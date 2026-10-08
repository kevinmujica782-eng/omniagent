# OmniAgent

Agente personal con IA para web y Android. **Omni se encarga; tú solo apruebas.**

> **En línea:** https://omniagent-app.netlify.app (Netlify + Supabase). Cómo se publicó y cómo volver a publicar: [`docs/DEPLOY.md`](docs/DEPLOY.md#producción-actual-netlify--supabase). Pasos para Google Play: [`docs/GOOGLE_PLAY.md`](docs/GOOGLE_PLAY.md).

Omni analiza tus finanzas (gastos hormiga, suscripciones sin uso, recomendaciones de ahorro), encuentra en tu correo los trámites pendientes (permisos, citas, reembolsos, facturas), llena los formularios PDF con tus datos, los agenda en tu calendario, vigila precios de productos, boletos, vuelos y hoteles para avisarte cuando bajan de verdad y sigue tus pedidos hasta que llegan: si uno se atrasa o llega mal, prepara el reclamo, insiste si la tienda no responde y confirma cuando vuelve tu dinero. Todo lo que gasta dinero, envía algo o cancela un servicio pasa por una **boleta de aprobación**: Omni propone, tú apruebas o rechazas, y solo entonces el servidor lo ejecuta.

---

## Qué incluye

| Área | Lo que ya funciona |
| --- | --- |
| **Inicio** | Panel central de los módulos: lo que espera tu permiso (cobro fallido, compras, aprobaciones, devoluciones, trámites urgentes y ofertas), ritmo de gasto del mes frente al anterior, próximos trámites, precios vigilados, ahorro logrado con Omni (con lo recuperado en devoluciones), estado de los agentes, actividad y consumo del plan. Claro, oscuro o del sistema, con barra de pestañas en el teléfono. |
| **Chat con agente** | Claude con function calling (41 herramientas en 4 módulos), tarjetas ricas, preguntas sugeridas, historial, cuota mensual por plan y prompt caching. |
| **Asistente financiero** | Conector de cuentas tipo Plaid (sandbox con bancos ficticios o Plaid real), **estados de cuenta en PDF o CSV** para bancos que no se pueden conectar (vista previa, corrección de columnas, fechas y signos, sin duplicados y con deshacer), sincronización incremental con cursor, análisis con IA de los últimos 3 meses, gastos hormiga, suscripciones inactivas, recomendaciones de ahorro que se aplican con un toque, presupuestos por categoría, buscador de movimientos y análisis mensual automático. |
| **Trámites y productividad** | Conector de correo con el contrato de Gmail/Outlook (bandeja sandbox), detección de formularios adjuntos, citas, reembolsos, facturas y fechas límite (reglas + Claude), lectura de PDF con IA y llenado automático (AcroForm y PDF planos), "Mis datos" cifrados, fechas sugeridas sin choques con el calendario, **confirmación de un toque**, calendario sincronizado (calendario conectado + feed ICS privado con alarmas), recordatorios y respuesta con el PDF adjunto previa aprobación. |
| **Compras y ofertas** | Seguir productos, boletos, vuelos y hoteles por enlace o búsqueda; lectura del precio con datos estructurados (JSON-LD, microdata, meta) o con Claude; **agente en segundo plano** que revisa precios con cron, respeta robots.txt y se identifica como OmniAgentBot; detección de **bajadas de verdad** frente a la mediana de 30 días; **alertas inteligentes** redactadas por Claude y validadas cifra por cifra, con botón de compra rápida; y **hoja de pago segura** con **Permitir / Denegar** que reconfirma el precio, respeta tus límites y nunca cobra dos veces (pagos simulados, sin cobro real). |
| **Pedidos y devoluciones** | Sigue tus pedidos (compras con OmniAgent, correos de tiendas y paqueterías, o agregados a mano) contra la fecha prometida. Si uno va 2 días tarde, **prepara el reclamo solo**; si llegó dañado, equivocado o distinto al anuncio, lo prepara con un toque. El correo a la tienda sale desde tu bandeja **solo si lo apruebas** (en Amazon, Mercado Libre y otros marketplaces te deja el texto listo y te dice dónde reclamar). Si la tienda no responde, propone seguimientos; si tampoco, te dice cómo escalar (plataforma, banco o protección al consumidor). Lee las respuestas de la tienda y confirma el reembolso en tus movimientos de Finanzas. |
| **Metas** | Metas con monto, fecha, aporte mensual sugerido y pasos. |
| **Ideas** | Sugerencias proactivas a partir de tus datos (incluye las 3 mejores recomendaciones del análisis financiero). |
| **Planes y pagos** | Gratis y **Pro ($19.99 al mes)**, que pone a los agentes en piloto automático: correo revisado cada 3 horas, precios cada hora, informe mensual, alertas redactadas por Omni y el modelo más capaz. Los límites se validan en el servidor. **Pantalla de Omni Pro** a pantalla completa, siempre oscura, con la comparación Gratis / Pro y el botón **Desbloquear Omni Pro**. Stripe en la web (Checkout en español, portal, activación al volver del pago, webhooks idempotentes y aviso de cobro fallido) y RevenueCat para Google Play. |
| **Seguridad** | Supabase Auth, RLS en todas las tablas, tokens cifrados (AES-256-GCM), tokens del sandbox firmados (HMAC), webhooks idempotentes, bitácora de auditoría, límites de tasa, CSP y HSTS, y **eliminación de la cuenta** desde la app. |
| **Producción** | Errores con formato estable e id de solicitud, logs JSON sin datos sensibles, `/api/health`, revisión de la configuración al arrancar, pantallas de error propias, 148 pruebas unitarias (`npm test`), Docker, CI/CD con GitHub Actions y guía de despliegue en [`docs/DEPLOY.md`](docs/DEPLOY.md). |
| **Android** | Capacitor 8 configurado (modo hosted, target API 36) y API lista para token Bearer. |
| **Vista previa** | `/preview`: todas las pantallas con datos de ejemplo, **sin** configurar Supabase. |

## Stack

- **Next.js 16** (App Router, `proxy.ts`, React 19) + **TypeScript** estricto + **Tailwind CSS 4**
- **Supabase**: PostgreSQL + Auth (`@supabase/ssr`, `getClaims()`)
- **Prisma 7** (`prisma-client` generator, driver adapter `@prisma/adapter-pg`, `prisma.config.ts`)
- **Anthropic SDK**: `claude-haiku-4-5-20251001` en el plan Gratis y `claude-sonnet-5-5` en Pro (configurable)
- **zod 4**: validación de API y esquemas de las herramientas (se convierten a JSON Schema)
- **Stripe** (web) + **RevenueCat** (Google Play Billing)
- **Plaid** (opcional) para cuentas reales; sandbox propio por defecto
- **pdf-lib** (leer y llenar formularios) y **pdf.js** (`pdfjs-dist`, texto y posiciones para PDF sin campos)
- **Capacitor 8** para Android
- **lucide-react** para íconos y la fuente **Onest** (`next/font`)
- **Vitest** (pruebas unitarias), **Docker** (Next.js *standalone*) y **GitHub Actions** (CI y migraciones)

## Estructura

```
omniagent/
├── prisma/
│   ├── schema.prisma            # 34 tablas: usuarios, pagos, IA, finanzas, trámites, correo, compras, devoluciones, metas, límites de tasa...
│   └── sql/supabase-setup.sql   # RLS, triggers con auth.users, Storage y Realtime (idempotente)
├── scripts/
│   ├── db-sql.mjs               # aplica el SQL anterior (npm run db:security)
│   └── db-cron.mjs              # tareas programadas dentro de Supabase: pg_cron + pg_net (npm run db:cron)
├── tests/unit/                  # pruebas unitarias con Vitest (npm test)
├── docs/DEPLOY.md               # despliegue: Vercel, Docker, Supabase, Stripe, CI/CD y Google Play
├── .github/workflows/           # ci.yml (tipos, pruebas, build e imagen) y migrate.yml (migraciones de producción)
├── Dockerfile, .dockerignore    # imagen de producción: standalone, usuario sin privilegios y healthcheck
├── docker-compose.yml           # web + programador de tareas (deploy/scheduler.sh)
├── mobile/www/                  # pantalla sin conexión de la app nativa
├── vercel.json                  # cron diario de finanzas, trámites, compras y devoluciones
├── next.config.ts               # cabeceras de seguridad (CSP, HSTS) y salida standalone
├── vitest.config.mts, capacitor.config.ts, prisma.config.ts
└── src/
    ├── proxy.ts                 # sesión de Supabase, rutas protegidas y CORS para /api
    ├── instrumentation.ts       # revisa la configuración al arrancar y registra los errores de Next.js
    ├── app/
    │   ├── page.tsx             # landing
    │   ├── preview/             # galería con datos de ejemplo (solo desarrollo)
    │   ├── (auth)/login/        # correo y contraseña, registro y Google
    │   ├── auth/                # callback, confirm y signout
    │   ├── bot/                 # página pública de OmniAgentBot (qué hace y cómo bloquearlo)
    │   ├── (app)/               # inicio, chat, ideas, metas, finanzas, trámites, compras, devoluciones, aprobaciones, conexiones, cuenta
    │   │   ├── inicio/          # panel de control (con su esqueleto de carga)
    │   │   └── tramites/        # tablero de trámites y revisión de formularios (formularios/[id])
    │   ├── error.tsx, global-error.tsx, not-found.tsx
    │   └── api/
    │       ├── v1/              # API para web y app nativa (cookie o Bearer)
    │       ├── health/          # salud para monitores, Docker y balanceadores
    │       ├── calendar/[token] # feed ICS privado (URL secreta, sin sesión)
    │       ├── cron/            # finance/, procedures/, concierge/ y returns/ (tareas programadas)
    │       └── webhooks/        # stripe y revenuecat
    ├── modules/                 # dominio: un módulo por área
    │   ├── agent/               # bucle de function calling, prompt y registro de herramientas
    │   ├── actions/             # Proponer → Aprobar → Ejecutar
    │   ├── engine/              # motor de ejecución autónoma: tipos, reglas, almacén, ejecutor, servicio, pasos y playbooks
    │   ├── sites/               # páginas web que arma Omni: esquemas, revisión, IA, servicio y herramientas
    │   ├── memory/              # memoria de Omni: recuerdos tipados y contexto de cada turno
    │   ├── dashboard/           # rules.ts (saludo, gasto del mes, lo pendiente, agentes: puro) y dashboard.service.ts
    │   ├── finance/
    │   │   ├── providers/       # contrato tipo Plaid: sandbox.ts, plaid.ts y catálogo del sandbox
    │   │   ├── insights/        # snapshot de 3 meses, candidatas por reglas, informe con Claude
    │   │   ├── sync.service.ts  # conectar, sincronizar (cursor) y desconectar
    │   │   ├── statement-import/ # estados de cuenta PDF/CSV: lectores, validación, categorías, deduplicación y servicio
    │   │   ├── finance.service.ts, budgets.service.ts, cancellation.ts, jobs.ts
    │   │   └── finance.tools.ts # 11 herramientas del asistente financiero
    │   ├── procedures/          # trámites, correo, documentos y calendario
    │   │   ├── mail/            # providers/ (contrato Gmail/Outlook + sandbox), triage/ (reglas + Claude), mail.service
    │   │   ├── documents/       # pdf.ts (inspección), fill.ts (llenado), extract.ts (Claude/reglas), Mis datos, storage
    │   │   ├── calendar/        # scheduler (fechas sugeridas), ics.ts (RFC 5545), calendar y feed services
    │   │   ├── time/            # zonas horarias y fechas en español ("a más tardar el viernes 2 de octubre")
    │   │   ├── plan-rules.ts    # pasos, eventos y vista de cada trámite (puro)
    │   │   ├── plan.ts          # sugerir, confirmar con un toque, reprogramar, posponer, completar
    │   │   ├── reminders.ts, jobs.ts
    │   │   └── procedures.tools.ts # 13 herramientas de trámites
    │   ├── concierge/           # compras y ofertas
    │   │   ├── scraper/         # fetcher.ts (red segura, robots.txt, ritmo por dominio), extract.ts (JSON-LD, microdata, meta), page-ai.ts, money.ts
    │   │   ├── sandbox/         # 9 tiendas de prueba (.test) con precios deterministas y ventas relámpago
    │   │   ├── rules/           # bajadas (drops.ts), horarios (schedule.ts), cotización y límites (checkout.ts), textos de alertas: puros
    │   │   ├── sources.ts, checker.ts, alerts.service.ts, checkout.service.ts, tracking.service.ts, payments.ts, jobs.ts
    │   │   └── concierge.tools.ts # 9 herramientas de compras
    │   ├── returns/             # pedidos y devoluciones
    │   │   ├── rules/           # entregas y plazos (delivery.ts), correos de pedidos, reclamos y seguimientos (claim.ts), respuestas de tiendas, reembolsos y turnos: puros
    │   │   ├── merchants.ts     # tiendas de prueba, marketplaces reales (dónde reclamar) y paqueterías
    │   │   ├── returns.service.ts, views.ts, sandbox.ts, jobs.ts
    │   │   └── returns.tools.ts # 5 herramientas de pedidos y devoluciones
    │   ├── billing/             # plans.ts (Gratis/Pro y funciones), status.ts, entitlements.ts, plan-change.ts, stripe.ts, revenuecat.ts, upgrade.ts
    │   ├── account/             # eliminar la cuenta (Stripe, bancos, archivos y Supabase Auth)
    │   ├── notifications/  goals/  ideas/  connections/
    ├── components/
    │   ├── views/dashboard-view.tsx, dashboard/ # panel de Inicio y gráfica de ritmo de gasto
    │   ├── finance/             # diálogo de conexión, informe, paneles, buscador de movimientos
    │   ├── procedures/          # tarjeta de trámite, tablero, agenda, revisión de formularios, Mis datos, calendario
    │   ├── concierge/           # alerta, lista y detalle con gráfica, seguir un enlace, hoja de pago (Permitir/Denegar), pedidos
    │   ├── returns/             # tarjeta del reclamo, hoja "¿Qué pasó con tu pedido?", fila del pedido, formulario, tarjetas del chat
    │   ├── paywall/             # pantalla de Omni Pro: órbita de 24 h, comparación Gratis / Pro y botón de pago
    │   └── ...                  # shell con pestañas, hoja de Pro, eliminar cuenta, tema, chat, boleta, tarjetas, landing
    ├── lib/                     # auth, db, env, http y error-mapping (errores), log, rate-limit, config-check, tema, cifrado, purchase (Stripe / Google Play)...
    └── types/                   # cards.ts, dashboard.ts y billing.ts: contratos entre servicios, API y UI
```

