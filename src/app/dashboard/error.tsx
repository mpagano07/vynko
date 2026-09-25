"use client";

import { ErrorState } from "@/components/ui/error-state";

export default function DashboardError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  if (process.env.NODE_ENV !== "production") {
    console.error("Dashboard error boundary caught:", error);
  }
  return <ErrorState title="No se pudo cargar el tablero" onRetry={retry} />;
}