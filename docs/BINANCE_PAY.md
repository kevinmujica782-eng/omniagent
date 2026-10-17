# Cobrar Omni Pro con Binance Pay

Omni Pro cuesta **19.99 USDT al mes** y se paga con **Binance Pay**: la persona paga con el saldo de su cuenta de Binance, el mismo que usa su **tarjeta Binance Visa**. Funciona igual en la web, en la app de Android (archivo `.apk`) y en el iPhone (app agregada a la pantalla de inicio).

Hay dos formas de recibir el pago. La app usa la que esté configurada (si están las dos, la de comercio):

| | Cuenta personal (Pay ID) | Cuenta de comercio |
|---|---|---|
| Qué necesitas | Tu cuenta de Binance de siempre y una llave de API **de solo lectura** | Una empresa registrada y una cuenta de comercio en merchant.binance.com |
| Cómo paga la persona | Envía USDT a tu Pay ID y pega en Omni el **ID de la orden** | Se abre la página de pago de Binance |
| Cómo se confirma | Omni busca el pago en tu historial de Binance Pay | Webhook firmado de Binance y consulta de la orden |
| Variables | `BINANCE_PAY_ID`, `BINANCE_READ_API_KEY`, `BINANCE_READ_API_SECRET`, `BINANCE_RELAY_TOKEN` | `BINANCE_PAY_API_KEY`, `BINANCE_PAY_SECRET_KEY` |

En las dos:

- **Mes pagado por adelantado, sin renovación automática.** Cada pago suma meses a partir del vencimiento actual, o de hoy si ya venció.
- **Aviso antes de vencer.** Tres días antes, Omni manda una notificación (en la app y al teléfono, si activó las notificaciones) con el botón **Sumar un mes con Binance Pay**.
- **Al vencer**, la cuenta vuelve a Gratis sola (tarea programada `omniagent-cobros`, cada hora).

## Con tu cuenta personal (sin empresa)

La cuenta de comercio de Binance exige una empresa registrada, y al pedirla Binance ofrece cerrar la cuenta personal para convertirla. **No hace falta:** Omni puede cobrar en tu cuenta personal tal como está.

### Cómo paga la persona

1. En la pantalla de Pro toca **Desbloquear Omni Pro**. Omni le muestra tu **Pay ID** (con botón para copiarlo) y el nombre que verá al enviar.
2. En su app de Binance: **Pay → Enviar → Pay ID**, y envía **19.99 USDT** (o USDC). Con 39.98 paga 2 meses; con un solo pago puede pagar hasta 12.
3. Binance le muestra el **ID de la orden** al terminar el envío (también está en Pay → Historial). Lo pega en Omni y toca **Confirmar pago**.
4. Omni busca ese pago en tu historial de Binance Pay y, si está, activa Pro en el momento. Si Binance todavía no lo muestra, vuelve a buscar dos veces antes de avisar.

### Qué revisa Omni antes de activar Pro

- **Que sea un envío recibido** por Binance Pay (`C2C`) en **USDT o USDC**.
- **El monto:** 19.99 por mes. Si llegó menos, se lo dice a la persona con el monto que recibiste («Recibimos 15 USDT…»).
- **La fecha:** el pago tiene que ser posterior a cuando la persona empezó a pagar en Omni, con 48 horas de margen por si pagó antes de abrir la pantalla. Así, un pago viejo que recibiste por otra cosa no sirve para activar Pro.
- **Una sola vez:** el ID del pago en Binance queda guardado como único. El mismo pago no activa Pro dos veces ni en otra cuenta de Omni.

### Lo que tiene que hacer el dueño (una sola vez)

1. **Llave de API de solo lectura.** En binance.com (o en la app, buscando «API»): Perfil → **Gestión de API** → **Crear API** → «Generada por el sistema», con el nombre «Omni».
   - Deja marcado **solo «Habilitar lectura»**. Nada de retiros, transferencias ni trading.
   - En la restricción de IP elige **«Sin restricción»**: las consultas salen de servidores sin IP fija.
   - Copia la **API Key** y la **Secret Key**. La Secret Key se muestra una sola vez.
2. **Tu Pay ID:** app de Binance → Pay → Recibir.
3. **Variables en Netlify** (*Project configuration → Environment variables*, marcadas como secretas, contexto de producción):
   - `BINANCE_PAY_ID` = tu Pay ID.
   - `BINANCE_PAY_NAME` = el nombre que verá la persona al enviarte (opcional).
   - `BINANCE_READ_API_KEY` y `BINANCE_READ_API_SECRET` = las dos llaves.
   - `BINANCE_RELAY_TOKEN` ya está puesto (es el token del relevo, ver abajo).
4. **Publica de nuevo.** Las variables se leen al arrancar.
5. **Comprueba.** Con el `CRON_SECRET`, `GET /api/health?binance=1` debe responder `binanceRelay: { relay: "ok", key: "ok" }`: el relevo llega a Binance y la llave es de solo lectura. Después, un pago real de 19.99 USDT desde otra cuenta de Binance.

### Por qué las consultas pasan por Supabase

