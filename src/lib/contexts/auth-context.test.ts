import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearSupabaseAuthCookies, isSupabaseAuthKey } from './auth-context';

const AUTH_COOKIE = 'sb-abcdefghijklmnop-auth-token';

function clearBrowserState() {
  for (const part of document.cookie.split(';')) {
    const name = part.split('=')[0]?.trim();
    if (name) document.cookie = `${name}=; path=/; max-age=0`;
  }
  window.localStorage.clear();
}

beforeEach(clearBrowserState);
afterEach(clearBrowserState);

describe('isSupabaseAuthKey', () => {
  it('reconoce el cookie real de @supabase/ssr y sus chunks', () => {
    expect(isSupabaseAuthKey(AUTH_COOKIE)).toBe(true);
    expect(isSupabaseAuthKey(`${AUTH_COOKIE}.0`)).toBe(true);
    expect(isSupabaseAuthKey(`${AUTH_COOKIE}.1`)).toBe(true);
  });

  it('sigue aceptando el nombre heredado', () => {
    expect(isSupabaseAuthKey('supabase.auth.token')).toBe(true);
    expect(isSupabaseAuthKey('supabase.auth.token.0')).toBe(true);
  });

  it('no confunde cookies de la app con la de sesion', () => {
    expect(isSupabaseAuthKey('vynko_active_tenant_id')).toBe(false);
    expect(isSupabaseAuthKey('vynko_last_activity')).toBe(false);
    expect(isSupabaseAuthKey('sb-otra-cosa')).toBe(false);
  });
});

describe('clearSupabaseAuthCookies', () => {
  // Regresion: antes solo miraba `supabase.auth.token`, nombre que @supabase/ssr
  // no usa. Como nunca encontraba la cookie real, quedaba sin borrar.
  it('borra los chunks reales, no solo el nombre heredado', () => {
    document.cookie = `${AUTH_COOKIE}.0=uno; path=/`;
    document.cookie = `${AUTH_COOKIE}.1=dos; path=/`;
    document.cookie = 'vynko_remember=%7B%7D; path=/';

    clearSupabaseAuthCookies();

    // Los chunks de sesion desaparecieron...
    expect(document.cookie).not.toContain(AUTH_COOKIE);
    // ...y las cookies que no son de sesion se respetan.
    expect(document.cookie).toContain('vynko_remember');
  });

  it('no toca cookies ajenas a la sesion', () => {
    document.cookie = 'vynko_active_tenant_id=t1; path=/';

    clearSupabaseAuthCookies();

    expect(document.cookie).toContain('vynko_active_tenant_id=t1');
  });
});
