-- Restricciones y trigger de Dots/conocimiento base, para las pruebas de integración contra Postgres.
-- Es el bloque §4.1 de prisma/sql/supabase-setup.sql (independiente de roles de auth), que `prisma db push` no crea
-- porque el esquema de Prisma no lo expresa. Si cambias aquello, refleja el cambio aquí.

do $$
begin
  if to_regclass('public.assistants') is not null then
    alter table public.assistants drop constraint if exists assistants_name_not_blank;
    alter table public.assistants add constraint assistants_name_not_blank check (length(btrim(name)) > 0);
    alter table public.assistants drop constraint if exists assistants_role_not_blank;
    alter table public.assistants add constraint assistants_role_not_blank check (length(btrim(role)) > 0);
    alter table public.assistants drop constraint if exists assistants_permissions_object;
    alter table public.assistants add constraint assistants_permissions_object
      check (jsonb_typeof(permissions) = 'object' and pg_column_size(permissions) <= 4096);
    alter table public.assistants drop constraint if exists assistants_default_active;
    alter table public.assistants add constraint assistants_default_active
      check (not (is_default and archived_at is not null));
  end if;

  if to_regclass('public.user_knowledge') is not null then
    alter table public.user_knowledge drop constraint if exists user_knowledge_content_object;
    alter table public.user_knowledge add constraint user_knowledge_content_object
      check (jsonb_typeof(content) = 'object' and pg_column_size(content) <= 32768);
    alter table public.user_knowledge drop constraint if exists user_knowledge_version_positive;
    alter table public.user_knowledge add constraint user_knowledge_version_positive check (version >= 1);
  end if;
end $$;

create or replace function public.assistants_single_default()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.is_default then
    perform pg_advisory_xact_lock(hashtext('assistants_default:' || new.user_id::text));
    update public.assistants
       set is_default = false
     where user_id = new.user_id and id <> new.id and is_default;
  end if;
  return new;
end;
$$;

drop trigger if exists assistants_single_default on public.assistants;
create trigger assistants_single_default
  before insert or update of is_default on public.assistants
  for each row when (new.is_default)
  execute function public.assistants_single_default();
