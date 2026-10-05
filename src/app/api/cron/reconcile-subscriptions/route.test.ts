import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from './route';

const reconcileMock = vi.fn();

vi.mock('@/lib/mercadopago-reconcile', () => ({
  reconcileSubscriptions: (...args: unknown[]) => reconcileMock(...args),
}));

const ORIGINAL_SECRET = process.env.CRON_SECRET;

const authorized = () =>
  new Request('http://localhost/api/cron/reconcile-subscriptions', {
    headers: { authorization: 'Bearer test-secret' },
  });

const report = {
  checked: 3,
  inSync: 1,
  repaired: 2,
  unreachable: 0,
  deferred: [],
  details: [],
};

describe('GET /api/cron/reconcile-subscriptions', () => {
  beforeEach(() => {
    reconcileMock.mockReset();
    reconcileMock.mockResolvedValue(report);
    process.env.CRON_SECRET = 'test-secret';
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = ORIGINAL_SECRET;
    vi.restoreAllMocks();
  });

  it('runs the reconciliation when the bearer token matches', async () => {
    const res = await GET(authorized());

    expect(res.status).toBe(200);
    expect(reconcileMock).toHaveBeenCalledTimes(1);
    expect(await res.json()).toEqual(report);
  });

  it('is not cacheable, so a cron cannot read a stale report', async () => {
    const res = await GET(authorized());
    expect(res.headers.get('Cache-Control')).toContain('no-store');
  });

  it('rejects a request with no authorization header', async () => {
    const res = await GET(
      new Request('http://localhost/api/cron/reconcile-subscriptions')
    );

    expect(res.status).toBe(401);
    expect(reconcileMock).not.toHaveBeenCalled();
  });

  it('rejects a wrong token', async () => {
    const res = await GET(
      new Request('http://localhost/api/cron/reconcile-subscriptions', {
        headers: { authorization: 'Bearer wrong' },
      })
    );

    expect(res.status).toBe(401);
    expect(reconcileMock).not.toHaveBeenCalled();
  });

  it('rejects a token that is a prefix of the real secret', async () => {
    const res = await GET(
      new Request('http://localhost/api/cron/reconcile-subscriptions', {
        headers: { authorization: 'Bearer test' },
      })
    );

    expect(res.status).toBe(401);
  });

  it('reports what it repaired', async () => {
    reconcileMock.mockResolvedValue({
      ...report,
      repaired: 1,
      details: [{ tenantId: 't9', preapprovalId: 'pa-9', outcome: 'repaired' }],
    });

    const json = await (await GET(authorized())).json();

    expect(json.repaired).toBe(1);
    expect(json.details[0]).toMatchObject({ tenantId: 't9', outcome: 'repaired' });
  });

  it('does not leak the secret in the error body', async () => {
    const res = await GET(
      new Request('http://localhost/api/cron/reconcile-subscriptions', {
        headers: { authorization: 'Bearer nope' },
      })
    );
    expect(JSON.stringify(await res.json())).not.toContain('test-secret');
  });

  describe('sin CRON_SECRET configurado', () => {
    beforeEach(() => {
      delete process.env.CRON_SECRET;
    });

    it('stays disabled instead of open', async () => {
      // Fail closed: sin secreto, el endpoint no corre. Un endpoint de
      // reconciliacion sin auth permitiria a cualquiera disparar la
      // comparacion contra la API de MP.
      const res = await GET(authorized());

      expect(res.status).toBe(503);
      expect(reconcileMock).not.toHaveBeenCalled();
    });

    it('does not accept an empty bearer token as valid', async () => {
      const res = await GET(
        new Request('http://localhost/api/cron/reconcile-subscriptions', {
          headers: { authorization: 'Bearer ' },
        })
      );
      expect(res.status).toBe(503);
    });
  });
});

describe('POST /api/cron/reconcile-subscriptions', () => {
  beforeEach(() => {
    reconcileMock.mockReset();
    reconcileMock.mockResolvedValue(report);
    process.env.CRON_SECRET = 'test-secret';
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = ORIGINAL_SECRET;
    vi.restoreAllMocks();
  });

  it('can be triggered manually from a runbook with the same auth', async () => {
    const res = await POST(authorized());
    expect(res.status).toBe(200);
    expect(reconcileMock).toHaveBeenCalledTimes(1);
  });

  it('enforces the same auth on POST', async () => {
    const res = await POST(
      new Request('http://localhost/api/cron/reconcile-subscriptions')
    );
    expect(res.status).toBe(401);
    expect(reconcileMock).not.toHaveBeenCalled();
  });
});