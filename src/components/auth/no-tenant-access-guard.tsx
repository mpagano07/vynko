'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthContext } from '@/lib/contexts/auth-context';
import { isPublicPath } from '@/lib/marketing/public-routes';

/**
 * Expulsa a `/no-access` a la sesion que no tiene ninguna empresa.
 *
 * El caso real es que al usuario lo sacaron de todos sus tenants. Sin esto caia
 * en el dashboard y cada pedido devolvia 401, sin ninguna explicacion de por que
 * la app no le funcionaba.
 *
 * Vive en el cliente y no en el proxy por una razon concreta: `tenant_users` es
 * el unico origen de membresia del schema, asi que desde el proxy una lectura
 * vacia no se puede distinguir de un fallo transitorio, y expulsar ahi le
 * mostraria a un cliente que si tiene empresa un cartel de "pedile a un owner que
 * te vuelva a invitado". Aca `/api/session` ya es una segunda lectura, con la
 * pagina cargada.
 *
 * `/no-access` y las rutas publicas (como `/login`, `/auth/forgot-password`)
 * quedan exentas para que el usuario pueda recuperar contraseñas o cambiar
 * de cuenta sin quedar atrapado en un bucle de redirección.
 */
export function NoTenantAccessGuard() {
  const { noTenantAccess, loading } = useAuthContext();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading || !noTenantAccess) return;
    if (pathname === '/no-access' || isPublicPath(pathname)) return;
    router.replace('/no-access');
  }, [loading, noTenantAccess, pathname, router]);

  return null;
}
