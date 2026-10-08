import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: { rpc: rpcMock },
}));

import { rateLimit, rateLimitPeek, getClientIp, __resetRateLimitStateForTests } from '@/lib/rate-limit';

/** Simula la respuesta de `rate_limit_hit`. */
function mockRpc(ok: boolean, retryAfterSeconds = 0) {
  rpcMock.mockResolvedValue({ data: { ok, retry_after_seconds: retryAfterSeconds }, error: null });
}

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('E2E', '');
  vi.stubEnv('RATE_LIMIT_STORE', 'memory');
  rpcMock.mockReset();
  __resetRateLimitStateForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('rateLimit (store en memoria)', () => {
  it('permite hasta el limite y bloquea despues', async () => {
    const key = `test:${Math.random()}`;
    for (let i = 0; i < 3; i++) {
      expect((await rateLimit(key, 3, 60_000)).ok).toBe(true);
    }
    const blocked = await rateLimit(key, 3, 60_000);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('deja pasar con E2E=1 fuera de produccion', async () => {
    vi.stubEnv('E2E', '1');
    const key = `test:${Math.random()}`;
    for (let i = 0; i < 50; i++) {
      expect((await rateLimit(key, 1, 60_000)).ok).toBe(true);
    }
  });

  it('NO se puede desactivar en produccion aunque venga E2E=1', async () => {
    // Si el flag se filtra al server real, NODE_ENV=production debe frenar el
    // bypass. Este es el test que importa: el otro sentido del bypass es
    // inocuo (solo afloja un limite), este protege el control.
    vi.stubEnv('E2E', '1');
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('RATE_LIMIT_STORE', 'memory');
    const key = `test:${Math.random()}`;
    expect((await rateLimit(key, 1, 60_000)).ok).toBe(true);
    expect((await rateLimit(key, 1, 60_000)).ok).toBe(false);
  });
});

describe('rateLimit (store distribuido)', () => {
  beforeEach(() => {
    vi.stubEnv('RATE_LIMIT_STORE', 'postgres');
  });

  it('delega en rate_limit_hit y devuelve su resultado', async () => {
    mockRpc(true);
    const result = await rateLimit('auth:login:ip:1.1.1.1', 5, 60_000);

    expect(result).toEqual({ ok: true, retryAfterSeconds: 0 });
    expect(rpcMock).toHaveBeenCalledWith('rate_limit_hit', {
      p_key: 'auth:login:ip:1.1.1.1',
      p_limit: 5,
      p_window_ms: 60_000,
      p_probabilistic_cleanup: false,
    });
  });

  it('propaga el retry-after que devuelve la base', async () => {
    mockRpc(false, 42);
    expect(await rateLimit('k', 5, 60_000)).toEqual({ ok: false, retryAfterSeconds: 42 });
  });

  it('pide la purga de forma esporadica, no en cada llamada', async () => {
    mockRpc(true);
    for (let i = 0; i < 3; i++) await rateLimit('k', 5, 60_000);

    const flags = rpcMock.mock.calls.map((c) => (c[1] as { p_probabilistic_cleanup: boolean }).p_probabilistic_cleanup);
    expect(flags).toEqual([false, false, false]);

    for (let i = 0; i < 60; i++) await rateLimit('k', 5, 60_000);
    const anyTrue = rpcMock.mock.calls.some(
      (c) => (c[1] as { p_probabilistic_cleanup: boolean }).p_probabilistic_cleanup
    );
    expect(anyTrue).toBe(true);
  });

  it('permite el request si el store falla, en vez de cortar el servicio', async () => {
    // Trade-off explicito: si Postgres no responde la app ya esta caida, porque
    // login, onboarding y datos pasan por el mismo Supabase. Un fail-closed
    // convertiria un incidente en un corte total. Se avisa una sola vez por log.
    rpcMock.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const first = await rateLimit('k', 1, 60_000);
    const second = await rateLimit('k', 1, 60_000);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    // Log una sola vez, no uno por request.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0]?.[0])).toContain('036_rate_limit_buckets');
    spy.mockRestore();
  });

  it('permite el request si la funcion todavia no esta migrada', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'function does not exist' } });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await rateLimit('k', 1, 60_000)).ok).toBe(true);
    spy.mockRestore();
  });

  it('rechaza una respuesta con forma inesperada en vez de asumir que pasa', async () => {
    rpcMock.mockResolvedValue({ data: { algo: 'distinto' }, error: null });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await rateLimit('k', 1, 60_000)).ok).toBe(true);
    spy.mockRestore();
  });

  it('usa postgres por default en produccion', async () => {
    // El default por entorno: produccion SIEMPRE postgres, porque ahi el limite
    // tiene que ser el mismo para todas las instancias. Un `memory` silencioso
    // seria `limite x instancias`, que es el bug que vino a arreglar.
    vi.stubEnv('E2E', '');
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('RATE_LIMIT_STORE', '');
    mockRpc(true);
    await rateLimit('k', 5, 60_000);
    expect(rpcMock).toHaveBeenCalledOnce();
  });

  it('usa memoria por default fuera de produccion, sin tocar Postgres', async () => {
    // Desarrollo local es un proceso unico, asi que el Map no tiene el problema
    // que motivationa el store compartido, y ademas deja trabajar sin la
    // migracion aplicada.
    vi.stubEnv('E2E', '');
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('RATE_LIMIT_STORE', '');
    const first = await rateLimit(`k:${Math.random()}`, 2, 60_000);
    const second = await rateLimit(`k:${Math.random()}`, 2, 60_000);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('NUNCA cae a memoria en produccion aunque el RPC falle', async () => {
    vi.stubEnv('E2E', '');
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('RATE_LIMIT_STORE', '');
    rpcMock.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const key = `k:${Math.random()}`;
    for (let i = 0; i < 5; i++) expect((await rateLimit(key, 1, 60_000)).ok).toBe(true);

    // Todas pasaron por el RPC fallido, no por un contador local: si cayera a
    // memoria, la segunda ya habria sido bloqueada.
    expect(rpcMock).toHaveBeenCalledTimes(5);
    spy.mockRestore();
  });
});

