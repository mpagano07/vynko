import { describe, expect, it } from 'vitest';
import { hardenSessionCookieOptions } from '@/lib/security/session-cookie';

/**
 * La cookie de sesion se escribe desde dos caminos: el cliente SSR de las rutas
 * de API y el proxy. Ambos tienen que aplicar el mismo endurecimiento.
 *
 * Regresion: el proxy repetia la logica inline y se le habia olvidado el
 * `httpOnly`. Como refresca la sesion en cada navegacion, eso reescribia la
 * cookie como legible despues de que las rutas la hubieran escrito bien, y la
 * proteccion se perdia sin que ningun test lo notara.
 */
describe('hardenSessionCookieOptions', () => {
  it('aplica sameSite, secure y path por defecto', () => {
    const hardened = hardenSessionCookieOptions({});
    expect(hardened.sameSite).toBe('lax');
    expect(hardened.path).toBe('/');
    expect(hardened.secure).toBe(process.env.NODE_ENV === 'production');
  });

  it('respeta el path que pide el SDK en vez de forzar "/"', () => {
    expect(hardenSessionCookieOptions({ path: '/sub' }).path).toBe('/sub');
  });

  it('cierra la sesion al JavaScript con httpOnly', () => {
    // Este es el estado al que se migro: la cookie de sesion no aparece en
    // `document.cookie` y ningun XSS puede leerla. Si alguien reintroduce un
    // flujo que autentica desde el cliente, este test sigue en verde pero el de
    // "supabaseClient sin uso" mas abajo lo hace fallar.
    expect(hardenSessionCookieOptions({}).httpOnly).toBe(true);
  });

  it('aplica httpOnly tambien al borrar la cookie', () => {
    // La eliminacion se endurece con maxAge: 0, pero sin httpOnly el navegador
    // podria escribir una replacement con el mismo nombre sin esa proteccion.
    expect(hardenSessionCookieOptions({ maxAge: 0 }).httpOnly).toBe(true);
  });

  it('es idempotente: endurecer dos veces no cambia el resultado', () => {
    const once = hardenSessionCookieOptions({ sameSite: 'lax', path: '/' });
    expect(hardenSessionCookieOptions(once)).toEqual(once);
  });
});

describe('supabaseClient (browser) sin uso', () => {
  it('ningun modulo de la app lo importa: sin cliente browser no hay quien lea la cookie', async () => {
    // Si alguien reintroduce `supabase.auth.*` en el navegador, esta asercion
    // falla, que es justamente la señal de que la sesion volvería a estar
    // expuesta al JS cuando se active `httpOnly`.
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join, relative } = await import('node:path');

    const root = join(process.cwd(), 'src');
    const offenders: string[] = [];

    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry)) continue;
        if (/\.test\.(ts|tsx)$/.test(entry)) continue;
        // Las rutas de API y el proxy corren en Node: el cliente SSR es correcto
        // ahi. Lo que no puede aparecer es un import del cliente de navegador.
        if (full.includes(`${join('app', 'api')}`) || full.endsWith(join('proxy.ts'))) continue;
        if (full.endsWith(join('lib', 'supabaseClient.ts'))) continue;

        const source = readFileSync(full, 'utf8');
        if (/from\s+['"][^'"]*supabaseClient['"]/.test(source)) {
          offenders.push(relative(process.cwd(), full));
        }
      }
    };

    walk(root);
    expect(offenders).toEqual([]);
  });
});
