import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PUT } from './route';

const requireAdminMock = vi.hoisted(() => vi.fn());
const setFeatureFlagMock = vi.hoisted(() => vi.fn());
const invalidateKillSwitchCacheMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/admin-guard', () => ({ requireAdmin: requireAdminMock }));
vi.mock('@/lib/security/csrf', () => ({ isSameOriginRequest: () => true }));
vi.mock('@/lib/feature-flags', () => ({ setFeatureFlag: setFeatureFlagMock, listFeatureFlags: vi.fn() }));
vi.mock('@/lib/kill-switch', () => ({ invalidateKillSwitchCache: invalidateKillSwitchCacheMock }));

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/admin/kill-switches', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('PUT /api/admin/kill-switches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminMock.mockResolvedValue({ userId: 'admin-1' });
    setFeatureFlagMock.mockResolvedValue({
      ok: true,
      flag: { flag_key: 'kill_sales', enabled: true, rollout_percent: 100 },
    });
  });

  it('prende un área conocida y fuerza rollout 100', async () => {
    const response = await PUT(makeRequest({ flag_key: 'kill_sales', enabled: true }));

    expect(response.status).toBe(200);
    expect(setFeatureFlagMock).toHaveBeenCalledWith({
      flag_key: 'kill_sales',
      enabled: true,
      rollout_percent: 100,
      updated_by: 'admin-1',
    });
    expect(invalidateKillSwitchCacheMock).toHaveBeenCalledOnce();
  });

  it('acepta mantenimiento global', async () => {
    setFeatureFlagMock.mockResolvedValue({
      ok: true,
      flag: { flag_key: 'maintenance_mode', enabled: true, rollout_percent: 100 },
    });

    const response = await PUT(makeRequest({ flag_key: 'maintenance_mode', enabled: true }));

    expect(response.status).toBe(200);
    expect(setFeatureFlagMock).toHaveBeenCalledOnce();
  });

  it('rechaza claves que no son kill switches', async () => {
    for (const flagKey of ['kill_typo', 'nuevo_flag', '']) {
      const response = await PUT(makeRequest({ flag_key: flagKey, enabled: true }));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: 'Kill switch inválido' });
    }

    expect(setFeatureFlagMock).not.toHaveBeenCalled();
  });

  it('rechaza enabled que no es booleano', async () => {
    const response = await PUT(makeRequest({ flag_key: 'kill_sales', enabled: 'true' }));

    expect(response.status).toBe(400);
    expect(setFeatureFlagMock).not.toHaveBeenCalled();
  });
});
