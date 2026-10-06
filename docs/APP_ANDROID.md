# La app para clientes (sin Google Play)

OmniAgent se instala de tres formas. Las tres abren la misma web, así que cada cambio publicado llega a todos sin
actualizar nada.

| Teléfono | Cómo se instala | Notificaciones |
|---|---|---|
| Android | Archivo **OmniAgent.apk** desde `https://omniagent-app.netlify.app/descargar` (o desde Chrome: ⋮ → *Instalar app*) | Sí |
| iPhone | Safari → **Compartir → Agregar a inicio** (no existe .apk para iPhone) | Sí, desde iOS 16.4, abriendo la app desde su ícono |
| Computadora | El navegador | Sí, en Chrome, Edge y Firefox |

**El enlace para anuncios y redes es `https://omniagent-app.netlify.app/descargar`.** Esa página trae el botón de descarga y los pasos para Android, iPhone y computadora.

## El archivo .apk

- Es una **Trusted Web Activity**: una app de Android mínima (unos 500 KB) que abre la web en Chrome a pantalla completa. Por eso tiene las notificaciones push y los pagos con Binance Pay de la web.
- Paquete `com.omniagent.twa`. Es distinto de `com.omniagent.app`, la versión vieja con Capacitor pensada para Google Play.
- **Dónde está:**
  - En la web: `/descargas/OmniAgent.apk`, cuando se publica el sitio.
  - En GitHub: [release app-android](https://github.com/kevinmujica782-eng/omniagent/releases/tag/app-android).
  - En el repositorio: `public/descargas/OmniAgent.apk`.
- **Pantalla completa:** Android la verifica con `https://omniagent-app.netlify.app/.well-known/assetlinks.json`, que lleva la huella de la llave con la que se firmó el `.apk`. Mientras ese archivo no esté publicado, la app funciona igual, pero muestra una barra con la dirección arriba.
- **Instalar:** al abrir el archivo, Android pide permitir *instalar apps de este navegador* una sola vez. Play Protect puede avisar que la app no viene de la tienda: es normal en un `.apk` fuera de Google Play.

## Compilar una versión nueva

Casi nunca hace falta: la app solo abre la web. Recompílala si cambian el ícono, el nombre o el dominio.

1. En GitHub, ve a *Actions → App Android para clientes (.apk) → Run workflow*. Pon la versión y el dominio.
2. El workflow compila y firma el `.apk` con una **llave nueva que nunca se guarda**. Luego:
   - deja el `.apk` en `public/descargas/`,
   - agrega la huella en `assetlinks.json` (conserva las 5 últimas, así las apps ya instaladas siguen a pantalla completa),
   - y actualiza el release `app-android`.
3. Publica la web para que salgan el `.apk` y el `assetlinks.json` nuevos.

Como cada versión se firma con otra llave, quien tenga la anterior debe desinstalarla antes de instalar la nueva. La web no cambia: su cuenta y sus datos siguen ahí.

El workflow *Probar la app Android en un emulador* instala el `.apk` en Android 14 con Chrome, lo abre y deja capturas en la rama `apk-checks`.

## Notificaciones

- En la app: **Cuenta → App y notificaciones → Activar notificaciones**. El botón *Enviar una de prueba* confirma que llegan.
- Cada notificación de Omni (precio que bajó, aprobación pendiente, trámite por vencer, aviso de pago) llega al teléfono. Lo hace el trigger `on_notification_push` de la tabla `notifications`, que llama a `/api/cron/push` con pg_net.
- Las llaves VAPID se crean solas la primera vez y se guardan cifradas en `app_settings`. Si quieres fijarlas, usa `VAPID_PUBLIC_KEY` y `VAPID_PRIVATE_KEY` (`npx web-push generate-vapid-keys`).