## Puesta en marcha

Requisitos: **Node 22 o superior**, un proyecto de Supabase y una API key de Anthropic.

### 1. Ver la app sin configurar nada

```bash
npm install          # también genera el cliente de Prisma
npm run dev
```

- `http://localhost:3000`: landing
- `http://localhost:3000/preview?screen=chat`: la app con datos de ejemplo. Pantallas: `inicio`, `inicio-gratis`, `inicio-nuevo`, `mejorar` (la hoja de Pro), `chat`, `ideas`, `metas`, `finanzas`, `aprobaciones`, `conexiones`, `cuenta`, `cuenta-gratis`, `eliminar-cuenta`, `chat&vacio=1`; del módulo financiero, `finanzas-vacia`, `conectar`, `conectar-cuentas`, `conectar-listo`, `analisis` y `chat-finanzas`; del de trámites, `tramites`, `tramites-vacia`, `conectar-correo`, `correo-conectado`, `formulario` y `chat-tramites`; y del de compras, `compras`, `compras-vacia`, `seguir-precio`, `pago`, `pago-listo` y `chat-compras`. Los datos de ejemplo pasan por las mismas reglas que en producción: la bandeja de prueba, por el clasificador y el planificador; las tiendas de prueba, por el lector de precios, la detección de bajadas y la cotización.

### 2. Conectar Supabase y la base de datos

1. Crea un proyecto en Supabase.
2. `cp .env.example .env.local` y completa:
   - `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (Project Settings → API).
   - `DATABASE_URL`: cadena del **transaction pooler** (puerto 6543), para la app.
   - `DIRECT_URL`: cadena del **session pooler** (puerto 5432) o la conexión directa, para migraciones.
   - `ANTHROPIC_API_KEY` y `TOKEN_ENCRYPTION_KEY` (`openssl rand -base64 32`).
3. Crea las tablas y aplica la seguridad:

```bash
npx prisma migrate dev --name init   # instalación nueva: crea las 34 tablas
npm run db:security                  # RLS, triggers, bucket "documents" y Realtime
```

¿Ya tenías la base de una fase anterior? Aplica solo los cambios nuevos:

```bash
npx prisma migrate dev --name modulo_tramites   # fase 3: correo, documentos, Mis datos y feed del calendario
npx prisma migrate dev --name modulo_compras    # fase 4: alertas de precio, pedidos y columnas nuevas de seguimiento
npx prisma migrate dev --name plan_pro_y_panel  # fase 5: límites de tasa (rate_limits)
npx prisma migrate dev --name devoluciones      # pedidos y devoluciones (tracked_orders y return_cases)
npx prisma migrate dev --name estados_de_cuenta # estados de cuenta PDF/CSV (cuenta y movimientos ligados a cada importación)
npm run db:security
```

> Corre `npm run db:security` **después de cada migración nueva**: activa RLS en las tablas nuevas. Las de trámites (`mail_messages`, `mail_attachments`, `personal_fields`, `calendar_feeds`, `document_blobs`) quedan sin ningún acceso desde el cliente: solo la API las lee. Las de compras (`price_alerts`, `purchase_orders`) y `tracked_orders` solo dejan que cada usuario lea sus propias filas; `return_cases` (el texto de los reclamos y las respuestas de las tiendas) queda solo para la API.

4. En Supabase → Authentication → URL Configuration:
   - Site URL: `http://localhost:3000` (y tu dominio en producción).
   - Redirect URLs: `http://localhost:3000/auth/callback` y `https://TU-DOMINIO/auth/callback`.
   - Opcional: activa el proveedor **Google**.
5. `npm run dev`, crea tu cuenta y entra a **Finanzas → Conectar cuenta** (o **Probar con datos de ejemplo**). Al terminar, Omni te muestra el análisis de tus últimos 3 meses y puedes seguir la conversación en el chat.
6. Entra a **Trámites → Conectar correo de prueba**: Omni lee la bandeja ficticia, detecta 7 trámites y te propone fechas. Confirma uno con un toque, abre el permiso escolar para verlo lleno con los datos de ejemplo y genera el PDF.
7. Entra a **Compras → Seguir un precio**, toca una sugerencia (por ejemplo, *Audífonos*), elige un resultado y toca **Seguir precio**: Omni lee la tienda de prueba y guarda 29 días de historial. Abre el producto y toca **Probar una bajada** para ver la alerta; después, **Comprar** → **Permitir** con la tarjeta de prueba. Para el agente en segundo plano, define `CRON_SECRET` (ver la tarea programada del módulo de compras).
8. Entra a **Devoluciones → Probar con pedidos de ejemplo**: uno va 3 días tarde y Omni ya le preparó el reclamo, otro ya llegó y otro está en camino. Con la bandeja de prueba del paso 6, el reclamo se aprueba en la misma tarjeta y sale a la tienda de prueba; sin bandeja, Omni te deja el texto listo. Con el reclamo enviado, toca **Simular respuesta de la tienda**. En el pedido que ya llegó, **Tengo un problema** prepara el reclamo por un producto dañado.

### 3. Pagos con Stripe (web)

1. Crea el producto **OmniAgent Pro** con un precio recurrente de **$19.99 al mes** y copia su ID en `STRIPE_PRICE_PRO_MONTHLY`.
2. Añade `STRIPE_SECRET_KEY`.
3. Crea un webhook a `https://TU-DOMINIO/api/webhooks/stripe` con estos eventos:
   - `checkout.session.completed`
   - `customer.subscription.created`, `.updated`, `.deleted`, `.paused` y `.resumed`
   - `invoice.paid` e `invoice.payment_failed`

   Usa la versión de API 2025-03-31.basil o posterior y copia su secreto en `STRIPE_WEBHOOK_SECRET`.
4. En local, usa `stripe listen --forward-to localhost:3000/api/webhooks/stripe` y la tarjeta de prueba `4242 4242 4242 4242`.
5. Activa el portal de clientes de Stripe (tarjeta, facturas y cancelación al final del periodo) para el botón **Administrar suscripción**.

Al volver del pago, Pro se activa en el momento (`/api/v1/billing/sync`), sin esperar al webhook. La configuración de producción (modo *live*, reintentos de cobro, correos e impuestos) está en la sección 5 de [`docs/DEPLOY.md`](docs/DEPLOY.md).

### 4. Suscripciones en Android (RevenueCat + Google Play)

Google Play exige su propio sistema de cobro para suscripciones digitales dentro de la app, así que en Android se usa RevenueCat:

1. Crea la suscripción en Google Play Console y conéctala en RevenueCat con un entitlement llamado `pro` (o cambia `REVENUECAT_PRO_ENTITLEMENT`).
2. Webhook de RevenueCat a `https://TU-DOMINIO/api/webhooks/revenuecat` con un **Authorization header** secreto, el mismo valor que `REVENUECAT_WEBHOOK_AUTH`.
3. Instala el plugin nativo y sincroniza: `npm i @revenuecat/purchases-capacitor` y `npx cap sync android`.
4. Pon la llave pública del SDK de Android en `NEXT_PUBLIC_REVENUECAT_ANDROID_KEY` (empieza con `goog_`) y publica la web de nuevo.

La pantalla de Omni Pro (`src/lib/purchase.ts`) configura RevenueCat con el id de Supabase de la persona, compra el paquete mensual de la oferta actual y espera a que el webhook active Pro. Muestra el precio que cobra Google Play en la moneda de cada persona. Sin el plugin o la llave, explica que el pago con Google Play llega en otra versión: dentro de la app nunca se ofrece pagar con tarjeta, como pide la política de pagos de Google Play.

Ambos proveedores escriben en la misma tabla `subscriptions`; el plan es Pro si hay una suscripción vigente en cualquiera de los dos.

### 5. App para Android (Capacitor)

Modo **hosted**: la app nativa abre tu web desplegada, con SSR, API y sesión incluidas.

```bash
# 1. Despliega la web (por ejemplo, en Vercel) y pon su URL HTTPS en CAP_SERVER_URL
npm run cap:add     # crea el proyecto android/
npm run cap:sync
npm run cap:open    # abre Android Studio → Build → Generate Signed App Bundle (.aab)
```

- En la app nativa, el botón de pago muestra un aviso en lugar de abrir Stripe, por la política de Google Play.
- Google bloquea OAuth dentro de WebViews, así que en la app se entra con correo. Google llegará con el navegador del sistema y deep links.
- La API `/api/v1` acepta `Authorization: Bearer <JWT de Supabase>` y tiene CORS para `capacitor://localhost`: está lista para un cliente empaquetado (modo bundled) más adelante.
- Antes de publicar en Google Play, completa la lista de la sección 10 de [`docs/DEPLOY.md`](docs/DEPLOY.md): target API 36, eliminación de cuenta, política de privacidad y Data safety.

