"use client";

import { ErrorState } from "@/components/ui/error-state";

export default function SalesError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  if (process.env.NODE_ENV !== "production") {
    console.error("Sales error boundary caught:", error);
  }
  return <ErrorState title="No se pudo cargar la caja" onRetry={retry} />;
}