# Publicar OmniAgent en Google Play

Guía para pasar de la web publicada a la app en la tienda. La web ya está en **https://omniagent-app.netlify.app** y la app de Android la abre por dentro. Los datos de la app son:

| Dato | Valor |
| --- | --- |
| Paquete | `com.omniagent.app` (no se puede cambiar después de publicar) |
| Versión | `1.0.0` |
| Android | mínimo 7.0 (API 24) y objetivo Android 16 (API 36), como exige Google Play desde el 31 de agosto de 2026 |

## 1. Antes de subir nada: que la web funcione completa

1. **Registro sin correo de confirmación (ya está hecho).** El correo que trae Supabase solo envía a los miembros de tu equipo, así que tus testers nunca recibirían el correo de confirmación. Por eso la base de datos confirma el correo al crear la cuenta y la persona entra de una vez (trigger `on_auth_user_autoconfirm` sobre `auth.users`, en `prisma/sql/supabase-setup.sql`).
   - Cuando configures un correo propio en *Authentication → Emails → SMTP Settings* (Resend o Brevo tienen plan gratis):
     - En *Authentication → URL Configuration*, pon *Site URL* `https://omniagent-app.netlify.app` y agrega `https://omniagent-app.netlify.app/**` en *Redirect URLs*.
     - Quita el trigger para volver a pedir confirmación: `drop trigger if exists on_auth_user_autoconfirm on auth.users;`
2. **Netlify → omniagent-app → Project configuration → Environment variables.**
   - `ANTHROPIC_API_KEY` (ya está, desde el 3 oct 2026): la llave de la consola de Anthropic (*Settings → API keys*). Necesita saldo; sin ella, el chat de Omni no responde.
   - «Eliminar cuenta», que Google Play exige, no necesita variables: la base la resuelve con la función `public.delete_auth_user` (creada el 3 oct 2026; solo la puede ejecutar el rol de la app).

   Las variables nuevas se aplican al volver a publicar la web. Después, corre el workflow «Probar producción» en GitHub: crea una cuenta, habla con Omni, elimina la cuenta y comprueba que ya no puede entrar.
3. **Prueba la web:** crea una cuenta, habla con Omni, sube un estado de cuenta y prueba «Reportar» y «Eliminar cuenta».

## 2. Cuenta de desarrollador

- Entra a https://play.google.com/console y crea la cuenta: US$25, una sola vez.
- Te piden un documento de identidad y una tarjeta de crédito o débito a tu nombre. No aceptan tarjetas prepagadas.
- **Cuenta personal:** antes de publicar necesitas una prueba cerrada con 12 testers durante 14 días (paso 6).
- **Cuenta de organización:** no necesita esa prueba, pero pide un número D-U-N-S.

## 3. Crear la app

*Play Console → Crear app*, con estos datos:
- **Nombre:** OmniAgent
- **Idioma predeterminado:** Español (Latinoamérica)
- **Tipo:** App
- **Precio:** Gratis

## 4. Ficha de la tienda

### Textos

**Descripción breve** (máximo 80 caracteres):

> Tu agente con IA para finanzas, trámites y compras. Tú apruebas cada paso.

**Descripción completa:**

> OmniAgent es tu agente personal con inteligencia artificial. Omni revisa, te propone y tú decides: nada se paga, se envía ni se cancela sin tu aprobación.
>
> FINANZAS
> • Sube tus estados de cuenta en PDF o CSV y Omni ordena tus movimientos por categoría.
> • Encuentra gastos hormiga y suscripciones que ya no usas.
> • Te propone cómo ahorrar, con presupuestos y metas.
>
> TRÁMITES
> • Llena formularios en PDF con tus datos y te dice qué falta.
> • Ordena fechas límite y citas en tu calendario de OmniAgent, con recordatorios.
>
> COMPRAS Y DEVOLUCIONES
> • Vigila el precio de productos, boletos, vuelos y hoteles, y te avisa cuando baja de verdad.
> • Sigue tus pedidos y prepara el reclamo si algo llega mal.
>
> CHAT CON OMNI
> • Pregúntale por tus gastos, un trámite o algo que quieras comprar.
> • Si una respuesta no te parece correcta, repórtala desde el mismo chat.
>
> MODO DEMO
> Algunas conexiones (bancos, bandeja de correo y tiendas) están marcadas como «Demo»: usan datos de ejemplo para que veas cómo funciona la app, sin mover dinero real.
>
> PLANES
> Empieza gratis. Omni Pro llegará pronto a Android.

### Gráficos

| Recurso | Archivo |
| --- | --- |
| Ícono de 512 × 512 | `mobile/store/play-icon-512.png` |
| Imagen destacada de 1024 × 500 | `mobile/store/feature-graphic-1024x500.png` |
| Capturas de teléfono (mínimo 2) | Rama `play-store`: 1080 × 1920 de Inicio, Finanzas, el chat, Compras, Trámites y Aprobaciones. Las genera el workflow «Capturas para Google Play» con la cuenta de revisión |

**Datos de contacto:** el correo `kevinmujica782@gmail.com` y el sitio `https://omniagent-app.netlify.app`.

## 5. Contenido de la app (Play Console → Política → Contenido de la app)