### 6. Pruebas y producción

```bash
npm test             # 58 pruebas unitarias (Vitest)
npm run check        # tipos + pruebas
npm run build        # compilación de producción
```

Para desplegar (Vercel o Docker), sigue [`docs/DEPLOY.md`](docs/DEPLOY.md).

## Módulo financiero y de ahorro

### Flujo

1. **Conectar.** El diálogo de conexión pide una sesión (`POST /finance/link-token`, equivale al *link token* de Plaid), el usuario elige institución y cuentas, y el servidor canjea el token por un *access token* que se guarda **cifrado** en `integration_connections`.
2. **Importar.** `syncConnection` recorre `/transactions/sync` con cursor (`added`, `modified`, `removed`, `has_more`): la primera vez trae 90 días; después, solo lo nuevo. Los pendientes de un día vuelven como `modified` ya contabilizados. Actualiza saldos y detecta cargos recurrentes.
3. **Analizar.** `runFinancialAnalysis` arma un *snapshot* de 3 periodos de 30 días (montos agregados, sin ids internos), calcula **candidatas por reglas** y le pide a Claude el informe con **salida estructurada** (tool use forzado a `registrar_informe`, esquema zod → JSON Schema). Si no hay API key o el modelo falla, se guarda el informe por reglas.
4. **Validar.** `draftFromModel` enlaza cada recomendación con su candidata para que la acción funcione, limita el ahorro prometido (1.25× la candidata; 5% del gasto mensual si la idea es del modelo) y agrega las suscripciones sin uso que el modelo haya omitido.
5. **Conversar.** "Hablar con Omni" abre una conversación sembrada con el informe y preguntas sugeridas. En el chat, Omni usa las 11 herramientas financieras para responder cosas como *"¿cuánto gasté en delivery en agosto?"*.
6. **Actuar.** Cada recomendación se aplica con un toque: **cancelar** crea una boleta en Aprobaciones (nunca cancela directo), **presupuesto** y **tope de gastos hormiga** crean un presupuesto por categoría, **meta de ahorro** crea una meta y el resto deja un recordatorio.

Reglas del análisis:
- Las **transferencias entre cuentas y los pagos de tarjeta** no cuentan como gasto (categoría `Transferencias`).
- **Gasto hormiga:** compras de hasta $15 que se repiten en el mismo comercio (4 o más en 30 días).
- **Suscripción inactiva:** sin uso en 60 días según la señal del conector o porque el usuario dijo "No la uso" (su respuesta siempre manda).
- Límite de análisis manuales: 1 cada 12 h en Gratis y 1 cada 30 min en Pro. Tras conectar una cuenta el análisis corre siempre. Los tokens del análisis no cuentan en la cuota de mensajes.

### Conectores

| `FINANCE_PROVIDER` | Qué hace |
| --- | --- |
| `sandbox` (por defecto) | 4 instituciones ficticias (Banco Ceiba, Tarjeta Aurora, Colibrí Digital y Cooperativa Arrayán) con 90 días de movimientos deterministas por usuario, nómina, pagos de tarjeta, intereses, comisiones y 6 suscripciones (3 sin uso). No pide usuarios ni contraseñas y todo se marca como **Sandbox**. |
| `plaid` | Plaid real: el diálogo abre Plaid Link, el servidor canjea el `public_token` y usa `/transactions/sync`. Configura `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV` (`sandbox` o `production`) y `PLAID_COUNTRY_CODES`. |

Plaid cubre sobre todo bancos de Estados Unidos, Canadá y Europa. Para bancos de Latinoamérica se puede sumar otro proveedor (por ejemplo, Belvo) implementando la interfaz `FinancialProvider` de `modules/finance/providers/types.ts`; el resto del módulo no cambia.

> `PLAID_WEBHOOK_URL` es opcional. El receptor de webhooks de Plaid aún no está implementado (ver hoja de ruta): mientras tanto se sincroniza con el botón **Sincronizar**, al conectar y con el cron diario.

### Estados de cuenta en PDF o CSV

Para bancos que no se pueden conectar: **Finanzas → Subir estado de cuenta** (también en la bienvenida y en cada cuenta importada).

1. **Vista previa.** `POST /finance/statements/preview` lee el archivo en memoria y devuelve periodo, gastos, ingresos, los primeros movimientos con comercio y categoría, las filas que no se importarán (con el motivo) y avisos. No guarda nada.
2. **Corregir.** Si algo no cuadra, el usuario elige las columnas del CSV (cada opción muestra un valor de ejemplo), el orden de las fechas (día/mes o mes/día) o qué son los montos negativos, y la vista previa se rehace.
3. **Importar.** `POST /finance/statements/import` guarda los movimientos en una **cuenta manual** (sin conexión, para no mezclarse con lo que sincroniza un banco), cada uno ligado a su importación. Volver a subir el mismo archivo, o uno que se encima con el anterior, **no duplica** nada. Luego se recalculan los cargos recurrentes y Omni rehace el análisis (una vez por importación).
4. **Deshacer.** `DELETE /finance/statements/:id` borra la importación y sus movimientos; si la cuenta manual queda vacía, también la cuenta.

Cómo se lee:
- **Formato por contenido**, no por extensión. CSV en UTF-8, UTF-16 (Excel) o Windows-1252, separado por coma, punto y coma, tabulador o barra, con renglones de presentación antes de los encabezados; las columnas se reconocen en español e inglés o por su contenido. PDF con **pdf.js**, reconstruyendo la tabla con la posición de cada texto (cargos, abonos y saldo en columnas, títulos en dos renglones, descripciones en varios renglones, movimientos del mismo día sin fecha, varias páginas y PDF protegidos con contraseña).
- **Montos** de cualquier país: `1,234.56`, `1.234,56`, `(45.00)`, `45.00-`, `CR`/`DR`, pesos chilenos sin centavos. Se guardan en centavos exactos.
- **Sentido** (gasto o ingreso): columnas de cargo/abono → marca CR/DR → columna de tipo → signo → saldos (entre dos saldos conocidos se prueba qué combinación de cargos y abonos cuadra) → palabras clave. En débito, "negativo = gasto" salvo pruebas en contra; si hay que adivinar, se avisa y se puede cambiar.
- **Resúmenes** (totales, saldos, pago mínimo) no se importan como movimientos; los dudosos aparecen entre las filas omitidas.
- **Categorías** de la misma taxonomía que Plaid y el sandbox, con nombre de comercio canónico ("Netflix", "OXXO"), para que suscripciones y gastos hormiga funcionen igual.

Límites y seguridad: archivos de hasta **4 MB** (el cuerpo se lee con tope aunque falte `Content-Length`), 5,000 movimientos, 60 páginas y 200,000 trozos de texto por PDF; 60 vistas previas y 20 importaciones por hora. **El archivo no se guarda** y la contraseña del PDF solo se usa en memoria. Cada cuenta e importación se busca por usuario, y una cuenta sincronizada con un banco no admite importaciones (409). Los PDF escaneados (imagen) no se leen: se pide el estado de cuenta digital.

> Pendiente: un PDF de 4 MB con flujos comprimidos puede expandirse a varios GB **sin texto** y agotar la memoria al leerlo (igual con los formularios PDF de Trámites). En Vercel solo cae esa invocación; si despliegas con Docker, conviene leer los PDF en un proceso aparte con límite de memoria y de tiempo.

### Tarea programada

`vercel.json` llama cada día a las 11:00 UTC a `/api/cron/finance`, que sincroniza conexiones con más de 20 h sin actualizar (hasta 25 por corrida) y genera el informe mensual automático de quienes tienen Pro y no tienen uno en 30 días (hasta 3 por corrida; en Gratis el análisis se pide a mano). Define `CRON_SECRET`: Vercel lo envía como `Authorization: Bearer <CRON_SECRET>` y la ruta lo compara en tiempo constante. Si el número de usuarios crece, conviene pasar estos lotes a una cola.

## Módulo de trámites y productividad

### Flujo

1. **Conectar el correo.** `connectMailbox` usa el contrato `MailProvider` (`mail/providers/types.ts`: `connect`, `syncMessages` con cursor, `getAttachment`, `sendMessage` y el calendario de la misma cuenta). Hoy lo implementa una **bandeja sandbox** estilo Gmail u Outlook con 10 correos ficticios de dominios `.test` (un permiso escolar con PDF rellenable, un reembolso con PDF plano, una cita con invitación `.ics`, una factura, un pasaporte por renovar, una reunión, libros por devolver, una vacunación que llega al día siguiente y dos correos de ruido). El acceso se guarda cifrado; el token del sandbox va firmado (HMAC) y atado al usuario.
2. **Sincronizar.** Solo guarda lo nuevo (cursor), con sus adjuntos; las invitaciones `.ics` se leen al vuelo (hora exacta, zona horaria y lugar).
3. **Clasificar.** `triageInbox` aplica **reglas** a cada correo (fechas en español: *"a más tardar el miércoles 30"*, *"el viernes a las 6 p. m."*, *"05/10/2026"*; montos, referencias y lugares) y, si hay API key, **Claude** en lotes de 15 con salida estructurada (`clasificar_correos`). La unión es defensiva: las fechas de la invitación mandan, una fecha absurda del modelo se descarta y solo se acepta responder al remitente o a una dirección que aparezca en el correo. Clasificar usa el modelo rápido y no gasta la cuota del chat.
4. **Sugerir.** Cada correo accionable crea un trámite `SUGGESTED` con título, pasos y **fechas propuestas** (`calendar/scheduler.ts`): cuándo hacerlo (1 día antes para un formulario, 2 para una factura, 3 para un reembolso, un mes para renovaciones con cita), en horarios preferidos que **no chocan con el calendario** (ni entre sugerencias), y cuándo avisar (en citas, la víspera a las 7 p. m.). El "por qué" se arma al mostrarlo, así "mañana" nunca queda viejo. Si trae un PDF, se descarga y se prellena con reglas.
5. **Confirmar con un toque.** `confirmProcedure` activa el trámite y crea en el calendario la cita o evento, el bloque para hacerlo y la fecha límite (con avisos); un doble toque no duplica nada. **Ajustar** cambia fechas o pide otra sugerencia; **Más tarde** pospone el aviso; **Hecho** quita el bloque y la fecha límite; **Descartar** se puede deshacer. "Confirmar todos" agenda las sugerencias en lote.
6. **Llenar el formulario.** Al abrir la revisión, Claude lee el PDF completo (bloque `document`) junto con la lista de campos detectados y "Mis datos", y propone el valor y el origen de cada campo (`registrar_formulario`). Reglas duras sobre su salida: **nunca firma**, las casillas de autorización las marca el usuario, no inventa documentos ni cuentas, fechas en dd/mm/aaaa. Los PDF con campos (AcroForm, incluso con nombres como `Text1`) se llenan en sus campos; los PDF planos, escribiendo sobre las líneas `____` y las casillas `[ ]`. Lo nuevo que escribe el usuario puede guardarse en "Mis datos" (cifrado; nunca firmas ni casillas).
7. **Responder.** Con el PDF lleno, Omni prepara la respuesta al remitente con el adjunto. Es una boleta de Aprobaciones: se envía solo al aprobar, y entonces el trámite queda hecho y se retiran sus avisos. En el sandbox el correo queda en "Enviados" y no sale a internet.

