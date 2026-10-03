# Documentación y Contexto del Proyecto: OmniAgent (Super-App All-in-One)

## 1. Descripción General
Aplicación móvil (Android/Web) impulsada por Inteligencia Artificial y agentes autónomos que unifica tres pilares fundamentales en una sola plataforma:
- **Asistente Financiero y de Ahorro Automatizado:** Análisis de estados de cuenta, detección de gastos hormiga, cancelación de suscripciones inactivas y recomendaciones de ahorro mediante chat conversacional.
- **Gestor de Productividad y Trámites:** Lectura inteligente de correos, llenado automático de formularios/PDFs y recordatorios sincronizados.
- **Concierge de Compras Autónomo:** Monitoreo de precios de productos y boletos, alertas de ofertas y ejecución de compras con aprobación explícita del usuario ("Allow/Deny").
- **Devoluciones automáticas (dentro de Compras):** Seguimiento de pedidos, detección de retrasos y productos con problemas, reclamos preparados por Omni y enviados solo con aprobación, seguimientos, escalamiento y confirmación del reembolso.

## 2. Stack Tecnológico
- **Frontend/Backend:** Next.js (TypeScript), Tailwind CSS.
- **Base de Datos y Auth:** Supabase (PostgreSQL + Row Level Security).
- **Inteligencia Artificial:** Anthropic Claude API (SDK oficial con Function Calling para agentes autónomos).
- **Pagos:** Stripe / RevenueCat para gestión de suscripciones Freemium/Pro ($19.99/mes).
- **Empaquetado Móvil:** Capacitor (para convertir la app web en aplicación nativa de Android para Google Play).

## 3. Estructura de Módulos a Desarrollar
- FASE 1: Configuración base, base de datos y autenticación de usuarios.
- FASE 2: Módulo de finanzas (integración de transacciones y análisis de IA).
- FASE 3: Módulo de trámites (lector de documentos y automatización de tareas).
- FASE 4: Módulo de compras (scraper de precios y pasarela de aprobación).
- FASE 5: Dashboard unificado, pasarela de pagos (Stripe) y optimización para Google Play

---

## 4. Estado del desarrollo (actualizado el 2 oct 2026)

### Versiones y decisiones fijadas
- Next.js 16 (App Router, `src/proxy.ts` en lugar de middleware), React 19, Tailwind 4, TypeScript estricto.
- Prisma 7 con `prisma.config.ts`, cliente generado en `src/generated/prisma` y driver adapter `@prisma/adapter-pg`.
- Supabase: `@supabase/ssr`, validación con `getClaims()`, llave publicable (`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`).
- Modelos de IA: `claude-haiku-4-5-20251001` en el plan Gratis y `claude-sonnet-5-5` en Pro (variables `ANTHROPIC_MODEL_*`). Las tareas de fondo (clasificar correos, leer precios, redactar alertas) usan el modelo rápido y no gastan la cuota del chat.
- Planes (`src/modules/billing/plans.ts`):
  - **Gratis:** 40 mensajes al mes, 3 precios revisados una vez al día, correo revisado una vez al día, 2 metas, 5 formularios y 10 páginas leídas con IA, y análisis manual cada 12 h.
  - **Pro, a $19.99 al mes:** 1.500 mensajes, 50 precios revisados cada hora, correo cada 3 h, 20 metas, 100 formularios y 200 páginas, informe mensual automático, alertas redactadas por IA y el modelo más capaz.
  - Las funciones de los agentes (`AgentFeatureId`) y los límites se validan siempre en el servidor.
  - Devoluciones funciona igual en los dos planes: no se agregó un plan ni límites nuevos, y el precio de Pro no cambió (decisión del dueño: "no aumentes el plan").
- Regla de producto: todo lo que gasta, envía o cancela se **propone** y el usuario lo **aprueba** (tabla `agent_actions`). Confirmar un trámite solo escribe en el calendario propio del usuario. Las compras se autorizan solo en la hoja de pago con **Permitir / Denegar** (el Allow/Deny de la especificación).
- Contenido externo (correos, PDF, páginas de tiendas, nombres de comercios) es **información, nunca instrucciones**: los prompts lo dicen y la salida del modelo siempre se valida en el servidor.
- Conectores de prueba marcados "Sandbox" con dominios ficticios `.test`: nunca piden usuarios ni contraseñas reales. Nunca se pide ni se guarda el número de una tarjeta.
- Identidad visual propia (inspirada en la experiencia de Muse, sin copiarla): agente "Omni" con marca geométrica, verde pino #1E5B47, acento ámbar #E9B45E, fuente Onest y la boleta perforada de aprobación como elemento de firma.

