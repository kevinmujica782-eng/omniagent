# Despliegue de OmniAgent

Qué se despliega:

- **La app Next.js**: la web, la API `/api/v1`, los webhooks de pagos y las tareas programadas `/api/cron/*`.
- **Supabase**: Postgres (con RLS), el inicio de sesión y, si lo activas, los archivos.
- **Servicios externos**: Anthropic (IA), Stripe (pagos en la web), RevenueCat (Google Play) y Plaid (opcional).

Hay dos caminos, con el mismo código:

| | Vercel (recomendado) | Docker (cualquier nube o VPS) |
|---|---|---|
| Servidores que mantener | Ninguno | El contenedor y un proxy HTTPS |
| Tareas programadas | `vercel.json` (diarias en Hobby) + `npm run db:cron` para cada hora | Servicio `scheduler` de `docker-compose.yml` |
| Escala | Automática | Réplicas del contenedor (la app no guarda estado) |

## 0. Una sola vez, antes del primer despliegue

1. **Un proyecto de Supabase solo para producción.** Ponlo en la región de tus usuarios y la app en la misma región: cada consulta cruza esa distancia.
2. **Sube `package-lock.json`.** Corre `npm install` en tu máquina (Node 22 o superior) y súbelo al repositorio. Así CI y Docker instalan exactamente las mismas versiones con `npm ci`.
3. **Crea las migraciones y guárdalas en el repositorio.** El repositorio trae el esquema (`prisma/schema.prisma`, 34 tablas), pero no la carpeta `prisma/migrations`: se genera en tu máquina contra una base de **desarrollo**.

   ```bash
   npx prisma migrate dev --name init              # base nueva: crea las 34 tablas
   # ¿ya tenías la base de una fase anterior? Solo lo nuevo:
   npx prisma migrate dev --name plan_pro_y_panel  # fase 5 (tabla rate_limits)
   npx prisma migrate dev --name devoluciones      # pedidos y devoluciones (tracked_orders y return_cases)
   git add prisma/migrations && git commit -m "Migraciones"
   ```

4. **Aplica las migraciones en producción** con `migrate deploy` (nunca `migrate dev`, que puede pedir resetear la base) y después la seguridad de Supabase:

   ```bash
   DIRECT_URL="postgresql://…:5432/postgres" npm run db:deploy
   DIRECT_URL="postgresql://…:5432/postgres" npm run db:security   # RLS, triggers y bucket; se puede repetir
   ```

   O deja que lo haga el workflow **Migrar base de datos** de GitHub (ver la sección 8).

## 1. Variables de entorno

La plantilla completa, con comentarios, está en `.env.example`. Las variables marcadas **al compilar** quedan fijas en el build: si las cambias, vuelve a desplegar.

| Variable | Cuándo se lee | ¿Obligatoria? | Nota |
|---|---|---|---|
| `NEXT_PUBLIC_APP_URL` | al compilar y al correr | Sí | `https://tu-dominio`, sin barra final. Stripe vuelve aquí. |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | al compilar y al correr | Sí | Project Settings → API. |
| `DATABASE_URL` | al correr | Sí | Transaction pooler (puerto 6543). |
| `DIRECT_URL` | migraciones y scripts | Para migrar | Session pooler (5432) o conexión directa. |
| `TOKEN_ENCRYPTION_KEY` | al correr | Sí | `openssl rand -base64 32`. **No la cambies después**: los tokens guardados quedarían ilegibles. |
| `SUPABASE_SECRET_KEY` | al correr | Con `DOCUMENT_STORAGE=supabase` | `sb_secret_…`. Solo para Storage. **Eliminar cuenta** no la usa: llama a la función `public.delete_auth_user` (`npm run db:security`). |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL_FREE`, `ANTHROPIC_MODEL_PRO` | al correr | Recomendada | Sin la llave, el chat responde "no configurado". |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO_MONTHLY` | al correr | Las tres o ninguna | Con solo una parte, el pago abre pero Pro nunca se activa: la app lo marca como error al arrancar. |
| `REVENUECAT_WEBHOOK_AUTH`, `REVENUECAT_PRO_ENTITLEMENT` | al correr | Para Android | Ver la sección 10. |
| `CRON_SECRET` | al correr | Recomendada | `openssl rand -hex 32`. Protege `/api/cron/*` y el detalle de `/api/health`. |
| `FINANCE_PROVIDER`, `PLAID_*` | al correr | No | `sandbox` por defecto. |
| `DOCUMENT_STORAGE` | al correr | No | `database` (por defecto) o `supabase`. |
| `WEB_PRICE_CHECKS`, `SCRAPER_CONTACT_URL` | al correr | No | Rastreador de precios. |
| `LOG_LEVEL`, `LOG_FORMAT`, `ERROR_WEBHOOK_URL` | al correr | No | Ver la sección 7. |
| `CSP_MODE` | **al compilar** | No | `enforce` (por defecto), `report-only` u `off`. |
| `APP_VERSION` | al correr | No | Aparece en `/api/health`. En Vercel se toma del commit. |
| `ENABLE_PREVIEW` | al correr | No | Déjala en `false` en producción. |
| `CORS_ALLOWED_ORIGINS` | al correr | No | Orígenes extra para la API (la app nativa ya está incluida). |
| `CAP_SERVER_URL` | al empaquetar Android | Para Android | La URL HTTPS de la web desplegada. |