### Calendario y recordatorios

- **Calendario conectado:** lo que confirmas se crea también en el calendario de la cuenta de correo (hoy el calendario de prueba, con una rutina semanal que el planificador respeta).
- **Feed ICS privado** (`/api/calendar/{id}.{secreto}.ics`, RFC 5545): suscripción desde Google Calendar, Apple Calendar u Outlook, con alarmas (`VALARM`), eventos de todo el día y cancelaciones (`SEQUENCE`). El secreto se guarda cifrado (para volver a mostrar la URL) y como hash (se compara en tiempo constante); se puede cambiar o desactivar. Apple Calendar respeta las alarmas; Google Calendar usa sus propios avisos y actualiza los calendarios suscritos cada varias horas.
- **Descarga `.ics`** de cada evento ("Añadir a mi calendario").
- **Recordatorios en la app:** al llegar el `remind_at` de un trámite activo se crea un aviso una sola vez (`reminded_at`), al abrir la app y con el cron. El contador de **Trámites** en la navegación suma lo que falta confirmar y lo que ya toca. Las notificaciones push quedan para la fase 5.

### Documentos

- `DOCUMENT_STORAGE=database` (por defecto) guarda los PDF en `document_blobs`; `supabase` usa el bucket privado `documents` con `SUPABASE_SECRET_KEY` (el cliente solo puede leer su carpeta; subir y borrar pasa por la API).
- Tamaño máximo: 10 MB para adjuntos del correo y **4 MB para PDF subidos** (límite de cuerpo de las funciones de Vercel).
- Las descargas salen siempre como adjunto (`Content-Disposition: attachment`): un PDF del usuario nunca se muestra dentro del dominio de la app.
- Límite del plan: **5 lecturas con IA al mes en Gratis y 100 en Pro**. Sin cupo o sin API key, el formulario se llena con reglas y la pantalla lo avisa.

### Seguridad del módulo

- El contenido de correos y PDF es **información, nunca instrucciones**: así lo dicen los prompts y la salida del modelo se valida (esquema zod, fechas en rango, destinatarios permitidos, firmas y autorizaciones anuladas).
- Nada se envía sin aprobación. Confirmar un trámite solo escribe en tu propio calendario.
- Las tablas de correo, Mis datos, secretos del feed y binarios no tienen acceso desde el cliente (RLS sin políticas).
- Desconectar la bandeja borra sus correos y las sugerencias sin confirmar; lo que ya confirmaste se queda.

### Tarea programada

`/api/cron/procedures` (diario en `vercel.json`, 11:30 UTC) revisa las bandejas que tocan según el plan (Gratis, con más de 20 h sin sincronizar; Pro, con más de 3 h; hasta 20 por corrida) y entrega los recordatorios vencidos. Para cumplir las 3 horas de Pro, llámala cada hora: `npm run db:cron`, Vercel Pro (`35 * * * *`) o el programador de Docker.

## Módulo de compras y ofertas (Concierge)

### Flujo

1. **Seguir un precio.** En **Compras → Seguir un precio** pegas el enlace de un producto, unos boletos, un vuelo o un hotel, o buscas en el catálogo de prueba. Antes de guardar nada, `previewLink` lee la página y te muestra qué es, cuánto cuesta y si se puede revisar sola. Eliges cuándo avisarte (si baja 10%, 15% o 25% frente a lo normal), un precio objetivo opcional y la cantidad. Sin enlace, el seguimiento queda manual y no se revisa solo. En el chat funciona igual: *"avísame si los Aura X2 bajan de $260"*.
2. **Leer el precio.** `readPrice` (`sources.ts`) prueba en orden los datos que publica la tienda: **JSON-LD** (`Product`, `Offer`, `AggregateOffer`, variantes, `Event`, `ScreeningEvent`, vuelos y hoteles), **microdata** y **meta tags** (`product:price:amount`, `og:price`, Twitter). Si la página no trae datos de producto, **Claude** puede leer su texto (`leer_precio`, tool use forzado, modelo rápido) con reglas duras: el texto del precio que copie tiene que aparecer literal en la página y coincidir con el número, y si todas las líneas con ese monto hablan de envío, cuotas o precio anterior, la lectura se descarta. Esas lecturas cuentan en el plan (10 al mes en Gratis y 200 en Pro), y esos productos se revisan como máximo una vez al día.
3. **Vigilar en segundo plano.** El cron llama a `runPriceChecks`, que reclama los seguimientos que ya tocan (`next_check_at`) con una reserva atómica de 10 minutos, así dos corridas a la vez nunca revisan lo mismo, y los procesa de 4 en 4 dentro de un presupuesto de tiempo. Frecuencia: una vez al día en Gratis y cada hora en Pro (si el cron corre cada hora). **Revisar ahora** se puede usar cada 60 minutos en Gratis y cada 5 en Pro. Si una página falla, reintenta a los 30 minutos, 2 h, 6 h y 24 h. Pausa el seguimiento y te avisa tras 8 fallos, 3 "no encontrado" seguidos o si robots.txt no lo permite.
4. **Detectar una bajada de verdad.** `analyzeReading` compara con la **mediana de los precios diarios de los últimos 30 días**, no con el "antes" que muestra la tienda, que puede estar inflado. Avisa si baja al menos lo que elegiste (`DROP`) o si llega a tu objetivo (`TARGET`), y marca si es el mínimo desde que lo sigues (`LOWEST`). No avisa si está agotado, si cambió la moneda o si ya avisó en los últimos 14 días y no bajó al menos otro 5% (salvo que el precio se haya recuperado entre medias). Una bajada de 60% o más se confirma con una segunda lectura antes de avisar.
5. **Alerta inteligente.** Claude redacta el titular y el resumen (`redactar_alerta`) a partir de cifras ya calculadas, y el servidor lo valida número por número: cada monto tiene que coincidir con los datos (±$0.50), el porcentaje con la bajada (±1), y no se aceptan enlaces, emojis ni signos de exclamación. Si algo no cuadra, se usa el texto por reglas. La alerta trae veredicto (**buen momento**, o **puede bajar más** si llegó a estar al menos 5% más barato), ahorro frente a lo normal, unidades disponibles y el botón **Comprar por $X**. Además crea una notificación y una Idea, y queda en la bitácora. Hay una sola alerta abierta por producto, y vence a las 72 h.
6. **Pagar con Permitir o Denegar.** **Comprar** no cobra. `startCheckout` crea una propuesta `PURCHASE` con la cotización (precio, envío, cargos, impuestos y total) y abre la **hoja de pago**. **Permitir** se activa a los 1.2 s, para evitar toques accidentales, y envía la huella de la cotización que viste (`quoteId`). Entonces el servidor vuelve a leer el precio en la tienda: si el total subió, no cobra y te muestra la hoja nueva para que decidas otra vez; si bajó, cobra el menor. Luego revisa tus límites, reclama la propuesta de forma atómica (`PENDING → APPROVED`, así un doble toque nunca cobra dos veces), cobra con el proveedor de pago (con la acción como llave de idempotencia) y registra el pedido. **Denegar** la cierra sin cobrar. Una compra no se puede aprobar desde la boleta genérica de Aprobaciones ni desde el chat: solo en la hoja de pago. La propuesta vence a las 24 h.

### Fuentes de precios y rastreador

- **Tiendas de prueba (`.test`).** Son 9 tiendas ficticias con 11 productos, servidas por una red simulada (`sandbox/stores.ts`). Cada una prueba un formato distinto:
  - SonidoMax: JSON-LD, con ventas relámpago.
  - CasaNova Hogar: meta tags.
  - Cumbre Sports: microdata.
  - BoletoYa: evento.
  - Cine Polar: función de cine.
  - VuelaYa: vuelo.
  - Hotel Brisa: hotel con tasas del 12%.
  - Bazar Central: sin datos de producto, necesita IA.
  - MegaTienda: su robots.txt no admite el bot.

  Los precios son deterministas por día, y al seguir un producto se cargan 29 días de historial. **Probar una bajada**, en el detalle de un producto de prueba, simula una oferta de 6 h para ver de punta a punta la alerta y la compra.
- **Páginas reales** (`WEB_PRICE_CHECKS=on`). El rastreador se presenta como `OmniAgentBot/1.0 (+URL)`; la URL es `SCRAPER_CONTACT_URL` o la página pública `/bot`, que explica qué hace y cómo bloquearlo. Respeta **robots.txt** (RFC 9309, en caché 6 h): si no puede leerlo, no visita la página. Hace una sola visita a la vez por dominio, con al menos 1 s entre visitas o el `Crawl-delay` del sitio. No cambia de User-Agent, no resuelve captchas ni evade bloqueos: si una tienda no lo permite, pausa el seguimiento y te lo dice. Con `off`, solo se revisan las tiendas de prueba.
- **Red segura (SSRF).** Solo acepta `http` o `https` en los puertos 80 y 443, sin usuario ni contraseña en la URL. La IP se valida **al conectar**: bloquea redes privadas, loopback, link-local, metadata de nubes, CGNAT y rangos especiales de IPv6. Cada redirección (hasta 4) se vuelve a validar. Además: máximo 8 s y 1.5 MB (también después de descomprimir), y solo HTML.
- **Qué esperar de tiendas reales.** Muchas publican JSON-LD de producto y funcionan bien. Otras cargan el precio con JavaScript, lo cambian por país o bloquean bots; esas no se pueden vigilar así. Los precios de vuelos y boletos cambian por sesión y requieren las API de sus proveedores (ver hoja de ruta).

### Pagos y límites

- **Medios de pago:** hoy solo hay dos tarjetas de prueba, **Visa de prueba •••• 4242** (aprueba) y **Tarjeta de prueba que rechaza •••• 0002**. OmniAgent nunca pide ni guarda el número de una tarjeta. Un proveedor real, como Stripe con métodos guardados mediante SetupIntent y Elements, implementaría el mismo contrato (`PaymentProvider` en `payments.ts`).
- **Límites de compra:** por compra ($500 por defecto) y por mes ($1,000). Se cambian en **Compras → Pago y límites** y se revisan al preparar la compra y otra vez al permitirla.
- **Pedidos:** cada compra deja un `purchase_order` con número de pedido, desglose, medio de pago y entrega estimada. Un pago rechazado queda como `FAILED`, y el producto sigue vigilado.

### Tarea programada

`/api/cron/concierge` revisa los precios que ya tocan, crea las alertas y vence las alertas y compras viejas. Usa `CRON_SECRET` igual que los otros crons y dura como máximo 50 s por corrida. `vercel.json` la programa **una vez al día** (12:00 UTC), porque el plan Hobby de Vercel solo permite crons diarios, con precisión de ±59 min. Para revisar cada hora (lo que promete el plan Pro de OmniAgent):

- **Supabase pg_cron + pg_net** (gratis, con cualquier hosting): `npm run db:cron` hace lo siguiente:
  - guarda la URL pública y el `CRON_SECRET` cifrados en Vault;
  - programa compras y trámites cada hora y finanzas cada día.

  Para quitarlas: `npm run db:cron -- --remove`.
- **Vercel Pro:** cambia el horario a `5 * * * *`.
- **Docker:** el servicio `scheduler` de `docker-compose.yml` ya lo hace.

Con un cron diario, el horario de cada producto se adelanta un poco (nunca se atrasa), así ningún día queda sin revisar.

### Seguridad del módulo