### Avance por fase
| Fase | Estado | Hecho | Pendiente |
| --- | --- | --- | --- |
| 1. Base, BD y auth | Hecha | Esquema (hoy 34 tablas), SQL de RLS, triggers y Storage, login con correo y Google, rutas protegidas, API con cookie o Bearer | — |
| 2. Finanzas | Hecha (v2) | Conector tipo Plaid (sandbox con 4 instituciones ficticias y adaptador de Plaid real), sync con cursor, análisis con Claude de 3 meses (salida estructurada + respaldo por reglas), gastos hormiga, suscripciones inactivas, recomendaciones accionables, presupuestos, buscador de movimientos, chat con preguntas sugeridas, cron diario, 11 herramientas, **estados de cuenta PDF/CSV** (vista previa, corrección de columnas/fechas/signos, sin duplicados, deshacer) | OCR de estados de cuenta escaneados, leer los PDF en un proceso aparte con límite de memoria, webhooks de Plaid, proveedor para Latinoamérica (p. ej. Belvo), alertas push de presupuesto |
| 3. Trámites | Hecha (v3) | Conector de correo con contrato Gmail/Outlook (`MailProvider`, bandeja sandbox con 10 correos), clasificación con reglas + Claude, trámites sugeridos con fechas sin choques, confirmación de un toque, lectura de PDF con IA y llenado (AcroForm y planos), "Mis datos" cifrados, calendario conectado + feed ICS privado con alarmas, `.ics` por evento, recordatorios en la app, respuesta con el PDF adjunto previa aprobación, cron, 13 herramientas | OAuth real de Gmail (Google APIs) y Outlook (Microsoft Graph), OCR de escaneados, firma dibujada, envío a portales (`SUBMIT_FORM`), push (FCM) |
| 4. Compras | Hecha (v4) | Seguir productos, boletos, vuelos y hoteles por enlace o búsqueda; lector de precios (JSON-LD, microdata, meta y lectura con Claude validada); rastreador que respeta robots.txt, se identifica como OmniAgentBot y bloquea SSRF; 9 tiendas sandbox `.test`; agente en segundo plano con cron (reserva atómica, reintentos, pausa); bajadas frente a la mediana de 30 días; alertas redactadas por Claude y validadas cifra por cifra; hoja de pago Permitir/Denegar con precio reconfirmado, límites y cobro idempotente (pagos simulados); pedidos; 9 herramientas | Medios de pago reales (Stripe SetupIntent/Elements), compra real con API de comercios o afiliados, API de vuelos y boletos (Amadeus, Duffel, Ticketmaster), push, comparar entre tiendas |
| 5. Dashboard, pagos y producción | Hecha (v5) | Panel de Inicio (lo pendiente, ritmo de gasto, módulos, ahorro, agentes, actividad, plan) en claro/oscuro con pestañas en el teléfono; planes Gratis/Pro que habilitan las funciones autónomas (validadas en servidor, 402 `plan_limit`, hoja de Pro, cambios de plan que retiman o pausan agentes); Stripe completo (Checkout es-419, sync al volver, webhooks idempotentes, past_due, portal); errores estables con requestId, logs JSON con redacción, `/api/health`, límites de tasa, CSP/HSTS, revisión de configuración; eliminar cuenta; 58 pruebas unitarias (Vitest); Docker, docker-compose con programador, GitHub Actions (CI y migraciones), `npm run db:cron` y `docs/DEPLOY.md` | Configurar RevenueCat y la suscripción en Play Console, notificaciones push, Stripe Tax si aplica (íconos, splash, plugin de RevenueCat, política de privacidad, página para borrar la cuenta y borrador de la ficha: hechos el 2 oct) |
| Devoluciones (extra) | Hecha (v6) | Pedidos de compras con OmniAgent, correos de tiendas y paqueterías, a mano y de ejemplo; retrasos con reclamo automático; reclamo por daño, producto equivocado, distinto al anuncio o arrepentimiento; envío por correo con aprobación o texto listo para marketplaces; seguimientos aprobados y escalamiento; lectura de respuestas; reembolso confirmado en Finanzas; pantalla Devoluciones, tarjetas del chat e Inicio; cron; 5 herramientas (41 en total); 92 pruebas unitarias (con las de la pantalla de Pro) | Leer respuestas ambiguas con Claude (validado), fotos en el reclamo, API de paqueterías, aviso del fin del plazo para devolver |

