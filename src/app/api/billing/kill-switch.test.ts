import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as createCheckout } from './create-checkout/route';
import { POST as downgrade } from './downgrade/route';
import { POST as portal } from './portal/route';

const guardKillMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/kill-switch', () => ({ guardKill: guardKillMock }));

function makeRequest(): Request {
  // Sin `Origin`: si el guard no cortara primero, CSRF respondería 403.
  return new Request('http://localhost/api/billing', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan: 'pro' }),
  });
}

function killedResponse() {
  return new Response(JSON.stringify({ code: 'KILL_SWITCH_PAYMENTS' }), { status: 503 });
}

describe('kill switch de pagos', () => {
  beforeEach(() => {
    guardKillMock.mockReset();
    guardKillMock.mockResolvedValue(killedResponse());
  });

  it.each([
    ['create-checkout', createCheckout],
    ['portal', portal],
    ['downgrade', downgrade],
  ])('%s devuelve 503 antes de CSRF cuando el kill switch está activo', async (_name, handler) => {
    const response = await handler(makeRequest());

    expect(response.status).toBe(503);
    expect(guardKillMock).toHaveBeenCalledWith('payments');
  });
});