- Lo que dicen las páginas es **información, nunca instrucciones**, y toda salida del modelo se valida contra la página o contra las cifras calculadas.
- Nada se compra sin **Permitir**. Permitir vale solo para el total que viste: si sube, no se cobra.
- Los pedidos y las alertas son del usuario (RLS de solo lectura para el dueño). Las escrituras pasan por la API.
- Cada paso deja registro en la bitácora: seguir, alertar, preparar la compra, permitir, denegar y fallos de pago.

## Pedidos y devoluciones

### Flujo

1. **Seguir los pedidos.** La pantalla **Devoluciones** junta los pedidos de cuatro fuentes: las compras hechas con OmniAgent (con su entrega estimada), los correos de confirmación, envío y entrega de tiendas y paqueterías que llegan a la bandeja conectada en Trámites, los que agregas a mano (o en el chat: *"compré una lámpara en Mercado Libre, llega el viernes"*) y los pedidos de ejemplo. Un pedido no se duplica: cada origen tiene su llave, y a mano se reconoce por la tienda y el número.
2. **Ver el problema.** Con la fecha prometida, Omni sabe si un pedido va a tiempo, llega hoy o va tarde. A los **2 días de retraso** prepara el reclamo por su cuenta, una sola vez y solo si el pedido nunca tuvo uno; a los 10 días lo da por probablemente perdido. Si llegó dañado, llegó otro producto, no es como lo describían o ya no lo quieres, tocas **Tengo un problema**, eliges qué pasó y qué pides (reembolso, cambio, saldo a favor o que llegue) y, si quieres, lo cuentas con tus palabras.
3. **Preparar el reclamo.** `draftClaim` redacta el mensaje solo con los datos del pedido y lo que escribiste: número, fecha de compra, monto, fecha prometida y lo que pides. No inventa montos, plazos ni políticas. Si la tienda atiende por correo y tienes la bandeja conectada, el correo queda en **Aprobaciones** (`SEND_EMAIL`) y sale desde tu bandeja solo si lo apruebas. Si no, Omni te deja el texto listo, te dice dónde reclamar (Amazon, Mercado Libre y otros marketplaces atienden en su página o app) y tú marcas **Ya lo envié**.
4. **Insistir.** Si la tienda no responde en 2 días hábiles, Omni prepara un seguimiento a las 9:00 de tu hora, que también apruebas; el segundo, 3 días hábiles después, avisa que pedirás ayuda. Si tampoco responde, te deja los pasos para escalar (la plataforma donde compraste, el contracargo de tu banco y la oficina de protección al consumidor) y un resumen del caso para copiar. Si el reclamo lo enviaste tú, en lugar de preparar correos te pregunta si la tienda respondió.
5. **Leer la respuesta.** Las respuestas de la tienda que llegan a tu bandeja (mismo dominio, después del envío) se leen con reglas (`readStoreReply`): reembolso, cambio, saldo a favor, etiqueta de devolución, pide datos, rechazo o novedades del envío. Una promesa condicional (*"si no llega en 3 días, te reembolsamos"*) no cuenta como reembolso. Si falta un paso tuyo (devolver el paquete o responder), el reclamo pasa a **Necesitan tu atención** con su fecha límite. También puedes contarle a Omni qué respondió o pegar el texto.
6. **Confirmar el reembolso.** Cuando la tienda aprueba un reembolso, Omni lo busca durante 60 días en tus movimientos de Finanzas (un abono de la misma tienda por el mismo monto, ±1% o ±$0.50) y te avisa cuando llega. Lo recuperado suma en **Inicio → Ahorro con Omni**. Un pedido que nunca llegó y que la tienda reembolsó deja de esperarse.

### Tiendas y paqueterías

- **Tiendas de prueba (`.test`).** Las mismas de Compras, con correo de atención (`soporte@…`) y 30 días para devolver. **Probar con pedidos de ejemplo** agrega tres pedidos (uno atrasado, uno entregado y uno en camino) y **Simular respuesta de la tienda** responde como lo haría la tienda. Nada sale a internet.
- **Marketplaces reales:** Amazon, Mercado Libre, AliExpress, eBay, Shein, Temu y Walmart. Omni los reconoce por nombre o dominio y sabe dónde se reclama en cada uno, pero no inventa correos ni plazos de devolución. No existe una API de pedidos para compradores (la de Amazon es solo para vendedores), así que sus pedidos llegan por tus correos, por tus compras con OmniAgent o porque los agregas.
- **Paqueterías:** DHL, FedEx, UPS, Estafeta, Servientrega, Coordinadora, Correos, Andreani, Chilexpress y 99minutos. Sus avisos crean o actualizan el pedido, pero el reclamo va siempre a la tienda. Si un aviso solo nombra a la paquetería, corrige el pedido con la tienda y su correo, y el reclamo sin enviar se reescribe para ella.

### Tarea programada

`/api/cron/returns` pone al día a cada persona con pedidos en camino, reclamos esperando respuesta, reembolsos por confirmar, correo conectado o compras recientes: importa las compras, lee los correos nuevos, prepara los reclamos de los atrasados, propone los seguimientos que tocan y confirma reembolsos. Atiende primero lo vencido y reparte turnos entre los demás (50 personas por corrida). Cada paso se reclama de forma atómica, así dos corridas a la vez nunca preparan el mismo reclamo ni el mismo seguimiento. `vercel.json` la programa una vez al día (11:45 UTC); para que los seguimientos salgan a las 9:00, llámala cada hora (`npm run db:cron`, Vercel Pro con `45 * * * *` o el programador de Docker). La pantalla también se pone al día cada vez que la abres.

Devoluciones no tiene límites propios ni cambia los planes: funciona igual en Gratis y en Pro. Lee los correos que ya trajo Trámites, que revisa la bandeja según el plan (Pro cada 3 horas, Gratis una vez al día).

### Seguridad del módulo

- Nada sale a una tienda sin tu aprobación: ni el reclamo ni los seguimientos. En los marketplaces, el que envía eres tú.
- Los correos de las tiendas son **información, nunca instrucciones**: se leen con reglas y solo cambian el estado del reclamo.
- Omni no pide ni guarda datos de tarjetas ni contraseñas de las tiendas.
- `tracked_orders` es de solo lectura para su dueño (RLS). `return_cases` no tiene acceso desde el cliente: solo la API lee el texto de los reclamos y las respuestas.
- Límites de tasa: 60 pedidos por hora, 20 reclamos por hora y 30 respuestas simuladas cada 10 minutos.

## Panel de Inicio, planes y producción (fase 5)

### Inicio

`/inicio` es la pantalla principal. Reúne Finanzas, Trámites, Compras y Devoluciones con estas secciones:

- **Lo que espera tu permiso:** una fila por pendiente, en orden de urgencia:
  - cobro de Pro fallido;
  - compras por permitir;
  - aprobaciones;
  - devoluciones que esperan un paso tuyo (enviar el reclamo, devolver el paquete, responder a la tienda o escalar) y pedidos atrasados sin reclamo;
  - trámites urgentes o por confirmar;
  - ofertas nuevas.

  Al pie, un contador por tipo lleva a cada lista.
- **Finanzas:** gasto del mes, con una gráfica del ritmo acumulado frente al mes pasado hasta el mismo día (cursor, teclado y tabla para lectores de pantalla). También la categoría principal, los presupuestos y las suscripciones sin uso.
- **Trámites:** los próximos vencimientos.
- **Compras:** precios vigilados, ofertas nuevas y la próxima revisión.
- **Ahorro con Omni:** suscripciones canceladas, lo que pagaste por debajo de lo normal y lo recuperado con devoluciones.
- **Agentes:** qué hace cada uno y cada cuánto; en Gratis, qué cambia con Pro.
- **Actividad:** los avisos, con "marcar como leído".
- **Plan:** el consumo del mes.

Cada sección carga por separado: si una falla, muestra **Reintentar** y las demás siguen. En el teléfono hay barra de pestañas (Inicio, Finanzas, Omni, Trámites y Compras). El tema (Sistema, Claro u Oscuro) se guarda en una cookie y el servidor lo aplica sin parpadeo.

### Qué habilita Pro

| | Gratis | Pro ($19.99 al mes) |
| --- | --- | --- |
| Mensajes con Omni | 40 al mes | 1,500 al mes |
| Precios vigilados | 3, revisados una vez al día | 50, revisados cada hora |
| Correo en segundo plano | Una revisión al día | Cada 3 horas (piloto automático) |
| Formularios leídos con IA | 5 al mes | 100 al mes |
| Páginas de tiendas leídas con IA | 10 al mes | 200 al mes |
| Metas activas | 2 | 20 |
| Análisis financiero | Cuando lo pides (1 cada 12 h) | Informe mensual automático, y 1 a mano cada 30 min |
| Alertas de ofertas | Estándar (reglas) | Redactadas por Omni y validadas cifra por cifra |
| Modelo | Rápido (`ANTHROPIC_MODEL_FREE`) | Más capaz (`ANTHROPIC_MODEL_PRO`) |

Todo se valida en el servidor (`modules/billing`):

- **Agentes.**
  - Las tareas programadas revisan con la frecuencia de cada plan, y el revisor de precios nunca revisa más seguido de lo que el plan permite.
  - Las alertas con IA y el informe mensual solo corren en Pro.
- **Límites.** Al llegar a uno, la API responde `402 plan_limit` con el detalle: `{ plan, reason, limit?, feature? }`.
  - En la web se abre la hoja **Pásate a Pro**, que empieza por el motivo.
  - En el chat, Omni lo dice una vez, ofrece una alternativa gratis y muestra una tarjeta para pasarse a Pro.
- **Cambios de plan** (`plan-change.ts`). Se aplican cuando cambia el plan efectivo, por Stripe o por Google Play.
  - **A Pro:** los precios pasan a revisarse cada hora, la próxima revisión se adelanta y vuelve lo que se había pausado por el plan.
  - **A Gratis:** vuelve la revisión diaria y siguen activos los 3 precios más recientes. Los demás quedan en pausa (no se borran) y la persona recibe un aviso.

### Pantalla de Omni Pro

Se abre desde cualquier límite del plan Gratis (402 `plan_limit`), la tarjeta de Pro del chat, el Inicio y la cuenta (`requestUpgrade`). Está en `src/components/paywall/`:

- **Siempre oscura** (clase `theme-dark`), a pantalla completa en el teléfono, con el botón fijo abajo, y en dos columnas desde 1024 px.
- **Un día con Pro:** la órbita de 24 horas marca cada revisión de precios (cada hora) y de correo (cada 3 horas). Da una vuelta al abrir; sin animación si el teléfono pide menos movimiento.
- **Comparación Gratis / Pro** con la columna de Pro resaltada y la etiqueta **Recomendado**. Si la abrió un límite, esa fila queda marcada y arriba sale el motivo.
- **Números reales:** filas, precio y resumen del mes salen de `PLANS` (`modules/billing/paywall.ts`), los mismos límites que valida el servidor. Si cambias un límite o el precio en `plans.ts`, la pantalla cambia sola.
- **Desbloquear Omni Pro** usa `purchasePro()` (`src/lib/purchase.ts`): Stripe Checkout en la web y Google Play (RevenueCat) en la app de Android. Junto al botón van el precio, la renovación mensual y cómo cancelar.

### Pagos con Stripe

1. **Checkout.** `POST /api/v1/billing/checkout` abre una sesión en español latino, atada al usuario (máximo 10 por hora).
2. **Activación inmediata.** Al volver, `/cuenta?checkout=success` llama a `/api/v1/billing/sync` y Pro queda activo en el momento.
3. **Webhooks.** Mantienen todo al día: renovaciones (`invoice.paid`), cancelaciones, pausas y cobros fallidos. Un cobro fallido (`invoice.payment_failed`) avisa a la persona. Mientras Stripe reintenta, `past_due` conserva Pro, con un aviso en Inicio y en Cuenta.
4. **Idempotencia.** Cada evento se procesa una sola vez. Si uno falla a medias, el reintento de Stripe lo completa.
5. **Dos canales.** Pro vale si hay una suscripción vigente en Stripe o en Google Play.

