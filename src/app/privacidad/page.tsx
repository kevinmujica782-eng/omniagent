import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, LegalSection } from "@/components/legal-page";
import { LEGAL_NAME, SUPPORT_EMAIL, appHost } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Política de privacidad",
  description: "Qué datos usa OmniAgent, para qué, con quién se comparten y cómo borrarlos.",
};

const linkClass = "font-semibold text-primary underline-offset-2 hover:underline";

export default function PrivacyPage() {
  const email = (
    <a href={`mailto:${SUPPORT_EMAIL}`} className={linkClass}>
      {SUPPORT_EMAIL}
    </a>
  );
  return (
    <LegalPage
      title="Política de privacidad"
      intro={
        <p>
          OmniAgent es un asistente personal con inteligencia artificial para tus finanzas, trámites y compras. Esta política
          explica qué datos usamos, para qué, con quién los compartimos y cómo puedes borrarlos. Aplica a la app para Android
          y a la web ({appHost()}).
        </p>
      }
    >
      <LegalSection title="Quién es responsable">
        <p>
          El responsable de tus datos es {LEGAL_NAME ? `${LEGAL_NAME}, ` : ""}el desarrollador de OmniAgent. Para cualquier
          tema de privacidad escribe a {email}.
        </p>
      </LegalSection>

      <LegalSection title="Qué datos usamos">
        <ul>
          <li>
            <strong>Tu cuenta:</strong> nombre, correo, zona horaria, moneda y preferencias. La contraseña la guarda cifrada
            nuestro proveedor de cuentas; nosotros nunca la vemos.
          </li>
          <li>
            <strong>Lo que hablas con Omni:</strong> tus mensajes y las respuestas del asistente. Omni también puede guardar en
            su memoria cosas útiles que le cuentas; las ves y le pides que las olvide desde la app.
          </li>
          <li>
            <strong>Finanzas, si las usas:</strong> cuentas, saldos y movimientos de los bancos que conectes o de los estados
            de cuenta que subas, además de presupuestos, metas y análisis. De un estado de cuenta solo guardamos los
            movimientos: el archivo y su contraseña no se guardan.
          </li>
          <li>
            <strong>Trámites, si los usas:</strong> los correos y adjuntos de la bandeja que conectes, los PDF que subas o que
            Omni llene, los datos personales que decidas guardar para llenar formularios (en «Mis datos», cifrados) y los
            eventos de tu calendario de OmniAgent.
          </li>
          <li>
            <strong>Compras y devoluciones, si las usas:</strong> los enlaces y precios de los productos que sigues, tus
            pedidos y tus reclamos. Nunca pedimos ni guardamos el número de una tarjeta.
          </li>
          <li>
            <strong>Páginas web, si las usas:</strong> el contenido de las páginas que Omni arma para ti. Una página que
            apruebas y publicas la puede abrir cualquiera que tenga el enlace, y no aparece en buscadores.
          </li>
          <li>
            <strong>Tu suscripción:</strong> si pagas Omni Pro con Binance Pay, Binance nos informa de cada pago: el monto, la
            hora, el identificador del pago y el nombre con el que pagas. Nosotros guardamos eso y hasta cuándo está pagado tu
            Pro. Nunca vemos tu contraseña ni tu saldo de Binance. Si pagas con otro método que la app ofrezca (como Google
            Play), ese proveedor procesa el pago y nosotros solo recibimos el estado de la suscripción.
          </li>
          <li>
            <strong>Avisos, si los activas:</strong> el código que tu navegador o tu teléfono nos da para enviarte
            notificaciones. Las entrega el servicio de avisos de tu navegador (Google, Apple o Mozilla).
          </li>
          <li>
            <strong>Voz, si la usas:</strong> el micrófono solo se activa cuando tocas el botón de voz. El dictado lo hace el
            navegador de tu teléfono: en Chrome con los servicios de reconocimiento de voz de Google y en Safari con los de
            Apple. Omni solo recibe el texto; no graba ni guarda tu voz. Mientras escucha, la app mide el volumen en tu propio
            teléfono para animar el ojo de Omni, y ese audio no sale de tu dispositivo.
          </li>
          <li>
            <strong>Datos técnicos:</strong> registros de seguridad y errores (con correos, teléfonos y claves ocultos),
            cuánto usas cada función del plan y la dirección IP que registra nuestro proveedor de alojamiento. Usamos
            cookies solo para mantener tu sesión y recordar el tema claro u oscuro.
          </li>
        </ul>
        <p>
          No pedimos tu ubicación ni tus contactos, solo subimos las fotos y los archivos que tú eliges, y no hay publicidad
          ni rastreadores de terceros.
        </p>
      </LegalSection>

      <LegalSection title="Para qué los usamos">
        <ul>
          <li>Para darte el servicio: responder en el chat, analizar tus gastos, preparar trámites, vigilar precios y seguir pedidos.</li>
          <li>Para pedirte permiso: nada se paga, se envía ni se cancela sin que lo apruebes.</li>
          <li>Para cuidar la seguridad, evitar abusos y mejorar la app, por ejemplo con las respuestas que nos reportas.</li>
        </ul>
        <p>No vendemos tus datos ni los usamos para publicidad.</p>
      </LegalSection>

      <LegalSection title="Inteligencia artificial">
        <p>
          Para responderte, enviamos a un proveedor de inteligencia artificial lo necesario para cada tarea: tu mensaje y los
          datos de la función que estás usando (por ejemplo, las páginas de un estado de cuenta que subes para leerlo). El
          principal es Claude, de Anthropic. Si no está disponible, Omni puede usar de respaldo a OpenAI (ChatGPT), Google
          (Gemini) o xAI (Grok), según cuál esté activo en ese momento.
        </p>
        <p>
          Anthropic procesa ese contenido como proveedor nuestro y, según sus condiciones para la API, no lo usa para
          entrenar sus modelos. Los demás proveedores lo tratan según sus propias condiciones para el uso de su API.
        </p>
        <p>
          Las respuestas de la IA pueden equivocarse, así que revisa lo importante. Si una respuesta te parece ofensiva,
          peligrosa o incorrecta, repórtala desde el chat con «Reportar».
        </p>
      </LegalSection>

      <LegalSection title="Con quién los compartimos">
        <p>Solo con proveedores que los tratan por cuenta nuestra o que la función que usas necesita:</p>
        <ul>
          <li><strong>Supabase:</strong> base de datos y cuentas de usuario.</li>
          <li><strong>Netlify:</strong> alojamiento de la web y de la API.</li>
          <li>
            <strong>Anthropic:</strong> inteligencia artificial (Claude). De respaldo, OpenAI, Google (Gemini) o xAI (Grok).
          </li>
          <li><strong>Binance:</strong> pagos de Omni Pro con Binance Pay.</li>
          <li>
            <strong>Google Play, RevenueCat y Stripe:</strong> pagos de Pro, solo si la app ofrece ese método y lo eliges.
          </li>
          <li><strong>Plaid:</strong> solo si conectas un banco compatible.</li>
          <li>
            <strong>Slack:</strong> solo si conectas Omni a Slack: lo que le escribes con /omni pasa por Slack.
          </li>
          <li>
            <strong>Tu navegador o tu teléfono:</strong> el servicio de avisos y el dictado por voz, si los usas.
          </li>
        </ul>
        <p>
          Cuando apruebas un correo o un reclamo, se envía al destinatario que ves antes de aprobar. Para vigilar precios,
          nuestro rastreador visita la página pública del producto sin enviar datos tuyos. También podemos entregar datos si
          una ley o una autoridad competente lo exige. Tus datos se guardan en servidores de Estados Unidos.
        </p>
      </LegalSection>

      <LegalSection title="Cómo los protegemos">
        <ul>
          <li>Todas las conexiones van cifradas (HTTPS).</li>
          <li>Los accesos a bancos y al correo, y «Mis datos», se guardan cifrados.</li>
          <li>La base de datos separa la información de cada usuario, y solo tú puedes ver la tuya desde la app.</li>
        </ul>
      </LegalSection>

      <LegalSection title="Cuánto tiempo los guardamos">
        <p>
          Mientras tengas tu cuenta. Si la borras, eliminamos en ese momento tu perfil y todo lo asociado: conversaciones, lo
          que Omni recuerda de ti, finanzas, trámites, documentos, compras, devoluciones, páginas web, avisos, tus registros
          de pago con Binance Pay y la bitácora de actividad. Solo conservamos, sin datos personales, los identificadores de
          los avisos de pago, para no procesar dos veces un mismo cobro. Binance, Google Play y Stripe guardan sus propios
          registros de pago según la ley que les aplica.
        </p>
      </LegalSection>

      <LegalSection title="Tus derechos">
        <p>
          Puedes ver y corregir tus datos en la app, pedirnos una copia o que los borremos. Para borrar todo, usa{" "}
          <strong>Cuenta → Eliminar cuenta</strong> o sigue los pasos de{" "}
          <Link href="/eliminar-cuenta" className={linkClass}>
            borrar tu cuenta
          </Link>
          . Para lo demás, escríbenos a {email}; respondemos en un máximo de 30 días.
        </p>
      </LegalSection>

      <LegalSection title="Menores de edad">
        <p>
          OmniAgent es solo para mayores de 18 años. Si crees que un menor creó una cuenta, escríbenos y la borraremos.
        </p>
      </LegalSection>

      <LegalSection title="Cambios a esta política">
        <p>
          Si la cambiamos, actualizaremos la fecha de arriba. Si el cambio es importante, te avisaremos en la app antes de que
          aplique.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
