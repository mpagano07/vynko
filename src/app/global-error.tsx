"use client";

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  if (process.env.NODE_ENV !== "production") {
    console.error("Global error caught:", error);
  }

  return (
    <html lang="es">
      <body style={{ margin: 0, background: "#0f172a", color: "#e2e8f0", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ padding: "40px 20px", textAlign: "center" }}>
          <h1 style={{ fontSize: "24px", margin: "0 0 8px" }}>Algo salió mal</h1>
          <p style={{ color: "#94a3b8", margin: "0 0 20px" }}>Por favor, intenta de nuevo más tarde.</p>
          <button
            onClick={() => retry()}
            style={{
              marginTop: "16px",
              padding: "8px 24px",
              background: "#6366f1",
              color: "#fff",
              border: "none",
              borderRadius: "8px",
              cursor: "pointer",
            }}
          >
            Reintentar
          </button>
        </div>
      </body>
    </html>
  );
}