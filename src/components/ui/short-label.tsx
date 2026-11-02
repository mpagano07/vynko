import type { ReactNode } from 'react';

/**
 * Etiqueta corta para mobile y completa desde `sm` en adelante.
 *
 * Pensada para botones cuyo texto no entra en una sola línea en pantallas
 * angostas: se usa junto al ícono, que sigue visible en ambos tamaños.
 */
export function ShortLabel({ short, children }: { short: ReactNode; children: ReactNode }) {
  return (
    <>
      <span className="sm:hidden">{short}</span>
      <span className="hidden sm:inline">{children}</span>
    </>
  );
}
