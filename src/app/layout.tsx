import type { Metadata, Viewport } from "next";
import { Onest } from "next/font/google";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { parseTheme, THEME_COLORS, THEME_COOKIE } from "@/lib/theme";
import "./globals.css";

const onest = Onest({ subsets: ["latin"], variable: "--font-onest", display: "swap" });

export const metadata: Metadata = {
  title: { default: "OmniAgent", template: "%s | OmniAgent" },
  description: "Tu agente personal para finanzas, trámites y compras. Omni propone; tú apruebas.",
  applicationName: "OmniAgent",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/brand/omni-mark.svg", apple: "/icons/apple-touch-icon.png" },
  // En iPhone, «Agregar a inicio» abre OmniAgent como app (sin barra del navegador) y permite notificaciones push.
  appleWebApp: { capable: true, title: "OmniAgent", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLORS.light },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Tema elegido en Cuenta → Apariencia: el servidor lo pinta desde el primer byte (sin parpadeo).
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang="es" className={onest.variable} data-theme={theme === "system" ? undefined : theme}>
      <body className="min-h-dvh bg-canvas font-sans text-ink antialiased">{children}</body>
    </html>
  );
}