### Decisiones del módulo financiero (fase 2)
- Proveedor intercambiable con `FINANCE_PROVIDER` (`sandbox` por defecto, `plaid` opcional). Contrato en `src/modules/finance/providers/types.ts`; el sandbox nunca pide credenciales y se marca "Sandbox" en la UI.
- Análisis: snapshot agregado de 3 periodos de 30 días → candidatas por reglas → Claude redacta con tool use forzado (`registrar_informe`) → `draftFromModel` valida y limita ahorros (1.25× la candidata; 5% del gasto si la idea es del modelo). Sin API key se usa el informe por reglas.
- Transferencias y pagos de tarjeta son neutrales (categoría `Transferencias`). Gasto hormiga: hasta $15 y 4+ compras en 30 días. Suscripción inactiva: 60 días sin uso o el usuario dice que no la usa.
- Frecuencia de análisis manual: Gratis 12 h, Pro 30 min; tras conectar una cuenta siempre corre. El análisis no consume la cuota de mensajes.
- Cancelar sigue siendo Proponer → Aprobar → Ejecutar; presupuestos y metas se crean directo porque no mueven dinero.
- **Estados de cuenta (PDF/CSV)** en `src/modules/finance/statement-import/`: se leen en memoria y el archivo no se guarda (`storagePath` null); CSV con `papaparse`, PDF con pdf.js reconstruyendo la tabla por posiciones. Los movimientos van a una **cuenta manual** (`connectionId` null, nunca a una sincronizada) y llevan `statementImportId` para deshacer. Deduplicación: `externalId = stmt_` + sha256(fecha | centavos | descripción normalizada | n.º de aparición), sin el sentido (puede deducirse distinto en otro archivo). Sentido: columnas cargo/abono → CR/DR → tipo → signo (en débito, negativo = gasto salvo pruebas) → saldos → palabras clave; si hay que adivinar, la vista previa lo avisa. Montos en centavos enteros. Un análisis forzado por importación. Archivos de hasta 4 MB, 5,000 movimientos y 60 páginas; 56 pruebas unitarias (148 en total). Detalle en `README.md` («Estados de cuenta en PDF o CSV»).

### Decisiones del módulo de trámites (fase 3)
- **Correo:** contrato `MailProvider` en `src/modules/procedures/mail/providers/types.ts` (`connect`, `syncMessages` con cursor, `getAttachment`, `sendMessage` y el calendario de la misma cuenta). Hoy lo implementa la bandeja sandbox (token HMAC atado al usuario). Gmail y Outlook reales se suman implementando ese contrato; el resto del módulo no cambia.
- **Clasificación (`triageInbox`):** reglas en todos los correos (fechas y horas en español, montos, referencias) y Claude en lotes de 15 con `clasificar_correos`. `mergeTriage` es defensivo: la hora de una invitación `.ics` manda, una fecha fuera de rango se descarta y solo se responde al remitente o a una dirección que aparezca en el correo.
- **Ciclo del trámite:** `SUGGESTED` → (un toque) `PENDING` → `DONE`, o `CANCELED` con deshacer. Confirmar es un `updateMany` atómico que crea los eventos (cita o evento, bloque para hacerlo y fecha límite); un doble toque no duplica nada.
- **Planificador (`calendar/scheduler.ts`):** margen de 1 día para formularios, 2 para facturas y 3 para reembolsos y fechas límite (30 si falta más de 45 días); horarios preferidos que evitan lo ocupado y otras sugerencias; en citas, aviso la víspera a las 19:00. El "por qué" se guarda como base (`ScheduleBasis`) y se redacta al mostrarlo, relativo a hoy.
- **Formularios:** Claude lee el PDF completo (bloque `document`) con tool use forzado (`registrar_formulario`). Reglas duras sobre su salida: nunca firma, las casillas de autorización las marca el usuario, fechas en dd/mm/aaaa. AcroForm se llena en sus campos; los PDF planos, escribiendo sobre líneas y casillas. Sin cupo o sin API key se llena con reglas.
- **Almacenamiento:** `DOCUMENT_STORAGE=database` (tabla `document_blobs`, por defecto) o `supabase` (bucket privado `documents` con `SUPABASE_SECRET_KEY`). Subidas hasta 4 MB (límite de Vercel), adjuntos hasta 10 MB; las descargas siempre como adjunto.
- **Calendario:** feed ICS privado (secreto cifrado + hash, comparación en tiempo constante) con `VALARM`, eventos de todo el día y cancelaciones por `SEQUENCE`. Recordatorios en la app con `reminded_at` (se avisa una sola vez), al abrir la app y con el cron.
- **Privacidad:** `mail_messages`, `mail_attachments`, `personal_fields`, `calendar_feeds` y `document_blobs` no tienen ningún acceso desde el cliente (solo la API). Desconectar la bandeja borra sus correos y las sugerencias sin confirmar.

