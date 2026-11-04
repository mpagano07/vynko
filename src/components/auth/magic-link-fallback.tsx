'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

const MAGIC_PATH = '/auth/magic';
const INVITATION_TYPES = new Set(['invite', 'magiclink', 'signup']);

/**
 * Devuelve la URL de canje cuando el fragmento trae una sesión de invitación,
 * o `null` si no hay nada que rescatar.
 *
 * `redirect_to` sólo se respeta si la URL está en la allowlist del proyecto.
 * Si no lo está, GoTrue colapsa el destino al Site URL (`/`) y deja la sesión
 * en el fragmento (`#access_token=...&type=invite`). El servidor no ve ese
 * fragmento, así que el usuario queda en la home sin sesión y cree que el link
 * no funcionó.
 *
 * No toca los links de recuperación de contraseña (flujo PKCE con `?code`) ni
 * el flujo implícito de recuperación (`type=recovery`).
 */
export function magicRedirectTarget(hash: string): string | null {
  const raw = hash.replace(/^#/, '');
  if (!raw) return null;

  const params = new URLSearchParams(raw);
  const type = params.get('type') ?? '';
  const hasSession = Boolean(params.get('access_token') && params.get('refresh_token'));

  if (!hasSession || !INVITATION_TYPES.has(type)) return null;
  return `${MAGIC_PATH}#${raw}`;
}

/**
 * Rescata los magic links de invitación cuando Supabase los manda a la raíz.
 *
 * Vive en el layout raíz para cubrir ese caso sin depender de la configuración
 * de Supabase.
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
