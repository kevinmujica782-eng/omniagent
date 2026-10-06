# Correo real en Trámites

Cada persona conecta **su propio correo** y Omni detecta en él permisos, citas, reembolsos y fechas límite. Las respuestas (por ejemplo, el formulario lleno) salen desde ese correo, siempre después de que la persona las aprueba.

## Proveedores

| Proveedor | Cómo se conecta | Servidores |
|---|---|---|
| Gmail (y Google Workspace) | Contraseña de aplicación: [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords). Requiere la verificación en dos pasos. | `imap.gmail.com:993`, `smtp.gmail.com:465` |
| Yahoo | Contraseña de aplicación en *Seguridad de la cuenta* | `imap.mail.yahoo.com:993`, `smtp.mail.yahoo.com:465` |
| iCloud | Contraseña específica de app en la cuenta de Apple | `imap.mail.me.com:993`, `smtp.mail.me.com:587` |
| AOL | Contraseña de aplicación | `imap.aol.com:993`, `smtp.aol.com:465` |
| Zoho Mail | Contraseña específica de aplicación (con IMAP activado) | `imap.zoho.com:993`, `smtp.zoho.com:465` |
| Otro (dominio propio) | Usuario y contraseña del servidor | IMAP 993 o 143 y SMTP 465 o 587, con TLS |

**Outlook, Hotmail y Live no se pueden conectar con contraseña.** Microsoft exige su propio inicio de sesión (OAuth) desde el 16 de septiembre de 2024. La app lo explica y sugiere reenviar esos correos a Gmail, Yahoo o iCloud. Conectar Outlook con OAuth (Microsoft Graph) está en la hoja de ruta.

La **bandeja de prueba** (correos ficticios `.test`) sigue disponible para ver cómo funciona sin conectar nada.

## Qué hace Omni con el correo

- **Solo lectura.** Abre la bandeja de entrada con `EXAMINE`: no marca como leído, no mueve y no borra nada.
- **Qué lee.** La primera vez, los últimos 20 correos de los últimos 30 días. Después, solo los nuevos (por UID, con cursor), de 25 en 25. Con el plan Gratis revisa una vez al día; con Pro, cada 3 horas. También al tocar **Revisar correo**.
- **Adjuntos e invitaciones.** Ve la lista de adjuntos sin bajarlos. Baja un PDF solo cuando hace falta para llenar un formulario, y las invitaciones de calendario (`.ics`) para proponer la cita.
- **Envíos.** Por SMTP desde el correo de la persona, solo después de **Aprobar**. Si responde a un correo, la respuesta queda en el mismo hilo (`In-Reply-To`). Los destinatarios `.test` de las tiendas de prueba nunca salen por el correo real.
- **Calendario.** El correo por IMAP no trae calendario. Las citas quedan en OmniAgent y en el enlace privado del calendario del teléfono (Google Calendar, Apple, Outlook).

## Seguridad

- La contraseña de aplicación se verifica al conectar, entrando a IMAP y a SMTP, y se guarda cifrada con AES-256-GCM (`TOKEN_ENCRYPTION_KEY`). Nunca vuelve al navegador ni a los logs.
- Si el proveedor la rechaza después (por ejemplo, porque la persona la revocó), la bandeja queda como vencida y la app pide volver a conectarla.
- **Sin acceso a redes internas.** Un servidor propio debe tener nombre de dominio, no una IP, y resolver a una IP pública. La app se conecta a esa IP ya revisada y TLS valida el certificado con el nombre (`servername`), así un cambio de DNS no la redirige.
- Solo se permiten los puertos de correo con TLS: 993 o 143 con STARTTLS, y 465 o 587 con STARTTLS.
- Hay un máximo de 8 intentos de conexión por hora por cuenta, porque cada intento prueba una contraseña.

## Código y pruebas

- Proveedor: `src/modules/procedures/mail/providers/imap.ts`, con `imapflow`, `mailparser` y `nodemailer`. Implementa el mismo `MailProvider` que el sandbox.
- Reglas puras: `imap-rules.ts` (cursor, adjuntos, errores, servidores) y `imap-presets.ts` (proveedores), con pruebas en `tests/unit/imap.test.ts`.
- Conectar: `POST /api/v1/procedures/mailboxes/imap`. Las conexiones se guardan en `integration_connections` con `provider = MAIL_IMAP`.
- Prueba de integración: `tests/integration/imap.int.test.ts` corre en CI contra un servidor IMAP/SMTP real (GreenMail). Conecta, lee, baja adjuntos, sincroniza solo lo nuevo y responde en el mismo hilo.
