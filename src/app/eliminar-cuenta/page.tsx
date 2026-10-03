import type { Metadata } from "next";
import { LegalPage, LegalSection } from "@/components/legal-page";
import { ButtonLink } from "@/components/ui";
import { SUPPORT_EMAIL, appHost } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Borrar tu cuenta",
  description: "Cómo borrar tu cuenta de OmniAgent y todos tus datos, con o sin la app instalada.",
};

const linkClass = "font-semibold text-primary underline-offset-2 hover:underline";

// Página pública que pide Google Play: permite pedir el borrado de la cuenta sin reinstalar la app.
export default function DeleteAccountInfoPage() {
  const subject = encodeURIComponent("Borrar mi cuenta de OmniAgent");
  return (
    <LegalPage
      title="Borrar tu cuenta de OmniAgent"
      updated={false}
      intro={<p>Puedes borrar tu cuenta y todos sus datos cuando quieras, sin reinstalar la app.</p>}
    >
      <LegalSection title="Desde la app o la web">
        <ol>
          <li>
            Entra en OmniAgent, en la app o en <strong>{appHost()}</strong>.
          </li>
          <li>
            Abre <strong>Cuenta</strong>.
          </li>
          <li>
            Al final de la página toca <strong>Eliminar cuenta</strong> y escribe <strong>ELIMINAR</strong> para confirmar.
          </li>
        </ol>
        <p>Tu cuenta y tus datos se borran en ese momento.</p>
        <div>
          <ButtonLink href="/login?next=%2Fcuenta" variant="secondary">
            Entrar para borrar mi cuenta
          </ButtonLink>
        </div>
      </LegalSection>

      <LegalSection title="Si no puedes entrar">
        <p>
          Escríbenos a{" "}
          <a href={`mailto:${SUPPORT_EMAIL}?subject=${subject}`} className={linkClass}>
            {SUPPORT_EMAIL}
          </a>{" "}
          desde el correo de tu cuenta, con el asunto «Borrar mi cuenta de OmniAgent». La borramos en un máximo de 30 días y
          te confirmamos por correo.
        </p>
      </LegalSection>

      <LegalSection title="Antes de borrarla">
        <p>
          Si pagas Omni Pro con Google Play, cancela la suscripción en Google Play (Pagos y suscripciones), porque nosotros no
          podemos cancelarla por ti. Si pagas en la web, la cancelamos al borrar la cuenta.
        </p>
      </LegalSection>

      <LegalSection title="Qué se borra">
        <ul>
          <li>Tu perfil, tu acceso y tus preferencias.</li>
          <li>Tus conversaciones con Omni.</li>
          <li>Cuentas, movimientos, estados de cuenta importados, presupuestos, metas y análisis.</li>
          <li>Correos, documentos, «Mis datos» y eventos del calendario.</li>
          <li>Productos que sigues, compras, pedidos, reclamos y devoluciones.</li>
          <li>La bitácora de actividad de tu cuenta.</li>
        </ul>
      </LegalSection>

      <LegalSection title="Qué se conserva">
        <p>
          Solo los identificadores de los avisos de pago, sin datos personales, para no procesar dos veces un mismo cobro.
          Google Play y Stripe guardan sus propios registros de pago según la ley que les aplica.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
