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
    expect(json.error).toBe('Missing id');
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
    const updateData = tenantCall!.args[0] as Record<string, unknown>;
    expect(updateData.subscription_status).toBe('active');
    expect(updateData.subscription_plan).toBe('starter');
    expect(updateData.mercadopago_preapproval_id).toBe('preapproval-123');
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

  it('always returns 200 even if processing throws', async () => {
    mockGetPreApprovalById.mockRejectedValue(new Error('MP API down'));

    const req = makeWebhookRequest({
      type: 'subscription_preapproval',
      data: { id: 'preapproval-error' },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.received).toBe(true);
  });
});
