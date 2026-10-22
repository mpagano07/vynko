import { describe, expect, it } from 'vitest';
import { resolveSiteUrl } from './site-url';

describe('resolveSiteUrl', () => {
  it('prefiere NEXT_PUBLIC_SITE_URL', () => {
    expect(
      resolveSiteUrl({
        NEXT_PUBLIC_SITE_URL: 'https://app.vynko.com',
        NEXT_PUBLIC_APP_URL: 'https://otro.vynko.com',
      })
    ).toBe('https://app.vynko.com');
  });

  it('usa NEXT_PUBLIC_APP_URL como alias historico', () => {
    expect(resolveSiteUrl({ NEXT_PUBLIC_APP_URL: 'https://app.vynko.com' })).toBe('https://app.vynko.com');
  });

  it('cae al dominio de produccion si no hay ninguna', () => {
    expect(resolveSiteUrl({})).toBe('https://vynko.dev');
  });

  it('normaliza la barra final', () => {
    expect(resolveSiteUrl({ NEXT_PUBLIC_SITE_URL: 'https://app.vynko.com/' })).toBe('https://app.vynko.com');
    expect(resolveSiteUrl({ NEXT_PUBLIC_SITE_URL: 'https://app.vynko.com///' })).toBe('https://app.vynko.com');
  });

  it('ignora espacios alrededor', () => {
    expect(resolveSiteUrl({ NEXT_PUBLIC_SITE_URL: '  https://app.vynko.com  ' })).toBe('https://app.vynko.com');
  });

  it('ignora una variable definida pero vacia', () => {
    // `.env.example` trae la variable vacia. `??` no salta los strings vacios:
    // sin este filtro `resolveSiteUrl` devolvia `''` y `new URL('')` reventaba
    // en el `metadataBase` del layout raiz, rompiendo el build.
    expect(resolveSiteUrl({ NEXT_PUBLIC_SITE_URL: '' })).toBe('https://vynko.dev');
    expect(resolveSiteUrl({ NEXT_PUBLIC_SITE_URL: '   ' })).toBe('https://vynko.dev');
    expect(resolveSiteUrl({ NEXT_PUBLIC_APP_URL: '' })).toBe('https://vynko.dev');
  });

  it('ignora los hosts de preview de Vercel', () => {
    // Un `*.vercel.app` no es nunca el dominio canonico: es un deploy de
    // pruebas, que ademas Vercel marca con `noindex`.
    expect(resolveSiteUrl({ NEXT_PUBLIC_SITE_URL: 'https://vynko-abc123.vercel.app' })).toBe('https://vynko.dev');
    expect(resolveSiteUrl({ NEXT_PUBLIC_APP_URL: 'https://vynko-abc123.vercel.app' })).toBe('https://vynko.dev');
  });

  it('respeta el host local: en desarrollo el canonical es el entorno local', () => {
    expect(resolveSiteUrl({ NEXT_PUBLIC_SITE_URL: 'http://localhost:3000' })).toBe('http://localhost:3000');
  });

  it('ignora una URL invalida y cae al dominio de produccion', () => {
    expect(resolveSiteUrl({ NEXT_PUBLIC_SITE_URL: 'no-es-una-url' })).toBe('https://vynko.dev');
  });

  it('la URL resuelta siempre se puede pasar a new URL()', () => {
    // Esta es la garantia que necesita `metadataBase: new URL(SITE_URL)`.
    for (const env of [
      {},
      { NEXT_PUBLIC_SITE_URL: '' },
      { NEXT_PUBLIC_SITE_URL: '   ' },
      { NEXT_PUBLIC_SITE_URL: 'no-es-una-url' },
      { NEXT_PUBLIC_APP_URL: 'https://vynko-abc.vercel.app' },
      { NEXT_PUBLIC_SITE_URL: 'http://localhost:3000' },
    ]) {
      expect(() => new URL(resolveSiteUrl(env))).not.toThrow();
    }
  });
});
