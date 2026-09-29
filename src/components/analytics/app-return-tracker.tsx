'use client';

import { useEffect, useRef } from 'react';
import { useAuthContext } from '@/lib/contexts/auth-context';
import { trackClientEvent } from '@/lib/analytics-client';

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
 * con 401.
 */
export function AppReturnTracker() {
  const { user, loading } = useAuthContext();
  const trackedUserId = useRef<string | null>(null);

  useEffect(() => {
    if (loading || !user?.id) return;
    // `useEffect` puede volver a correr si cambia la referencia del objeto
    // user sin que haya cambiado el id. Sin este ref, el mismo montaje
    // dispara el POST dos veces.
    if (trackedUserId.current === user.id) return;
    trackedUserId.current = user.id;

    trackClientEvent('app_return');
  }, [loading, user?.id]);

  return null;
}
