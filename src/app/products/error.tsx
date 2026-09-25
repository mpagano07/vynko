"use client";

import { ErrorState } from "@/components/ui/error-state";

export default function ProductsError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  if (process.env.NODE_ENV !== "production") {
    console.error("Products error boundary caught:", error);
  }
  return <ErrorState title="No se pudieron cargar los productos" onRetry={retry} />;
}