### Producción

- **Errores.**
  - Toda la API responde con la misma forma: `{ error: { code, message, details, requestId } }`. El id también va en la cabecera `x-request-id`.
  - Los errores de Prisma, Anthropic y Stripe se traducen a mensajes útiles (`database_unavailable`, `ai_busy`, `payment_provider_error`…) sin filtrar detalles internos.
  - Hay pantallas de error propias (por sección y global) y un 404 con la marca.
- **Logs.**
  - Una línea JSON por evento, con `requestId`. Se ocultan contraseñas, tokens, llaves, cookies, correos y teléfonos.
  - Opcional: alertas de errores 5xx a Slack o Discord (`ERROR_WEBHOOK_URL`).
- **Salud.** `/api/health` responde `200 ok` o `503 degraded`. Con `CRON_SECRET`, da el detalle por integración. Si la base no contesta, la conexión se corta a los 5 s.
- **Configuración.** Al arrancar, `instrumentation.ts` revisa las variables y deja en los logs qué falta o qué está mal, por ejemplo Stripe en modo de prueba en producción.
- **Límites de tasa.** Viven en la tabla `rate_limits`, compartida entre instancias. Si la base falla, dejan pasar.

  | Acción | Límite |
  | --- | --- |
  | Chat | 20 por minuto |
  | Pagos | 10 por hora |
  | Compras | 30 cada 10 minutos |
  | Documentos | 20 por hora |
  | Eliminar la cuenta | 3 por hora |

- **Cabeceras.** CSP (`CSP_MODE`), HSTS, COOP, `X-Frame-Options` y `Permissions-Policy`. La API nunca se guarda en cachés compartidas.

### Eliminar la cuenta

Google Play exige que la cuenta se pueda eliminar desde la app y desde la web. En **Cuenta → Eliminar cuenta**, una hoja explica qué se borra y pide escribir ELIMINAR. Después, el servidor:

1. Cancela en el acto la suscripción de Stripe. Si Stripe no responde, no borra nada y se puede reintentar.
2. Revoca el acceso a los bancos (Plaid) y borra los archivos de Storage.
3. Borra el usuario de Supabase Auth. Con él se van, en cascada, todos sus datos.
4. Borra su bitácora y vacía sus eventos de pago.

Una suscripción de Google Play solo la puede cancelar la persona desde Google Play, así que la hoja se lo recuerda. El paso 3 usa la función `public.delete_auth_user` de `prisma/sql/supabase-setup.sql` (SECURITY DEFINER; solo la ejecuta el rol de la app), así que no necesita la llave secreta de Supabase.

### Pruebas

`npm test` corre 148 pruebas unitarias (Vitest) de las reglas puras. Cubren:

- el importador de estados de cuenta: montos y fechas de varios países, CSV de distintos bancos (Chase, BofA, ING, bancos mexicanos y chilenos) y PDF reales generados en la prueba (con columnas, sin encabezados, de varias páginas, protegidos, escaneados, dañados y que se expanden), resúmenes, signos, saldos y deduplicación;
- planes y estados de suscripción, y la hoja de Pro;
- el panel de Inicio: gasto del mes, lo pendiente y los agentes;
- precios y bajadas, y la red segura del rastreador;
- errores, logs, límites de tasa, configuración y redirecciones.

`npm run check` suma la revisión de tipos, y CI corre ambas en cada cambio.

### Despliegue

[`docs/DEPLOY.md`](docs/DEPLOY.md) reúne todo el paso a paso:

- **Vercel o Docker.** Para Docker están el `Dockerfile` y el `docker-compose.yml`, con programador de tareas.
- **Variables.** Qué se fija al compilar y qué se lee al correr.
- **Migraciones.** Con `prisma migrate deploy` y con el workflow de GitHub.
- **Tareas cada hora sin Vercel Pro.** Con `npm run db:cron`.
- **Lanzamiento.** Stripe *live*, las listas de salida a producción y de Google Play, y la solución de problemas.

## Arquitectura

**Monolito modular.** Las rutas de `src/app` son delgadas: validan, autentican y llaman a servicios en `src/modules`, que hablan con Prisma. Cada módulo aporta sus herramientas al agente.

**Agente (`modules/agent/run-agent.ts`).** Cada turno guarda el mensaje, llama a Claude con las 36 herramientas (esquemas zod convertidos a JSON Schema), ejecuta las llamadas en un bucle de hasta 6 rondas y guarda la respuesta con sus tarjetas y preguntas sugeridas (`{ text, cards, suggestions }`). Cada llamada a herramienta queda registrada como mensaje `TOOL`. El consumo se guarda en `ai_usage_logs` y alimenta la cuota mensual. La parte fija del prompt de sistema usa prompt caching.

**Motor de ejecución autónoma (`modules/engine`).** Las peticiones de varios pasos («créame una página web», «analiza mis finanzas», «ponme al día») se convierten en un trabajo con pasos que llaman a los servicios de cada módulo, uno detrás de otro, en segundo plano: después de responder (`after()`), en otra invocación si no alcanza el tiempo y con una tarea programada cada minuto que retoma lo pendiente. Cada paso se guarda antes de seguir; un turno atómico evita que dos ejecutores corran el mismo trabajo; los reintentos son solo para fallos pasajeros; y lo que publica, gasta, envía o cancela espera la aprobación de la persona. Detalle en `docs/MOTOR.md`.

**Proponer → Aprobar → Ejecutar (`modules/actions`).** Las herramientas `*_propose_*` solo crean una `agent_action` en estado `PENDING` y una notificación. Al aprobar, un `updateMany` atómico (`PENDING → APPROVED`) evita dobles ejecuciones; luego el ejecutor corre y la acción queda `EXECUTED` o `FAILED`. Las compras son la excepción: no se aprueban con la boleta genérica sino en la hoja de pago (**Permitir** con la huella de la cotización, precio reconfirmado en la tienda y límites). Las propuestas vencen solas (72 h; compras, 24 h).

**Seguridad.**
- Supabase publica el esquema `public` por su Data API. `supabase-setup.sql` activa RLS en **todas** las tablas, deja al cliente solo lectura de sus propias filas (para Realtime) y quita permisos de escritura. Las escrituras pasan por la API, con Prisma como `postgres`.
- `profiles` se sincroniza con `auth.users` por triggers. No hay FK entre esquemas, para no romper la shadow database de Prisma.
- Los tokens OAuth y bancarios se cifran con AES-256-GCM (`lib/crypto.ts`). Los tokens del sandbox van firmados con HMAC y atados al usuario: un token alterado o de otra persona se rechaza.
- A Claude solo le llega un resumen agregado (montos por categoría, comercios, suscripciones), sin ids internos ni números de cuenta completos, y el prompt le indica tratar los nombres de comercios como datos, nunca como instrucciones.
- Los webhooks se verifican (firma de Stripe; header de RevenueCat comparado en tiempo constante) y se procesan una sola vez (`billing_events`).
- El servidor nunca usa `getSession()`: valida el JWT con `getClaims()`.

### Endpoints