Al arrancar, la app revisa su configuración y deja en los logs `config.missing_critical`, `config.missing_recommended` o `config.warning` (por ejemplo, "Stripe está en modo de prueba en producción"). No se detiene: la landing y `/api/health` siguen respondiendo, así el problema se ve enseguida.

## Producción actual (Netlify + Supabase)

La app publicada vive en **https://omniagent-app.netlify.app**:

- **Web y API:** proyecto `omniagent-app` de Netlify (Next.js con `@netlify/plugin-nextjs`, Node 24; ver `netlify.toml`). Las variables están en *Project configuration → Environment variables*. Cambiar una variable exige volver a publicar.
- **Base de datos:** proyecto `omniagent` de Supabase (`nhrporwspcvnmabjaqta`, us-east-1).
  - La app entra con el rol propio `omniagent_app`, con BYPASSRLS y miembro de `postgres`, por el pooler compartido `aws-0-us-east-1.pooler.supabase.com`: puerto 6543 en `DATABASE_URL` (con `sslmode=no-verify`) y 5432 en `DIRECT_URL`.
  - Las tablas se crearon con `prisma db push`, ejecutado en la compilación de Netlify con `DB_BOOTSTRAP=1` (ver `scripts/netlify-build.mjs`). Después se aplicó la seguridad de `prisma/sql/supabase-setup.sql`: RLS, triggers de `auth.users`, bucket y Realtime.
  - Para cambiar el esquema más adelante hay dos caminos:
    - Pon `DB_BOOTSTRAP=1` en Netlify durante una publicación; `db push` aplica los cambios que no borran datos.
    - O pasa a migraciones: crea `prisma/migrations/0_init` con `prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script` y márcala como aplicada con `prisma migrate resolve --applied 0_init`.
- **Tareas programadas:** las mismas de `npm run db:cron`, ya creadas en Supabase con pg_cron y pg_net. La URL y el `CRON_SECRET` están en Vault.
- **Código y CI:** repositorio `kevinmujica782-eng/omniagent`, público en GitHub: no guardes secretos en el código ni los pases como entradas de un workflow.
  - **CI:** revisa tipos, corre las pruebas y compila en cada push.
  - **Publicar en Netlify:** sube el código a Netlify y lo compila allá. Pide el `proxy_path` que entrega la herramienta *deploy-site* del MCP de Netlify; ese valor vence pronto. Para publicar sin ese paso, conecta el repositorio desde Netlify (*Project configuration → Build & deploy → Link repository*) y cada push a `main` se publica solo.
  - **Simular compilación de Netlify:** repite la instalación y la compilación en GitHub y deja los errores como anotaciones.
  - **App de Android:** compila el `.aab` (Google Play) y el `.apk` (instalar directo) firmados con la llave de subida `mobile/keystore/omniagent-upload.p12`.
    - El archivo de la llave está cifrado en el repositorio. Su contraseña no se guarda ahí: va en el secreto `ANDROID_KEYSTORE_PASSWORD` o en el campo `keystore_password` al correr el workflow.
    - El `versionCode` es el número de corrida, así que cada compilación sube de versión.

## 2. Opción A: Vercel

