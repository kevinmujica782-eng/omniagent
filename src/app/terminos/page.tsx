import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, LegalSection } from "@/components/legal-page";
import { SUPPORT_EMAIL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Términos de uso",
  description: "Las reglas para usar OmniAgent: aprobaciones, límites de la IA, planes y pagos.",
};

const linkClass = "font-semibold text-primary underline-offset-2 hover:underline";

export default function TermsPage() {
  return (
    <LegalPage
      title="Términos de uso"
      intro={
        <p>
          Al crear una cuenta o usar OmniAgent aceptas estos términos y la{" "}
          <Link href="/privacidad" className={linkClass}>
            política de privacidad
          </Link>
          . Si no estás de acuerdo, no uses la app.
        </p>
      }
    >
      <LegalSection title="El servicio">
        <p>
          OmniAgent es un asistente con inteligencia artificial que te ayuda con tus finanzas, trámites, compras y
          devoluciones. Para usarlo tienes que ser mayor de 18 años y crear una cuenta con datos verdaderos. Cuida tu
          contraseña: lo que pase en tu cuenta es tu responsabilidad.
        </p>
      </LegalSection>

      <LegalSection title="Tú apruebas">
        <p>
          Omni propone y tú decides. Nada se paga, se envía ni se cancela sin tu aprobación explícita. Revisa cada propuesta
          antes de aprobarla: al aprobar, autorizas esa acción.
        </p>
      </LegalSection>

      <LegalSection title="La IA puede equivocarse">
        <p>
          Las respuestas, análisis y recomendaciones son orientativos y pueden tener errores. No son asesoría financiera,
          legal ni fiscal. Verifica la información importante antes de tomar una decisión. Si una respuesta es ofensiva,
          peligrosa o incorrecta, repórtala desde el chat.
        </p>
      </LegalSection>

      <LegalSection title="Funciones de demostración">
        <p>
          Algunas conexiones están marcadas como <strong>Demo</strong> o <strong>de prueba</strong>: bancos, bandeja de
          correo, tiendas y pagos ficticios para que veas cómo funciona la app. Usan datos inventados, no mueven dinero real y
          no envían nada fuera de OmniAgent.
        </p>
      </LegalSection>

      <LegalSection title="Planes y pagos">
        <ul>
          <li>
            <strong>Gratis:</strong> con los límites que ves en Cuenta.
          </li>
          <li>
            <strong>Omni Pro:</strong> 19.99 USDT al mes (el equivalente a US$19.99). Cada pago activa Pro por un mes.
          </li>
          <li>
            El pago se hace con Binance Pay, en USDT. <strong>No se renueva solo:</strong> nosotros no podemos sacar dinero de
            tu cuenta, cada pago lo envías tú. Unos días antes de que venza te avisamos en la app para que decidas si pagas
            otro mes.
          </li>
          <li>
            Si no pagas otro mes, tu cuenta vuelve al plan Gratis. No se borra nada de lo que ya tienes; lo que supere los
            límites del plan Gratis (por ejemplo, los productos que sigues) queda en pausa hasta que vuelvas a Pro.
          </li>
          <li>
            Un pago en USDT no se puede revertir de forma automática. Si pagaste por error o algo no funcionó, escríbenos y lo
            revisamos.
          </li>
          <li>
            Si más adelante la app ofrece otro método de pago (por ejemplo, Google Play), verás su precio y sus condiciones de
            renovación y cancelación en la pantalla de pago, antes de pagar.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Uso aceptable">
        <p>
          No uses OmniAgent para actividades ilegales, para acceder a cuentas o datos de otras personas, para generar
          contenido dañino ni para intentar romper, saturar o copiar el servicio.
        </p>
      </LegalSection>

      <LegalSection title="Tu contenido">
        <p>
          Lo que subes o escribes sigue siendo tuyo. Nos das permiso para procesarlo solo para prestarte el servicio, como
          explica la política de privacidad.
        </p>
        <p>
          Las páginas web que armas con Omni solo se publican cuando tú las apruebas, y las puede abrir cualquiera que tenga
          el enlace. Tú respondes por lo que publicas: no incluyas datos privados de otras personas ni contenido que no
          puedas usar. Podemos retirar una página que incumpla estos términos.
        </p>
      </LegalSection>

      <LegalSection title="Cambios y disponibilidad">
        <p>
          Podemos mejorar, cambiar o retirar funciones. Si un cambio te afecta de forma importante, te avisaremos en la app.
          Hacemos lo posible para que el servicio esté disponible, pero puede tener interrupciones.
        </p>
      </LegalSection>

      <LegalSection title="Responsabilidad">
        <p>
          OmniAgent se ofrece tal como está. En la medida en que la ley lo permita, no respondemos por decisiones tomadas solo
          con base en sugerencias de la IA ni por fallas de terceros, como bancos, tiendas o proveedores de pago. Nada de esto
          limita los derechos que la ley te da como consumidor.
        </p>
      </LegalSection>

      <LegalSection title="Cierre de la cuenta">
        <p>
          Puedes borrar tu cuenta cuando quieras desde{" "}
          <Link href="/eliminar-cuenta" className={linkClass}>
            Cuenta → Eliminar cuenta
          </Link>
          . Si la borras con Pro activo, el Pro termina con la cuenta. Podemos suspender una cuenta que incumpla estos
          términos.
        </p>
      </LegalSection>

      <LegalSection title="Contacto">
        <p>
          Escríbenos a{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className={linkClass}>
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}
