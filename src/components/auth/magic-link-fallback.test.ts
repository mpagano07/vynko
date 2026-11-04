import { describe, expect, it } from 'vitest';
import { magicRedirectTarget } from '@/components/auth/magic-link-fallback';

const sessionHash =
  '#access_token=access-1&refresh_token=refresh-1&expires_at=1&type=invite';

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
