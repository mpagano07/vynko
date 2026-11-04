'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2, XCircle } from 'lucide-react';
import { safeInternalPath } from '@/lib/security/redirects';

type Status = 'processing' | 'error';

/**
 * Aterrizaje de los links de invitación (magic link / invite).
 *
 * Supabase entrega la sesión con el flujo implícito: los tokens viajan en el
 * fragmento (`#access_token=...&refresh_token=...`), que el servidor no recibe.
 * Por eso se capturan acá en el navegador y se envían a `/api/auth/session`,
 * que escribe las cookies HttpOnly que después leen el proxy y las rutas de API.
 *
 * El flujo PKCE normal (confirmación de registro) sigue usando `/auth/callback`:
 * si llega un `code`, se lo deriva al servidor, que tiene el code verifier en la
 * cookie y puede canjearlo.
 */
export default function MagicLinkPage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>('processing');

  useEffect(() => {
    let cancelled = false;

    async function redeem() {
      const url = new URL(window.location.href);
      // Los magic links de este proyecto son invitaciones: si Supabase colapsó
      // el `redirect_to` al Site URL y se perdió `next`, el destino correcto
      // sigue siendo aceptar la invitación. La página de aceptación manda al
      // dashboard cuando no había nada pendiente.
      const next = safeInternalPath(url.searchParams.get('next'), '/accept-invite');
      const hash = new URLSearchParams(url.hash.replace(/^#/, ''));

      const linkError =
        url.searchParams.get('error_description') ??
        url.searchParams.get('error') ??
        hash.get('error_description') ??
        hash.get('error');

      if (linkError) {
        if (!cancelled) setStatus('error');
        return;
      }

      const accessToken = hash.get('access_token');
      const refreshToken = hash.get('refresh_token');

      if (accessToken && refreshToken) {
        try {
          const res = await fetch('/api/auth/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              access_token: accessToken,
              refresh_token: refreshToken,
            }),
          });

          if (cancelled) return;

          if (!res.ok) {
            setStatus('error');
            return;
          }

          // Los tokens no tienen que quedar en el historial ni volver a procesarse
          // con un refresh de la página.
          window.history.replaceState({}, '', `${url.pathname}${url.search}`);
          router.replace(next);
          return;
        } catch {
          if (!cancelled) setStatus('error');
          return;
        }
      }

      const code = url.searchParams.get('code');
      if (code) {
        window.location.replace(
          `/auth/callback?code=${encodeURIComponent(code)}&next=${encodeURIComponent(next)}`
        );
        return;
      }

      if (!cancelled) setStatus('error');
    }

    redeem();

    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center max-w-sm mx-auto px-4">
        {status === 'processing' ? (
          <>
            <Loader2 className="h-12 w-12 animate-spin text-indigo-500 mx-auto" />
            <p className="mt-4 text-gray-600">Ingresando con tu link...</p>
          </>
        ) : (
          <>
            <XCircle className="h-12 w-12 text-red-500 mx-auto" />
            <p className="mt-4 text-gray-600">
              El link ya se usó o venció. Pedí uno nuevo o iniciá sesión con tu
              email y contraseña.
            </p>
            <Link
              href="/login"
              className="mt-6 inline-block rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Ir a iniciar sesión
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
