'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { MAGIC_PATH, magicRedirectTarget } from '@/components/auth/magic-link-rescue';

export { magicRedirectTarget };

/**
 * Rescata los magic links de invitación cuando Supabase los manda a la raíz.
 *
 * El rescate principal vive en un script inline del `<head>`
 * (`buildMagicLinkRescueScript`), porque corre antes de hidratar. Este
 * componente queda como red de seguridad para navegaciones del cliente que
 * dejen el fragmento en la URL.
 */
export function MagicLinkFallback() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname === MAGIC_PATH) return;

    const target = magicRedirectTarget(window.location.hash);
    if (!target) return;

    // `replace` para no dejar los tokens en el historial.
    window.location.replace(target);
  }, [pathname]);

  return null;
}
