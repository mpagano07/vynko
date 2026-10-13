import React from 'react';
import type { Metadata } from 'next';

/**
 * Pagina de auth con valor SEO nulo (login es una accion, no contenido). Se
 * marca `noindex` para que no compita con el home ni ensucie el indice. El
 * `page.tsx` es un Client Component y no puede exportar `metadata`, por eso el
 * robots vive en este layout de segmento (Server Component) que solo envuelve.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: true },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
