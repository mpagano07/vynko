'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthContext } from '@/lib/contexts/auth-context';

/**
 * Expulsa a `/sin-acceso` a la sesion que no tiene ninguna empresa.
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
 * `/sin-acceso` esta en las `publicPaths` del proxy justamente para que este
 * redireccionamiento no se realimente: sin eso el proxy mandaria de vuelta y
 * seria un bucle.
 */
export function NoTenantAccessGuard() {
  const { noTenantAccess, loading } = useAuthContext();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading || !noTenantAccess) return;
    if (pathname === '/sin-acceso') return;
    router.replace('/sin-acceso');
  }, [loading, noTenantAccess, pathname, router]);

  return null;
}
