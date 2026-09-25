"use client";

import { ErrorState } from "@/components/ui/error-state";

export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  if (process.env.NODE_ENV !== "production") {
    console.error("Error boundary caught:", error);
  }

  const link = (href: string, label: string) => (
    <a href={href} style={{ color: "#22d3ee" }}>{label}</a>
  );

  return (
    <div style={{ padding: "20px", textAlign: "center" }}>
      <ErrorState onRetry={retry} />
      <div style={{ marginTop: "24px", fontSize: "12px" }}>
        {link("/privacidad", "Privacidad")} · {link("/terminos", "Términos")} · {link("/cookies", "Cookies")}
      </div>
    </div>
  );
}