import { describe, expect, it } from 'vitest';
import robots from './robots';

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
    expect(disallow).toContain('/api/');
    expect(disallow).toContain('/dashboard/');
    expect(disallow).toContain('/reset-password');
  });

  it('declara el sitemap', () => {
    expect(result.sitemap).toMatch(/\/sitemap\.xml$/);
  });
});
