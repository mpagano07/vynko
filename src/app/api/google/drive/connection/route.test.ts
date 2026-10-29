import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAuth } from '@/lib/api-auth';
import { isGoogleDriveConnected, revokeGoogleDriveConnection } from '@/lib/google/token-store';
import { DELETE, GET } from './route';

const mockAuth = { tenantId: 'tenant-1', userId: 'user-1', allTenants: false, tenantIds: ['tenant-1'] };

vi.mock('@/lib/api-auth', () => ({ getAuth: vi.fn(async () => mockAuth) }));
vi.mock('@/lib/google/token-store', () => ({
  isGoogleDriveConnected: vi.fn(async () => true),
  revokeGoogleDriveConnection: vi.fn(async () => undefined),
}));

function makeRequest(method: 'GET' | 'DELETE'): Request {
  return new Request('http://localhost/api/google/drive/connection', { method });
}

describe('/api/google/drive/connection', () => {
  beforeEach(() => {
    vi.mocked(getAuth).mockResolvedValue(mockAuth);
    vi.mocked(isGoogleDriveConnected).mockResolvedValue(true);
    vi.mocked(revokeGoogleDriveConnection).mockResolvedValue(undefined);
  });

  it('devuelve 401 sin autenticación', async () => {
    vi.mocked(getAuth).mockResolvedValueOnce(null);
    const res = await GET(makeRequest('GET'));
    expect(res.status).toBe(401);
  });

  it('informa el estado de la conexión', async () => {
    vi.mocked(isGoogleDriveConnected).mockResolvedValueOnce(false);
    const res = await GET(makeRequest('GET'));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ connected: false });
    expect(isGoogleDriveConnected).toHaveBeenCalledWith('user-1');
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