### Decisiones del módulo de compras (fase 4)
- **Lectura del precio (`sources.ts` → `readPrice`):** primero datos estructurados (JSON-LD con Product/Offer/AggregateOffer/variantes/Event/Flight/Hotel, luego microdata y meta tags). Si no hay, Claude lee el texto (`leer_precio`, forzado) y solo se acepta si el texto del precio aparece literal en la página, coincide con el número y no es de envío, cuotas o precio anterior. Cupo por plan (`page_read` en `ai_usage_logs`); esos productos se revisan como máximo a diario.
- **Rastreador (`scraper/fetcher.ts`):** User-Agent `OmniAgentBot/1.0 (+SCRAPER_CONTACT_URL o /bot)`, robots.txt RFC 9309 (caché 6 h; si falla la lectura, no visita), una visita a la vez por dominio con 1 s mínimo o `Crawl-delay`, sin evadir bloqueos (403/429/robots → se informa y se pausa). SSRF: IP validada al conectar (lookup propio), redirecciones revalidadas (máx. 4), 8 s, 1.5 MB también descomprimido, solo HTML. `WEB_PRICE_CHECKS=off` deja solo las tiendas `.test`.
- **Tiendas sandbox (`sandbox/stores.ts`):** 9 tiendas y 11 productos con precios deterministas por día (una por formato: JSON-LD, meta, microdata, evento, función de cine, vuelo, hotel con tasas, sin datos y una que prohíbe bots). "Probar una bajada" simula una oferta de 6 h.
- **Agente en segundo plano (`checker.ts`):** `/api/cron/concierge` reclama con `next_check_at` + reserva de 10 min (atómico), concurrencia 4 y presupuesto de tiempo; reintentos 30 min/2 h/6 h/24 h; pausa tras 8 fallos, 3 "no encontrado" o robots. El horario solo se adelanta (jitter negativo) para que un cron diario no salte días. Vercel Hobby solo permite cron diario; cada hora requiere Vercel Pro o Supabase pg_cron + pg_net (SQL en el README).
- **Bajadas (`rules/drops.ts`):** referencia = mediana de 30 cierres diarios (≥3), si no, la lectura anterior. Motivos DROP (≥ sensibilidad 10/15/25%), TARGET y LOWEST. Sin aviso si está agotado, cambia la moneda o ya se avisó en 14 días sin bajar otro 5%. Una bajada ≥60% se confirma con otra lectura. Veredicto "esperar" si el mínimo previo fue ≥5% menor y no llegó al objetivo.
- **Alertas (`alerts.service.ts`):** Claude redacta (`redactar_alerta`) y se valida: montos ±0.50 contra los datos, % ±1, sin URLs, emojis ni "!"; si no pasa, texto por reglas. Una alerta abierta por producto (72 h), notificación PRICE_DROP, Idea con `dedupeKey` y auditoría.
- **Hoja de pago (`checkout.service.ts`):** `startCheckout` crea la acción PURCHASE (24 h) con la cotización; `quoteId` = huella de acción, versión, total, moneda y cantidad. Permitir exige el `quoteId` visto, relee el precio (si sube → 409 `price_changed` con hoja nueva; si baja → cobra menos), revisa límites (por compra $500 y mes $1,000 por defecto, en `profiles.preferences.concierge`), reclama `PENDING → APPROVED` atómico y cobra con la acción como llave de idempotencia. `decideAction` bloquea aprobar compras fuera de la hoja.
- **Pagos:** proveedor sandbox con dos tarjetas de prueba (4242 aprueba, 0002 rechaza). Un proveedor real implementa `PaymentProvider` (`payments.ts`).
- **Interfaz:** Compras en la navegación con contador de ofertas nuevas; alerta con minigráfica y "Comprar por $X"; detalle con gráfica accesible (línea de referencia, objetivo punteado, cursor con teclado y tabla); "Permitir" se arma a los 1.2 s; el chat tiene tarjetas de seguimiento, ofertas, historial, hoja de pago y pedidos.