| Método | Ruta | Uso |
| --- | --- | --- |
| GET | `/api/v1/dashboard` | Todo el panel de Inicio en una llamada (cada sección con `status`: `ok`, `empty` o `error`) |
| GET | `/api/v1/notifications?limit=` | Avisos y cuántos faltan por leer |
| POST | `/api/v1/notifications/read` | Marcar como leídos `{ ids? }` (sin ids, todos) |
| GET | `/api/v1/billing` | Plan, estado, renovación, avisos, funciones de los agentes y consumo del mes |
| POST | `/api/v1/account/delete` | Eliminar la cuenta y todos sus datos `{ confirm: "ELIMINAR" }` |
| GET | `/api/health` | Salud pública; detalle por integración con `Authorization: Bearer <CRON_SECRET>` |
| GET, PATCH | `/api/v1/me` | Perfil, plan, uso y pendientes; actualizar nombre, zona horaria o moneda |
| POST | `/api/v1/agent/chat` | `{ message, conversationId?, module?, ideaId? }` → respuesta de Omni con tarjetas y sugerencias |
| GET | `/api/v1/conversations` y `/api/v1/conversations/:id` | Historial |
| GET | `/api/v1/actions?filter=pending\|history` | Aprobaciones |
| GET, POST | `/api/v1/actions/:id` | Ver o decidir: `{ decision: "approve" \| "reject" }` |
| PATCH | `/api/v1/ideas/:id` | `{ status: "ACCEPTED" \| "DISMISSED" }` |
| POST | `/api/v1/finance/link-token` | Abre una sesión de conexión (en sandbox incluye instituciones y cuentas) |
| GET, POST | `/api/v1/finance/connections` | Lista conexiones; conecta con `{ provider: "sandbox", linkToken, institutionId, accountIds }` o `{ provider: "plaid", publicToken, accountIds? }` |
| DELETE | `/api/v1/finance/connections/:id` | Desconecta y borra sus cuentas y movimientos |
| POST | `/api/v1/finance/connections/:id/sync` y `/api/v1/finance/sync` | Sincroniza una conexión o todas |
| POST | `/api/v1/finance/demo-bank` | "Probar con datos de ejemplo": conecta nómina, ahorros y tarjeta del sandbox |
| GET | `/api/v1/finance/summary` | Todo lo de la página de Finanzas en una llamada (útil para la app nativa), incluidas las cuentas con estados de cuenta |
| POST | `/api/v1/finance/statements/preview` | Vista previa de un estado de cuenta (multipart: `file` y `options` en JSON: `accountId` o `newAccount`, y opcionalmente `mapping`, `dateOrder`, `signConvention`, `password`). No guarda nada |
| POST | `/api/v1/finance/statements/import` | Importa el estado de cuenta (mismo cuerpo) → `{ importId, accountId, imported, duplicates, skipped }` |
| GET | `/api/v1/finance/statements` | Cuentas manuales con sus estados de cuenta importados |
| DELETE | `/api/v1/finance/statements/:id` | Deshace una importación y borra sus movimientos |
| GET | `/api/v1/finance/transactions` | Movimientos: `q`, `category`, `accountId`, `from`, `to`, `type=gasto\|ingreso`, `limit`, `offset` |
| GET, POST | `/api/v1/finance/analysis` | Último informe o uno nuevo (`?origen=conexion` justo después de conectar o de importar un estado de cuenta) |
| POST | `/api/v1/finance/analysis/:id/conversation` | Abre el chat sembrado con el informe → `{ conversationId }` |
| PATCH | `/api/v1/finance/recommendations/:id` | `{ decision: "accept" \| "dismiss" \| "done" }` |
| PATCH | `/api/v1/finance/subscriptions/:id` | `{ inUse: boolean }` |
| POST | `/api/v1/finance/subscriptions/:id/cancel` | Prepara la baja (queda en Aprobaciones) |
| GET, POST | `/api/v1/finance/budgets` | Presupuestos del mes; crear o cambiar `{ category, monthlyLimit }` |
| DELETE | `/api/v1/finance/budgets/:id` | Quitar un presupuesto |
| GET | `/api/cron/finance` | Tarea programada (requiere `CRON_SECRET`) |
| GET, POST | `/api/v1/procedures` | Trámites (`?scope=suggested\|active\|done\|canceled`); crear `{ title, type, due?, remindAt?, confirm? }` con fechas propuestas |
| GET, PATCH | `/api/v1/procedures/:id` | Ver; cambiar fechas `{ due?, plannedAt?, remindAt?, recompute? }` (hora local) |
| POST | `/api/v1/procedures/:id/confirm` | Confirmación de un toque (cuerpo opcional con fechas ajustadas) |
| POST | `/api/v1/procedures/:id/dismiss`, `/restore`, `/complete`, `/snooze` | Descartar, deshacer, hecho, posponer `{ preset: "1h" \| "tonight" \| "tomorrow" }` |
| GET, POST | `/api/v1/procedures/mailboxes` | Bandejas; conectar `{ flavor: "gmail" \| "outlook", withDemoData }` |
| DELETE | `/api/v1/procedures/mailboxes/:id` | Desconectar (borra correos y sugerencias sin confirmar) |
| POST | `/api/v1/procedures/inbox/sync` | "Revisar correo": sincroniza, clasifica y devuelve lo que falta confirmar |
| GET | `/api/v1/procedures/messages` y `/messages/:id` | Correos clasificados (`q`, `category`, `actionOnly`, `folder`) y el texto de uno |
| POST | `/api/v1/procedures/attachments/:id` | Descargar un adjunto como documento |
| GET, POST | `/api/v1/procedures/documents` | Formularios; subir un PDF (multipart `file`, `taskId?`) |
| GET, DELETE | `/api/v1/procedures/documents/:id` | Lo ya leído (`aiPending`) o borrar |
| POST | `/api/v1/procedures/documents/:id/extract` | Leer con IA `{ preferAI, force }` |
| POST | `/api/v1/procedures/documents/:id/fill` | Generar el PDF lleno `{ values, saveToProfile }` |
| GET | `/api/v1/procedures/documents/:id/file` | Descargar el PDF |
| POST | `/api/v1/procedures/documents/:id/reply` | Preparar la respuesta con el PDF (queda en Aprobaciones) |
| GET, PUT, DELETE | `/api/v1/procedures/personal-data` | Mis datos: ver, guardar `{ person, relation?, fields }`, borrar `?person=` |
| DELETE | `/api/v1/procedures/personal-data/:id` | Borrar un dato |
| GET | `/api/v1/procedures/agenda` | Agenda desde hoy (`days`, `busy=1` para incluir lo ocupado) |
| GET, POST, DELETE | `/api/v1/procedures/calendar/feed` | Estado del calendario; crear o cambiar el enlace ICS; desactivarlo |
| GET | `/api/v1/procedures/calendar/events/:id/ics` | Un evento como `.ics` |
| GET | `/api/calendar/:token` | Feed ICS (público con la URL secreta) |
| GET | `/api/cron/procedures` | Tarea programada de trámites (requiere `CRON_SECRET`) |
| GET | `/api/v1/concierge` | Todo lo de la página de Compras en una llamada: seguimientos, alertas, compras por autorizar, pedidos y ajustes |
| GET | `/api/v1/concierge/search?q=` | Buscar ofertas en las tiendas conectadas (hoy, las de prueba) |
| POST | `/api/v1/concierge/preview` | Vista previa de un enlace antes de seguirlo `{ url, useAI }` (30 por hora) |
| GET, POST | `/api/v1/concierge/items` | Seguimientos; seguir un enlace `{ url, title?, targetPrice?, dropAlertPct, quantity, useAI }` |
| GET, PATCH, DELETE | `/api/v1/concierge/items/:id` | Detalle con historial; cambiar `{ title?, targetPrice?, dropAlertPct?, quantity?, status? }`; dejar de seguir |
| POST | `/api/v1/concierge/items/:id/check` | Revisar ahora (con espera mínima por plan) |
| POST | `/api/v1/concierge/items/:id/simulate-drop` | "Probar una bajada" (solo tiendas de prueba) |
| POST | `/api/v1/concierge/items/:id/checkout` | Prepara la compra `{ quantity?, alertId? }` → hoja de pago (no cobra) |
| GET, POST | `/api/v1/concierge/checkout/:id` | Ver la hoja de pago; decidir `{ decision: "allow" \| "deny", quoteId, methodId }`. Si el precio subió: 409 `price_changed` con la hoja nueva |
| GET, POST | `/api/v1/concierge/alerts` | Alertas; marcarlas como vistas |
| GET, PATCH | `/api/v1/concierge/alerts/:id` | Ver una alerta; descartarla `{ status: "DISMISSED" }` |
| GET | `/api/v1/concierge/orders` | Pedidos |
| GET, PUT | `/api/v1/concierge/settings` | Medios de pago y límites; cambiar `{ perOrderLimit, monthlyLimit }` |
| GET | `/api/cron/concierge` | Agente de precios en segundo plano (requiere `CRON_SECRET`) |
| GET | `/api/v1/returns` | Todo lo de la pantalla Devoluciones en una llamada (antes la pone al día): pedidos, reclamos, resumen y bandeja |
| GET, POST | `/api/v1/returns/orders` | Pedidos (`?filtro=all\|active\|late\|problems\|delivered`); agregar uno a mano `{ merchant, title, orderNumber?, orderedOn?, expectedOn?, deliveredOn?, total?, currency?, supportEmail?, trackingNumber? }` (60 por hora) |
| GET, PATCH, DELETE | `/api/v1/returns/orders/:id` | Ver; `{ action: "delivered" \| "dismiss" \| "restore" \| "edit", … }`; borrar (solo los agregados a mano o de ejemplo) |
| POST | `/api/v1/returns/orders/:id/problem` | Preparar el reclamo `{ reason, desired?, details? }` → el reclamo y, si va por correo, su propuesta en Aprobaciones (20 por hora) |
| POST | `/api/v1/returns/examples` | "Probar con pedidos de ejemplo" |
| GET, PATCH | `/api/v1/returns/cases/:id` | Ver un reclamo; `{ action: "sent" \| "propose" \| "edit" \| "reply" \| "package_sent" \| "info_sent" \| "refund_received" \| "close" \| "reopen", … }` |
| POST | `/api/v1/returns/cases/:id/simulate-reply` | Respuesta simulada (solo tiendas de prueba) |
| GET | `/api/cron/returns` | Pedidos y devoluciones en segundo plano (requiere `CRON_SECRET`) |
| GET, POST | `/api/v1/engine/jobs` | Trabajos en segundo plano (`?active=1`); empezar uno `{ playbook, input }` → responde al instante (`created: false` si ya estaba en marcha) |
| GET | `/api/v1/engine/jobs/:id` | Un trabajo con sus pasos |
| POST | `/api/v1/engine/jobs/:id/cancel` | Detenerlo (si corre, al terminar el paso actual) |
| GET, POST | `/api/cron/engine` | Motor: tarea de cada minuto (GET) y continuación de un trabajo (POST `{ jobId }`), con `CRON_SECRET` |
| GET | `/api/v1/sites` | Páginas web que armó Omni |
| DELETE | `/api/v1/sites/:id` | Retirar una página (su enlace deja de abrir) |
| GET | `/s/:slug` | Página web pública (con `?vista=previa`, la versión que espera aprobación, solo para su dueño) |
| POST | `/api/v1/billing/checkout` y `/api/v1/billing/portal` | Stripe Checkout para Pro y portal de clientes (devuelven `{ url }`) |
| POST | `/api/v1/billing/sync` | Al volver de Checkout: `{ sessionId }` → activa Pro sin esperar al webhook |
| POST | `/api/webhooks/stripe` y `/api/webhooks/revenuecat` | Webhooks de pago |

### Herramientas del agente

| Módulo | Herramientas |
| --- | --- |
| Finanzas | `finance_get_insights`, `finance_apply_recommendation`, `finance_search_transactions`, `finance_overview`, `finance_monthly_breakdown`, `finance_ant_expenses`, `finance_subscriptions`, `finance_mark_subscription_usage`, `finance_propose_cancel_subscription`, `finance_set_budget`, `finance_list_accounts` |
| Trámites | `procedures_scan_inbox`, `procedures_list_tasks`, `procedures_create_task`, `procedures_confirm`, `procedures_update`, `procedures_search_email`, `procedures_read_form`, `procedures_fill_form`, `procedures_propose_form_reply`, `procedures_get_agenda`, `procedures_save_personal_data`, `procedures_propose_calendar_event`, `procedures_propose_email` |
| Compras | `concierge_search_offers`, `concierge_track_item`, `concierge_list_tracking`, `concierge_price_history`, `concierge_check_now`, `concierge_update_tracking`, `concierge_list_alerts`, `concierge_propose_purchase` (prepara la hoja de pago; nunca cobra), `concierge_list_orders` |
| Pedidos y devoluciones | `returns_list_orders`, `returns_add_order`, `returns_report_problem` (prepara el reclamo; nunca lo envía), `returns_update_case`, `returns_update_order` |
| Metas | `goals_create`, `goals_list`, `goals_add_progress` |
| Memoria | `memory_save_preference`, `memory_save_finance`, `memory_save_website`, `memory_save_goal`, `memory_save_note`, `memory_recall`, `memory_forget` |
| Motor en segundo plano | `engine_analyze_finances`, `engine_daily_sweep`, `engine_create_website`, `engine_update_website` (responden al instante con la tarjeta del trabajo), `engine_job_status`, `engine_cancel_job` |
| Páginas web | `sites_list`, `sites_unpublish` |

Para agregar una herramienta: defínela con `defineTool()` en su módulo (esquema zod + `run`) y súmala al arreglo del módulo. `modules/agent/tools.ts` las reúne todas. Una herramienta puede devolver `cards` (lo que ve el usuario) y `suggestions` (botones con preguntas de seguimiento).

## Qué es simulado hoy

- **Sandbox bancario:** instituciones y movimientos ficticios con el mismo contrato que Plaid. Con `FINANCE_PROVIDER=plaid` se usan cuentas reales.
- **Estados de cuenta escaneados:** los PDF digitales y los CSV se importan de verdad, pero un PDF que es una foto o un escaneo no tiene texto que leer (falta OCR).
- **Pagos de compras:** la hoja de pago, los límites y los pedidos funcionan de verdad dentro de la app, pero el cobro usa un proveedor de prueba (dos tarjetas ficticias): no se cobra ninguna tarjeta ni se envía el pedido a una tienda.
- **Pro en Android:** la pantalla de Omni Pro ya compra con Google Play a través de RevenueCat, pero falta instalar el plugin nativo y poner la llave pública (ver "Suscripciones en Android"); no se probó en un teléfono. En la web, Pro se compra con Stripe (real, en modo de prueba o *live*).
- **Cancelaciones:** son asistidas. La suscripción queda marcada y se crea un trámite de seguimiento.
- **Correo y calendario:** la bandeja y el calendario son de prueba (dominios `.test`) con el contrato de Gmail/Outlook; al aprobar un envío, el correo queda en "Enviados" y no sale a internet. Gmail (Google APIs) y Outlook (Microsoft Graph) reales se suman implementando `MailProvider`, sin cambiar el resto del módulo.
- **Firmas:** Omni nunca firma. El usuario puede escribir su nombre como firma o imprimir el PDF y firmarlo a mano.
- **Devoluciones:** los reclamos a las tiendas de prueba salen por la bandeja de prueba y su respuesta se simula con un botón. Con Gmail u Outlook reales, el reclamo saldría desde tu correo y las respuestas llegarían solas. Los marketplaces no tienen API de pedidos para compradores: sus reclamos los envías tú con el texto que prepara Omni.
- **Tiendas:** las 9 tiendas `.test` son ficticias. Con `WEB_PRICE_CHECKS=on` también se leen páginas públicas reales (datos estructurados o IA), respetando robots.txt; no todas las tiendas publican su precio de forma legible.

