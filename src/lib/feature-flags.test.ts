import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  __resetFeatureFlagCacheForTests,
  getFeatureFlags,
  isFeatureEnabled,
  listFeatureFlags,
  setFeatureFlag,
} from './feature-flags';
import { supabaseMock } from '@/test/supabase-mock';

vi.mock('@/lib/supabaseAdmin', async () => {
  const mod = await import('@/test/supabase-mock');
  return { supabaseAdmin: mod.supabaseMock };
});

function flagRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    data: [
      {
        flag_key: 'new_checkout',
        enabled: true,
        rollout_percent: 100,
        description: null,
        updated_by: null,
        updated_at: '2026-10-08T00:00:00Z',
        ...overrides,
      },
    ],
    error: null,
  };
}

function selectCalls() {
  return supabaseMock.__calls.filter((c) => c.table === 'feature_flags' && c.method === 'select');
}

describe('feature-flags', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    __resetFeatureFlagCacheForTests();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    __resetFeatureFlagCacheForTests();
  });

  it('un flag que no existe esta apagado', async () => {
    supabaseMock.__queue('feature_flags', { data: [], error: null });

    await expect(isFeatureEnabled('no_existe')).resolves.toBe(false);
  });

  it('enabled + 100% enciende para cualquiera', async () => {
    supabaseMock.__queue('feature_flags', flagRow());

    await expect(isFeatureEnabled('new_checkout', { userId: 'user-1' })).resolves.toBe(true);
  });

  it('el kill switch apaga aunque el rollout este en 100%', async () => {
    supabaseMock.__queue('feature_flags', flagRow({ enabled: false, rollout_percent: 100 }));

    await expect(isFeatureEnabled('new_checkout', { userId: 'user-1' })).resolves.toBe(false);
  });

  it('el rollout es estable por usuario y cubre aproximadamente la mitad', async () => {
    supabaseMock.__queue('feature_flags', flagRow({ rollout_percent: 50 }));

    const users = Array.from({ length: 200 }, (_, i) => `user-${i}`);
    const first = await Promise.all(users.map((userId) => isFeatureEnabled('new_checkout', { userId })));

    // La misma consulta otra vez (cache en memoria) tiene que dar identica.
    const second = await Promise.all(users.map((userId) => isFeatureEnabled('new_checkout', { userId })));
    expect(second).toEqual(first);

    const enabledCount = first.filter(Boolean).length;
    // FNV-1a sobre 200 sujetos: ni 0 ni 200. Un rango holgado para no depender
    // del hash exacto, pero suficiente para detectar "todos" o "ninguno".
    expect(enabledCount).toBeGreaterThan(60);
    expect(enabledCount).toBeLessThan(140);
  });

  it('sin sujeto no explota y usa un bucket estable', async () => {
    supabaseMock.__queue('feature_flags', flagRow({ rollout_percent: 50 }));

    const first = await isFeatureEnabled('new_checkout');
    const second = await isFeatureEnabled('new_checkout');
    expect(second).toBe(first);
  });

  it('la variable de entorno gana sobre la base', async () => {
    supabaseMock.__queue('feature_flags', flagRow({ enabled: false }));

    vi.stubEnv('FEATURE_NEW_CHECKOUT', 'on');
    await expect(isFeatureEnabled('new_checkout', { userId: 'user-1' })).resolves.toBe(true);

    vi.stubEnv('FEATURE_NEW_CHECKOUT', 'off');
    await expect(isFeatureEnabled('new_checkout', { userId: 'user-1' })).resolves.toBe(false);
  });

  it('la variable de entorno acepta un porcentaje', async () => {
    vi.stubEnv('FEATURE_NEW_CHECKOUT', '0');
    await expect(isFeatureEnabled('new_checkout', { userId: 'user-1' })).resolves.toBe(false);

    vi.stubEnv('FEATURE_NEW_CHECKOUT', '100');
    await expect(isFeatureEnabled('new_checkout', { userId: 'user-1' })).resolves.toBe(true);
  });

  it('un valor de env invalido se ignora y sigue la base', async () => {
    supabaseMock.__queue('feature_flags', flagRow());

    vi.stubEnv('FEATURE_NEW_CHECKOUT', 'cualquier-cosa');
    await expect(isFeatureEnabled('new_checkout', { userId: 'user-1' })).resolves.toBe(true);
    expect(console.warn).toHaveBeenCalled();
  });

  it('lee la base una sola vez por el TTL del cache', async () => {
    supabaseMock.__queue('feature_flags', flagRow());

    await isFeatureEnabled('new_checkout', { userId: 'user-1' });
    await isFeatureEnabled('new_checkout', { userId: 'user-2' });
    await getFeatureFlags(['new_checkout'], { userId: 'user-3' });

    expect(selectCalls()).toHaveLength(1);
  });

  it('varios flags con una sola lectura', async () => {
    supabaseMock.__queue('feature_flags', {
      data: [
        { flag_key: 'a', enabled: true, rollout_percent: 100 },
        { flag_key: 'b', enabled: false, rollout_percent: 100 },
      ],
      error: null,
    });

    const flags = await getFeatureFlags(['a', 'b', 'c'], { userId: 'user-1' });

    expect(flags).toEqual({ a: true, b: false, c: false });
    expect(selectCalls()).toHaveLength(1);
  });

  it('si la base falla y no hay cache, los flags quedan apagados', async () => {
    supabaseMock.__queue('feature_flags', { data: null, error: { message: 'caida' } });

    await expect(isFeatureEnabled('new_checkout', { userId: 'user-1' })).resolves.toBe(false);
    expect(console.error).toHaveBeenCalled();
  });

  it('si la base falla con cache vencido, conserva el ultimo snapshot', async () => {
    vi.useFakeTimers();
    try {
      supabaseMock.__queue('feature_flags', flagRow());
      await expect(isFeatureEnabled('new_checkout', { userId: 'user-1' })).resolves.toBe(true);

      // Vence el TTL: la siguiente lectura va a la base y la base esta caida.
      vi.setSystemTime(Date.now() + 61_000);
      supabaseMock.__queue('feature_flags', { data: null, error: { message: 'caida' } });

      await expect(isFeatureEnabled('new_checkout', { userId: 'user-1' })).resolves.toBe(true);
      expect(console.error).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('setFeatureFlag hace upsert y invalida el cache', async () => {
    supabaseMock.__queue('feature_flags', flagRow({ enabled: false, rollout_percent: 0 }));
    supabaseMock.__queue('feature_flags', { data: [], error: null });

    await setFeatureFlag({ flag_key: 'seed', enabled: true, rollout_percent: 100 });
    __resetFeatureFlagCacheForTests();

    const result = await setFeatureFlag({
      flag_key: 'new_checkout',
      enabled: false,
      rollout_percent: 0,
      updated_by: 'admin-1',
    });

    expect(result.ok).toBe(true);
    const upserts = supabaseMock.__calls.filter((c) => c.table === 'feature_flags' && c.method === 'upsert');
    expect(upserts).toHaveLength(2);
    expect(upserts[1]?.args[0]).toMatchObject({
      flag_key: 'new_checkout',
      enabled: false,
      rollout_percent: 0,
      updated_by: 'admin-1',
    });
  });

  it('listFeatureFlags devuelve las filas ordenadas', async () => {
    supabaseMock.__queue('feature_flags', {
      data: [
        { flag_key: 'zeta', enabled: false, rollout_percent: 0 },
        { flag_key: 'alpha', enabled: true, rollout_percent: 10 },
      ],
      error: null,
    });

    const flags = await listFeatureFlags();
    expect(flags.map((f) => f.flag_key)).toEqual(['alpha', 'zeta']);
  });
});