### Decisiones de la fase 5 (Inicio, planes y producción)
- **Inicio (`/inicio`, `modules/dashboard`):**
  - Es la pantalla principal tras entrar. `getDashboard` arma cada sección por separado (`SectionState` `ok` / `empty` / `error`), así que una falla no tumba el panel.
  - Lo que espera permiso va en este orden: cobro fallido, compras, aprobaciones, devoluciones que esperan un paso tuyo, trámites urgentes o por confirmar y ofertas nuevas.
  - El gasto del mes se compara con el mes pasado hasta el mismo día, sin transferencias, y solo si hay historial.
  - La gráfica es de ritmo acumulado (línea de 2 px, lavado 10 %, cursor con teclado y tabla accesible).
- **Tema:** cookie `omni-theme` (`system` / `light` / `dark`) y `data-theme` en `<html>`, que pone el servidor. Los tokens oscuros se definen para el media query y para `[data-theme="dark"]`.
- **Planes:**
  - Frecuencia de precios: `max(item, plan)` en el revisor.
  - Correo: Gratis cada 20 h, Pro cada 3 h. Informe mensual y alertas con IA, solo en Pro.
  - `402 plan_limit` con `{plan, reason, feature?, limit?}`. `apiFetch` abre la hoja de Pro solo en Gratis; en el chat sale una tarjeta `upgrade`.
- **Cambio de plan (`applyPlanChange`):**
  - A Pro: se retima cada hora, se adelanta la próxima revisión y se reanuda lo pausado por el plan (`pausedByPlan`).
  - A Gratis: revisión diaria, quedan activos los 3 precios más recientes, el resto se pausa (sin borrar) y llega un aviso.
- **Stripe (stripe-node 22.x):**
  - Checkout en `es-419` con `success_url` + `{CHECKOUT_SESSION_ID}`; `/billing/sync` activa Pro al volver.
  - Eventos: `checkout.session.completed`, `customer.subscription.*` (creada, actualizada, borrada, pausada, reanudada), `invoice.paid` e `invoice.payment_failed`.
  - `billing_events` hace el procesamiento idempotente y reprocesa lo que quedó a medias.
  - `PAST_DUE` conserva Pro mientras dure el periodo. Desde basil, el fin de periodo se lee por ítem y la suscripción desde `invoice.parent`.
- **Producción:**
  - Errores: forma `{error:{code,message,details,requestId}}` y `classify()`, que traduce errores de Prisma, Anthropic y Stripe (incluidos los timeouts de pool).
  - Logs: `log.ts` escribe JSON y redacta secretos, correos y teléfonos.
  - Límites de tasa: `rate_limits` con ventana fija; si falla, deja pasar.
  - Base de datos: `connectionTimeoutMillis` de 5 s.
  - Cabeceras: CSP (`CSP_MODE`, se fija al compilar), HSTS y COOP.
  - Arranque: `instrumentation.ts` hace `checkConfig` y registra `onRequestError`.
- **Eliminar la cuenta (exigencia de Google Play):** confirmación escribiendo ELIMINAR. El orden es:
  1. Cancelar Stripe; si falla, no se borra nada.
  2. Revocar Plaid y borrar Storage.
  3. Borrar el usuario de Supabase Auth, lo que borra en cascada.
  4. Borrar la bitácora y vaciar los eventos de pago.

  El webhook tardío de una cuenta borrada se ignora. El paso 3 llama a `public.delete_auth_user` (función SECURITY DEFINER de `supabase-setup.sql` que solo ejecuta el rol de la app): no necesita `SUPABASE_SECRET_KEY`.
