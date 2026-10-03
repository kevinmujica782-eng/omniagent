"use client";

// Último recurso: falla el layout raíz. Debe traer su propio <html> y estilos mínimos en línea
// (la hoja de estilos de la app pudo no cargarse).
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="es">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#f2f4f1", color: "#13201b" }}>
        <main style={{ maxWidth: 420, margin: "0 auto", padding: "96px 24px", textAlign: "center" }}>
          <p style={{ fontSize: 20, fontWeight: 600 }}>OmniAgent no pudo cargar</p>
          <p style={{ marginTop: 8, fontSize: 14, lineHeight: 1.6, color: "#5c6a63" }}>
            Algo falló de nuestro lado. Vuelve a intentarlo en unos segundos.
          </p>
          {error.digest ? <p style={{ marginTop: 8, fontSize: 12, color: "#5c6a63" }}>Código: {error.digest}</p> : null}
          <button
            type="button"
            onClick={reset}
            style={{ marginTop: 24, border: 0, borderRadius: 999, padding: "10px 18px", background: "#1e5b47", color: "#fff", fontWeight: 600, cursor: "pointer" }}
          >
            Reintentar
          </button>
        </main>
      </body>
    </html>
  );
}
