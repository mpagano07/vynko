import { describe, expect, it } from 'vitest';
import { getPathMatch } from 'next/dist/shared/lib/router/utils/path-match';
import { config } from '@/proxy';

/**
 * El matcher del Proxy se compila con el mismo path-to-regexp que usa Next en
 * runtime, asi que este test reproduce exactamente lo que decide Next si el
 * Proxy se ejecuta o no para una URL.
 *
 * Existia un bug de escapado (`\.' en vez de `\\.`) que hacia que el lookahead
 * `.*\..*` se compilara como `.*..*`, que matchea cualquier string no vacio. El
 * Proxy terminaba ejecutandose solo en `/`, y con el los gates de auth,
 * onboarding y suscripcion no se ejecutaban en ningun build de produccion.
 * Este test falla si eso vuelve a pasar.
 */
const matchers = config.matcher.map((m) => getPathMatch(m));

const matches = (pathname: string) => matchers.some((m) => Boolean(m(pathname)));

describe('proxy matcher', () => {
  it('cubre las paginas de la app, para que corran los gates de auth', () => {
    const pages = [
      '/',
      '/login',
      '/dashboard',
      '/products',
      '/customers',
      '/settings',
      '/billing',
      '/onboarding',
      '/auth/callback',
      '/privacidad',
      '/terminos',
      '/codigos',
      '/documentos',
      '/sales/cash-register',
    ];
    for (const page of pages) {
      expect(matches(page), `el proxy deberia correr en ${page}`).toBe(true);
    }
  });

  it('excluye assets y rutas tecnicas para no bloquear la carga', () => {
    const excluded = [
      '/_next/static/chunks/main.js',
      '/_next/image',
      '/api/products',
      '/api/auth/login',
      '/theme-init.js',
      '/favicon.ico',
      '/robots.txt',
      '/sitemap.xml',
      '/icon.png',
    ];
    for (const path of excluded) {
      expect(matches(path), `el proxy no deberia correr en ${path}`).toBe(false);
    }
  });

  it('el filtro de archivos con punto usa un punto escapado de verdad', () => {
    // Si el punto no estuviera escapado, `.*..*` matchearia cualquier ruta con
    // al menos un caracter y el lookahead excluiria todas las paginas.
    const source = String(config.matcher[0]);
    expect(source).toContain('.*\\..*');
    expect(source).not.toContain('.*\\..*'.replace('\\', ''));
  });
});