Binance responde **451** («Service unavailable from a restricted location») a los servidores de EE. UU., y las funciones de Netlify corren allí. La consulta pasa por la función **`binance-relay`** de Supabase (`supabase/functions/binance-relay/index.ts`), que el servidor invoca en **París** (`eu-west-3`) y, si falla, en **São Paulo** (`sa-east-1`) con la cabecera `x-region`. Probado el 16 oct 2026: desde `us-east-1`, 451; desde París, Fráncfort y São Paulo, 200.

- El relevo **no guarda llaves**. El servidor firma cada consulta con la llave secreta (que se queda en Netlify) y el relevo solo la pasa a Binance; la firma vence a los 10 segundos.
- Solo deja pasar **tres rutas de lectura**: el historial de Binance Pay, los permisos de la llave y la hora de Binance.
- Solo responde a quien manda el **token del relevo** (`BINANCE_RELAY_TOKEN`). En el código solo está su SHA-256: el repositorio es público y el token no.
- Para cambiar el token: `openssl rand -hex 32`, poner su SHA-256 en `TOKEN_SHA256` (`printf %s "$TOKEN" | sha256sum`), desplegar la función («Verify JWT» apagado) y poner el token nuevo en Netlify.

### Seguridad

- **La llave solo lee.** Antes de usarla (y cada hora), Omni consulta sus permisos en Binance (`/sapi/v1/account/apiRestrictions`). Si la llave puede retirar, transferir u operar, el cobro se detiene y queda el error `binance.transfer.key_not_read_only` en los logs.
- **Tu historial no se guarda.** Omni lo consulta solo para encontrar el pago del ID que pegó la persona. De cada pago usado guarda el ID de Binance, el monto, la moneda, la fecha y el nombre de quien pagó.

### Límites

- La persona tiene que pegar el ID de la orden: Binance no avisa a las cuentas personales cuando reciben un pago.
- Cada consulta al historial pesa 3000 en el límite de Binance (unas 60 por minuto en total). Por eso cada persona puede intentar 20 veces cada 10 minutos.
- Son cobros de negocio en una cuenta personal. Con mucho volumen, Binance podría pedir verificaciones; entonces conviene una cuenta de comercio (y una empresa).

## Con una cuenta de comercio (si algún día hay empresa)

1. **Cuenta de comercio.** En [merchant.binance.com](https://merchant.binance.com), solicita una cuenta de comercio de Binance Pay. Binance pide una cuenta de empresa (con otro correo, no la personal) y sus documentos.
2. **Llaves de API.** En el portal de comercio, *Developers → API Key*. Copia la **API Key** y la **Secret Key**.
3. **Variables en Netlify**, marcadas como secretas: `BINANCE_PAY_API_KEY` y `BINANCE_PAY_SECRET_KEY`. Publica de nuevo.
4. **Comprueba.** La pantalla de Pro abre la página de pago de Binance; al pagar, la cuenta queda en Pro. Con el `CRON_SECRET`, `/api/health` muestra `binance: ok`.

Al volver de Binance, la pantalla **Cuenta** consulta la orden. Además, Binance avisa al webhook `/api/webhooks/binance` (la app manda su URL en cada orden), que verifica la firma RSA de Binance y vuelve a consultar la orden. El monto y la moneda se comparan con la orden guardada, y la orden pasa a `PAID` una sola vez. Las llamadas se firman con HMAC-SHA512. Si Binance también respondiera 451 a `bpay.binanceapi.com` desde Netlify, esas llamadas tendrían que pasar por un relevo como el de arriba.

## Código

- Reglas puras: `src/modules/billing/binance-rules.ts` (comercio: firma, montos, meses) y `src/modules/billing/binance-transfer-rules.ts` (cuenta personal: firma de la API, historial, ID de la orden, meses por monto, permisos de la llave). Pruebas en `tests/unit/binance.test.ts` y `tests/unit/binance-transfer.test.ts`.
- Servidor: `src/modules/billing/binance.ts` (órdenes de comercio, meses de Pro, vencimientos) y `src/modules/billing/binance-transfer.ts` (relevo, permisos, historial, solicitud de pago y reclamo). Pruebas contra Postgres en `tests/integration/db/binance-transfer.int.test.ts`.
- Pantallas: `src/components/binance-transfer.tsx` (el paso de pago), en la pantalla de Pro (`src/components/paywall/paywall.tsx`) y en Cuenta (`src/components/binance-pay.tsx`).
- Rutas: `POST /api/v1/billing/binance/transfer` (empezar a pagar), `POST /api/v1/billing/binance/transfer/claim` (`{ "codigo": "…" }`), `POST /api/v1/billing/binance/checkout`, `POST /api/v1/billing/binance/sync`, `POST /api/webhooks/binance` y `/api/cron/billing`.
- Tabla `binance_orders`: `kind` = `MERCHANT` o `TRANSFER`. En las de cuenta personal, la fila `PENDING` marca cuándo empezó la persona y, al pagar, guarda `transaction_id` (único), `claim_code` y `payer_name`.
