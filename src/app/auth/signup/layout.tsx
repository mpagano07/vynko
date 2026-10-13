import React from 'react';
import type { Metadata } from 'next';

/**
 * Signup es una accion de conversion, no contenido indexable. Se marca
 * `noindex` igual que /login. El `page.tsx` es un Client Component y no puede
 * exportar `metadata`, asi que el robots vive en este layout de segmento.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: true },
};

export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return children;
}
