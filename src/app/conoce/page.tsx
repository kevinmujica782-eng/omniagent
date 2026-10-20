import type { Metadata } from "next";
import { SalesPage } from "@/components/sales-page";

// Página pública para mandar por WhatsApp a quien llega por los anuncios: qué hace Omni, cuánto cuesta y cómo empezar.
// WhatsApp arma la vista previa del enlace con og:title, og:description y og:image, así que van con dirección completa.

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://omniagent-app.netlify.app").replace(/\/+$/, "");
const TITLE = "Omni: tu asistente con IA para ahorrar y no olvidar nada";
const DESCRIPTION =
  "Revisa tus gastos, vigila precios y te recuerda tus trámites. Empieza gratis; Pro se paga con Binance Pay.";

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: "/conoce" },
  openGraph: {
    type: "website",
    url: "/conoce",
    siteName: "OmniAgent",
    locale: "es_VE",
    title: TITLE,
    description: DESCRIPTION,
    images: [
      {
        url: "/brand/omni-compartir.png",
        width: 1024,
        height: 500,
        alt: "OmniAgent: tu agente personal para finanzas, trámites y compras",
      },
    ],
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: ["/brand/omni-compartir.png"] },
};

export default function ConocePage() {
  return <SalesPage />;
}