- **Google Play:** dentro de la app de Android no se dirige a pagar fuera de Google Play (la hoja solo dice que Pro llegará con Google Play). Target API 36 (Capacitor 8). Node 22+.
- **Despliegue:**
  - Plataformas: Vercel (crons diarios en Hobby; cada hora con `npm run db:cron`, que usa Supabase pg_cron + pg_net con Vault) o Docker (`output: standalone`, usuario `node`, `HEALTHCHECK`, servicio `scheduler`).
  - CI (`ci.yml`): tipos, pruebas, build e imagen con prueba de salud.
  - Migraciones (`migrate.yml`): `prisma migrate deploy` + `db:security`, en el entorno `production`.
- **Pruebas:** `tests/unit/*.test.ts` (Vitest) sobre las reglas puras. El registro de npm no estaba disponible al construir, así que se corrieron con un ejecutor con la misma API; al instalar, `npm test`.

### Decisiones de Devoluciones (v6, sin cambiar los planes)
- **Alcance:** es parte de Compras (herramientas del módulo `CONCIERGE`), con pantalla propia `/devoluciones`, entrada en el menú y chat con `?modulo=devoluciones`. Funciona igual en Gratis y en Pro.
- **Modelo:** `tracked_orders` (origen `OMNIAGENT | EMAIL | MANUAL | EXAMPLE`, `source_key` único por usuario, fecha prometida al final del día local, `late_notified_at` para el aviso atómico, `meta` con los correos de origen y la última estimación) y `return_cases` (motivo, lo que se pide, canal `EMAIL | MANUAL`, asunto y cuerpo, `action_id` de la propuesta, seguimientos, respuesta, próximo paso con fecha, resultado, reembolso e historial en `events`).
- **Orígenes:** compras `PLACED` de OmniAgent (entrega de `details.delivery.eta`), correos de la bandeja de Trámites leídos con reglas (`readOrderMail`: confirmado, enviado, entregado o cancelado; promociones fuera; cursor en `profiles.preferences.returns.mailCursor`), a mano y de ejemplo. No hay API de pedidos para compradores (la SP-API de Amazon es para vendedores).
- **Retrasos (`rules/delivery.ts`):** el reclamo se prepara a los 2 días de retraso y a los 10 el pedido se da por probablemente perdido. Omni lo prepara por su cuenta una sola vez (`late_notified_at` atómico) y solo si el pedido nunca tuvo reclamo; enviarlo sigue necesitando aprobación. En Inicio y en "Necesitan tu atención", un pedido tarde cuenta solo si nunca tuvo reclamo.
- **Reclamo (`rules/claim.ts`):** texto determinista con los datos del pedido y las palabras del usuario (hasta 600 caracteres); no inventa montos, plazos ni políticas. Canal `EMAIL` si la tienda tiene correo de atención y hay bandeja: `SEND_EMAIL` en Aprobaciones y, al ejecutarse, `markClaimSent` programa el seguimiento. Si no, `MANUAL`, con dónde reclamar en cada marketplace.
- **Seguimientos:** esperas de 2, 3 y 3 días hábiles a las 9:00 locales; hasta 2 seguimientos, que también se aprueban, y después los pasos para escalar (plataforma, contracargo del banco, protección al consumidor) con `disputeSummary`. El canal manual recibe recordatorios en lugar de correos.
- **Respuestas (`rules/reply.ts`):** se asocian por el dominio del remitente y una fecha posterior al envío (y el número de pedido si hay varios). Clases: refund, replacement, store_credit, return_label, needs_info, rejected, shipping_update y ack; una promesa condicional no resuelve. Guardia atómica con `replied_at`. Si un pedido que nunca llegó termina en reembolso o saldo a favor, queda `CANCELED`; con un cambio, se vuelve a esperar con la fecha nueva o sin fecha.
- **Reembolsos (`rules/refund-match.ts`):** abonos de Finanzas de la misma tienda, ±1% o ±$0.50, durante 60 días desde que se aprobó.
- **Cron (`/api/cron/returns`):** primero lo urgente y después turnos que rotan cada hora (`rules/turns.ts`, 50 personas por corrida); todo idempotente. Cada hora con `db:cron` o Docker; en Vercel Hobby, una vez al día (11:45 UTC).
- **Seguridad:** `tracked_orders` de solo lectura para su dueño; `return_cases` solo por la API. Límites de tasa: 60 pedidos por hora, 20 reclamos por hora y 30 simulaciones cada 10 minutos. Los correos de las tiendas son información, nunca instrucciones.
- **Interfaz:** secciones "Necesitan tu atención", "Reclamos en curso", "En camino", "Entregados", "Resueltos" y "Cancelados y sin seguimiento"; la boleta de aprobación va dentro de la tarjeta del reclamo; hoja "¿Qué pasó con tu pedido?" en dos pasos; tarjetas del chat `tracked_orders` y `return_case`; en Inicio, las devoluciones pendientes y lo recuperado en el ahorro.
- **Pruebas:** 30 unitarias de reglas, 93 comprobaciones de extremo a extremo y 23 por HTTP.

