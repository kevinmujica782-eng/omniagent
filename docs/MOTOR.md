# Motor de ejecución autónoma

El motor recibe una petición del asistente, como «créame una página web», «analiza mis finanzas» o «ponme al día». La convierte en un **trabajo** con pasos y la corre en segundo plano: cada paso llama al servicio de un módulo, uno detrás de otro. La respuesta llega al instante con una tarjeta que muestra cada paso en vivo, y la persona recibe un aviso (también push) cuando termina.

## Cómo se pide

- **Chat y asistente:** el agente tiene una herramienta por playbook: `engine_analyze_finances`, `engine_daily_sweep`, `engine_create_website` y `engine_update_website`. Además, `engine_job_status` dice cómo va un trabajo y `engine_cancel_job` lo detiene.
- **API:** `POST /api/v1/engine/jobs` con `{ playbook, input }`. Si ya hay un trabajo igual en marcha, devuelve ese con `created: false` («ya estoy en eso»).
- **Tarjeta en vivo:** `JobCard`, en `src/components/engine/`. Escucha la fila del trabajo por Supabase Realtime y, si Realtime no conecta, pregunta cada pocos segundos mientras el trabajo siga activo. Tiene un botón para detenerlo.

## Qué sabe hacer

| Playbook | Pasos, en orden | Reglas |
|---|---|---|
| `finance.analyze` | Actualizar tus cuentas → Revisar tus suscripciones → Buscar gastos hormiga → Preparar tu informe con IA | Necesita una cuenta o un estado de cuenta. Respeta el tiempo entre análisis del plan (Gratis 12 h, Pro 30 min). El informe queda en Finanzas y avisa el propio módulo. |
| `daily.sweep` | Actualizar tus cuentas → Revisar tu correo → Revisar tus precios → Revisar tus pedidos → Resumirte lo nuevo | Si un módulo falla, los demás siguen y el fallo queda como aviso. Los precios se revisan solo si ya les toca según el plan. Hay 5 minutos de espera entre una vez y la siguiente. |
| `website.create` | Escribir tu página → Revisar que sea segura → Armar la vista previa → Esperar tu aprobación para publicar → Guardarla en tu memoria | Gratis: 1 página nueva al mes. Pro: 20. |
| `website.update` | Aplicar tus cambios → Revisar que sea segura → Armar la vista previa → Esperar tu aprobación para publicar → Guardarla en tu memoria | Cada cambio a una página publicada se aprueba otra vez. Sin IA solo se pueden cambiar los datos de contacto. |

## Cómo corre sin servidores aparte

Una función de Netlify vive 60 s. El motor trabaja con un presupuesto de 54 s por invocación, y ningún paso puede durar más de 45 s.

1. **Después de responder.** La petición deja el trabajo en cola y responde. Con `after()` de Next.js, la misma invocación sigue con los pasos mientras le quede tiempo.
2. **Otra invocación.** Si no alcanza el tiempo para el próximo paso, el trabajo suelta su turno y pide seguir con `POST /api/cron/engine`, protegido por `CRON_SECRET`. Esa ruta responde 202 al instante y continúa con su propio tiempo.
3. **Cada minuto.** pg_cron llama a `GET /api/cron/engine` (job `omniagent-motor`; para crearlo, `npm run db:cron`). Esa llamada retoma:
   - lo que quedó en cola;
   - los reintentos;
   - las aprobaciones que vencieron;
   - los trabajos cuyo ejecutor se cayó a la mitad.

Cada paso se guarda antes de seguir, así un corte nunca obliga a repetir lo ya hecho.

## Estados

- **Trabajo:**
  - `QUEUED`: en cola, o esperando su próximo reintento.
  - `RUNNING`: un ejecutor lo tiene tomado.
  - `WAITING`: espera una aprobación.
  - Al terminar queda en `SUCCEEDED`, `FAILED` o `CANCELED`.
- **Paso:**
  - Mientras avanza: `PENDING`, `RUNNING` o `WAITING`.
  - Al terminar: `SUCCEEDED`, `SKIPPED` (no había nada que hacer, por ejemplo sin bancos conectados), `FAILED` o `CANCELED`.

## Seguridad

- **Solo lo registrado.** Únicamente corren los playbooks de `playbooks/index.ts`, con entradas validadas con zod, y cada paso llama a los servicios de su módulo con el `userId` del trabajo. Rige lo mismo que en la app: dueño, límites del plan y datos tratados como datos.
- **Aprobaciones.** Lo que se publica, gasta, envía o cancela pasa por Aprobaciones. El trabajo queda en `WAITING` sin ocupar el servidor y sigue cuando la persona decide. Lo despierta `decideAction`, o la tarea programada cuando vence la aprobación.
- **Un solo ejecutor por trabajo.**
  - El turno se toma con un `UPDATE` atómico y dura hasta `locked_until`.
  - Cada escritura lleva `locked_by` en el `WHERE`: si el turno venció y otro ejecutor tomó el trabajo, el viejo ya no puede escribir.
- **Reintentos acotados.**
  - Se reintenta solo lo pasajero: red, base de datos, IA saturada o tiempo agotado.
  - Cada paso tiene un máximo de intentos. Antes de cada nuevo intento se espera 10 s, 1 min y luego 5 min.
  - Los errores de datos, de permisos o de límites del plan no se reintentan.
