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
});