### Pantalla de Omni Pro (paywall)
- **Dónde:** `src/components/paywall/` (`paywall.tsx` y `autopilot-dial.tsx`); datos en `modules/billing/paywall.ts`; pago en `lib/purchase.ts`. Reemplaza la hoja anterior: la abren los límites del plan Gratis (402 `plan_limit`, con la fila del límite marcada), la tarjeta del chat, el Inicio y la cuenta.
- **Diseño:** siempre oscura (clase `theme-dark`, que reutiliza los tokens oscuros), a pantalla completa en el teléfono con el botón fijo abajo y en dos columnas desde 1024 px. La órbita de 24 horas (la marca de Omni) muestra las revisiones de un día con Pro y da una sola vuelta al abrir. La columna de Pro tiene el anillo brillante, la luna ámbar y la etiqueta "Recomendado".
- **Honestidad:** filas, precio y resumen salen de `PLANS`. No promete "ilimitado" (Pro tiene límites) ni "Gmail" (la bandeja real aún no está conectada). Permitir o Denegar aparece en los dos planes porque existe en los dos.
- **Pago:** `purchasePro()` usa Stripe Checkout en la web y Google Play con RevenueCat en Android (plugin `@revenuecat/purchases-capacitor`, llave `NEXT_PUBLIC_REVENUECAT_ANDROID_KEY`, `appUserID` = id de Supabase). En Android muestra el precio de Google Play y espera a que el webhook active Pro.

### Producción (publicada el 2 oct 2026)
- **Web y API:** https://omniagent-app.netlify.app. Es el proyecto `omniagent-app` de Netlify (Node 24, `@netlify/plugin-nextjs`, `netlify.toml`). Se publica desde GitHub Actions con el workflow «Publicar en Netlify», que usa el `proxy_path` de *deploy-site* del MCP de Netlify; también se puede conectar el repositorio desde Netlify.
- **Base de datos:** proyecto `omniagent` de Supabase (`nhrporwspcvnmabjaqta`, us-east-1).
  - La app entra con el rol `omniagent_app` (BYPASSRLS, miembro de `postgres`) por el pooler `aws-0-us-east-1`.
  - Las tablas se crearon con `prisma db push`, usando `DB_BOOTSTRAP=1` en la compilación. Después se aplicaron la seguridad (RLS, triggers de `auth.users`, bucket y Realtime) y los crons de pg_cron con Vault.
  - Las cuentas nuevas nacen con el correo confirmado (trigger `on_auth_user_autoconfirm`, 3 oct 2026), porque el correo de prueba de Supabase solo llega a los miembros del equipo. Con SMTP propio (Resend): poner *Site URL* y *Redirect URLs* en Supabase Auth y quitar el trigger.
- **Código:** repositorio `kevinmujica782-eng/omniagent`, **público** en GitHub desde al menos el 3 oct 2026 (no tiene secretos dentro; los logs y las entradas de los workflows se pueden ver), con estos workflows:
  - CI con tipos, Vitest y build, que pasó con dependencias reales por primera vez.
  - «Publicar en Netlify».
  - «Simular compilación de Netlify».
  - «App de Android», que entrega el `.aab` y el `.apk` firmados en *Artifacts* y en la rama `builds`.
  - «Migrar base de datos», que solo corre a mano.
  - «Probar producción»: crea una cuenta de prueba, le escribe a Omni por la API, elimina la cuenta con «Eliminar cuenta» y comprueba que ya no puede entrar.
  - «Capturas para Google Play»: crea una cuenta con datos de prueba, toma 6 capturas de 1080 × 1920 (sin la insignia de Netlify) y las deja en la rama `play-store`. La contraseña sale cifrada con una llave pública que se da al correrlo.
