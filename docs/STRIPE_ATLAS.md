# Cobrar Omni Pro con Stripe Atlas

Stripe no abre cuentas a negocios de Venezuela. Stripe Atlas crea una empresa en Delaware (EE. UU.) a tu nombre y, con ella, una cuenta de Stripe para cobrar Omni Pro en la web (US$19.99 al mes).

La app ya tiene los cobros con Stripe hechos: Checkout, webhooks, portal de clientes y cobros fallidos. Solo le faltan la cuenta y 3 variables. Mientras no estén, la web oculta el pago de Pro.

> Esto es información general, no asesoría legal ni de impuestos. Antes de elegir el tipo de empresa y para las declaraciones, habla con un contador o abogado de EE. UU. Atlas tampoco da esa asesoría.

## 1. Lo que cuesta

| Concepto | Monto | Cuándo |
| --- | --- | --- |
| Stripe Atlas | US$500 | Una vez. Incluye la constitución, las tasas de Delaware y el primer año del agente registrado. |
| Agente registrado | US$100 al año | Desde el segundo año; se renueva solo. |
| Impuesto de Delaware | LLC: US$300 fijos, antes del 1 de junio. C corporation: *franchise tax* e informe anual, antes del 1 de marzo. | Cada año, aunque no haya ventas. Pagar tarde cuesta US$200 más intereses. |
| Declaraciones federales | Las prepara un contador | Cada año. Una LLC de un solo dueño extranjero presenta el formulario 5472 con un 1120 *pro forma*; no presentarlo tiene una multa de US$25,000. |
| Comisión de Stripe | Por cada pago | Según la tarifa de Stripe. |

## 2. LLC o C corporation

- **LLC:** lo habitual para un solo dueño que no busca inversionistas.
- **C corporation:** lo que piden los inversionistas de capital de riesgo. Paga impuesto corporativo y el *franchise tax* de Delaware.

## 3. Qué tener listo antes de empezar

- **Nombre legal**, por ejemplo «OmniAgent LLC». Atlas revisa que esté libre en Delaware.
- **Descripción:** «Software de productividad y finanzas personales con IA, por suscripción mensual». Atlas la usa para revisar que el negocio no esté en sus categorías restringidas.
- **Sitio web:** `https://omniagent-app.netlify.app`.
- **Dirección:** la tuya o una virtual de los socios de Atlas. Ahí llega la carta del EIN.
- **Teléfono de EE. UU.:** personal o virtual (los socios de Atlas lo ofrecen). Solo va en la solicitud del EIN.
- **Tus datos:** nombre como en tu documento de identidad, correo, fecha de nacimiento y dirección. SSN o ITIN solo si los tienes.

## 4. Pasos

1. Abre la solicitud en https://dashboard.stripe.com/register/atlas y complétala.
2. Paga los US$500. Si Stripe no puede atender tu negocio, devuelve la tarifa. Atlas no garantiza que Stripe apruebe los pagos de la empresa.
3. En 1 a 2 días hábiles la empresa queda constituida y Atlas te avisa por correo. Desde ese correo activas Stripe Payments: los pagos con tarjeta de EE. UU. funcionan antes de tener el EIN.
4. Sin SSN, el EIN (número fiscal de la empresa) tarda de 10 a 30 días hábiles. Mientras tanto puedes transferir hasta US$100,000 de Stripe a tu cuenta.
5. Abre la cuenta bancaria de la empresa, con Stripe o con un banco de EE. UU., para recibir los pagos.

## 5. Conectar la cuenta a OmniAgent

Cuando la cuenta de Stripe esté activa, conecta el conector de Stripe en Claude y Claude configura el resto:

- Producto **OmniAgent Pro** con precio recurrente de **US$19.99 al mes**.
- Webhook `https://omniagent-app.netlify.app/api/webhooks/stripe` con los 8 eventos de `docs/DEPLOY.md` (sección 5).
- Portal de clientes, reintentos de cobro y correos de Stripe.

Tú solo pegas la llave secreta (`sk_live_…`) en Netlify como `STRIPE_SECRET_KEY`. Las otras dos variables son `STRIPE_PRICE_PRO_MONTHLY` y `STRIPE_WEBHOOK_SECRET`. El detalle completo está en `docs/DEPLOY.md`, sección 5.

## 6. Google Play

- En la app de Android, Pro se cobra con Google Play (RevenueCat), no con Stripe: Google lo exige para lo que se vende dentro de la app. Stripe es para la web.
- Con la empresa puedes pedir un número D-U-N-S (gratis, puede tardar) y abrir una **cuenta de organización** en Play Console. Esas cuentas no necesitan la prueba cerrada de 12 testers durante 14 días.

## Fuentes

- Stripe Atlas: https://stripe.com/atlas
- Cómo se incorpora una empresa con Atlas (precio, datos, EIN, plazos): https://docs.stripe.com/atlas/signup
- Impuestos de la empresa (Delaware y federales): https://docs.stripe.com/atlas/business-taxes
- Categorías restringidas de Atlas: https://support.stripe.com/questions/stripe-atlas-restricted-business-categories
