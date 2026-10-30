import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDriveAccount, uploadToDrive } from './drive';

const fetchMock = vi.fn();

function bodyToText(body: unknown): string {
  expect(body).toBeInstanceOf(Uint8Array);
  return new TextDecoder().decode(body as Uint8Array);
}

describe('uploadToDrive', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('manda multipart/related con metadata y archivo en la raíz de Mi unidad', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'file-1',
          name: 'productos.xls',
          webViewLink: 'https://drive.google.com/file/d/file-1/view',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const result = await uploadToDrive({
      accessToken: 'token',
      name: 'productos.xls',
      mimeType: 'application/vnd.ms-excel',
      blob: new Blob(['contenido-planilla'], { type: 'application/vnd.ms-excel' }),
    });

    expect(result).toEqual({
      id: 'file-1',
      name: 'productos.xls',
      webViewLink: 'https://drive.google.com/file/d/file-1/view',
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('uploadType=multipart');
    expect(url).toContain('fields=id,name,webViewLink,parents');

    const contentType = (init.headers as Record<string, string>)['Content-Type'];
    // Google sólo acepta multipart/related en este endpoint; FormData manda
    // multipart/form-data y el metadata se pierde.
    expect(contentType).toMatch(/^multipart\/related; boundary="vynko_/);

    const raw = bodyToText(init.body);
    expect(raw).toContain(JSON.stringify({
      name: 'productos.xls',
      mimeType: 'application/vnd.ms-excel',
      parents: ['root'],
    }));
    expect(raw).toContain('Content-Type: application/vnd.ms-excel');
    expect(raw).toContain('contenido-planilla');
    expect(raw.trimEnd().endsWith('--')).toBe(true);
  });

  it('normaliza el mimeType con parámetros (CSV)', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: 'file-2' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const result = await uploadToDrive({
      accessToken: 'token',
      name: 'productos.csv',
      mimeType: 'text/csv;charset=utf-8',
      blob: new Blob(['a,b'], { type: 'text/csv;charset=utf-8' }),
    });

    // Sin `name` en la respuesta, se conserva el nombre pedido.
    expect(result.name).toBe('productos.csv');

    const raw = bodyToText((fetchMock.mock.calls[0][1] as RequestInit).body);
    expect(raw).toContain('"mimeType":"text/csv"');
    expect(raw).not.toContain('charset=utf-8');
  });

  it('propaga el error de Google', async () => {
    fetchMock.mockResolvedValue(new Response('invalid request', { status: 400 }));

    await expect(
      uploadToDrive({
        accessToken: 'token',
        name: 'productos.xls',
        mimeType: 'application/vnd.ms-excel',
        blob: new Blob(['x']),
      })
    ).rejects.toThrow(/No se pudo guardar en Google Drive/);
  });
});

describe('getDriveAccount', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('devuelve la cuenta vinculada al token', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ user: { emailAddress: 'duena@example.com', displayName: 'Dueña' } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    await expect(getDriveAccount('token')).resolves.toEqual({
      emailAddress: 'duena@example.com',
      displayName: 'Dueña',
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/drive/v3/about');
    expect(init.headers).toEqual({ Authorization: 'Bearer token' });
  });

  it('devuelve null si Google no responde', async () => {
    fetchMock.mockResolvedValue(new Response('forbidden', { status: 403 }));
    await expect(getDriveAccount('token')).resolves.toBeNull();
  });
});