| Sección | Qué poner |
| --- | --- |
| Política de privacidad | `https://omniagent-app.netlify.app/privacidad` |
| Acceso a la app | «Toda o parte de la funcionalidad está restringida». Usa la cuenta de revisión `kevinmujica782+revisor@gmail.com` (ya tiene banco, correo, compras y pedidos de prueba): escribe su correo y contraseña para los revisores. |
| Anuncios | No contiene anuncios |
| Clasificación del contenido | Categoría utilidad o productividad. Responde «no» a violencia, sexo, drogas y apuestas. Si preguntan por contenido generado con IA, responde que sí: tiene un chat con IA y botón para reportar. |
| Público objetivo | Solo mayores de 18 años |
| Funciones financieras | Administración de finanzas personales: presupuestos y análisis de gastos. No ofrece préstamos, inversiones, cripto ni pagos entre personas. |
| Eliminación de la cuenta | Sí se puede crear cuenta. URL: `https://omniagent-app.netlify.app/eliminar-cuenta` |
| Seguridad de los datos | Ver la tabla de abajo |
| Apps de gobierno, salud, noticias | No |

### Seguridad de los datos (borrador; revísalo)

- ¿Recoge o comparte datos? **Sí recoge, no comparte.** Los proveedores que procesan datos por tu cuenta, como Supabase, Netlify y Anthropic, no cuentan como «compartir».
- ¿Cifrados en tránsito? **Sí.**
- ¿Se pueden borrar? **Sí**, desde la app y en la URL de eliminación.

Datos que recoge la app:

| Tipo de dato | ¿Obligatorio? | Para qué |
| --- | --- | --- |
| Nombre y correo | Sí | Funcionalidad de la app y administración de la cuenta |
| Información financiera: historial de compras y otra información financiera (movimientos y saldos de los estados de cuenta) | Opcional | Funcionalidad de la app |
| Archivos y documentos (PDF que subes) | Opcional | Funcionalidad de la app |
| Calendario: eventos de los trámites | Opcional | Funcionalidad de la app |
| Actividad en la app: otro contenido generado por el usuario (conversaciones con Omni y reportes) | Sí | Funcionalidad de la app; los reportes también sirven para seguridad |

Cuando conectes Gmail u Outlook de verdad, agrega **Mensajes → Correos electrónicos**.

## 6. Prueba cerrada (cuentas personales: 12 testers durante 14 días)

1. *Probar y publicar → Pruebas → Prueba cerrada → Crear segmento.*
2. Sube `omniagent-1.0.0.aab`. La primera vez, acepta **Firma de apps de Google Play**: Google guarda la llave con la que se firma la app y tú subes con tu llave de subida (ver el paso 8).
3. Crea una lista de testers con al menos 12 correos de Gmail y elige los países.
4. Envía la versión a revisión. Cuando la aprueben, comparte el **enlace de participación** con tus testers: cada uno debe aceptar y descargar la app.
5. Los 12 deben seguir inscritos **14 días seguidos**. Pídeles que la usen y te dejen comentarios: Google pregunta por eso.

## 7. Acceso a producción

Al pasar los 14 días, Play Console muestra **Solicitar acceso a producción**. Responde las preguntas: cómo reclutaste a los testers, qué te comentaron, qué cambiaste y por qué la app está lista. La revisión suele tardar 7 días o menos. Con el acceso aprobado, crea la versión de **Producción** con el último `.aab`.

## 8. Llave de subida y nuevas versiones

- **La llave de subida** está en `mobile/keystore/omniagent-upload.p12`, alias `omniagent`, cifrada con una contraseña que no está en el repositorio.
  - Guarda una copia del archivo y la contraseña fuera de GitHub, por ejemplo en un gestor de contraseñas.
  - Si se pierde, Google permite cambiar la llave de subida desde Play Console. La llave de la app la guarda Google.
  - Huella SHA-256: `B4:0E:3D:44:B3:BD:9A:FD:1E:06:A2:8B:D7:DC:06:4E:09:39:A5:BA:E4:CB:37:0D:F6:04:2D:24:58:67:E5:26`
- **Otra versión:** en GitHub, *Actions → App de Android → Run workflow*, con la versión visible (por ejemplo `1.0.1`) y la contraseña de la llave.
  - Para no escribir la contraseña cada vez, guárdala como secreto `ANDROID_KEYSTORE_PASSWORD` en *Settings → Secrets and variables → Actions*.
  - El `.aab` y el `.apk` quedan en los *Artifacts* de esa corrida y en la rama `builds`.
  - El número de versión interno sube solo.
- **Cambios en la web** (textos, pantallas, funciones): llegan a la app sin subir otra versión, porque la app abre la web publicada. Solo hace falta una versión nueva para cambiar íconos, permisos o plugins nativos.

## 9. Cobrar Omni Pro dentro de la app (cuando quieras)

1. En Play Console, completa el **perfil de pagos**. Venezuela está entre los países que pueden vender; se cobra en dólares.
2. *Monetizar → Productos → Suscripciones:* crea `pro_monthly` a US$19.99 al mes.
3. En RevenueCat, crea el proyecto, conecta Google Play con una cuenta de servicio, define el entitlement `pro` y el webhook `https://omniagent-app.netlify.app/api/webhooks/revenuecat`.
4. En Netlify, agrega `NEXT_PUBLIC_REVENUECAT_ANDROID_KEY` (llave pública `goog_…`) y `REVENUECAT_WEBHOOK_AUTH`, y vuelve a publicar la web. La app ya trae el plugin de RevenueCat.
