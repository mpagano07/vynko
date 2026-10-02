import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseMock } from '@/test/supabase-mock';
import {
  createCheckoutSession,
  downgradePlan,
  cancelSubscription,
  getSubscriptionStatus,
} from './billing-service';

vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: supabaseMock,
}));

const mockCreatePreApproval = vi.fn();
const mockCancelPreApproval = vi.fn();

vi.mock('@/lib/mercadopago', () => ({
  createPreApproval: (...args: unknown[]) => mockCreatePreApproval(...args),
  cancelPreApproval: (...args: unknown[]) => mockCancelPreApproval(...args),
}));

const mockTrackEvent = vi.fn();

vi.mock('@/lib/track-event', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(
  url = 'http://localhost:3000/api/billing/checkout',
  headers: Record<string, string> = {}
): Request {
  return new Request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  });
}

const USER = { id: 'user-1', email: 'user@test.com' };

// ---------------------------------------------------------------------------
// createCheckoutSession
// ---------------------------------------------------------------------------

describe('createCheckoutSession', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    mockCreatePreApproval.mockReset();
    mockCancelPreApproval.mockReset();
    mockTrackEvent.mockReset();
  });

  it('returns error when user has no tenant', async () => {
    supabaseMock.__queue('tenant_users', { data: [], error: null });

    const result = await createCheckoutSession(USER, { plan: 'starter' }, makeRequest());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
    }
  });

  it('returns 403 when user is a regular member (not owner/manager)', async () => {
    supabaseMock.__queue('tenant_users', {
      data: [{ tenant_id: 'tenant-1', role: 'member' }],
      error: null,
    });

    const result = await createCheckoutSession(USER, { plan: 'starter' }, makeRequest());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
    }
  });

  it('allows owner to create checkout', async () => {
    supabaseMock.__queue('tenant_users', {
      data: [{ tenant_id: 'tenant-1', role: 'owner' }],
      error: null,
    });
    supabaseMock.__queue('tenants', {
      data: { name: 'Mi Tienda', billing_email: 'billing@test.com' },
      error: null,
    });
    supabaseMock.__queue('tenants', { data: null, error: null }); // update preapproval_id

    mockCreatePreApproval.mockResolvedValue({
      id: 'preapproval-new',
      init_point: 'https://mp.com/checkout/xyz',
    });

    const result = await createCheckoutSession(USER, { plan: 'starter' }, makeRequest());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.data as Record<string, unknown>).url).toBe('https://mp.com/checkout/xyz');
    }
  });

  it('allows manager to create checkout', async () => {
    supabaseMock.__queue('tenant_users', {
      data: [{ tenant_id: 'tenant-1', role: 'manager' }],
      error: null,
    });
    supabaseMock.__queue('tenants', {
      data: { name: 'Mi Tienda', billing_email: null },
      error: null,
    });
    supabaseMock.__queue('tenants', { data: null, error: null });

    mockCreatePreApproval.mockResolvedValue({
      id: 'preapproval-new',
      init_point: 'https://mp.com/checkout/xyz',
    });

    const result = await createCheckoutSession(USER, { plan: 'starter' }, makeRequest());
    expect(result.ok).toBe(true);
  });

  it('returns 400 for invalid plan', async () => {
    supabaseMock.__queue('tenant_users', {
      data: [{ tenant_id: 'tenant-1', role: 'owner' }],
      error: null,
    });
    supabaseMock.__queue('tenants', {
      data: { name: 'Mi Tienda', billing_email: null },
      error: null,
    });

    const result = await createCheckoutSession(USER, { plan: 'nonexistent' }, makeRequest());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
    }
  });

  it('returns needsSalesContact for enterprise plan', async () => {
    supabaseMock.__queue('tenant_users', {
      data: [{ tenant_id: 'tenant-1', role: 'owner' }],
      error: null,
    });
    supabaseMock.__queue('tenants', {
      data: { name: 'Mi Tienda', billing_email: null },
      error: null,
    });

    const result = await createCheckoutSession(USER, { plan: 'enterprise' }, makeRequest());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.needsSalesContact).toBe(true);
    }
  });

  it('uses billing_email from tenant when available', async () => {
    supabaseMock.__queue('tenant_users', {
      data: [{ tenant_id: 'tenant-1', role: 'owner' }],
      error: null,
    });
    supabaseMock.__queue('tenants', {
      data: { name: 'Mi Tienda', billing_email: 'facturacion@empresa.com' },
      error: null,
    });
    supabaseMock.__queue('tenants', { data: null, error: null });

    mockCreatePreApproval.mockResolvedValue({
      id: 'pa-1',
      init_point: 'https://mp.com/checkout',
    });

    await createCheckoutSession(USER, { plan: 'starter' }, makeRequest());

    expect(mockCreatePreApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        payer_email: 'facturacion@empresa.com',
      })
    );
  });

  it('falls back to user email when tenant has no billing_email', async () => {
    supabaseMock.__queue('tenant_users', {
      data: [{ tenant_id: 'tenant-1', role: 'owner' }],
      error: null,
    });
    supabaseMock.__queue('tenants', {
      data: { name: 'Mi Tienda', billing_email: null },
      error: null,
    });
    supabaseMock.__queue('tenants', { data: null, error: null });

    mockCreatePreApproval.mockResolvedValue({
      id: 'pa-1',
      init_point: 'https://mp.com/checkout',
    });

    await createCheckoutSession(USER, { plan: 'starter' }, makeRequest());

    expect(mockCreatePreApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        payer_email: 'user@test.com',
      })
    );
  });

  it('sets external_reference as tenantId:planId', async () => {
    supabaseMock.__queue('tenant_users', {
      data: [{ tenant_id: 'tenant-abc', role: 'owner' }],
      error: null,
    });
    supabaseMock.__queue('tenants', {
      data: { name: 'Test', billing_email: null },
      error: null,
    });
    supabaseMock.__queue('tenants', { data: null, error: null });

    mockCreatePreApproval.mockResolvedValue({
      id: 'pa-1',
      init_point: 'https://mp.com/checkout',
    });

    await createCheckoutSession(USER, { plan: 'business' }, makeRequest());

    expect(mockCreatePreApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        external_reference: 'tenant-abc:business',
      })
    );
  });

  it('stores the preapproval_id in the tenant after creating checkout', async () => {
    supabaseMock.__queue('tenant_users', {
      data: [{ tenant_id: 'tenant-1', role: 'owner' }],
      error: null,
    });
    supabaseMock.__queue('tenants', {
      data: { name: 'Test', billing_email: null },
      error: null,
    });
    supabaseMock.__queue('tenants', { data: null, error: null });

    mockCreatePreApproval.mockResolvedValue({
      id: 'pa-stored',
      init_point: 'https://mp.com/checkout',
    });

    await createCheckoutSession(USER, { plan: 'starter' }, makeRequest());

    const tenantUpdate = supabaseMock.__calls.find(
      (c) => c.table === 'tenants' && c.method === 'update'
    );
    expect(tenantUpdate).toBeDefined();
    const data = tenantUpdate!.args[0] as Record<string, unknown>;
    expect(data.mercadopago_preapproval_id).toBe('pa-stored');
  });

  it('returns 502 when MercadoPago API fails', async () => {
    supabaseMock.__queue('tenant_users', {
      data: [{ tenant_id: 'tenant-1', role: 'owner' }],
      error: null,
    });
    supabaseMock.__queue('tenants', {
      data: { name: 'Test', billing_email: null },
      error: null,
    });

    mockCreatePreApproval.mockRejectedValue(new Error('MP API down'));

    const result = await createCheckoutSession(USER, { plan: 'starter' }, makeRequest());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(502);
    }
  });

  it('uses x-active-tenant-id header to select tenant', async () => {
    supabaseMock.__queue('tenant_users', {
      data: [
        { tenant_id: 'tenant-1', role: 'member' },
        { tenant_id: 'tenant-2', role: 'owner' },
      ],
      error: null,
    });
    supabaseMock.__queue('tenants', {
      data: { name: 'Sucursal 2', billing_email: null },
      error: null,
    });
    supabaseMock.__queue('tenants', { data: null, error: null });

    mockCreatePreApproval.mockResolvedValue({
      id: 'pa-1',
      init_point: 'https://mp.com/checkout',
    });

    const req = makeRequest('http://localhost:3000/api/billing/checkout', {
      'x-active-tenant-id': 'tenant-2',
    });

    const result = await createCheckoutSession(USER, { plan: 'starter' }, req);
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// cancelSubscription
// ---------------------------------------------------------------------------

describe('cancelSubscription', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    mockCreatePreApproval.mockReset();
    mockCancelPreApproval.mockReset();
    mockTrackEvent.mockReset();
  });

  it('cancels preapproval and updates tenant', async () => {
    supabaseMock.__queue('tenant_users', {
      data: [{ tenant_id: 'tenant-1', role: 'owner' }],
      error: null,
    });
    supabaseMock.__queue('tenants', {
      data: {
        mercadopago_preapproval_id: 'pa-active',
        subscription_current_period_end: '2026-11-01T00:00:00Z',
        subscription_plan: 'business',
      },
      error: null,
    });
    supabaseMock.__queue('tenants', { data: null, error: null }); // update

    mockCancelPreApproval.mockResolvedValue({});

    const result = await cancelSubscription('user-1');
    expect(result.ok).toBe(true);

    expect(mockCancelPreApproval).toHaveBeenCalledWith('pa-active');

    const tenantUpdate = supabaseMock.__calls.find(
      (c) => c.table === 'tenants' && c.method === 'update'
    );
    const data = tenantUpdate!.args[0] as Record<string, unknown>;
    expect(data.subscription_status).toBe('canceled');
    expect(data.subscription_plan).toBe('free');
    expect(data.mercadopago_preapproval_id).toBeNull();
  });

  it('returns 401 when user has no tenant', async () => {
    supabaseMock.__queue('tenant_users', { data: [], error: null });

    const result = await cancelSubscription('user-1');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
    }
  });

  it('returns 403 when user is only a member', async () => {
    supabaseMock.__queue('tenant_users', {
      data: [{ tenant_id: 'tenant-1', role: 'member' }],
      error: null,
    });

    const result = await cancelSubscription('user-1');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
    }
  });

  it('returns 400 when no active subscription', async () => {
    supabaseMock.__queue('tenant_users', {
      data: [{ tenant_id: 'tenant-1', role: 'owner' }],
      error: null,
    });
    supabaseMock.__queue('tenants', {
      data: {
        mercadopago_preapproval_id: null,
        subscription_current_period_end: null,
        subscription_plan: 'starter',
      },
      error: null,
    });

    const result = await cancelSubscription('user-1');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
    }
  });

  it('emits subscription_cancelled analytics event with source "portal"', async () => {
    supabaseMock.__queue('tenant_users', {
      data: [{ tenant_id: 'tenant-1', role: 'owner' }],
      error: null,
    });
    supabaseMock.__queue('tenants', {
      data: {
        mercadopago_preapproval_id: 'pa-1',
        subscription_current_period_end: '2026-11-01T00:00:00Z',
        subscription_plan: 'business',
      },
      error: null,
    });
    supabaseMock.__queue('tenants', { data: null, error: null });

    mockCancelPreApproval.mockResolvedValue({});

    await cancelSubscription('user-1');

    expect(mockTrackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'subscription_cancelled',
        userId: 'user-1',
        tenantId: 'tenant-1',
        metadata: expect.objectContaining({
          plan: 'business',
          source: 'portal',
        }),
      })
    );
  });

  it('preserves subscription_current_period_end on cancel', async () => {
    supabaseMock.__queue('tenant_users', {
      data: [{ tenant_id: 'tenant-1', role: 'owner' }],
      error: null,
    });
    supabaseMock.__queue('tenants', {
      data: {
        mercadopago_preapproval_id: 'pa-1',
        subscription_current_period_end: '2026-12-01T00:00:00Z',
        subscription_plan: 'starter',
      },
      error: null,
    });
    supabaseMock.__queue('tenants', { data: null, error: null });

    mockCancelPreApproval.mockResolvedValue({});

    await cancelSubscription('user-1');

    const tenantUpdate = supabaseMock.__calls.find(
      (c) => c.table === 'tenants' && c.method === 'update'
    );
    const data = tenantUpdate!.args[0] as Record<string, unknown>;
    expect(data.subscription_current_period_end).toBe('2026-12-01T00:00:00Z');
  });
});

