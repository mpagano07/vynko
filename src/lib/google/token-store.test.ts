import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseMock } from '@/test/supabase-mock';
import { revokeGoogleDriveConnection } from './token-store';

const fetchMock = vi.fn();

vi.mock('@/lib/supabaseAdmin', () => ({ supabaseAdmin: supabaseMock }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('./token-crypto', () => ({
  decryptGoogleToken: vi.fn(() => 'refresh-token'),
  encryptGoogleToken: vi.fn(() => ({ encrypted: 'enc', iv: 'iv', tag: 'tag' })),
}));

const storedRow = {
  refresh_token_encrypted: 'enc',
  refresh_token_iv: 'iv',
  refresh_token_tag: 'tag',
  scope: 'https://www.googleapis.com/auth/drive.file',
};

function deleteWasCalled(): boolean {
  return supabaseMock.__calls.some(
    (call) =>
      call.table === 'google_drive_tokens' &&
      call.method === 'delete' &&
      supabaseMock.__calls.some(
        (candidate) =>
          candidate.table === 'google_drive_tokens' &&
          candidate.method === 'eq' &&
          candidate.args[0] === 'user_id' &&
          candidate.args[1] === 'user-1'
      )
  );
}

describe('revokeGoogleDriveConnection', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('revoca en Google y borra el token local', async () => {
    vi.stubGlobal('fetch', fetchMock);
    supabaseMock.__queue('google_drive_tokens', { data: storedRow, error: null });
    supabaseMock.__queue('google_drive_tokens', { data: null, error: null });
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

    await revokeGoogleDriveConnection('user-1');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://oauth2.googleapis.com/revoke',
      expect.objectContaining({ method: 'POST' })
    );
    const body = fetchMock.mock.calls[0][1].body as URLSearchParams;
    expect(body.get('token')).toBe('refresh-token');
    expect(deleteWasCalled()).toBe(true);
  });

  it('también limpia la fila si Google responde invalid_token', async () => {
    vi.stubGlobal('fetch', fetchMock);
    supabaseMock.__queue('google_drive_tokens', { data: storedRow, error: null });
    supabaseMock.__queue('google_drive_tokens', { data: null, error: null });
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'invalid_token' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await revokeGoogleDriveConnection('user-1');

    expect(deleteWasCalled()).toBe(true);
  });

  it('no borra la fila si falla la red', async () => {
    vi.stubGlobal('fetch', fetchMock);
    supabaseMock.__queue('google_drive_tokens', { data: storedRow, error: null });
    fetchMock.mockRejectedValue(new Error('network'));

    await expect(revokeGoogleDriveConnection('user-1')).rejects.toThrow(
      'No se pudo revocar el acceso a Google Drive'
    );

    expect(deleteWasCalled()).toBe(false);
  });
});
