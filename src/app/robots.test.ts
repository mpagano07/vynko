import { describe, expect, it } from 'vitest';
import robots from './robots';
import sitemap from './sitemap';
import { PRIVATE_ROUTE_PREFIXES } from '@/lib/marketing/public-routes';
import { SITE_URL } from '@/lib/site-url';

/**
 * El rastreo de ChatGPT depende de que `OAI-SearchBot` tenga un bloque
 * explicito con `Allow: /`. El bloque comodin tambien lo permitiria, pero un
 * agente puede quedar afuera si alguna regla lo nombra con un `Disallow`; este
 * test congela la intencion para que un refactor no la borre sin querer.
 */
describe('robots', () => {
  const result = robots();
  const rules = Array.isArray(result.rules) ? result.rules : [result.rules];

  const userAgentsOf = (rule: (typeof rules)[number]) =>
    Array.isArray(rule.userAgent) ? rule.userAgent : [rule.userAgent];

  const disallowOf = (rule: (typeof rules)[number]) =>
    Array.isArray(rule.disallow) ? rule.disallow : rule.disallow ? [rule.disallow] : [];

  it('permite explicitamente el rastreo de OAI-SearchBot', () => {
    const rule = rules.find((r) => userAgentsOf(r).includes('OAI-SearchBot'));

    expect(rule, 'deberia existir un bloque para OAI-SearchBot').toBeDefined();
    expect(rule?.allow).toBe('/');
    expect(disallowOf(rule!)).not.toContain('/');
  });

  it('conserva las rutas privadas fuera del indice para el comodin', () => {
    const wildcard = rules.find((r) => userAgentsOf(r).includes('*'));
    const disallow = disallowOf(wildcard!);

    expect(wildcard).toBeDefined();
    expect(disallow).toContain('/api');
    expect(disallow).toContain('/dashboard');
  });

  it('usa los mismos Disallow para todos los agentes', () => {
    const oai = rules.find((r) => userAgentsOf(r).includes('OAI-SearchBot'));
    const wildcard = rules.find((r) => userAgentsOf(r).includes('*'));

    expect(disallowOf(oai!)).toEqual(disallowOf(wildcard!));
    expect(disallowOf(wildcard!)).toEqual([...PRIVATE_ROUTE_PREFIXES]);
  });

  it('bloquea las rutas privadas SIN barra final', () => {
    // `Disallow: /dashboard/` NO bloquea `https://site/dashboard`: en robots.txt
    // el prefijo con barra solo matchea las subrutas. Con el prefijo plano se
    // bloquean las dos formas.
    const wildcard = rules.find((r) => userAgentsOf(r).includes('*'));
    const disallow = disallowOf(wildcard!);

    expect(disallow.length).toBeGreaterThan(0);
    for (const prefix of disallow) {
      expect(prefix.endsWith('/'), `no deberia terminar en "/": ${prefix}`).toBe(false);
    }
  });

  it('NO bloquea las rutas publicas que se sirven con noindex', () => {
    // Si Google no puede rastrear la URL, tampoco puede leer el `noindex` que
    // la saca del indice. Estas se rastrean y se marcan en el layout raiz.
    const wildcard = rules.find((r) => userAgentsOf(r).includes('*'));
    const disallow = disallowOf(wildcard!);

    expect(disallow).not.toContain('/login');
    expect(disallow).not.toContain('/auth');
    expect(disallow).not.toContain('/accept-invite');
    expect(disallow).not.toContain('/no-access');
  });

  it('declara el sitemap', () => {
    expect(result.sitemap).toMatch(/\/sitemap\.xml$/);
  });

  it('NO bloquea ninguna URL que este en el sitemap', () => {
    // Si robots.txt bloquea una URL publicada en el sitemap, Google la
    // descubre pero no la puede rastrear: nunca lee su contenido ni su
    // `noindex`. Es la contradiccion clasica entre los dos archivos.
    const wildcard = rules.find((r) => userAgentsOf(r).includes('*'));
    const disallow = disallowOf(wildcard!);

    for (const entry of sitemap()) {
      const path = entry.url === SITE_URL ? '/' : entry.url.slice(SITE_URL.length);
      for (const prefix of disallow) {
        const blocked = path === prefix || path.startsWith(prefix + '/');
        expect(blocked, `${path} esta en el sitemap pero robots.txt la bloquea`).toBe(false);
      }
    }
  });
});
