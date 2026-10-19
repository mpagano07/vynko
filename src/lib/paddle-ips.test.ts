import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// El módulo cachea la lista en memoria: cada test reimporta una instancia limpia.
async function loadPaddleIps() {
  vi.resetModules();
  return import('./paddle-ips');
}

const OK_BODY = {
  data: {
    ipv4_cidrs: ['34.120.6.67/32', '34.117.59.81/32', '35.190.30.0/24'],
  },
};

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

describe('paddle-ips (allowlist de IPs de Paddle)', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('marca como ok una IP exacta de la lista (/32)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(OK_BODY));
    const { checkPaddleSourceIp } = await loadPaddleIps();

    await expect(checkPaddleSourceIp('34.120.6.67')).resolves.toBe('ok');
  });

  it('marca como ok una IP dentro de un rango /24', async () => {
    fetchMock.mockResolvedValue(jsonResponse(OK_BODY));
    const { checkPaddleSourceIp } = await loadPaddleIps();

    await expect(checkPaddleSourceIp('35.190.30.200')).resolves.toBe('ok');
    // Fuera de la máscara del /24.
    await expect(checkPaddleSourceIp('35.190.31.1')).resolves.toBe('blocked');
  });

  it('rechaza una IP ajena con la lista disponible', async () => {
    fetchMock.mockResolvedValue(jsonResponse(OK_BODY));
    const { checkPaddleSourceIp } = await loadPaddleIps();

    await expect(checkPaddleSourceIp('203.0.113.10')).resolves.toBe('blocked');
  });

  it('normaliza IPv4-mapped IPv6 (::ffff:1.2.3.4)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(OK_BODY));
    const { checkPaddleSourceIp } = await loadPaddleIps();

    await expect(checkPaddleSourceIp('::ffff:34.120.6.67')).resolves.toBe('ok');
  });

  it('fail-closed: si el endpoint falla devuelve list-unavailable (nunca ok)', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    const { checkPaddleSourceIp } = await loadPaddleIps();

    await expect(checkPaddleSourceIp('34.120.6.67')).resolves.toBe('list-unavailable');
  });

  it('fail-closed: HTTP != 200 o payload sin ipv4_cidrs → list-unavailable', async () => {
    const { checkPaddleSourceIp } = await loadPaddleIps();

    fetchMock.mockResolvedValue(jsonResponse({}, false, 500));
    await expect(checkPaddleSourceIp('34.120.6.67')).resolves.toBe('list-unavailable');

    fetchMock.mockResolvedValue(jsonResponse({ data: {} }));
    await expect(checkPaddleSourceIp('34.120.6.67')).resolves.toBe('list-unavailable');
  });

  it('sin IP de origen → blocked', async () => {
    fetchMock.mockResolvedValue(jsonResponse(OK_BODY));
    const { checkPaddleSourceIp } = await loadPaddleIps();

    await expect(checkPaddleSourceIp('')).resolves.toBe('blocked');
  });

  it('cachea la lista: varias verificaciones hacen UN solo fetch', async () => {
    fetchMock.mockResolvedValue(jsonResponse(OK_BODY));
    const { checkPaddleSourceIp } = await loadPaddleIps();

    await checkPaddleSourceIp('34.120.6.67');
    await checkPaddleSourceIp('203.0.113.10');
    await checkPaddleSourceIp('35.190.30.1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.paddle.com/ips');
  });

  it('el CIDR viene de la respuesta y no está hardcodeado', async () => {
    // Lista que NO contiene los rangos del otro test.
    fetchMock.mockResolvedValue(
      jsonResponse({ data: { ipv4_cidrs: ['198.51.100.7/32'] } })
    );
    const { checkPaddleSourceIp } = await loadPaddleIps();

    await expect(checkPaddleSourceIp('198.51.100.7')).resolves.toBe('ok');
    await expect(checkPaddleSourceIp('34.120.6.67')).resolves.toBe('blocked');
  });
});