1. **Importa el repositorio** en Vercel. Detecta Next.js solo; el comando de build (`npm run build`) ya genera el cliente de Prisma.
2. **Variables:** carga las de la tabla en *Production*. Para *Preview*, usa otro proyecto de Supabase y las llaves de prueba de Stripe: una rama nunca debe tocar datos reales.
3. **Región de las funciones:** en la configuración del proyecto (Functions → Region), elige la más cercana a tu base de Supabase.
4. **Node.js:** versión 24.x (o 22.x) en la configuración del proyecto.
5. **Dominio:** agrégalo en Domains, pon la URL en `NEXT_PUBLIC_APP_URL` y vuelve a desplegar.
6. **Tareas programadas:** `vercel.json` trae tres crons diarios. Vercel manda `Authorization: Bearer <CRON_SECRET>` si la variable existe. El plan Hobby solo permite crons diarios: una expresión más frecuente hace **fallar el despliegue**. Para cumplir lo que promete Pro (precios cada hora, correo cada 3 horas), elige una de estas opciones:
   - **Supabase pg_cron** (gratis, cualquier plan de Vercel): `npm run db:cron`. Ver la sección 6.
   - **Vercel Pro:** en `vercel.json`, cambia el horario de compras a `"5 * * * *"` y el de trámites a `"35 * * * *"`.
7. **Logs:** Vercel muestra las líneas JSON de la app. Con *Log Drains* puedes mandarlas a tu herramienta de logs.

## 3. Opción B: Docker

La imagen (`Dockerfile`) compila Next.js en modo *standalone*. La imagen final no lleva el código fuente ni las dependencias de desarrollo, corre con un usuario sin privilegios y trae un `HEALTHCHECK` sobre `/api/health`.

```bash
cp .env.example .env         # complétalo (ver la sección 1)
docker compose up -d --build # web en :3000 + programador de tareas
docker compose logs -f web
```

- **Al compilar.** Las `NEXT_PUBLIC_*` y `CSP_MODE` entran como *build args*: `docker-compose.yml` las toma de `.env`. Si cambian, vuelve a compilar con `--build`. El resto de las variables se lee al arrancar desde `env_file`.
- **HTTPS.** Pon delante un proxy. Con Caddy, por ejemplo, el certificado es automático:

  ```
  tu-dominio.com {
    reverse_proxy localhost:3000
  }
  ```

- **Tareas programadas.** El servicio `scheduler` (Alpine + crond, `deploy/scheduler.sh`) llama a compras y trámites cada hora y a finanzas cada día con el `CRON_SECRET`. Corre **un solo** programador aunque tengas varias réplicas de la web.
- **Plataformas que solo corren la imagen** (Render, Railway, Fly.io, Cloud Run, ECS…):
  - Configura el puerto 3000 y el health check en `/api/health`.
  - Para las tareas, usa `npm run db:cron` o el cron de la plataforma, que llame a las rutas con la cabecera `Authorization: Bearer <CRON_SECRET>`.
- **Varias réplicas.** La app no guarda estado propio: la sesión va en cookies, y los límites de tasa y las tareas viven en Postgres. El revisor de precios además "reserva" cada producto antes de revisarlo, así que dos corridas simultáneas no duplican alertas.
- **Sin compilar en el servidor.** Puedes publicar la imagen en un registro (GHCR, ECR…) desde CI y solo descargarla en producción.
- **Red al compilar.** La compilación necesita internet: descarga las dependencias de npm y la fuente Onest de Google Fonts, que queda incluida en la imagen.

## 4. Supabase en producción

- **Authentication → URL Configuration:**
  - Site URL: `https://tu-dominio`.
  - Redirect URLs: `https://tu-dominio/auth/callback`.
- **Correo:** configura un SMTP propio (Authentication → Emails → SMTP). El envío integrado de Supabase tiene un límite muy bajo y es para pruebas. Si quieres, traduce también las plantillas de los correos.
- **Google (opcional):**
  1. Crea un cliente OAuth en Google Cloud con el redirect `https://TU-PROYECTO.supabase.co/auth/v1/callback`.
  2. Actívalo en Authentication → Providers.
- **Seguridad:** corre `npm run db:security` después de **cada** migración, porque activa RLS en las tablas nuevas. Revisa después el *Security Advisor* del panel.
- **Respaldo:** los planes pagos de Supabase hacen respaldos diarios. Activa PITR si necesitas recuperar a un minuto exacto.
- **Proyectos gratis:** Supabase pausa los proyectos gratis tras un tiempo sin uso. En producción usa un plan pago.

## 5. Stripe en producción (plan Pro de US$19.99 al mes)

