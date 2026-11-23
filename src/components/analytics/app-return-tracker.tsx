'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useAuthContext } from '@/lib/contexts/auth-context';
import { trackClientEvent } from '@/lib/analytics-client';
import { isPublicPath } from '@/lib/marketing/public-routes';

/**
 * Registra el paso "vuelven" del embudo: el usuario que vuelve a usar el
 * producto despues de haberlo cerrado.
 *
 * El corte real NO esta aca, esta en el endpoint: `trackAppReturn` descarta
 * el evento si el ultimo fue hace menos de 24 horas. Este componente solo
 * tiene que disparar UNA vez por montaje de la app.
 *
 * Va montado en el layout raiz, adentro de `AuthProvider`, y no en cada
 * pagina: asi "volvio" significa exactamente "volvio a la aplicacion" y no
 * "hizo clic en el dashboard". Como el layout raiz no se remunta en la
 * navegacion entre paginas, un usuario que esta 6 horas trabajando cuenta
 * una sola vez al recargar, que es justo lo que se quiere medir.
 *
 * Se saltea la sesion de /auth/callback y las pantallas publicas porque en
 * ese momento el user todavia puede no estar disponible y el POST rebotaria
 * con 401. Tambien se saltea /onboarding y cualquier usuario sin membresias:
 * `/api/analytics/track` resuelve la sesion con `getAuth`, que exige al menos
 * un tenant, y un 401 ahi hacia que `authFetch` mandara al usuario nuevo a
 * `/login?reason=expired` mientras cargaba el formulario.
 */
export function AppReturnTracker() {
  const { user, loading, tenants } = useAuthContext();
  const pathname = usePathname();
  const trackedUserId = useRef<string | null>(null);

  useEffect(() => {
    if (loading || !user?.id) return;
    // `useEffect` puede volver a correr si cambia la referencia del objeto
    // user sin que haya cambiado el id. Sin este ref, el mismo montaje
    // dispara el POST dos veces.
    if (trackedUserId.current === user.id) return;

    // Sin empresas no hay tenant que mandar en el header y el endpoint
    // responderia 401. Se marca el id para que, si completa el onboarding en
    // este mismo montaje, no se cuente como "vuelve" (nunca se fue).
    if (tenants.length === 0) {
      trackedUserId.current = user.id;
      return;
    }

    // `isPublicPath` cubre /auth/callback, /login y el resto de pantallas sin
    // sesion. /onboarding exige sesion pero no es una vuelta a la app.
    if (isPublicPath(pathname) || pathname === '/onboarding') return;

    trackedUserId.current = user.id;
    trackClientEvent('app_return');
  }, [loading, user?.id, tenants, pathname]);

  return null;
}