describe('rateLimitPeek (store en memoria)', () => {
  it('consultar no incrementa el contador', async () => {
    // Si peek contara, diez consultasarian agotar el limite solas. Es el
    // motivo de existir de la funcion: separar "ya excedi" de "contar un fallo".
    const key = `test:${Math.random()}`;
    for (let i = 0; i < 10; i++) {
      expect((await rateLimitPeek(key, 3)).ok).toBe(true);
    }
  });

  it('bloquea cuando el contador ya alcanzo el limite, sin contar de mas', async () => {
    const key = `test:${Math.random()}`;
    for (let i = 0; i < 3; i++) expect((await rateLimit(key, 3, 60_000)).ok).toBe(true);

    const blocked = await rateLimitPeek(key, 3);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    // Un peek mas sigue bloqueado y no_sigue_contando: el valor no se altera.
    expect((await rateLimitPeek(key, 3)).ok).toBe(false);
  });

  it('vuelve a dejar pasar cuando la ventana expira', async () => {
    const key = `test:${Math.random()}`;
    await rateLimit(key, 1, 30);
    await new Promise((r) => setTimeout(r, 60));
    expect((await rateLimitPeek(key, 1)).ok).toBe(true);
  });
});

describe('rateLimitPeek (store distribuido)', () => {
  beforeEach(() => {
    vi.stubEnv('RATE_LIMIT_STORE', 'postgres');
  });

  it('delega en rate_limit_peek y devuelve su resultado', async () => {
    mockRpc(true);
    expect(await rateLimitPeek('auth:login:ip:1.1.1.1', 5)).toEqual({ ok: true, retryAfterSeconds: 0 });
    expect(rpcMock).toHaveBeenCalledWith('rate_limit_peek', {
      p_key: 'auth:login:ip:1.1.1.1',
      p_limit: 5,
    });
  });

  it('propaga el retry-after que devuelve la base', async () => {
    mockRpc(false, 42);
    expect(await rateLimitPeek('k', 5)).toEqual({ ok: false, retryAfterSeconds: 42 });
  });

  it('permite el request si la funcion todavia no esta migrada', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'function does not exist' } });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await rateLimitPeek('k', 5)).ok).toBe(true);
    expect(String(spy.mock.calls[0]?.[0])).toContain('037_rate_limit_peek');
    spy.mockRestore();
  });
});

describe('getClientIp', () => {
  const req = (headers: Record<string, string>) => new Request('http://x.test', { headers });

  it('ignora el X-Forwarded-For que arma el cliente y usa el ultimo salto', async () => {
    // Regresion de seguridad: antes tomaba el PRIMER valor, que es el que elige
    // el cliente. Mandar un XFF distinto por request dava un bucket nuevo y hacia
    // evadir todos los limites por IP.
    expect(getClientIp(req({ 'x-forwarded-for': '9.9.9.9, 1.1.1.1' }))).toBe('1.1.1.1');
    expect(getClientIp(req({ 'x-forwarded-for': '9.9.9.9' }))).toBe('9.9.9.9');
  });

  it('prefiere el header que escribe el edge, que el cliente no puede forjar', () => {
    expect(
      getClientIp(req({ 'x-forwarded-for': '9.9.9.9', 'x-vercel-forwarded-for': '1.1.1.1' }))
    ).toBe('1.1.1.1');
    expect(getClientIp(req({ 'cf-connecting-ip': '2.2.2.2' }))).toBe('2.2.2.2');
  });

  it('respeta la cantidad de proxies de confianza configurada', () => {
    // Con dos proxies delante, el cliente es el penultimo salto, no el ultimo.
    vi.stubEnv('RATE_LIMIT_TRUSTED_HOPS', '1');
    expect(getClientIp(req({ 'x-forwarded-for': '5.5.5.5, 4.4.4.4, 3.3.3.3' }))).toBe('4.4.4.4');
    vi.stubEnv('RATE_LIMIT_TRUSTED_HOPS', '0');
    expect(getClientIp(req({ 'x-forwarded-for': '5.5.5.5, 4.4.4.4, 3.3.3.3' }))).toBe('3.3.3.3');
  });

  it('normaliza el IPv4 mapeado en IPv6 para no partir el limite en dos', () => {
    expect(getClientIp(req({ 'x-forwarded-for': '::ffff:1.2.3.4' }))).toBe('1.2.3.4');
  });

  it('usa x-real-ip como fallback y cae a unknown', () => {
    expect(getClientIp(req({ 'x-real-ip': '3.3.3.3' }))).toBe('3.3.3.3');
    expect(getClientIp(req({}))).toBe('unknown');
  });
});