- **IA:** `ANTHROPIC_API_KEY` está en Netlify desde el 3 oct 2026, como secreta y solo para producción. Ese día, «Probar producción» registró una cuenta sin correo y Omni respondió en menos de 2 s con Haiku 4.5; un mensaje simple costó menos de un centavo.
- **Android:** paquete `com.omniagent.app`, versión 1.0.0 y API objetivo 36.
  - La llave de subida está en `mobile/keystore/omniagent-upload.p12` (PKCS12 cifrado). Su contraseña no está en el repositorio: va como secreto `ANDROID_KEYSTORE_PASSWORD` o como campo del workflow.
  - Los íconos y la pantalla de carga salen de `mobile/assets/`, y los gráficos de la tienda de `mobile/store/`.
- **Agregado para Google Play:** páginas públicas `/privacidad`, `/terminos` y `/eliminar-cuenta`, con contacto kevinmujica782@gmail.com; botón «Reportar» en las respuestas de la IA (tabla `content_reports`); lo simulado marcado como «Demo»; «Continuar con Google» solo con `NEXT_PUBLIC_GOOGLE_AUTH=on`.
- **Listo para Google Play (3 oct 2026):** `.aab` 1.0.0 (versionCode 4, API 36) firmado con la llave de subida; cuenta de revisión `kevinmujica782+revisor@gmail.com` con banco, correo, compras y pedidos de prueba (la contraseña la pone el dueño con SQL o crea otra cuenta: ver `docs/GOOGLE_PLAY.md`); capturas en la rama `play-store`; «Eliminar cuenta» sin `SUPABASE_SECRET_KEY` (función `public.delete_auth_user`, ya creada en producción). Las cuentas `+prueba-…` viejas ya se borraron.
- **Por revisar en la IA:** en una corrida de prueba, el informe de Finanzas dijo «ingresaste $14.555 en promedio» (era el total de 3 meses) y el chat llamó a Delivery el mayor gasto cuando Vivienda es mayor. Conviene darle al modelo los promedios mensuales ya calculados y pedirle que no los recalcule.
- **Pendiente del dueño** (guía completa en `docs/GOOGLE_PLAY.md`):
  - En Netlify: apagar la insignia «Powered by Netlify» (tapa el menú de abajo de la app) y publicar la corrección de «Eliminar cuenta», idealmente conectando el repositorio para que cada push a `main` se publique solo.
  - En Google Play: cuenta de desarrollador (US$25), ficha, contenido de la app, prueba cerrada con 12 testers durante 14 días y solicitud de producción.

### Cómo retomar
1. `npm install` (Node 22+; sube el `package-lock.json`), luego `npm run dev` y abrir `/preview` para ver todas las pantallas sin configurar nada (`?screen=inicio`, `inicio-gratis`, `pro`, `mejorar`, `cuenta`, `eliminar-cuenta`, `finanzas`, `tramites`, `formulario`, `compras`, `pago`, `devoluciones`, `reclamo`, `chat-devoluciones`...).
2. Configurar `.env.local` y correr las migraciones:
   - Instalación nueva: `npx prisma migrate dev --name init`.
   - Si ya tenías la fase 4: `npx prisma migrate dev --name plan_pro_y_panel`.
   - Si ya tenías la fase 5: `npx prisma migrate dev --name devoluciones` (crea `tracked_orders` y `return_cases`).
   - Si ya tenías Devoluciones: `npx prisma migrate dev --name estados_de_cuenta` (cuentas manuales y movimientos ligados a cada importación).

   Después, `npm run db:security` y `npm test`. Para los agentes en segundo plano: `CRON_SECRET` y `npm run db:cron`, o los crons de Vercel.
3. El detalle completo está en `README.md` (puesta en marcha, módulos, Inicio y planes, arquitectura, endpoints y hoja de ruta). El despliegue a producción y la lista de Google Play están en `docs/DEPLOY.md`.
4. Las cinco fases, Devoluciones y los estados de cuenta en PDF/CSV están hechos, y la web está publicada (ver «Producción»). Lo siguiente, sin orden fijo:
   - Terminar la publicación en Google Play (`docs/GOOGLE_PLAY.md`) y activar los cobros con RevenueCat.
   - Notificaciones push.
   - Integraciones reales: Gmail, Outlook y medios de pago.
   - Estados de cuenta: OCR de los escaneados y leer los PDF en un proceso aparte con límite de memoria.
   - Pruebas de integración contra Postgres en CI.