- **Tope de tiempo.** Al vencer el tiempo de un paso, su `AbortSignal` corta la llamada a la IA. El análisis financiero, además, no guarda un informe a medias.
- **Límites.**
  - 12 trabajos nuevos por hora.
  - A la vez: 1 en Gratis y 3 en Pro (los que esperan una aprobación no cuentan).
  - Un trabajo que queda un día a medias se da por fallido.
- **Rastro.**
  - Bitácora `engine.job.*`.
  - Logs estructurados sin datos sensibles.
  - Aviso al terminar o al fallar.

### Páginas web

- La IA solo escribe textos. Los enlaces de WhatsApp, teléfono, correo, Instagram y web los arma el servidor con el contacto que dio la persona: una página nunca lleva a un sitio que ella no indicó.
- La revisión, sin IA, hace tres cosas:
  - quita las frases con cifras que la persona no dio («10 años», «5.000 clientes», «24/7»);
  - quita direcciones web y código del texto;
  - rechaza la página si pide contraseñas, códigos o datos de tarjeta.
- Si la IA cita cifras inventadas, se le pide corregir una vez. Si insiste o falla, la página se arma por reglas, solo con las palabras de la persona.
- La página no tiene formularios. La IA se niega a suplantar marcas o personas.
- Se publica solo con aprobación. Mientras tanto, solo su dueño la ve en `/s/{slug}?vista=previa`.
- La página pública no aparece en buscadores, se comparte con el enlace y trae «Reportar esta página».
- Desde el chat se puede retirar (`sites_unpublish`): el enlace deja de abrir.

## Datos

- **`engine_jobs`:** el trabajo con sus pasos en `steps`, un JSON validado con `stepRecordSchema`.
  - Los pasos siempre se leen y se guardan juntos, así cada cambio de estado es una sola escritura y Realtime entrega el trabajo completo.
  - Lleva `active_key`, única por persona mientras el trabajo está activo; `waiting_for` (las aprobaciones que espera); `run_after`; el turno; `result` y `error_message`.
  - Tiene RLS `owner_select` y está publicada en Realtime.
- **`sites`:** cada página con su `slug` único, `status` (`DRAFT`, `PUBLISHED` o `ARCHIVED`), `content` (validado con `siteContentSchema`), `pending_content` (un cambio que espera aprobación) y el pedido original (`brief`). Solo el servidor la lee y la escribe.
- **`action_type`:** tiene el valor `PUBLISH_SITE`. Su ejecutor está en `actions/executors.ts`.
- **Límites del plan:** `monthlySites` y `parallelJobs` en `billing/plans.ts`. La pantalla de Pro muestra la fila «Páginas web hechas por Omni».

## Código

| Archivo | Qué hace |
|---|---|
| `engine.types.ts` | Paso (`defineStep`), playbook (`definePlaybook`), resultados (`done`, `skip`, `waitFor`) y lo que se guarda. |
| `engine.rules.ts` | Reglas puras: tiempos, reintentos, qué paso sigue y la vista del trabajo. |
| `job-store.ts`, `prisma-job-store.ts` | Puerto de almacenamiento y su versión en Postgres (las pruebas usan una en memoria). |
| `engine.runner.ts` | El ejecutor: toma el turno, corre los pasos con tope de tiempo, guarda cada avance, reintenta, espera o cede el turno. |
| `engine.service.ts` | Pedir (`startJob`), consultar, cancelar, reanudar después de una aprobación y la corrida de cada minuto. |
| `engine.dispatch.ts` | Segundo plano: `after()` y la continuación en otra invocación. |
| `engine.tools.ts` | Herramientas del agente. |
| `steps/` | Pasos que envuelven los servicios de finanzas, correo, precios, pedidos, resumen y páginas web. |
| `playbooks/` | Los cuatro playbooks y su registro. |
| `src/modules/sites/` | Páginas web: esquemas, reglas (enlaces, revisión, página por reglas), IA, servicio y herramientas. |
| `src/app/s/[slug]/page.tsx`, `src/components/sites/site-page.tsx` | La página pública con seis paletas. |

## Agregar un playbook

1. Define sus pasos con `defineStep`, o reutiliza los de `steps/`. Cada paso tiene un esquema de salida, un tope de tiempo de hasta 45 s y un máximo de intentos. Devuelve `done(salida, nota)`, `skip(nota)` o `waitFor({ actionIds, recheckAt })`.
2. Arma el playbook con `definePlaybook`: `input` (zod), `title`, `activeKey`, `preflight` (requisitos y límites), `steps` y `finish` (resumen, enlace y si avisa).
3. Regístralo en `playbooks/index.ts` y en `PLAYBOOK_IDS`, y agrega su herramienta en `engine.tools.ts`.
4. `tests/unit/engine-playbooks.test.ts` comprueba que cada paso quepa en una invocación y que sus llaves no se repitan.

## Ver sin configurar nada

En `/preview?screen=` están:

- `asistente-motor`: el asistente con un trabajo en marcha.
- `chat-motor`: el chat con la tarjeta de una puesta al día y la de una página que espera aprobación.
- `pagina-web` y `pagina-web-grafito`: la plantilla pública.

Pruebas: `tests/unit/engine.test.ts` (reglas y ejecutor: orden, salidas entre invocaciones, reintentos, tiempo agotado, pasos opcionales, espera de aprobaciones, turnos y cancelación), `tests/unit/engine-playbooks.test.ts` y `tests/unit/sites.test.ts`.
