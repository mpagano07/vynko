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
  return new Request('http://localhost/api/admin/feature-flags', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('PUT /api/admin/feature-flags', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminMock.mockResolvedValue({ userId: 'admin-1' });
    setFeatureFlagMock.mockResolvedValue({
      ok: true,
      flag: { flag_key: 'nuevo_flag', enabled: true, rollout_percent: 50 },
    });
  });

  it('rechaza los kill switches y los manda a /admin/ops', async () => {
    for (const flagKey of ['kill_sales', 'kill_typo', 'maintenance_mode']) {
      const response = await PUT(makeRequest({ flag_key: flagKey, enabled: true, rollout_percent: 100 }));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: 'Los kill switches se administran desde /admin/ops',
      });
    }

    expect(setFeatureFlagMock).not.toHaveBeenCalled();
  });

  it('sigue permitiendo flags de release normales', async () => {
    const response = await PUT(
      makeRequest({ flag_key: 'nuevo_flag', enabled: true, rollout_percent: 50 })
    );

    expect(response.status).toBe(200);
    expect(setFeatureFlagMock).toHaveBeenCalledWith(
      expect.objectContaining({ flag_key: 'nuevo_flag', rollout_percent: 50, updated_by: 'admin-1' })
    );
  });
});