## Hoja de ruta

1. **Finanzas:** OCR para estados de cuenta escaneados y lectura con Claude de los PDF cuya tabla no se reconoce, leer los PDF en un proceso aparte con límites de memoria, receptor de webhooks de Plaid con verificación JWT, alertas push al llegar al 80% de un presupuesto y un proveedor para Latinoamérica.
2. **Integraciones:** OAuth de Google (Gmail API con `history.list` y Calendar) y Microsoft Graph (`delta`), implementando `MailProvider`; Pub/Sub o suscripciones de Graph para enterarse al instante de los correos nuevos.
3. **Trámites:** OCR para formularios escaneados, firma dibujada en el teléfono, envío a portales (`SUBMIT_FORM`) y recordatorios push (FCM).
4. **Compras:** medios de pago reales con Stripe (SetupIntent y Elements; OmniAgent nunca ve el número de la tarjeta), compra real con API de comercios o de afiliados, vuelos y boletos con API de proveedores (por ejemplo, Amadeus, Duffel o Ticketmaster), alertas push y comparación del mismo producto entre tiendas.
5. **Devoluciones:** leer la respuesta de la tienda con Claude cuando las reglas no alcanzan (validada contra el texto, como en Compras), fotos adjuntas al reclamo, seguimiento por número de guía con las API de las paqueterías y aviso cuando se acerca el fin del plazo para devolver.
6. **Tiempo real:** respuestas en streaming (SSE) y aprobaciones en vivo con Supabase Realtime.
7. **Android:** SDK de RevenueCat (comprar Pro con Google Play), notificaciones push, deep links e íconos y splash.
8. **Calidad:** pruebas de integración contra un Postgres real en CI, límites de tasa por IP en las rutas públicas, trazas (OpenTelemetry) y métricas de negocio (conversión a Pro, cancelaciones).

## Solución de problemas

- **`prepared statement "s0" already exists`:** usa también el session pooler (5432) en `DATABASE_URL`.
- **SSL obligatorio en Supabase:** si activas "Enforce SSL", configura el certificado de Supabase en el `PrismaPg` de `src/lib/db.ts`.
- **"Supabase no está configurado":** faltan `NEXT_PUBLIC_SUPABASE_URL` o `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` en `.env.local`. Reinicia `npm run dev`.
- **Error 503 "no está configurado":** falta la variable de esa integración (Anthropic, Stripe, RevenueCat, Plaid o `CRON_SECRET`).
- **El informe dice "Informe básico, sin IA":** falta `ANTHROPIC_API_KEY` o el modelo falló; el análisis se hizo con reglas. Revisa los logs del servidor.
- **"Ya tienes un análisis reciente":** es el límite de frecuencia del plan. Tras conectar una cuenta nueva el análisis se genera igual.
- **"No encontré campos para llenar en este PDF":** es un PDF escaneado (imagen). Pídele ayuda a Omni en el chat; el OCR está en la hoja de ruta.
- **El formulario dice "Leído con reglas":** falta `ANTHROPIC_API_KEY`, se acabaron las lecturas con IA del mes o el modelo falló (la pantalla lo indica).
- **El calendario del teléfono no muestra lo último:** Google Calendar actualiza los calendarios suscritos cada varias horas; Apple Calendar permite elegir la frecuencia.
- **"Ya tienes una bandeja de prueba conectada":** desconéctala en Trámites para cambiar de estilo (Gmail u Outlook).
- **"Esta tienda no permite revisiones automáticas (robots.txt)":** la tienda pidió que los bots no la visiten y OmniAgent lo respeta. Sigue el producto sin enlace o en otra tienda.
- **La página no publica su precio de forma legible:** no trae datos de producto. Activa "Leer la página con IA" (cuenta en tu plan) o sigue el producto sin enlace.
- **Los precios no se revisan solos:** falta `CRON_SECRET` o el cron no está programado. En Vercel Hobby corre una vez al día; para cada hora, usa `npm run db:cron` (Supabase pg_cron) o Vercel Pro.
- **402 `plan_limit`:** se alcanzó un límite del plan. En Gratis la app ofrece Pro y una alternativa; en Pro los topes son altos, pero existen (por ejemplo, 50 precios).
- **429 "Vas muy rápido":** es el límite de tasa. Espera los segundos que indica `Retry-After`.
- **Pagué y sigo en Gratis:**
  - Revisa que el webhook de Stripe tenga los eventos de la lista y que `STRIPE_WEBHOOK_SECRET` sea el de ese endpoint.
  - Al volver del pago, la app también sincroniza sola.
  - Busca `stripe.webhook.failed` en los logs.
- **`/api/health` responde `degraded`:** la base no contestó en 5 s. Revisa `DATABASE_URL` y que el proyecto de Supabase no esté pausado.
- **"Eliminar la cuenta no está configurado":** falta la función `public.delete_auth_user` o el rol de la app no puede ejecutarla. Corre `npm run db:security`.
- **"El precio cambió" al permitir una compra:** la tienda subió el total después de la cotización. No se cobró nada: revisa la hoja nueva y decide otra vez.

## Verificación

Este código se revisó con TypeScript en modo estricto (0 errores, con tipos equivalentes de las librerías y un cliente de Prisma tipado a partir de `schema.prisma` que resuelve `include`/`select`), y con pruebas automáticas:

- **Finanzas (54 comprobaciones):** el ciclo del conector sandbox, la exclusión de transferencias, suscripciones sin uso, candidatas por reglas, límites sobre la salida del modelo, la llamada a Claude con un cliente simulado y la conversión de las herramientas a JSON Schema.
- **Trámites, piezas puras (55 comprobaciones):** zonas horarias (incluido el cambio de horario), fechas y horas en español, la clasificación de los 10 correos de prueba, el planificador (sin choques, víspera de citas, mes de margen, vencidos), el "por qué" relativo a hoy, los pasos y eventos de cada trámite, y el ICS (plegado de líneas, escapes, alarmas, ida y vuelta).
- **Trámites, de extremo a extremo (87 comprobaciones)** sobre una base de datos emulada en memoria (valida enums, campos obligatorios, llaves únicas y foráneas y borrados en cascada): conectar la bandeja con la IA caída (se usan reglas), 7 trámites sugeridos sin choques, sincronización sin duplicados, confirmación de un toque (3 eventos, sin duplicar en un doble toque), agenda, feed ICS (y token alterado rechazado), lectura con IA simulada (el modelo "intenta" firmar y marcar la autorización y se anula), llenado del PDF real con pdf-lib, respuesta aprobada y enviada con el adjunto, descartar/deshacer/posponer/reprogramar, recordatorios sin repetirse, reclasificación con IA (fecha absurda y destinatario inventado rechazados), subida de PDF, las 13 herramientas del agente, el cron (con la revisión del correo según el plan: cada 20 h en Gratis y cada 3 h en Pro) y la desconexión.
- **Compras, piezas puras (182 comprobaciones):** montos y monedas en varios formatos ("$1,299.90", "1.299,90 €", "COP 1.250.000"), extracción de JSON-LD, microdata y meta de las 9 tiendas, robots.txt, política de red (IPv4/IPv6 privadas, puertos, credenciales), validación de la lectura con IA (monto copiado; envío o cuotas rechazados), bajadas frente a la mediana, supresión de avisos repetidos, validación cifra por cifra de la alerta de Claude, horarios con reintentos y cotización con envío, cargos, impuestos y límites.
- **Rastreador contra un servidor HTTP local (27 comprobaciones):** User-Agent, robots.txt antes de la página (y su grupo propio), gzip y brotli, redirecciones revalidadas (metadata de la nube, un dominio que resuelve a 10.x, `file://`, bucles), DNS que apunta a 127.0.0.1 bloqueado al conectar, página demasiado grande, bomba gzip, tiempo máximo, contenido que no es HTML, 403, 429 y 404 sin evadir nada, charset por encabezado y por `<meta>`, puertos no web y pausa entre visitas al mismo dominio.
- **Compras, de extremo a extremo (129 comprobaciones)** sobre la base emulada: buscar, vista previa, seguir con 29 días de historial, lectura con IA simulada (y un monto de envío rechazado), límites del plan, robots, revisiones programadas con alerta el día de la oferta (Claude simulado), corridas simultáneas sin duplicar, espera de "Revisar ahora", "Probar una bajada", hoja de pago, cotización alterada (409), tarjeta rechazada, Permitir, doble Permitir sin doble cobro, Denegar, precio que sube antes de permitir (nueva autorización), límites, vencimientos, pausa tras errores y por robots, dejar de seguir y las 9 herramientas del agente. Desde la fase 5 también cubre:
  - alertas por reglas en Gratis y redactadas por IA en Pro;
  - cambios de plan: subir, bajar, pausar los precios que sobran y reanudarlos;
  - el panel de Inicio y el ahorro frente a lo normal;
  - avisos y límites de tasa.
- **Panel, planes y pagos, por HTTP (43 comprobaciones):** Route Handlers reales con Next, Supabase y Stripe simulados. Cubren:
  - errores con id de solicitud (401, 400, 422, 429 con `Retry-After`);
  - salud, también con la base caída, y el cron con y sin secreto;
  - Checkout y webhooks con firma real: una firma falsa se rechaza y un evento repetido se procesa una vez;
  - cobro fallido, `past_due`, renovación y cancelación;
  - activación al volver de Checkout (403 con la sesión de otra persona);
  - avisos por usuario;
  - eliminar la cuenta: confirmación exacta, Stripe caído sin borrar nada, cancelación, Auth y Storage, y un aviso tardío de Stripe sin reintentos.
- **Pedidos y devoluciones, de extremo a extremo (93 comprobaciones)** sobre la base emulada: el aviso de la paquetería que llega al correo se vuelve un pedido; pedidos de ejemplo; el atrasado recibe su reclamo una sola vez; aprobar y enviar desde la bandeja; seguimiento que también se aprueba; respuesta de la tienda con nueva fecha y el pedido que llega; producto dañado → etiqueta → paquete devuelto → reembolso → abono encontrado en Finanzas; canal manual con recordatorios, escalar, rechazo y reabrir; compras de OmniAgent que se siguen solas; un reclamo cerrado que no se vuelve a preparar; un pedido reembolsado que deja de esperarse; permisos entre usuarios; las 5 herramientas del agente, Inicio y el cron.
- **Pedidos y devoluciones, por HTTP (23 comprobaciones):** 401 sin sesión, 422 en cada validación, 404 y 409 donde corresponde, reclamo a mano, respuesta simulada, borrar y el cron con y sin secreto.
- **Pruebas unitarias del repositorio (92)**, con la misma API de Vitest. Aquí corrieron con un ejecutor equivalente, porque el registro de npm no estaba disponible.
- **Capturas** renderizadas de todas las pantallas (89), en teléfono y escritorio, claro y oscuro. Incluyen interacciones:
  - confirmar, ajustar, llenar y responder un trámite;
  - seguir un precio, ver el detalle con la gráfica, y permitir y rechazar un pago;
  - elegir el tema, recorrer la gráfica del Inicio y confirmar la eliminación de la cuenta;
  - reportar un problema con un pedido, ver el reclamo listo para aprobar y registrar la respuesta de la tienda;
  - la pantalla de Omni Pro en teléfono (también de 360 px), escritorio y con la app en claro u oscuro, tras un límite y al tocar el botón.

Al instalar, corre `npm run check` (tipos y pruebas) y `npm run build` para validarlo contra las versiones exactas que resuelva npm.
