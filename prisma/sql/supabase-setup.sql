-- ════════════════════════════════════════════════════════════════════════
-- OmniAgent · Configuración de seguridad de Supabase
-- Ejecutar DESPUÉS de las migraciones de Prisma:  npm run db:security
-- Es idempotente: se puede correr varias veces (por ejemplo, tras cada migración nueva).
--
-- Por qué existe: Supabase publica el esquema `public` por su Data API. Cualquiera con la
-- publishable key podría leer o escribir tablas sin RLS. Aquí:
--   1) Toda tabla de `public` queda con RLS activo (denegar por defecto).
--   2) El cliente (supabase-js / Realtime) solo puede LEER sus propias filas.
--   3) Las escrituras pasan por la API del servidor (Prisma se conecta como `postgres`
--      y no está sujeto a RLS).
--   4) profiles se sincroniza con auth.users mediante triggers.
-- ════════════════════════════════════════════════════════════════════════

begin;

-- ─── 1. Perfiles sincronizados con Supabase Auth ───────────────────────

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url, updated_at)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url',
    now()
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace function public.handle_updated_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
     set email = new.email,
         updated_at = now()
   where id = new.id;
  return new;
end;
$$;

-- No usamos FK profiles → auth.users (rompe la shadow database de Prisma); este trigger
-- cumple la misma función: al borrar el usuario se borra su perfil y, en cascada, sus datos.
create or replace function public.handle_deleted_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.profiles where id = old.id;
  return old;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

drop trigger if exists on_auth_user_updated on auth.users;
create trigger on_auth_user_updated
  after update of email on auth.users
  for each row execute function public.handle_updated_user();

drop trigger if exists on_auth_user_deleted on auth.users;
create trigger on_auth_user_deleted
  after delete on auth.users
  for each row execute function public.handle_deleted_user();

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.handle_updated_user() from public, anon, authenticated;
revoke execute on function public.handle_deleted_user() from public, anon, authenticated;

-- ─── 2. RLS en todas las tablas de public (denegar por defecto) ────────

do $$
declare
  t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

-- ─── 3. Sin escrituras desde el cliente: todo pasa por la API ──────────

revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;
revoke select on all tables in schema public from anon;
alter default privileges for role postgres in schema public
  revoke insert, update, delete, truncate on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke select on tables from anon;

-- ─── 4. Lectura de las propias filas (para supabase-js y Realtime) ─────
-- El GRANT explícito hace que funcione aunque el proyecto no exponga tablas nuevas por defecto;
-- la política RLS limita cada fila a su dueño.
-- A propósito NO están aquí (quedan sin acceso desde el cliente, solo vía la API del servidor):
-- mail_messages, mail_attachments, personal_fields, calendar_feeds y document_blobs
-- (correos, datos personales cifrados, secretos del feed y binarios de documentos), price_points
-- (se lee por la API junto con su producto) y return_cases (el texto de los reclamos, las respuestas
-- de las tiendas y el historial: se leen por la API, que arma la vista con la aprobación pendiente).

do $$
declare
  tbl text;
  owner_tables text[] := array[
    'conversations', 'messages', 'agent_actions', 'notifications', 'tasks',
    'calendar_events', 'watchlist_items', 'suggestions', 'recurring_charges',
    'financial_accounts', 'transactions', 'goals', 'documents',
    'financial_analyses', 'savings_recommendations', 'category_budgets',
    'price_alerts', 'purchase_orders', 'tracked_orders'
  ];
begin
  foreach tbl in array owner_tables loop
    if to_regclass(format('public.%I', tbl)) is not null then
      execute format('grant select on public.%I to authenticated', tbl);
      execute format('drop policy if exists owner_select on public.%I', tbl);
      execute format(
        'create policy owner_select on public.%I for select to authenticated using ((select auth.uid()) = user_id)',
        tbl
      );
    end if;
  end loop;

  if to_regclass('public.profiles') is not null then
    grant select on public.profiles to authenticated;
    drop policy if exists owner_select on public.profiles;
    create policy owner_select on public.profiles
      for select to authenticated using ((select auth.uid()) = id);
  end if;
end $$;

-- ─── 5. Storage: bucket privado para documentos ────────────────────────
-- Rutas: {userId}/{documentId}/{archivo}. Se usa con DOCUMENT_STORAGE=supabase: el servidor sube,
-- lee y borra con la llave secreta (SUPABASE_SECRET_KEY, sin RLS) después de validar dueño, tamaño y tipo.
-- Desde el cliente solo se puede LEER la carpeta propia; subir y borrar pasa siempre por la API.

insert into storage.buckets (id, name, public, file_size_limit)
values ('documents', 'documents', false, 10485760)
on conflict (id) do update set public = false, file_size_limit = 10485760;

drop policy if exists "documents_owner_read" on storage.objects;
create policy "documents_owner_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Versiones anteriores de este script permitían subir y borrar desde el cliente: se retiran.
drop policy if exists "documents_owner_insert" on storage.objects;
drop policy if exists "documents_owner_delete" on storage.objects;

-- ─── 6. Realtime: aprobaciones y notificaciones en vivo ────────────────

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'agent_actions'
    ) then
      alter publication supabase_realtime add table public.agent_actions;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
    ) then
      alter publication supabase_realtime add table public.notifications;
    end if;
  end if;
end $$;

commit;
