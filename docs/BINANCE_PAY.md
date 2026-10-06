# Cobrar Omni Pro con Binance Pay

Omni Pro cuesta **19.99 USDT al mes** y se paga con **Binance Pay**: la persona paga con el saldo de su cuenta de Binance, el mismo que usa su **tarjeta Binance Visa**. Funciona igual en la web, en la app de Android (archivo `.apk`) y en el iPhone (app agregada a la pantalla de inicio).

## Cómo funciona

- **Mes pagado por adelantado, sin renovación automática.** Binance Pay no cobra solo cada mes. Cada pago suma un mes a partir del vencimiento actual o de hoy si ya venció.
- **Aviso antes de vencer.** Tres días antes, Omni manda una notificación (en la app y al teléfono, si activó las notificaciones) con el botón **Sumar un mes con Binance Pay**.
- **Al vencer**, la cuenta vuelve a Gratis sola (tarea programada `omniagent-cobros`, cada hora).
- **Confirmación doble.** Al volver de Binance, la pantalla **Cuenta** consulta la orden en Binance. Además, Binance avisa al webhook `/api/webhooks/binance`, que verifica la firma RSA de Binance y vuelve a consultar la orden antes de activar Pro. El monto y la moneda se comparan con la orden guardada.
- **Dónde llega el dinero:** a la billetera de Binance Pay del comercio, en USDT. Desde ahí se puede convertir, retirar o gastar con la tarjeta Binance Visa del dueño.

## Lo que tiene que hacer el dueño (una sola vez)

1. **Cuenta de comercio.** En [merchant.binance.com](https://merchant.binance.com), solicita una cuenta de comercio de Binance Pay con tu cuenta de Binance verificada. Binance revisa tu identidad y tu negocio.
2. **Llaves de API.** En el portal de comercio, entra a *Developers → API Key* (o «Gestión de API») y crea una llave. Copia la **API Key** y la **Secret Key**. La Secret Key se muestra una sola vez.
3. **Variables en Netlify.** En *Project configuration → Environment variables*, crea estas dos variables, marcadas como secretas:
   - `BINANCE_PAY_API_KEY` = la API Key.
   - `BINANCE_PAY_SECRET_KEY` = la Secret Key.
4. **Publica de nuevo** (*Deploys → Trigger deploy*). Las variables se leen al arrancar.
5. **Comprueba.** Entra con una cuenta de prueba y abre la pantalla de Pro: debe decir «19.99 USDT por 1 mes con Binance Pay». Al pagar, la cuenta queda en Pro. (Con el `CRON_SECRET`, `/api/health` también muestra `binance: ok`.)

Si en el portal te piden una URL de webhook, usa `https://omniagent-app.netlify.app/api/webhooks/binance`. La app también la manda en cada orden.

## Seguridad

- Las llaves solo viven en las variables de Netlify. No van en el repositorio, que es público.
- Cada llamada a Binance va firmada con HMAC-SHA512. Los avisos de Binance se aceptan solo con la firma RSA del certificado de Binance.
- Activar Pro es idempotente: la orden pasa a `PAID` una sola vez, aunque el aviso llegue dos veces.

## Código

- Reglas puras (firma, montos, meses): `src/modules/billing/binance-rules.ts`, con pruebas en `tests/unit/binance.test.ts`.
- Órdenes, consulta y vencimientos: `src/modules/billing/binance.ts`.
- Rutas: `POST /api/v1/billing/binance/checkout`, `POST /api/v1/billing/binance/sync`, `POST /api/webhooks/binance` y `/api/cron/billing`.
- Tabla `binance_orders` (una fila por intento de pago).
