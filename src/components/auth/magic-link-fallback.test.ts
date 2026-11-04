import { describe, expect, it } from 'vitest';
import { magicRedirectTarget } from '@/components/auth/magic-link-fallback';
import { buildMagicLinkRescueScript } from '@/components/auth/magic-link-rescue';

const sessionHash =
  '#access_token=access-1&refresh_token=refresh-1&expires_at=1&type=invite';

/**
 * Ejecuta el script inline contra una `window` mínima. El script corre en el
 * `<head>`, antes de hidratar, así que no puede depender de React.
 */
function runRescue(pathname: string, hash: string): string[] {
  const replaced: string[] = [];
  const fakeWindow = {
    location: {
      pathname,
      hash,
      replace: (url: string) => replaced.push(url),
    },
  };

  new Function('window', buildMagicLinkRescueScript())(fakeWindow);

  return replaced;
}

describe('magicRedirectTarget', () => {
  it('deriva los magic links de invitación a /auth/magic conservando el fragmento', () => {
    expect(magicRedirectTarget(sessionHash)).toBe(`/auth/magic${sessionHash}`);
    expect(
      magicRedirectTarget('#access_token=a&refresh_token=r&type=magiclink')
    ).toBe('/auth/magic#access_token=a&refresh_token=r&type=magiclink');
  });

  it('no toca hashes ajenos a una sesión', () => {
    expect(magicRedirectTarget('')).toBeNull();
    expect(magicRedirectTarget('#seccion=precios')).toBeNull();
    expect(magicRedirectTarget('#access_token=a&refresh_token=r&type=recovery')).toBeNull();
    expect(magicRedirectTarget('#access_token=a&type=invite')).toBeNull();
  });

  it('no redirige con errores de link vencido (no hay tokens)', () => {
    expect(magicRedirectTarget('#error=access_denied&error_code=otp_expired')).toBeNull();
  });
});

describe('buildMagicLinkRescueScript', () => {
  it('rescata el fragmento de invitación desde la home', () => {
    expect(runRescue('/', sessionHash)).toEqual([`/auth/magic${sessionHash}`]);
  });

  it('rescata también si el link cayó en otra ruta pública', () => {
    expect(runRescue('/login', sessionHash)).toEqual([`/auth/magic${sessionHash}`]);
  });

  it('no se re-ejecuta en /auth/magic (no hay loop)', () => {
    expect(runRescue('/auth/magic', sessionHash)).toEqual([]);
  });

  it('ignora hashes sin sesión de invitación', () => {
    expect(runRescue('/', '')).toEqual([]);
    expect(runRescue('/', '#seccion=precios')).toEqual([]);
    expect(runRescue('/', '#access_token=a&refresh_token=r&type=recovery')).toEqual([]);
    expect(runRescue('/', '#access_token=a&type=invite')).toEqual([]);
  });

  it('no rompe con un hash malformado', () => {
    expect(() => runRescue('/', '#%%%')).not.toThrow();
  });
});