1. **Activa la cuenta** (datos del negocio y cuenta bancaria) y pasa el Dashboard a modo *live*. Las llaves, precios y webhooks de *live* son distintos de los de prueba.
2. **Producto:** crea **OmniAgent Pro** con un precio **recurrente mensual de USD 19.99**. Su id (`price_…`) va en `STRIPE_PRICE_PRO_MONTHLY`.
3. **Webhook:** crea un endpoint `https://tu-dominio/api/webhooks/stripe` con estos eventos. Su secreto (`whsec_…`) va en `STRIPE_WEBHOOK_SECRET`.
   - `checkout.session.completed`
   - `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`
   - `invoice.paid`, `invoice.payment_failed`

   La versión de la API del endpoint debe ser **2025-03-31.basil o posterior**, porque la app lee el fin de periodo de cada ítem y la suscripción desde `invoice.parent`. Lo ideal es la versión más reciente que ofrezca el Dashboard.
4. **Portal de clientes** (Settings → Billing → Customer portal): permite actualizar la tarjeta, ver facturas y cancelar al final del periodo. No hace falta cambiar de plan, porque hay uno solo. El botón **Administrar suscripción** de la app abre este portal.
5. **Cobros fallidos:** activa los reintentos automáticos (*Smart Retries*) y define qué pasa si fallan todos. Recomendado: cancelar la suscripción. Mientras Stripe reintenta, la suscripción queda `past_due` y la persona conserva Pro, con un aviso en la app. Si al final se cancela, vuelve a Gratis y sus agentes se ajustan solos.
6. **Correos de Stripe:** activa los recibos y el aviso de pago fallido (Settings → Customer emails).
7. **Impuestos:** Stripe Tax no está activado en el código. Si tu país lo requiere, actívalo y añade `automatic_tax` en `createProCheckout`.
8. **Pruebas antes del lanzamiento:**
   - En modo de prueba: tarjeta `4242 4242 4242 4242` y `stripe listen --forward-to localhost:3000/api/webhooks/stripe`.
   - Para simular una renovación o un cobro fallido sin esperar un mes, usa los *test clocks* de Stripe.

Al volver de Checkout, la app sincroniza la suscripción en el momento (`/api/v1/billing/sync`), sin esperar al webhook. El webhook hace lo mismo y es idempotente: cada evento se procesa una sola vez.

## 6. Tareas programadas

| Ruta | Qué hace | Frecuencia recomendada |
|---|---|---|
| `/api/cron/concierge` | Revisa los precios que tocan (Pro cada hora, Gratis una vez al día), crea alertas, vence alertas y compras viejas y limpia `rate_limits` | Cada hora |
| `/api/cron/procedures` | Revisa bandejas (Pro cada 3 h, Gratis cada 20 h) y entrega recordatorios | Cada hora |
| `/api/cron/finance` | Sincroniza bancos y genera el informe mensual (Pro) | Una vez al día |
| `/api/cron/returns` | Pedidos y devoluciones: prepara el reclamo de los pedidos atrasados, propone los seguimientos que tocan, lee las respuestas de las tiendas y confirma reembolsos en Finanzas | Cada hora |

Cada corrida decide qué toca según el plan de cada persona: llamar de más no duplica trabajo. Las cuatro rutas exigen `Authorization: Bearer <CRON_SECRET>` y registran `cron.done`, con conteos, en los logs.

En `vercel.json`, `/api/cron/returns` corre una vez al día (11:45 UTC) por el límite del plan Hobby. Los seguimientos se programan para las 9:00, hora local de cada persona; con una sola corrida diaria pueden salir hasta un día después. Para que salgan a tiempo, llámala cada hora con `npm run db:cron`, Vercel Pro o el programador de Docker. La pantalla Devoluciones se pone al día sola cada vez que alguien la abre.

**Con Supabase (`npm run db:cron`):**

- Activa `pg_cron` y `pg_net`.
- Guarda la URL pública y el `CRON_SECRET` cifrados en Supabase Vault.
- Crea cuatro trabajos: `omniagent-compras`, `omniagent-tramites`, `omniagent-finanzas` y `omniagent-devoluciones`.
- Es idempotente: si cambias el dominio o el secreto, vuelve a correrlo. Para quitarlos: `npm run db:cron -- --remove`.

Para revisar las corridas:

```sql
select jobname, status, start_time from cron.job_run_details
  join cron.job using (jobid) order by start_time desc limit 10;
select status_code, content, created from net._http_response order by created desc limit 10;
```

`cron.job_run_details` solo dice que la llamada salió. La respuesta de la app (código HTTP y conteos) está en `net._http_response`, que guarda las últimas 6 horas.

## 7. Monitoreo, errores y seguridad

- **`/api/health`:**
  - Sin credenciales responde `{status, version, latencyMs}`, con `200 ok` o `503 degraded` si la base no contesta en 5 s. Úsala en tu monitor de disponibilidad y en el balanceador.
  - Con `Authorization: Bearer <CRON_SECRET>` añade el estado de cada integración (`ok` / `not_configured`), nunca sus valores.
- **Logs estructurados:**
  - Una línea JSON por evento, con `level`, `event`, `requestId` y el contexto.
  - Contraseñas, tokens, llaves, cookies, correos y teléfonos se ocultan antes de escribir.
  - Los errores de la API tienen siempre la forma `{ error: { code, message, details, requestId } }`, y el `requestId` también va en la cabecera `x-request-id`. Cuando alguien te mande el código que vio, búscalo en los logs.
- **Alertas:** con `ERROR_WEBHOOK_URL` (webhook entrante de Slack o Discord), cada error 5xx avisa como mucho una vez por minuto por tipo de error. El aviso lleva el evento, el mensaje y el id de la solicitud, nunca datos de usuarios.
- **Límites de tasa** (tabla `rate_limits`, compartida entre réplicas; se limpia sola):

  | Acción | Límite |
  |---|---|
  | Chat | 20 mensajes por minuto |
  | Pago | 10 por hora |
  | Aprobar compras | 30 cada 10 minutos |
  | Subir documentos | 20 por hora |
  | Eliminar la cuenta | 3 por hora |

  Si falla la base, el límite deja pasar (no bloquea a nadie) y lo registra.
- **Cabeceras:** en producción van CSP, HSTS (dos años, con `preload`), COOP, `X-Frame-Options: DENY`, `nosniff` y `Permissions-Policy`. La API responde con `Cache-Control: private, no-store`.
  - Antes de enviar el dominio a la lista de precarga de HSTS, confirma que todos sus subdominios sirven HTTPS.
  - Si integras algo nuevo y la CSP lo bloquea, compila con `CSP_MODE=report-only`, revisa la consola del navegador y ajusta `next.config.ts`.

## 8. CI/CD con GitHub Actions

- **`.github/workflows/ci.yml`:**
  - En cada pull request y en `main`: instala, revisa tipos, corre las pruebas unitarias y compila para producción.
  - En `main`, además, compila la imagen de Docker y comprueba que arranca y que `/api/health` responde `degraded`, no se cuelga, cuando la base no existe.
- **`.github/workflows/migrate.yml`:**
  - Aplica `prisma migrate deploy` y `npm run db:security` en la base de producción.
  - Corre al subir a `main` cambios en `prisma/migrations`, o a mano.
  - Necesita el secreto `DIRECT_URL` en el entorno `production` de GitHub. Añade revisores obligatorios a ese entorno para aprobar cada migración.

Flujo recomendado:

1. Pull request.
2. CI en verde.
3. Merge a `main`.
4. Se aprueba la migración.
5. Vercel despliega `main`.

Las migraciones de este proyecto solo agregan tablas o columnas, así que pueden ir antes o junto con el despliegue. Si alguna vez borras o renombras algo, hazlo en dos pasos: primero el código que ya no lo usa y después la migración.

## 9. Lista de salida a producción

- [ ] `/api/health` responde `ok`. Con el secreto, cada integración está en `ok`, salvo las que decidiste no usar.
- [ ] Los logs no muestran `config.missing_critical`.
- [ ] Registro, correo de confirmación e inicio de sesión funcionan con el dominio real.
- [ ] Stripe *live*:
  - Compra Pro con una tarjeta real: al volver, Pro ya está activo.
  - El webhook aparece con código 200 en el Dashboard.
  - Cancelas en **Administrar suscripción** y Pro sigue hasta el fin del periodo.
  - Si quieres, reembolsa esa compra desde el Dashboard.
