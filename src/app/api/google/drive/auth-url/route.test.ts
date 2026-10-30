import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAuth } from '@/lib/api-auth';
import { GET } from './route';

const mockAuth = { tenantId: 'tenant-1', userId: 'user-1', allTenants: false, tenantIds: ['tenant-1'] };

vi.mock('@/lib/api-auth', () => ({ getAuth: vi.fn(async () => mockAuth) }));
vi.mock('@/lib/security/redirects', () => ({
  getAppOrigin: vi.fn(() => 'https://app.vynko.test'),
}));

function makeRequest(origin?: string): Request {
  const suffix = origin ? `?origin=${encodeURIComponent(origin)}` : '';
  return new Request(`http://localhost/api/google/drive/auth-url${suffix}`);
}

describe('/api/google/drive/auth-url', () => {
  beforeEach(() => {
    vi.mocked(getAuth).mockResolvedValue(mockAuth);
    vi.stubEnv('GOOGLE_CLIENT_ID', 'client-id');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'client-secret');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('devuelve 401 sin autenticación', async () => {
    vi.mocked(getAuth).mockResolvedValueOnce(null);
    const res = await GET(makeRequest('/products'));
    expect(res.status).toBe(401);
  });

  it('obliga a elegir cuenta de Google y pide refresh token', async () => {
    const res = await GET(makeRequest('/products'));
    expect(res.status).toBe(200);

    const { url } = (await res.json()) as { url: string };
    const params = new URL(url).searchParams;

    // Sin `select_account` Google reusa la sesión abierta y el Drive queda
    // atado a una cuenta distinta de la que el usuario está mirando.
    expect(params.get('prompt')).toBe('select_account consent');
    expect(params.get('access_type')).toBe('offline');
    expect(params.get('scope')).toBe('https://www.googleapis.com/auth/drive.file');
    expect(params.get('redirect_uri')).toBe('https://app.vynko.test/auth/google-drive/callback');
    expect(params.get('state')).toBeTruthy();

    expect(res.headers.get('set-cookie')).toContain('gdrive_oauth_state');
  });

  it('descarta orígenes externos al armar el state', async () => {
    const res = await GET(makeRequest('https://evil.example/phishing'));
    const cookie = res.headers.get('set-cookie') ?? '';
    const decoded = decodeURIComponent(cookie);

    expect(decoded).toContain('"origin":"/products"');
    expect(decoded).not.toContain('evil.example');
  });
});
