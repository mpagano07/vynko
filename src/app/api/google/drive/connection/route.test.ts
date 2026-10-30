import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAuth } from '@/lib/api-auth';
import { getGoogleDriveAccessToken, revokeGoogleDriveConnection } from '@/lib/google/token-store';
import { getDriveAccount } from '@/lib/google/drive';
import { DELETE, GET } from './route';

const mockAuth = { tenantId: 'tenant-1', userId: 'user-1', allTenants: false, tenantIds: ['tenant-1'] };

vi.mock('@/lib/api-auth', () => ({ getAuth: vi.fn(async () => mockAuth) }));
vi.mock('@/lib/google/token-store', () => ({
  getGoogleDriveAccessToken: vi.fn(async () => ({ accessToken: 'token', expiresAt: Date.now() + 3600_000 })),
  revokeGoogleDriveConnection: vi.fn(async () => undefined),
}));
vi.mock('@/lib/google/drive', () => ({
  getDriveAccount: vi.fn(async () => ({ emailAddress: 'duena@example.com', displayName: 'Dueña' })),
}));

function makeRequest(method: 'GET' | 'DELETE'): Request {
  return new Request('http://localhost/api/google/drive/connection', { method });
}

describe('/api/google/drive/connection', () => {
  beforeEach(() => {
    vi.mocked(getAuth).mockResolvedValue(mockAuth);
    vi.mocked(getGoogleDriveAccessToken).mockResolvedValue({
      accessToken: 'token',
      expiresAt: Date.now() + 3600_000,
    });
    vi.mocked(getDriveAccount).mockResolvedValue({
      emailAddress: 'duena@example.com',
      displayName: 'Dueña',
    });
    vi.mocked(revokeGoogleDriveConnection).mockResolvedValue(undefined);
  });

  it('devuelve 401 sin autenticación', async () => {
    vi.mocked(getAuth).mockResolvedValueOnce(null);
    const res = await GET(makeRequest('GET'));
    expect(res.status).toBe(401);
  });

  it('informa la cuenta vinculada cuando hay conexión', async () => {
    const res = await GET(makeRequest('GET'));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      connected: true,
      email: 'duena@example.com',
    });
    expect(getDriveAccount).toHaveBeenCalledWith('token');
  });

  it('informa desconectado si no hay token', async () => {
    vi.mocked(getGoogleDriveAccessToken).mockResolvedValueOnce(null);
    const res = await GET(makeRequest('GET'));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ connected: false, email: null });
    expect(getDriveAccount).not.toHaveBeenCalled();
  });

  it('sigue conectado si Google no devuelve la cuenta', async () => {
    vi.mocked(getDriveAccount).mockResolvedValueOnce(null);
    const res = await GET(makeRequest('GET'));
    await expect(res.json()).resolves.toEqual({ connected: true, email: null });
  });

  it('revoca la conexión del usuario autenticado', async () => {
    const res = await DELETE(makeRequest('DELETE'));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(revokeGoogleDriveConnection).toHaveBeenCalledWith('user-1');
  });

  it('responde 502 si Google no permite revocar', async () => {
    vi.mocked(revokeGoogleDriveConnection).mockRejectedValueOnce(new Error('network'));
    const res = await DELETE(makeRequest('DELETE'));
    expect(res.status).toBe(502);
  });
});