- [ ] Tareas: `cron.done` aparece en los logs cada hora (compras y trámites) y una vez al día (finanzas).
- [ ] La consola del navegador no muestra bloqueos de CSP.
- [ ] `ENABLE_PREVIEW=false`.
- [ ] **Cuenta → Eliminar cuenta** funciona con una cuenta de prueba: la cuenta desaparece de Supabase Auth y su suscripción de prueba queda cancelada en Stripe.
- [ ] El *Security Advisor* de Supabase no muestra tablas sin RLS.

## 10. Google Play (Android)

La app de Android usa Capacitor 8 en modo *hosted*: abre tu web desplegada, con la sesión y la API incluidas.

**Requisitos:**

- Node 22 o superior.
- Android Studio Otter (2025.2.1) o posterior.
- *Target API* 36: Google Play lo exige desde el 31 de agosto de 2026 para apps nuevas y actualizaciones. Capacitor 8 ya compila con `compileSdk` y `targetSdk` 36.

```bash
# CAP_SERVER_URL=https://tu-dominio en .env
npm run cap:add     # la primera vez: crea android/
npm run cap:sync
npm run cap:open    # Android Studio → Build → Generate Signed App Bundle (.aab)
```

Antes de publicar, en Play Console:

- **Pagos:** las suscripciones digitales compradas dentro de la app deben usar Google Play Billing.
  - Crea la suscripción mensual de US$19.99 y conéctala a RevenueCat con el entitlement `pro`.
  - Configura el webhook de RevenueCat a `https://tu-dominio/api/webhooks/revenuecat`.
  - Por esa política, la app de Android no abre Stripe ni manda a pagar a otro lado: muestra que Pro llegará con Google Play.
  - Falta integrar el SDK de RevenueCat en la app nativa; está en la hoja de ruta.
- **Eliminación de la cuenta:** es obligatoria si la app permite crear cuentas.
  - En la app: **Cuenta → Eliminar cuenta**.
  - En la web: `https://tu-dominio/cuenta`, la misma opción después de entrar. Declara esa URL en *App content → Data safety*.
  - Si alguien paga con Google Play, la hoja le recuerda cancelar allí, porque el servidor no puede cancelar esa suscripción.
- **Política de privacidad:** publica una URL propia, redactada con tu asesor legal. Es obligatoria y la app no trae una.
- **Seguridad de los datos (Data safety):** declara correo y nombre, información financiera (si conectan bancos), contenido de correos (si conectan la bandeja), archivos (documentos) e historial de compras. Todo viaja cifrado y se puede eliminar.
- **Funciones financieras** (*App content → Financial features*): declara que la app muestra y analiza finanzas personales.
- **Público y clasificación:** completa el cuestionario. Recomendado: solo mayores de 18, porque la app maneja pagos y finanzas.
- **Cuentas personales de desarrollador nuevas:** Google pide una prueba cerrada con al menos 12 testers durante 14 días antes de publicar en producción.
- **Inicio de sesión:** Google bloquea OAuth dentro de WebViews, así que en la app se entra con correo y contraseña.

## 11. Problemas comunes

- **`/api/health` en `degraded` o errores `database_unavailable` (503):**
  - Revisa `DATABASE_URL`: debe ser el pooler de transacciones, puerto 6543.
  - Revisa que el proyecto de Supabase no esté pausado.
  - La app corta a los 5 s si la base no contesta.
- **Stripe responde 400 "Firma inválida":**
  - `STRIPE_WEBHOOK_SECRET` no corresponde a ese endpoint. Pasa a menudo al mezclar el de prueba con el de *live*.
  - Un proxy delante de la app puede estar modificando el cuerpo de la petición.
- **Pro no se activa:**
  - Faltan eventos en el webhook, o la versión de la API del endpoint es anterior a basil.
  - Mira `stripe.webhook.failed` en los logs.
  - Stripe reintenta durante días y la app reprocesa los eventos que quedaron a medias.
- **Vercel no despliega: "Hobby accounts are limited to daily cron jobs":** dejaste un horario por hora en `vercel.json`. Vuelve a los diarios y usa `npm run db:cron`.
- **Las tareas responden 401:** el `CRON_SECRET` de la app y el del programador (Vercel, Vault o Docker) no coinciden. Si lo cambias, vuelve a correr `npm run db:cron`.
- **Algo dejó de cargar en el navegador tras desplegar:** es la CSP. Compila con `CSP_MODE=report-only`, revisa la consola y ajusta `next.config.ts`.
- **Error "no configurado" (503):** falta la variable de esa integración. El detalle está en `/api/health` con el secreto.
