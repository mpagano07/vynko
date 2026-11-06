import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetKillSwitchCacheForTests,
  getKillSwitchEnvOverrides,
  getKillSwitchState,
  guardKill,
  invalidateKillSwitchCache,
  isKilled,
  isMaintenanceMode,
  KILL_SWITCH_CACHE_TTL_MS,
} from './kill-switch';
import { supabaseMock } from '@/test/supabase-mock';

vi.mock('@/lib/supabaseAdmin', async () => {
  const mod = await import('@/test/supabase-mock');
  return { supabaseAdmin: mod.supabaseMock };
});

function rows(...entries: Array<[string, boolean]>) {
  return {
    data: entries.map(([flag_key, enabled]) => ({ flag_key, enabled })),
    error: null,
  };
}

function selectCalls() {
  return supabaseMock.__calls.filter((c) => c.table === 'feature_flags' && c.method === 'select');
}

describe('kill-switch', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    __resetKillSwitchCacheForTests();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    __resetKillSwitchCacheForTests();
  });

  it('sin fila el area esta viva (fail open)', async () => {
    supabaseMock.__queue('feature_flags', { data: [], error: null });

    await expect(isKilled('sales')).resolves.toBe(false);
    await expect(getKillSwitchState()).resolves.toEqual({
      sales: false,
      payments: false,
      forecast: false,
      imports: false,
      maintenance: false,
    });
  });

  it('enabled = true mata solo esa area', async () => {
    supabaseMock.__queue('feature_flags', rows(['kill_sales', true], ['kill_forecast', false]));

    await expect(isKilled('sales')).resolves.toBe(true);
    await expect(isKilled('forecast')).resolves.toBe(false);
    await expect(isKilled('payments')).resolves.toBe(false);
  });

  it('maintenance_mode es superset de las cuatro areas', async () => {
    supabaseMock.__queue('feature_flags', rows(['maintenance_mode', true]));

    await expect(isMaintenanceMode()).resolves.toBe(true);
    for (const area of ['sales', 'payments', 'forecast', 'imports'] as const) {
      await expect(isKilled(area)).resolves.toBe(true);
    }
  });

  it('la env enciende el kill aunque la base diga que esta vivo', async () => {
    supabaseMock.__queue('feature_flags', rows(['kill_sales', false]));
    vi.stubEnv('FEATURE_KILL_SALES', 'on');

    await expect(isKilled('sales')).resolves.toBe(true);
  });

  it('la env apagada NO revive un flag matado en la base', async () => {
    supabaseMock.__queue('feature_flags', rows(['kill_sales', true]));
    vi.stubEnv('FEATURE_KILL_SALES', 'off');

    await expect(isKilled('sales')).resolves.toBe(true);
  });

  it('MAINTENANCE_MODE=true activa el mantenimiento sin tocar la base', async () => {
    vi.stubEnv('MAINTENANCE_MODE', 'true');

    await expect(isMaintenanceMode()).resolves.toBe(true);
    expect(selectCalls()).toHaveLength(0);
  });

  it('un valor de env invalido se ignora y sigue la base', async () => {
    supabaseMock.__queue('feature_flags', rows(['kill_sales', true]));
    vi.stubEnv('FEATURE_KILL_SALES', '50');

    await expect(isKilled('sales')).resolves.toBe(true);
    expect(console.warn).toHaveBeenCalled();
  });

  it('si la base falla y no hay cache, todo queda vivo', async () => {
    supabaseMock.__queue('feature_flags', { data: null, error: { message: 'caida' } });

    await expect(isKilled('sales')).resolves.toBe(false);
    expect(console.error).toHaveBeenCalled();
  });

  it('si la base falla con cache vencido, conserva el ultimo snapshot', async () => {
    vi.useFakeTimers();
    try {
      supabaseMock.__queue('feature_flags', rows(['kill_sales', true]));
      await expect(isKilled('sales')).resolves.toBe(true);

      vi.setSystemTime(Date.now() + KILL_SWITCH_CACHE_TTL_MS + 1);
      supabaseMock.__queue('feature_flags', { data: null, error: { message: 'caida' } });

      await expect(isKilled('sales')).resolves.toBe(true);
      expect(console.error).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('lee la base una sola vez por el TTL del cache', async () => {
    supabaseMock.__queue('feature_flags', rows(['kill_sales', true]));

    await isKilled('sales');
    await isKilled('payments');
    await getKillSwitchState();

    expect(selectCalls()).toHaveLength(1);
  });

  it('vuelve a leer cuando vence el TTL', async () => {
    vi.useFakeTimers();
    try {
      supabaseMock.__queue('feature_flags', rows(['kill_sales', false]));
      await expect(isKilled('sales')).resolves.toBe(false);

      vi.setSystemTime(Date.now() + KILL_SWITCH_CACHE_TTL_MS + 1);
      supabaseMock.__queue('feature_flags', rows(['kill_sales', true]));

      await expect(isKilled('sales')).resolves.toBe(true);
      expect(selectCalls()).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('invalidateKillSwitchCache fuerza la relectura inmediata', async () => {
    supabaseMock.__queue('feature_flags', rows(['kill_sales', false]));
    await expect(isKilled('sales')).resolves.toBe(false);

    supabaseMock.__queue('feature_flags', rows(['kill_sales', true]));
    invalidateKillSwitchCache();

    await expect(isKilled('sales')).resolves.toBe(true);
    expect(selectCalls()).toHaveLength(2);
  });

  it('guardKill devuelve 503 con code y Retry-After cuando el area esta matada', async () => {
    supabaseMock.__queue('feature_flags', rows(['kill_sales', true]));

    const response = await guardKill('sales');
    expect(response).not.toBeNull();
    expect(response?.status).toBe(503);
    expect(response?.headers.get('Retry-After')).toBe('60');

    const body = await response?.json();
    expect(body).toEqual({
      error: 'Las ventas están deshabilitadas temporalmente.',
      code: 'KILL_SWITCH_SALES',
    });
  });

  it('guardKill devuelve null cuando el area esta viva', async () => {
    supabaseMock.__queue('feature_flags', { data: [], error: null });

    await expect(guardKill('imports')).resolves.toBeNull();
  });

  it('getKillSwitchEnvOverrides solo informa las claves forzadas a ON por env', async () => {
    vi.stubEnv('FEATURE_KILL_FORECAST', 'on');
    vi.stubEnv('MAINTENANCE_MODE', 'off');

    expect(getKillSwitchEnvOverrides()).toEqual({ forecast: true });
  });
});
