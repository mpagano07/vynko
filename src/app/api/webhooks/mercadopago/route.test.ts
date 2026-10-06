import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseMock } from '@/test/supabase-mock';
import { POST } from './route';

vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: supabaseMock,
}));

vi.mock('@/lib/supabase', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: 'user-1' } },
        error: null,
      })),
    },
  })),
}));

const mockGetPreApprovalById = vi.fn();
const mockVerifySignature = vi.fn();

vi.mock('@/lib/mercadopago', () => ({
  getPreApprovalById: (...args: unknown[]) => mockGetPreApprovalById(...args),
  verifyMercadoPagoSignature: (...args: unknown[]) => mockVerifySignature(...args),
}));

function makeWebhookRequest(body: Record<string, unknown>, headers?: Record<string, string>): Request {
  return new Request('http://localhost/api/webhooks/mercadopago', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-request-id': 'test-req-id',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/webhooks/mercadopago', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    mockGetPreApprovalById.mockReset();
    mockVerifySignature.mockReset();
    mockVerifySignature.mockReturnValue(true);
  });

  it('returns 400 for invalid JSON body', async () => {
    const req = new Request('http://localhost/api/webhooks/mercadopago', {
      method: 'POST',
      body: 'not-json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Invalid JSON body');
  });

  it('returns 400 when data.id is missing', async () => {
    const req = makeWebhookRequest({ type: 'subscription_preapproval' });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('`data.id` must be a non-empty string');
  });

  describe('validacion de forma', () => {
    it('rejects a payload that is not a JSON object', async () => {
      const req = makeWebhookRequest('not an object' as unknown as Record<string, unknown>);
      const res = await POST(req);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('Payload must be a JSON object');
    });

    it('rejects `data` when it is an array instead of an object', async () => {
      const req = makeWebhookRequest({
        type: 'subscription_preapproval',
        data: ['preapproval-123'],
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('`data` must be an object when present');
    });

    it('rejects a numeric id, which would reach the service as a string check', async () => {
      const req = makeWebhookRequest({
        type: 'subscription_preapproval',
        data: { id: 12345 },
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('`data.id` must be a non-empty string');
    });

    it('rejects an id that is only whitespace', async () => {
      const req = makeWebhookRequest({
        type: 'subscription_preapproval',
        data: { id: '   ' },
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('`data.id` must be a non-empty string');
    });

    it('rejects a payload with no type at all', async () => {
      const req = makeWebhookRequest({ data: { id: 'preapproval-123' } });
      const res = await POST(req);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('Missing `type`');
    });

    it('rejects a type that is not a string', async () => {
      const req = makeWebhookRequest({
        type: { name: 'subscription_preapproval' },
        data: { id: 'preapproval-123' },
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('`type` must be a string');
    });

    it('does not touch the service when the shape is invalid', async () => {
      const req = makeWebhookRequest({ type: 'subscription_preapproval', data: { id: 1 } });
      await POST(req);
      expect(mockGetPreApprovalById).not.toHaveBeenCalled();
    });

    it('still accepts the flat `id` form without `data`', async () => {
      mockGetPreApprovalById.mockResolvedValue({
        external_reference: 'tenant-1',
        status: 'pending',
      });
      supabaseMock.__queue('tenant_users', { data: { user_id: 'owner-1' }, error: null });
      supabaseMock.__queue('tenant_users', { data: [{ tenant_id: 'tenant-1' }], error: null });
      supabaseMock.__queue('tenant_users', { data: { user_id: 'owner-1' }, error: null });

      const req = makeWebhookRequest({ type: 'subscription_preapproval', id: 'flat-123' });
      const res = await POST(req);

      expect(res.status).toBe(200);
      expect(mockGetPreApprovalById).toHaveBeenCalledWith('flat-123');
    });

    it('accepts an unknown topic with a valid shape and answers 200', async () => {
      // Un topic que no procesamos no es un error: 200 para que MercadoPago
      // deje de reenviarlo.
      const req = makeWebhookRequest({
        type: 'some_future_mp_event',
        data: { id: 'x-1' },
      });
      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(mockGetPreApprovalById).not.toHaveBeenCalled();
    });
  });

  it('returns 401 for invalid webhook signature', async () => {
    mockVerifySignature.mockReturnValue(false);
    const req = makeWebhookRequest({
      type: 'subscription_preapproval',
      data: { id: 'preapproval-123' },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toContain('Unauthorized');
  });

  it('activates subscription on authorized status', async () => {
    mockGetPreApprovalById.mockResolvedValue({
      external_reference: 'tenant-1',
      status: 'authorized',
      reason: 'Suscripción Starter - Vynko',
      next_payment_date: '2026-09-19T00:00:00.000Z',
    });

    supabaseMock.__queue('tenants', { data: null, error: null });

    const req = makeWebhookRequest({
      type: 'subscription_preapproval',
      data: { id: 'preapproval-123' },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.received).toBe(true);

    expect(mockGetPreApprovalById).toHaveBeenCalledWith('preapproval-123');

    const tenantCall = supabaseMock.__calls.find(
      (c) => c.table === 'tenants' && c.method === 'update'
    );
    expect(tenantCall).toBeDefined();
    // El servicio parte la escritura en dos UPDATE (transicion de estado +
    // refresco de periodo), asi que el estado final hay que leerlo del merge.
    const updateData = supabaseMock.__calls
      .filter((c) => c.table === 'tenants' && c.method === 'update')
      .reduce<Record<string, unknown>>(
        (acc, c) => ({ ...acc, ...(c.args[0] as Record<string, unknown>) }),
        {}
      );
    expect(updateData.subscription_status).toBe('active');
    expect(updateData.subscription_plan).toBe('starter');
    expect(updateData.mercadopago_preapproval_id).toBe('preapproval-123');
    expect(updateData.subscription_current_period_end).toBe('2026-09-19T00:00:00.000Z');
  });

  it('sets business plan when reason contains Business', async () => {
    mockGetPreApprovalById.mockResolvedValue({
      external_reference: 'tenant-1',
      status: 'authorized',
      reason: 'Suscripción Business - Vynko',
      next_payment_date: '2026-09-19T00:00:00.000Z',
    });

    supabaseMock.__queue('tenants', { data: null, error: null });

    const req = makeWebhookRequest({
      type: 'subscription_preapproval',
      data: { id: 'preapproval-biz' },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const tenantCall = supabaseMock.__calls.find(
      (c) => c.table === 'tenants' && c.method === 'update'
    );
    expect(tenantCall).toBeDefined();
    const updateData = tenantCall!.args[0] as Record<string, unknown>;
    expect(updateData.subscription_plan).toBe('business');
  });

  it('reactivates products when business plan is authorized', async () => {
    mockGetPreApprovalById.mockResolvedValue({
      external_reference: 'tenant-1',
      status: 'authorized',
      reason: 'Suscripción Business - Vynko',
      next_payment_date: '2026-09-19T00:00:00.000Z',
    });

    supabaseMock.__queue('tenants', { data: null, error: null });

    const req = makeWebhookRequest({
      type: 'subscription_preapproval',
      data: { id: 'preapproval-biz' },
    });

    await POST(req);

    const stockCall = supabaseMock.__calls.find(
      (c) => c.table === 'product_stock' && c.method === 'update'
    );
    expect(stockCall).toBeDefined();
    const stockData = stockCall!.args[0] as Record<string, unknown>;
    expect(stockData.active).toBe(true);
  });

  it('propagates an authorized business plan to all of the owner\'s branches', async () => {
    mockGetPreApprovalById.mockResolvedValue({
      external_reference: 'tenant-1',
      status: 'authorized',
      reason: 'Suscripción Business - Vynko',
      next_payment_date: '2026-09-19T00:00:00.000Z',
    });

    // resolveOwnerBranchIds queries tenant_users twice (owner + branches).
    supabaseMock.__queue('tenant_users', { data: { user_id: 'owner-1' }, error: null });
    supabaseMock.__queue('tenant_users', {
      data: [{ tenant_id: 'tenant-1' }, { tenant_id: 'tenant-2' }, { tenant_id: 'tenant-3' }],
      error: null,
    });
    supabaseMock.__queue('tenants', { data: null, error: null });

    const req = makeWebhookRequest({
      type: 'subscription_preapproval',
      data: { id: 'preapproval-biz' },
    });

    await POST(req);

    const tenantCall = supabaseMock.__calls.find(
      (c) => c.table === 'tenants' && c.method === 'update'
    );
    expect(tenantCall).toBeDefined();
    const updateData = tenantCall!.args[0] as Record<string, unknown>;
    expect(updateData.subscription_status).toBe('active');
    expect(updateData.subscription_plan).toBe('business');
    // Second argument of update() is the filter builder; the .in() call lists all branches.
    const inCall = supabaseMock.__calls.find(
      (c) => c.table === 'tenants' && c.method === 'in'
    );
    expect(inCall).toBeDefined();
    expect(inCall!.args[0]).toBe('id');
    expect(inCall!.args[1]).toEqual(['tenant-1', 'tenant-2', 'tenant-3']);
  });

  it('cancels subscription on cancelled status', async () => {
    mockGetPreApprovalById.mockResolvedValue({
      external_reference: 'tenant-1',
      status: 'cancelled',
      reason: 'Suscripción Starter - Vynko',
    });

    supabaseMock.__queue('tenants', {
      data: {
        subscription_plan: 'starter',
        mercadopago_preapproval_id: 'preapproval-123',
      },
      error: null,
    });
    supabaseMock.__queue('tenants', { data: null, error: null });

    const req = makeWebhookRequest({
      type: 'subscription_preapproval',
      data: { id: 'preapproval-123' },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const tenantCall = supabaseMock.__calls.find(
      (c) => c.table === 'tenants' && c.method === 'update'
    );
    expect(tenantCall).toBeDefined();
    const updateData = tenantCall!.args[0] as Record<string, unknown>;
    expect(updateData.subscription_status).toBe('canceled');
  });

  it('downgrades business to free on cancellation', async () => {
    mockGetPreApprovalById.mockResolvedValue({
      external_reference: 'tenant-1',
      status: 'cancelled',
      reason: 'Suscripción Business - Vynko',
    });

    supabaseMock.__queue('tenants', {
      data: {
        subscription_plan: 'business',
        mercadopago_preapproval_id: 'preapproval-123',
      },
      error: null,
    });
    supabaseMock.__queue('tenants', { data: null, error: null });

    const req = makeWebhookRequest({
      type: 'subscription_preapproval',
      data: { id: 'preapproval-123' },
    });

    await POST(req);

    const tenantCall = supabaseMock.__calls.find(
      (c) => c.table === 'tenants' && c.method === 'update'
    );
    expect(tenantCall).toBeDefined();
    const updateData = tenantCall!.args[0] as Record<string, unknown>;
    expect(updateData.subscription_plan).toBe('free');
  });

  it('marks past_due on paused status', async () => {
    mockGetPreApprovalById.mockResolvedValue({
      external_reference: 'tenant-1',
      status: 'paused',
    });

    supabaseMock.__queue('tenants', { data: null, error: null });

    const req = makeWebhookRequest({
      type: 'subscription_preapproval',
      data: { id: 'preapproval-paused' },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const tenantCall = supabaseMock.__calls.find(
      (c) => c.table === 'tenants' && c.method === 'update'
    );
    expect(tenantCall).toBeDefined();
    const updateData = tenantCall!.args[0] as Record<string, unknown>;
    expect(updateData.subscription_status).toBe('past_due');
  });

  it('returns 200 for unknown topic without error', async () => {
    const req = makeWebhookRequest({
      type: 'some_unknown_topic',
      data: { id: 'whatever' },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.received).toBe(true);
  });

  it('handles preapproval without external reference gracefully', async () => {
    mockGetPreApprovalById.mockResolvedValue({
      external_reference: null,
      status: 'authorized',
    });

    const req = makeWebhookRequest({
      type: 'subscription_preapproval',
      data: { id: 'preapproval-noref' },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('No external reference');
  });

  it('returns 500 when processing fails, so MercadoPago retries the delivery', async () => {
    // Este test afirmaba 200 "always". Con 200 MercadoPago considera el evento
    // procesado y no lo reintenta, asi que una caida transitoria de la API
    // dejaba al tenant sin activar para siempre. Un 5xx es lo que activa el
    // reintento con backoff de MercadoPago.
    mockGetPreApprovalById.mockRejectedValue(new Error('MP API down'));

    const req = makeWebhookRequest({
      type: 'subscription_preapproval',
      data: { id: 'preapproval-error' },
    });

    const res = await POST(req);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Webhook processing failed');
  });

  it('returns 200 for an obsolete cancellation, so MercadoPago stops retrying', async () => {
    // Al revés que el caso anterior: un evento obsoleto NO se reintenta nunca,
    // porque reintentarlo no lo vuelve a hacer vigente.
    supabaseMock.__queue('tenant_users', { data: { user_id: 'owner-1' }, error: null });
    supabaseMock.__queue('tenant_users', {
      data: [{ tenant_id: 'tenant-1' }],
      error: null,
    });
    supabaseMock.__queue('tenant_users', { data: { user_id: 'owner-1' }, error: null });
    supabaseMock.__queue('tenants', {
      data: { subscription_plan: 'starter', mercadopago_preapproval_id: 'preapproval-new' },
      error: null,
    });

    mockGetPreApprovalById.mockResolvedValue({
      external_reference: 'tenant-1',
      status: 'cancelled',
    });

    const req = makeWebhookRequest({
      type: 'subscription_preapproval',
      data: { id: 'preapproval-old' },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.received).toBe(true);

    expect(
      supabaseMock.__calls.filter((c) => c.table === 'tenants' && c.method === 'update')
    ).toHaveLength(0);
  });

  describe('dedupe temprano por x-request-id (migracion 052)', () => {
    it('corta un replay de la misma entrega sin llamar a la API de MercadoPago', async () => {
      supabaseMock.__queue('webhook_events', { data: { outcome: 'processed' }, error: null });

      const req = makeWebhookRequest({
        type: 'subscription_preapproval',
        data: { id: 'preapproval-123' },
      });

      const res = await POST(req);

      expect(res.status).toBe(200);
      expect((await res.json()).received).toBe(true);
      expect(mockGetPreApprovalById).not.toHaveBeenCalled();
    });

    it('un delivery previo con outcome error NO corta: MercadoPago esta reintentando para que se procese', async () => {
      supabaseMock.__queue('webhook_events', { data: { outcome: 'error' }, error: null });
      mockGetPreApprovalById.mockResolvedValue({
        external_reference: 'tenant-1',
        status: 'authorized',
        reason: 'Suscripción Starter - Vynko',
      });

      supabaseMock.__queue('tenants', { data: null, error: null });

      const req = makeWebhookRequest({
        type: 'subscription_preapproval',
        data: { id: 'preapproval-123' },
      });

      const res = await POST(req);

      expect(res.status).toBe(200);
      expect(mockGetPreApprovalById).toHaveBeenCalledWith('preapproval-123');
    });

    it('lee la bitacora filtrando por delivery_id, no por preapproval', async () => {
      // Modo tenant-aware del mock: aplica los filtros eq/in/is a las filas
      // encoladas. Una fila registrada bajo OTRO delivery se filtra, la entrega
      // se procesa normal (una renovacion mensual es un delivery distinto).
      supabaseMock.__setTenantAware(true);
      supabaseMock.__queue('webhook_events', {
        data: { outcome: 'processed', delivery_id: 'another-delivery', provider: 'mercadopago' },
        error: null,
      });
      mockGetPreApprovalById.mockResolvedValue({
        external_reference: 'tenant-1',
        status: 'authorized',
        reason: 'Suscripción Starter - Vynko',
      });

      supabaseMock.__queue('tenants', { data: null, error: null });

      const req = makeWebhookRequest({
        type: 'subscription_preapproval',
        data: { id: 'preapproval-123' },
      });

      const res = await POST(req);

      expect(res.status).toBe(200);
      expect(mockGetPreApprovalById).toHaveBeenCalledWith('preapproval-123');

      const deliveryEq = supabaseMock.__calls.find(
        (c) => c.table === 'webhook_events' && c.method === 'eq' && c.args[0] === 'delivery_id'
      );
      expect(deliveryEq).toBeDefined();
      expect(deliveryEq!.args[1]).toBe('test-req-id');
    });
  });
});