// ---------------------------------------------------------------------------
// downgradePlan
// ---------------------------------------------------------------------------

describe('downgradePlan', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    mockCreatePreApproval.mockReset();
    mockCancelPreApproval.mockReset();
    mockTrackEvent.mockReset();
  });

  it('downgrades from business to starter', async () => {
    supabaseMock.__queue('tenant_users', {
      data: [{ tenant_id: 'tenant-1', role: 'owner' }],
      error: null,
    });
    supabaseMock.__queue('tenants', {
      data: [{
        id: 'tenant-1',
        name: 'Mi Tienda',
        billing_email: 'test@test.com',
        subscription_plan: 'business',
        subscription_status: 'active',
        mercadopago_preapproval_id: 'pa-old',
        created_at: '2026-01-01T00:00:00Z',
      }],
      error: null,
    });

    mockCancelPreApproval.mockResolvedValue({});

    // product_stock deactivation
    supabaseMock.__queue('product_stock', {
      data: Array.from({ length: 60 }, (_, i) => ({ id: `stock-${i}` })),
      error: null,
    });
    supabaseMock.__queue('product_stock', { data: null, error: null }); // deactivate

    // No extra branches to remove
    // tenant_users delete (collaborators)
    supabaseMock.__queue('tenant_users', { data: null, error: null });
    // invitations delete
    supabaseMock.__queue('invitations', { data: null, error: null });
    // tenant update (plan downgrade)
    supabaseMock.__queue('tenants', { data: null, error: null });

    // createPreApproval for new plan
    mockCreatePreApproval.mockResolvedValue({
      id: 'pa-new',
      init_point: 'https://mp.com/checkout/starter',
    });
    supabaseMock.__queue('tenants', { data: null, error: null }); // save new preapproval_id

    const result = await downgradePlan(USER, 'starter', makeRequest());
    expect(result.ok).toBe(true);

    if (result.ok) {
      const data = result.data as Record<string, unknown>;
      expect(data.plan).toBe('starter');
      expect(data.url).toBe('https://mp.com/checkout/starter');
    }

    expect(mockCancelPreApproval).toHaveBeenCalledWith('pa-old');
  });

  it('returns 400 for invalid plan', async () => {
    const result = await downgradePlan(USER, 'nonexistent' as never, makeRequest());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
    }
  });

  it('returns 401 when user has no tenant', async () => {
    supabaseMock.__queue('tenant_users', { data: [], error: null });

    const result = await downgradePlan(USER, 'starter', makeRequest());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
    }
  });

  it('returns 403 when user is not owner', async () => {
    supabaseMock.__queue('tenant_users', {
      data: [{ tenant_id: 'tenant-1', role: 'manager' }],
      error: null,
    });
    supabaseMock.__queue('tenants', {
      data: [{
        id: 'tenant-1',
        name: 'Mi Tienda',
        billing_email: null,
        subscription_plan: 'business',
        subscription_status: 'active',
        mercadopago_preapproval_id: 'pa-1',
        created_at: '2026-01-01T00:00:00Z',
      }],
      error: null,
    });

    const result = await downgradePlan(USER, 'starter', makeRequest());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
    }
  });

  it('returns 400 when trying to downgrade to same or higher plan', async () => {
    supabaseMock.__queue('tenant_users', {
      data: [{ tenant_id: 'tenant-1', role: 'owner' }],
      error: null,
    });
    supabaseMock.__queue('tenants', {
      data: [{
        id: 'tenant-1',
        name: 'Mi Tienda',
        billing_email: null,
        subscription_plan: 'starter',
        subscription_status: 'active',
        mercadopago_preapproval_id: 'pa-1',
        created_at: '2026-01-01T00:00:00Z',
      }],
      error: null,
    });

    const result = await downgradePlan(USER, 'business', makeRequest());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
    }
  });

  it('deactivates excess products when downgrading to a lower-limit plan', async () => {
    supabaseMock.__queue('tenant_users', {
      data: [{ tenant_id: 'tenant-1', role: 'owner' }],
      error: null,
    });
    supabaseMock.__queue('tenants', {
      data: [{
        id: 'tenant-1',
        name: 'Mi Tienda',
        billing_email: null,
        subscription_plan: 'business',
        subscription_status: 'active',
        mercadopago_preapproval_id: 'pa-old',
        created_at: '2026-01-01T00:00:00Z',
      }],
      error: null,
    });

    mockCancelPreApproval.mockResolvedValue({});

    // 55 products (limit is 50 for starter)
    const stocks = Array.from({ length: 55 }, (_, i) => ({ id: `stock-${i}` }));
    supabaseMock.__queue('product_stock', { data: stocks, error: null });
    supabaseMock.__queue('product_stock', { data: null, error: null }); // deactivate

    supabaseMock.__queue('tenant_users', { data: null, error: null }); // collaborators
    supabaseMock.__queue('invitations', { data: null, error: null });
    supabaseMock.__queue('tenants', { data: null, error: null }); // plan update

    mockCreatePreApproval.mockResolvedValue({
      id: 'pa-new',
      init_point: 'https://mp.com/checkout',
    });
    supabaseMock.__queue('tenants', { data: null, error: null });

    await downgradePlan(USER, 'starter', makeRequest());

    // Check that deactivation was called for the 5 excess products
    const stockUpdates = supabaseMock.__calls.filter(
      (c) => c.table === 'product_stock' && c.method === 'update'
    );
    expect(stockUpdates.length).toBeGreaterThanOrEqual(1);
    const deactivateData = stockUpdates[0]!.args[0] as Record<string, unknown>;
    expect(deactivateData.active).toBe(false);

    // Verify the .in() call with the excess stock IDs
    const inCalls = supabaseMock.__calls.filter(
      (c) => c.table === 'product_stock' && c.method === 'in'
    );
    expect(inCalls.length).toBeGreaterThanOrEqual(1);
    const deactivatedIds = inCalls[0]!.args[1] as string[];
    expect(deactivatedIds).toHaveLength(5);
    expect(deactivatedIds[0]).toBe('stock-50');
  });

  it('removes collaborators on downgrade', async () => {
    supabaseMock.__queue('tenant_users', {
      data: [{ tenant_id: 'tenant-1', role: 'owner' }],
      error: null,
    });
    supabaseMock.__queue('tenants', {
      data: [{
        id: 'tenant-1',
        name: 'Mi Tienda',
        billing_email: null,
        subscription_plan: 'business',
        subscription_status: 'active',
        mercadopago_preapproval_id: null,
        created_at: '2026-01-01T00:00:00Z',
      }],
      error: null,
    });

    // No excess products
    supabaseMock.__queue('product_stock', { data: [], error: null });
    supabaseMock.__queue('tenant_users', { data: null, error: null }); // delete collaborators
    supabaseMock.__queue('invitations', { data: null, error: null }); // delete invitations
    supabaseMock.__queue('tenants', { data: null, error: null }); // plan update

    mockCreatePreApproval.mockResolvedValue({
      id: 'pa-1',
      init_point: 'https://mp.com/checkout',
    });
    supabaseMock.__queue('tenants', { data: null, error: null });

    await downgradePlan(USER, 'starter', makeRequest());

    // Verify collaborators delete was called
    const deleteCall = supabaseMock.__calls.find(
      (c) => c.table === 'tenant_users' && c.method === 'delete'
    );
    expect(deleteCall).toBeDefined();
  });

  it('deletes pending invitations on downgrade', async () => {
    supabaseMock.__queue('tenant_users', {
      data: [{ tenant_id: 'tenant-1', role: 'owner' }],
      error: null,
    });
    supabaseMock.__queue('tenants', {
      data: [{
        id: 'tenant-1',
        name: 'Mi Tienda',
        billing_email: null,
        subscription_plan: 'business',
        subscription_status: 'active',
        mercadopago_preapproval_id: null,
        created_at: '2026-01-01T00:00:00Z',
      }],
      error: null,
    });

    supabaseMock.__queue('product_stock', { data: [], error: null });
    supabaseMock.__queue('tenant_users', { data: null, error: null });
    supabaseMock.__queue('invitations', { data: null, error: null });
    supabaseMock.__queue('tenants', { data: null, error: null });

    mockCreatePreApproval.mockResolvedValue({
      id: 'pa-1',
      init_point: 'https://mp.com/checkout',
    });
    supabaseMock.__queue('tenants', { data: null, error: null });

    await downgradePlan(USER, 'starter', makeRequest());

    const invDelete = supabaseMock.__calls.find(
      (c) => c.table === 'invitations' && c.method === 'delete'
    );
    expect(invDelete).toBeDefined();
  });

  it('creates a new preapproval for the target plan after downgrade', async () => {
    supabaseMock.__queue('tenant_users', {
      data: [{ tenant_id: 'tenant-1', role: 'owner' }],
      error: null,
    });
    supabaseMock.__queue('tenants', {
      data: [{
        id: 'tenant-1',
        name: 'Mi Tienda',
        billing_email: 'test@test.com',
        subscription_plan: 'business',
        subscription_status: 'active',
        mercadopago_preapproval_id: null,
        created_at: '2026-01-01T00:00:00Z',
      }],
      error: null,
    });

    supabaseMock.__queue('product_stock', { data: [], error: null });
    supabaseMock.__queue('tenant_users', { data: null, error: null });
    supabaseMock.__queue('invitations', { data: null, error: null });
    supabaseMock.__queue('tenants', { data: null, error: null });

    mockCreatePreApproval.mockResolvedValue({
      id: 'pa-starter',
      init_point: 'https://mp.com/checkout/starter',
    });
    supabaseMock.__queue('tenants', { data: null, error: null });

    await downgradePlan(USER, 'starter', makeRequest());

    expect(mockCreatePreApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: expect.stringContaining('Starter'),
        auto_recurring: expect.objectContaining({
          trial_period_days: 0,
        }),
      })
    );
  });

  it('succeeds even when new preapproval creation fails', async () => {
    supabaseMock.__queue('tenant_users', {
      data: [{ tenant_id: 'tenant-1', role: 'owner' }],
      error: null,
    });
    supabaseMock.__queue('tenants', {
      data: [{
        id: 'tenant-1',
        name: 'Mi Tienda',
        billing_email: null,
        subscription_plan: 'business',
        subscription_status: 'active',
        mercadopago_preapproval_id: null,
        created_at: '2026-01-01T00:00:00Z',
      }],
      error: null,
    });

    supabaseMock.__queue('product_stock', { data: [], error: null });
    supabaseMock.__queue('tenant_users', { data: null, error: null });
    supabaseMock.__queue('invitations', { data: null, error: null });
    supabaseMock.__queue('tenants', { data: null, error: null });

    mockCreatePreApproval.mockRejectedValue(new Error('MP down'));

    const result = await downgradePlan(USER, 'starter', makeRequest());
    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as Record<string, unknown>;
      expect(data.url).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// getSubscriptionStatus
// ---------------------------------------------------------------------------

describe('getSubscriptionStatus', () => {
  beforeEach(() => {
    supabaseMock.__reset();
  });

  it('returns 401 when user has no tenants', async () => {
    supabaseMock.__queue('tenant_users', { data: [], error: null });

    const result = await getSubscriptionStatus('user-1');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
    }
  });

  it('returns subscription info for active subscription', async () => {
    supabaseMock.__queue('tenant_users', {
      data: [{ tenant_id: 'tenant-1' }],
      error: null,
    });
    supabaseMock.__queue('tenants', {
      data: [{
        subscription_status: 'active',
        subscription_plan: 'business',
        subscription_current_period_end: '2026-11-01T00:00:00Z',
        created_at: '2026-01-01T00:00:00Z',
      }],
      error: null,
    });

    const result = await getSubscriptionStatus('user-1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as Record<string, unknown>;
      expect(data.plan).toBe('business');
      expect(data.status).toBe('active');
    }
  });

  it('returns default status when no subscription data', async () => {
    supabaseMock.__queue('tenant_users', {
      data: [{ tenant_id: 'tenant-1' }],
      error: null,
    });
    supabaseMock.__queue('tenants', {
      data: [{
        subscription_status: null,
        subscription_plan: null,
        subscription_current_period_end: null,
        created_at: '2026-01-01T00:00:00Z',
      }],
      error: null,
    });

    const result = await getSubscriptionStatus('user-1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as Record<string, unknown>;
      // consolidateOwnerSubscription defaults null status to 'free'
      expect(data.status).toBe('free');
    }
  });
});
