import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from './route';

const reconcileMock = vi.fn();
const enqueueMock = vi.fn();

vi.mock('@/lib/mercadopago-reconcile', () => ({
  reconcileSubscriptions: (...args: unknown[]) => reconcileMock(...args),
}));

// El endpoint solo encola cuando la reconciliacion revienta; sin este mock el
// enqueue real tocaria la base.
vi.mock('@/lib/job-queue', () => ({
  enqueueJob: (...args: unknown[]) => enqueueMock(...args),
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
    enqueueMock.mockReset();
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
    expect(enqueueMock).not.toHaveBeenCalled();
    expect(await res.json()).toEqual(report);
  });

  it('si la reconciliacion revienta, la deja en cola y responde 500', async () => {
    // Sin esto la corrida del dia se pierde y el proximo intento es en 24 h.
    reconcileMock.mockRejectedValue(new Error('boom'));
    enqueueMock.mockResolvedValue('job-77');

    const res = await GET(authorized());

    expect(res.status).toBe(500);
    expect(enqueueMock).toHaveBeenCalledWith({
      jobType: 'reconcile_subscriptions',
      payload: { source: 'cron' },
    });
    expect(await res.json()).toMatchObject({ error: 'Reconciliation failed', queued: true });
  });

  it('si ni siquiera se pudo encolar, lo dice en la respuesta', async () => {
    reconcileMock.mockRejectedValue(new Error('boom'));
    enqueueMock.mockResolvedValue(null);

    const res = await GET(authorized());

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ queued: false });
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

  it('does not accept an empty bearer token as valid', async () => {
    // Sin el espacio despues de "Bearer": es lo que envia un cliente que
    // manda el esquema sin credenciales. Con el trailing space el test era
    // doblemente vacio, porque el constructor de Request normaliza los
    // espacios finales y "Bearer " llegaba al handler como "Bearer".
    //
    // Antes esto vivia dentro del describe de "sin CRON_SECRET", asi que pasaba
    // por 503 --el endpoint deshabilitado-- sin llegar nunca a comparar el
    // token. Decia una cosa y probaba otra.
    const res = await GET(
      new Request('http://localhost/api/cron/reconcile-subscriptions', {
        headers: { authorization: 'Bearer' },
      })
    );

    expect(res.status).toBe(401);
    expect(reconcileMock).not.toHaveBeenCalled();
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
  });
});

describe('POST /api/cron/reconcile-subscriptions', () => {
  beforeEach(() => {
    reconcileMock.mockReset();
    reconcileMock.mockResolvedValue(report);
    enqueueMock.mockReset();
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