import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseMock } from '@/test/supabase-mock';
import {
  processMercadoPagoWebhook,
  resolveOwnerBranchIds,
  resolveOwnerUserId,
} from './mercadopago-webhook-service';

vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: supabaseMock,
}));

const mockGetPreApprovalById = vi.fn();

vi.mock('@/lib/mercadopago', () => ({
  getPreApprovalById: (...args: unknown[]) => mockGetPreApprovalById(...args),
}));

const mockTrackEvent = vi.fn();

vi.mock('@/lib/track-event', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}));

// El log de bitacora se difiere con `after`. En tests `after` no existe, asi
// que se encolan los callbacks y `flushAfter()` los ejecuta a demanda. Hace
// falta esperarlos explicitamente: el insert es asincrono y si se leyera la
// tabla antes de que corra, el assertion seria una carrera.
const afterCallbacks: Array<() => unknown> = [];

const mockAfter = vi.fn((cb: () => unknown) => {
  afterCallbacks.push(cb);
});

async function flushAfter() {
  while (afterCallbacks.length > 0) {
    const cb = afterCallbacks.shift()!;
    await cb();
  }
}

vi.mock('next/server', () => ({
  after: (cb: () => unknown) => mockAfter(cb),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Queue the standard owner/branch resolution responses.
 *
 * Call flow inside processMercadoPagoWebhook:
 *   1. resolveOwnerBranchIds(tenantId)
 *      └── resolveOwnerUserId(tenantId)  → tenant_users query #1
 *      └── tenant_users.select(tenant_id).eq(user_id)  → tenant_users query #2
 *   2. resolveOwnerUserId(tenantId)  → tenant_users query #3
 *
 * So we need 3 queued responses for tenant_users.
 */
function queueOwnerResolution(
  ownerUserId: string = 'owner-1',
  branchIds: string[] = ['tenant-1']
) {
  // Query #1: resolveOwnerBranchIds → inner resolveOwnerUserId
  supabaseMock.__queue('tenant_users', {
    data: { user_id: ownerUserId },
    error: null,
  });
  // Query #2: resolveOwnerBranchIds → branches
  supabaseMock.__queue('tenant_users', {
    data: branchIds.map((id) => ({ tenant_id: id })),
    error: null,
  });
  // Query #3: outer resolveOwnerUserId (for analytics)
  supabaseMock.__queue('tenant_users', {
    data: { user_id: ownerUserId },
    error: null,
  });
}

/**
 * Queue owner resolution that returns null (no owner found).
 * Used to test fallback behavior.
 */
function queueNoOwner() {
  // Query #1: resolveOwnerBranchIds → inner resolveOwnerUserId → null
  supabaseMock.__queue('tenant_users', { data: null, error: null });
  // Query #2: outer resolveOwnerUserId → null
  supabaseMock.__queue('tenant_users', { data: null, error: null });
}

/**
 * Estado final que quedo escrito en `tenants`.
 *
 * El servicio parte la escritura en DOS UPDATE a proposito: la transicion de
 * estado (que lleva el compare-and-set) y el refresco del periodo (que es nivel
 * y tiene que correr en cada renewal). Un test que mira el final del flujo ya
 * no puede leer "el ultimo update" y esperar encontrarlo todo ahi: tiene que
 * mirar el merge de los dos.
 */
function tenantsWrites(): Record<string, unknown> {
  return supabaseMock.__calls
    .filter((c) => c.table === 'tenants' && c.method === 'update')
    .reduce<Record<string, unknown>>(
      (acc, c) => ({ ...acc, ...(c.args[0] as Record<string, unknown>) }),
      {}
    );
}

function tenantUpdates() {
  return supabaseMock.__calls.filter((c) => c.table === 'tenants' && c.method === 'update');
}

// ---------------------------------------------------------------------------
// processMercadoPagoWebhook
// ---------------------------------------------------------------------------

describe('processMercadoPagoWebhook', () => {
beforeEach(() => {
    supabaseMock.__reset();
    mockGetPreApprovalById.mockReset();
    mockTrackEvent.mockReset();
    mockAfter.mockClear();
    afterCallbacks.length = 0;
  });

  // -----------------------------------------------------------------------
  // Input validation
  // -----------------------------------------------------------------------

  describe('input validation', () => {
    it('returns error when id is undefined', async () => {
      const result = await processMercadoPagoWebhook(undefined, 'subscription_preapproval');
      expect(result).toEqual({ ok: false, error: 'Missing id', status: 400 });
    });

    it('returns ok for unknown topic (no-op)', async () => {
      const result = await processMercadoPagoWebhook('id-123', 'payment');
      expect(result.ok).toBe(true);
      expect(mockGetPreApprovalById).not.toHaveBeenCalled();
    });

    it('returns error when external_reference is null', async () => {
      mockGetPreApprovalById.mockResolvedValue({
        external_reference: null,
        status: 'authorized',
      });
      const result = await processMercadoPagoWebhook('id-1', 'subscription_preapproval');
      expect(result).toEqual({ ok: false, error: 'No external reference', status: 400 });
    });

    it('returns error when external_reference is empty string', async () => {
      mockGetPreApprovalById.mockResolvedValue({
        external_reference: '',
        status: 'authorized',
      });
      const result = await processMercadoPagoWebhook('id-1', 'subscription_preapproval');
      expect(result).toEqual({ ok: false, error: 'No external reference', status: 400 });
    });

    it('handles topic "preapproval" alias', async () => {
      mockGetPreApprovalById.mockResolvedValue({
        external_reference: 'tenant-1:starter',
        status: 'authorized',
        reason: 'Suscripción Starter - Vynko',
        next_payment_date: '2026-10-01T00:00:00Z',
      });
      queueOwnerResolution();
      supabaseMock.__queue('tenants', { data: null, error: null });

      const result = await processMercadoPagoWebhook('id-1', 'preapproval');
      expect(result.ok).toBe(true);
      expect(mockGetPreApprovalById).toHaveBeenCalledWith('id-1');
    });
  });

  // -----------------------------------------------------------------------
  // Status: authorized (pago aprobado)
  // -----------------------------------------------------------------------

  describe('authorized (pago aprobado)', () => {
    it('activates subscription and sets plan from external_reference', async () => {
      mockGetPreApprovalById.mockResolvedValue({
        external_reference: 'tenant-1:business',
        status: 'authorized',
        reason: 'Suscripción Business - Vynko',
        next_payment_date: '2026-11-01T00:00:00Z',
      });
      queueOwnerResolution();
      supabaseMock.__queue('tenants', { data: null, error: null });

      const result = await processMercadoPagoWebhook('preapproval-123', 'subscription_preapproval');
      expect(result.ok).toBe(true);

      const tenantUpdate = supabaseMock.__calls.find(
        (c) => c.table === 'tenants' && c.method === 'update'
      );
      expect(tenantUpdate).toBeDefined();
      const data = tenantsWrites();
      expect(data.subscription_status).toBe('active');
      expect(data.subscription_plan).toBe('business');
      expect(data.mercadopago_preapproval_id).toBe('preapproval-123');
      expect(data.subscription_current_period_end).toBe('2026-11-01T00:00:00Z');
    });

    it('falls back to plan from reason when external_reference has no plan suffix', async () => {
      mockGetPreApprovalById.mockResolvedValue({
        external_reference: 'tenant-1',
        status: 'authorized',
        reason: 'Suscripción Starter - Vynko',
        next_payment_date: '2026-11-01T00:00:00Z',
      });
      queueOwnerResolution();
      supabaseMock.__queue('tenants', { data: null, error: null });

      await processMercadoPagoWebhook('id-1', 'subscription_preapproval');

      const tenantUpdate = supabaseMock.__calls.find(
        (c) => c.table === 'tenants' && c.method === 'update'
      );
      const data = tenantUpdate!.args[0] as Record<string, unknown>;
      expect(data.subscription_plan).toBe('starter');
    });

    it('falls back to plan from reason with "Business" keyword', async () => {
      mockGetPreApprovalById.mockResolvedValue({
        external_reference: 'tenant-1',
        status: 'authorized',
        reason: 'Suscripción Business - Vynko',
        next_payment_date: '2026-11-01T00:00:00Z',
      });
      queueOwnerResolution();
      supabaseMock.__queue('tenants', { data: null, error: null });

      await processMercadoPagoWebhook('id-1', 'subscription_preapproval');

      const tenantUpdate = supabaseMock.__calls.find(
        (c) => c.table === 'tenants' && c.method === 'update'
      );
      const data = tenantUpdate!.args[0] as Record<string, unknown>;
      expect(data.subscription_plan).toBe('business');
    });

    it('does not set plan when neither external_reference nor reason provide it', async () => {
      mockGetPreApprovalById.mockResolvedValue({
        external_reference: 'tenant-1',
        status: 'authorized',
        reason: 'Something generic',
        next_payment_date: '2026-11-01T00:00:00Z',
      });
      queueOwnerResolution();
      supabaseMock.__queue('tenants', { data: null, error: null });

      await processMercadoPagoWebhook('id-1', 'subscription_preapproval');

      const tenantUpdate = supabaseMock.__calls.find(
        (c) => c.table === 'tenants' && c.method === 'update'
      );
      const data = tenantUpdate!.args[0] as Record<string, unknown>;
      expect(data.subscription_plan).toBeUndefined();
    });

    it('reactivates product_stock when business plan authorized', async () => {
      mockGetPreApprovalById.mockResolvedValue({
        external_reference: 'tenant-1:business',
        status: 'authorized',
        reason: 'Suscripción Business - Vynko',
        next_payment_date: '2026-11-01T00:00:00Z',
      });
      queueOwnerResolution();
      supabaseMock.__queue('tenants', { data: null, error: null });

      await processMercadoPagoWebhook('id-1', 'subscription_preapproval');

      const stockUpdate = supabaseMock.__calls.find(
        (c) => c.table === 'product_stock' && c.method === 'update'
      );
      expect(stockUpdate).toBeDefined();
      expect((stockUpdate!.args[0] as Record<string, unknown>).active).toBe(true);
    });

    it('does NOT reactivate product_stock for starter plan', async () => {
      mockGetPreApprovalById.mockResolvedValue({
        external_reference: 'tenant-1:starter',
        status: 'authorized',
        reason: 'Suscripción Starter - Vynko',
        next_payment_date: '2026-11-01T00:00:00Z',
      });
      queueOwnerResolution();
      supabaseMock.__queue('tenants', { data: null, error: null });

      await processMercadoPagoWebhook('id-1', 'subscription_preapproval');

      const stockUpdate = supabaseMock.__calls.find(
        (c) => c.table === 'product_stock' && c.method === 'update'
      );
      expect(stockUpdate).toBeUndefined();
    });

    it('does not set period_end when next_payment_date is absent', async () => {
      mockGetPreApprovalById.mockResolvedValue({
        external_reference: 'tenant-1:starter',
        status: 'authorized',
        reason: 'Suscripción Starter - Vynko',
      });
      queueOwnerResolution();
      supabaseMock.__queue('tenants', { data: null, error: null });

      await processMercadoPagoWebhook('id-1', 'subscription_preapproval');

      const tenantUpdate = supabaseMock.__calls.find(
        (c) => c.table === 'tenants' && c.method === 'update'
      );
      const data = tenantUpdate!.args[0] as Record<string, unknown>;
      expect(data.subscription_current_period_end).toBeUndefined();
    });

    it('emits subscription_started analytics event', async () => {
      mockGetPreApprovalById.mockResolvedValue({
        external_reference: 'tenant-1:business',
        status: 'authorized',
        reason: 'Business',
        next_payment_date: '2026-11-01T00:00:00Z',
      });
      queueOwnerResolution('owner-99');
      supabaseMock.__queue('tenants', { data: null, error: null });

      await processMercadoPagoWebhook('preapproval-x', 'subscription_preapproval');

      expect(mockTrackEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'subscription_started',
          userId: 'owner-99',
          tenantId: 'tenant-1',
          metadata: expect.objectContaining({
            plan: 'business',
            preapproval_id: 'preapproval-x',
          }),
        })
      );
    });

    it('does NOT emit analytics when owner cannot be resolved', async () => {
      mockGetPreApprovalById.mockResolvedValue({
        external_reference: 'tenant-1:starter',
        status: 'authorized',
        reason: 'Starter',
        next_payment_date: '2026-11-01T00:00:00Z',
      });
      queueNoOwner();
      supabaseMock.__queue('tenants', { data: null, error: null });

      await processMercadoPagoWebhook('id-1', 'subscription_preapproval');
      expect(mockTrackEvent).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Status: cancelled (pago cancelado)
  // -----------------------------------------------------------------------

  describe('cancelled (pago cancelado)', () => {
    it('sets subscription_status to canceled and downgrades business to free', async () => {
      mockGetPreApprovalById.mockResolvedValue({
        external_reference: 'tenant-1',
        status: 'cancelled',
      });
      queueOwnerResolution();
      // Query for current plan
      supabaseMock.__queue('tenants', {
        data: { subscription_plan: 'business', mercadopago_preapproval_id: 'preapproval-123' },
        error: null,
      });
      // Update
      supabaseMock.__queue('tenants', { data: null, error: null });

      const result = await processMercadoPagoWebhook('preapproval-123', 'subscription_preapproval');
      expect(result.ok).toBe(true);

      const tenantUpdate = supabaseMock.__calls.find(
        (c) => c.table === 'tenants' && c.method === 'update'
      );
      const data = tenantUpdate!.args[0] as Record<string, unknown>;
      expect(data.subscription_status).toBe('canceled');
      expect(data.subscription_plan).toBe('free');
      expect(data.mercadopago_preapproval_id).toBeNull();
    });

    it('downgrades enterprise to free on cancellation', async () => {
      mockGetPreApprovalById.mockResolvedValue({
        external_reference: 'tenant-1',
        status: 'cancelled',
      });
      queueOwnerResolution();
      supabaseMock.__queue('tenants', {
        data: { subscription_plan: 'enterprise', mercadopago_preapproval_id: 'pa-1' },
        error: null,
      });
      supabaseMock.__queue('tenants', { data: null, error: null });

      await processMercadoPagoWebhook('pa-1', 'subscription_preapproval');

      const tenantUpdate = supabaseMock.__calls.find(
        (c) => c.table === 'tenants' && c.method === 'update'
      );
      const data = tenantUpdate!.args[0] as Record<string, unknown>;
      expect(data.subscription_plan).toBe('free');
    });

    it('keeps starter plan on cancellation (not business/enterprise)', async () => {
      mockGetPreApprovalById.mockResolvedValue({
        external_reference: 'tenant-1',
        status: 'cancelled',
      });
      queueOwnerResolution();
      supabaseMock.__queue('tenants', {
        data: { subscription_plan: 'starter', mercadopago_preapproval_id: 'pa-1' },
        error: null,
      });
      supabaseMock.__queue('tenants', { data: null, error: null });

      await processMercadoPagoWebhook('pa-1', 'subscription_preapproval');

      const tenantUpdate = supabaseMock.__calls.find(
        (c) => c.table === 'tenants' && c.method === 'update'
      );
      const data = tenantUpdate!.args[0] as Record<string, unknown>;
      expect(data.subscription_plan).toBe('starter');
    });

    it('ignores a cancellation webhook for a subscription that is no longer current', async () => {
      // Webhook fuera de orden: llega la cancelacion de `old-preapproval`
      // DESPUES de que el owner se resuscribio con `new-preapproval`, que es la
      // que esta vigente y pagandose.
      //
      // Antes el servicio.cancelaba igual y solo se abstenia de limpiar el
      // preapproval_id: el tenant quedaba 'canceled' con una suscripcion
      // activa. Perder el evento obsoleto es mucho mas barato que cancelar un
      // pago vivo.
      mockGetPreApprovalById.mockResolvedValue({
        external_reference: 'tenant-1',
        status: 'cancelled',
      });
      queueOwnerResolution('owner-1');
      supabaseMock.__queue('tenants', {
        data: {
          subscription_plan: 'starter',
          mercadopago_preapproval_id: 'new-preapproval',
        },
        error: null,
      });

      const result = await processMercadoPagoWebhook('old-preapproval', 'subscription_preapproval');

      // 200 sin tocar nada: MP no debe reintentar un evento que ya no importa.
      expect(result).toEqual({ ok: true, data: { received: true } });
      expect(tenantUpdates()).toHaveLength(0);
      expect(mockTrackEvent).not.toHaveBeenCalled();
    });

    it('clears preapproval_id when the cancellation matches the current subscription', async () => {
      mockGetPreApprovalById.mockResolvedValue({
        external_reference: 'tenant-1',
        status: 'cancelled',
      });
      queueOwnerResolution('owner-1');
      supabaseMock.__queue('tenants', {
        data: { subscription_plan: 'business', mercadopago_preapproval_id: 'pa-c' },
        error: null,
      });
      supabaseMock.__queue('tenants', { data: [{ id: 'tenant-1' }], error: null });

      await processMercadoPagoWebhook('pa-c', 'subscription_preapproval');

      const data = tenantsWrites();
      expect(data.mercadopago_preapproval_id).toBeNull();
      expect(data.subscription_status).toBe('canceled');
    });

    it('emits subscription_cancelled event with the PREVIOUS plan', async () => {
      mockGetPreApprovalById.mockResolvedValue({
        external_reference: 'tenant-1',
        status: 'cancelled',
      });
      queueOwnerResolution('owner-5');
      supabaseMock.__queue('tenants', {
        data: { subscription_plan: 'business', mercadopago_preapproval_id: 'pa-1' },
        error: null,
      });
      supabaseMock.__queue('tenants', { data: null, error: null });

      await processMercadoPagoWebhook('pa-1', 'subscription_preapproval');

      expect(mockTrackEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'subscription_cancelled',
          userId: 'owner-5',
          tenantId: 'tenant-1',
          metadata: expect.objectContaining({
            plan: 'business',
            source: 'webhook',
          }),
        })
      );
    });
  });

  // -----------------------------------------------------------------------
  // Status: paused (pago rechazado / reintentos)
  // -----------------------------------------------------------------------

  describe('paused (pago rechazado)', () => {
    it('marks subscription as past_due', async () => {
      mockGetPreApprovalById.mockResolvedValue({
        external_reference: 'tenant-1',
        status: 'paused',
      });
      queueOwnerResolution();
      supabaseMock.__queue('tenants', { data: null, error: null });

      const result = await processMercadoPagoWebhook('pa-1', 'subscription_preapproval');
      expect(result.ok).toBe(true);

      const tenantUpdate = supabaseMock.__calls.find(
        (c) => c.table === 'tenants' && c.method === 'update'
      );
      const data = tenantUpdate!.args[0] as Record<string, unknown>;
      expect(data.subscription_status).toBe('past_due');
    });
  });

  // -----------------------------------------------------------------------
  // Status: pending
  // -----------------------------------------------------------------------

  describe('pending (esperando primer pago)', () => {
    it('does nothing for pending status', async () => {
      mockGetPreApprovalById.mockResolvedValue({
        external_reference: 'tenant-1',
        status: 'pending',
      });
      // Even with pending, resolveOwnerBranchIds and resolveOwnerUserId are called
      queueOwnerResolution();

      const result = await processMercadoPagoWebhook('pa-1', 'subscription_preapproval');
      expect(result.ok).toBe(true);

      const tenantUpdate = supabaseMock.__calls.find(
        (c) => c.table === 'tenants' && c.method === 'update'
      );
      expect(tenantUpdate).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Multi-branch propagation
  // -----------------------------------------------------------------------

  describe('multi-branch propagation', () => {
    it('propagates authorized status to all owner branches', async () => {
      mockGetPreApprovalById.mockResolvedValue({
        external_reference: 'tenant-1:business',
        status: 'authorized',
        reason: 'Business',
        next_payment_date: '2026-11-01T00:00:00Z',
      });
      queueOwnerResolution('owner-1', ['tenant-1', 'tenant-2', 'tenant-3']);
      supabaseMock.__queue('tenants', { data: null, error: null });

      await processMercadoPagoWebhook('pa-1', 'subscription_preapproval');

      const inCall = supabaseMock.__calls.find(
        (c) => c.table === 'tenants' && c.method === 'in'
      );
      expect(inCall).toBeDefined();
      expect(inCall!.args[1]).toEqual(['tenant-1', 'tenant-2', 'tenant-3']);
    });

    it('propagates cancelled status to all owner branches', async () => {
      mockGetPreApprovalById.mockResolvedValue({
        external_reference: 'tenant-1',
        status: 'cancelled',
      });
      queueOwnerResolution('owner-1', ['tenant-1', 'tenant-2']);
      supabaseMock.__queue('tenants', {
        data: { subscription_plan: 'business', mercadopago_preapproval_id: 'pa-1' },
        error: null,
      });
      supabaseMock.__queue('tenants', { data: null, error: null });

      await processMercadoPagoWebhook('pa-1', 'subscription_preapproval');

      // For cancelled, the .in() call is the second one (first is the select to get current plan)
      const inCalls = supabaseMock.__calls.filter(
        (c) => c.table === 'tenants' && c.method === 'in'
      );
      const lastInCall = inCalls[inCalls.length - 1];
      expect(lastInCall).toBeDefined();
      expect(lastInCall!.args[1]).toEqual(['tenant-1', 'tenant-2']);
    });

    it('propagates paused status to all owner branches', async () => {
      mockGetPreApprovalById.mockResolvedValue({
        external_reference: 'tenant-1',
        status: 'paused',
      });
      queueOwnerResolution('owner-1', ['tenant-1', 'tenant-2']);
      supabaseMock.__queue('tenants', { data: null, error: null });

      await processMercadoPagoWebhook('pa-1', 'subscription_preapproval');

      const inCall = supabaseMock.__calls.find(
        (c) => c.table === 'tenants' && c.method === 'in'
      );
      expect(inCall).toBeDefined();
      expect(inCall!.args[1]).toEqual(['tenant-1', 'tenant-2']);
    });

    it('falls back to single tenant when owner resolution fails', async () => {
      mockGetPreApprovalById.mockResolvedValue({
        external_reference: 'tenant-1:starter',
        status: 'authorized',
        reason: 'Starter',
        next_payment_date: '2026-11-01T00:00:00Z',
      });
      queueNoOwner();
      supabaseMock.__queue('tenants', { data: null, error: null });

      await processMercadoPagoWebhook('pa-1', 'subscription_preapproval');

      const inCall = supabaseMock.__calls.find(
        (c) => c.table === 'tenants' && c.method === 'in'
      );
      expect(inCall).toBeDefined();
      // Falls back to [tenantId]
      expect(inCall!.args[1]).toEqual(['tenant-1']);
    });
  });

  // -----------------------------------------------------------------------
  // Error resilience
  // -----------------------------------------------------------------------

  describe('reintentos de MercadoPago', () => {
    // Antes estos dos tests afirmaban `ok:true` y el nombre del bloque era
    // "error resilience". Eso fijaba como correcto el fallo silencioso: con 200
    // MercadoPago da el evento por procesado y NO reintenta, asi que un fallo
    // transitorio de red o de API se perdia para siempre. El nombre ahora
    // describe el requisito (que MP pueda reintentar) y la asercion es el 500.
    it('returns 500 so MercadoPago retries when getPreApprovalById throws', async () => {
      mockGetPreApprovalById.mockRejectedValue(new Error('MP API timeout'));

      const result = await processMercadoPagoWebhook('pa-1', 'subscription_preapproval');

      expect(result).toEqual({ ok: false, error: 'Webhook processing failed', status: 500 });
    });

    it('returns 500 when the tenants update fails, instead of losing the payment', async () => {
      mockGetPreApprovalById.mockResolvedValue({
        external_reference: 'tenant-1:starter',
        status: 'authorized',
        reason: 'Starter',
        next_payment_date: '2026-11-01T00:00:00Z',
      });
      queueOwnerResolution();
      supabaseMock.__queue('tenants', { data: null, error: { message: 'DB error' } });

      const result = await processMercadoPagoWebhook('pa-1', 'subscription_preapproval');

      expect(result).toEqual({ ok: false, error: 'Webhook processing failed', status: 500 });
    });

    it('does not emit analytics when the activation write failed', async () => {
      mockGetPreApprovalById.mockResolvedValue({
        external_reference: 'tenant-1:starter',
        status: 'authorized',
        reason: 'Starter',
        next_payment_date: '2026-11-01T00:00:00Z',
      });
      queueOwnerResolution('owner-1');
      supabaseMock.__queue('tenants', { data: null, error: { message: 'DB error' } });

      await processMercadoPagoWebhook('pa-1', 'subscription_preapproval');

      // Un pago que no se activo no puede contar como "empezo a pagar": si MP
      // reintenta y esta vez funciona, recien ahi se emite.
      expect(mockTrackEvent).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Idempotencia
  //
  // No hay tabla de eventos procesados. La idempotencia sale de que las
  // escrituras de estado sean compare-and-set (`.neq(...)` DENTRO del WHERE):
  // la segunda entrega del mismo evento no matchea la fila y Postgres devuelve
  // un array vacio. Es lo que permite que dos entregas simultaneas del mismo
  // webhook no cuenten dos.
  // -----------------------------------------------------------------------

  describe('idempotencia', () => {
    const authorizedPreapproval = {
      external_reference: 'tenant-1:business',
      status: 'authorized',
      reason: 'Business',
      next_payment_date: '2026-11-01T00:00:00Z',
    };

    /**
     * El mock NO evalua el predicado `neq` (solo aplica eq/in/is cuando
     * `__setTenantAware` esta encendido), asi que limitarse a encolar `data: []`
     * para simular "no matcheo" probaria la rama del `if`, no el WHERE. Sin
     * esto, borrar el `.neq` del servicio dejaria la suite en verde y la
     * idempotencia volveria a no existir sin que nadie se entere. Por eso la
     * garantia se afirma sobre el predicado emitido.
     */
    function expectTransitionGuardedBy(expectedPreviousStatus: string) {
      const neqCalls = supabaseMock.__calls.filter((c) => c.method === 'neq');
      expect(neqCalls.map((c) => c.args)).toContainEqual([
        'subscription_status',
        expectedPreviousStatus,
      ]);
    }

    it('guards the activation update with a compare-and-set on the previous status', async () => {
      mockGetPreApprovalById.mockResolvedValue(authorizedPreapproval);
      queueOwnerResolution('owner-1');
      supabaseMock.__queue('tenants', { data: [{ id: 'tenant-1' }], error: null });

      await processMercadoPagoWebhook('pa-cas', 'subscription_preapproval');

      // `.neq('subscription_status','active')` DENTRO del WHERE es lo que hace
      // que la segunda entrega no matchee. Si esto desaparece, cada reenvio
      // vuelve a emitir `subscription_started`.
      expectTransitionGuardedBy('active');
    });

    it('guards the cancellation update with a compare-and-set on the previous status', async () => {
      mockGetPreApprovalById.mockResolvedValue({
        external_reference: 'tenant-1',
        status: 'cancelled',
      });
      queueOwnerResolution('owner-1');
      supabaseMock.__queue('tenants', {
        data: { subscription_plan: 'business', mercadopago_preapproval_id: 'pa-c' },
        error: null,
      });
      supabaseMock.__queue('tenants', { data: [{ id: 'tenant-1' }], error: null });

      await processMercadoPagoWebhook('pa-c', 'subscription_preapproval');

      expectTransitionGuardedBy('canceled');
    });

    it('processes the same authorized webhook twice', async () => {
      mockGetPreApprovalById.mockResolvedValue(authorizedPreapproval);
      queueOwnerResolution();
      supabaseMock.__queue('tenants', { data: null, error: null });

      await processMercadoPagoWebhook('pa-same', 'subscription_preapproval');
      await processMercadoPagoWebhook('pa-same', 'subscription_preapproval');

      // Ambas entregas terminan en el mismo estado final...
      const data = tenantsWrites();
      expect(data.subscription_status).toBe('active');
      expect(data.subscription_plan).toBe('business');
      expect(data.mercadopago_preapproval_id).toBe('pa-same');
    });

    it('does NOT emit subscription_started twice for a repeated webhook', async () => {
      mockGetPreApprovalById.mockResolvedValue(authorizedPreapproval);

      // Primera entrega: la rama no estaba activa, asi que el UPDATE con
      // `.neq(subscription_status,'active')` matchea y devuelve filas.
      queueOwnerResolution('owner-1');
      supabaseMock.__queue('tenants', { data: [{ id: 'tenant-1' }], error: null });
      await processMercadoPagoWebhook('pa-dup', 'subscription_preapproval');

      expect(mockTrackEvent).toHaveBeenCalledTimes(1);
      expect(mockTrackEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'subscription_started' })
      );

      // Segunda entrega del MISMO evento: la fila ya quedo 'active', el WHERE no
      // matchea y PostgREST devuelve `[]`. Esa es la senal de no emitir.
      queueOwnerResolution('owner-1');
      supabaseMock.__queue('tenants', { data: [], error: null });
      await processMercadoPagoWebhook('pa-dup', 'subscription_preapproval');

      expect(mockTrackEvent).toHaveBeenCalledTimes(1);
    });

    it('does NOT emit subscription_cancelled twice for a repeated cancellation', async () => {
      mockGetPreApprovalById.mockResolvedValue({
        external_reference: 'tenant-1',
        status: 'cancelled',
      });

      queueOwnerResolution('owner-1');
      supabaseMock.__queue('tenants', {
        data: { subscription_plan: 'business', mercadopago_preapproval_id: 'pa-c' },
        error: null,
      });
      supabaseMock.__queue('tenants', { data: [{ id: 'tenant-1' }], error: null });
      await processMercadoPagoWebhook('pa-c', 'subscription_preapproval');
      expect(mockTrackEvent).toHaveBeenCalledTimes(1);

      // Reenvio: ya estaba 'canceled'.
      queueOwnerResolution('owner-1');
      supabaseMock.__queue('tenants', {
        data: { subscription_plan: 'free', mercadopago_preapproval_id: null },
        error: null,
      });
      supabaseMock.__queue('tenants', { data: [], error: null });
      await processMercadoPagoWebhook('pa-c', 'subscription_preapproval');

      expect(mockTrackEvent).toHaveBeenCalledTimes(1);
    });

    it('does NOT count a monthly renewal as a new subscription', async () => {
      // MP reenvia `authorized` en cada cobro. La rama ya esta 'active', asi que
      // el compare-and-set no matchea y el embudo NO ve un segundo "Empezo a
      // pagar". Esto era el bug: antes cada renewal reemitia el evento.
      mockGetPreApprovalById.mockResolvedValue(authorizedPreapproval);

      queueOwnerResolution('owner-1');
      supabaseMock.__queue('tenants', { data: [{ id: 'tenant-1' }], error: null });
      await processMercadoPagoWebhook('pa-renew', 'subscription_preapproval');
      expect(mockTrackEvent).toHaveBeenCalledTimes(1);

      // Renewal del mes siguiente: la fila ya estaba activa.
      mockGetPreApprovalById.mockResolvedValue({
        ...authorizedPreapproval,
        next_payment_date: '2026-12-01T00:00:00Z',
      });
      queueOwnerResolution('owner-1');
      supabaseMock.__queue('tenants', { data: [], error: null });
      await processMercadoPagoWebhook('pa-renew', 'subscription_preapproval');

      expect(mockTrackEvent).toHaveBeenCalledTimes(1);
    });

    it('still advances the billing period on a renewal, even with no transition', async () => {
      // El periodo es nivel, no arista: aunque no haya transicion, el renewal
      // tiene que mover `subscription_current_period_end` o el gate de acceso
      // creeria que la suscripcion vencio.
      mockGetPreApprovalById.mockResolvedValue(authorizedPreapproval);

      queueOwnerResolution('owner-1');
      supabaseMock.__queue('tenants', { data: [{ id: 'tenant-1' }], error: null });
      await processMercadoPagoWebhook('pa-renew', 'subscription_preapproval');

      mockGetPreApprovalById.mockResolvedValue({
        ...authorizedPreapproval,
        next_payment_date: '2026-12-01T00:00:00Z',
      });
      queueOwnerResolution('owner-1');
      supabaseMock.__queue('tenants', { data: [], error: null });
      await processMercadoPagoWebhook('pa-renew', 'subscription_preapproval');

      const data = tenantsWrites();
      expect(data.subscription_current_period_end).toBe('2026-12-01T00:00:00Z');
    });

    it('does NOT reactivate product_stock on a renewal', async () => {
      // Reencender stock en cada renewal volveria a activar productos que el
      // usuario apago a proposito entre cobros.
      mockGetPreApprovalById.mockResolvedValue(authorizedPreapproval);

      queueOwnerResolution('owner-1');
      supabaseMock.__queue('tenants', { data: [{ id: 'tenant-1' }], error: null });
      await processMercadoPagoWebhook('pa-renew', 'subscription_preapproval');
      expect(
        supabaseMock.__calls.filter((c) => c.table === 'product_stock' && c.method === 'update')
      ).toHaveLength(1);

      queueOwnerResolution('owner-1');
      supabaseMock.__queue('tenants', { data: [], error: null });
      await processMercadoPagoWebhook('pa-renew', 'subscription_preapproval');

      expect(
        supabaseMock.__calls.filter((c) => c.table === 'product_stock' && c.method === 'update')
      ).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // Upgrade con la rama ya activa
  // -----------------------------------------------------------------------

  describe('upgrade con la rama ya activa', () => {
    // Un UPDATE a la rama que ya estaba activa que NO lleva subscription_status:
    // es la escritura de plan que hace la correccion (un intento de transicion
    // trae los dos campos juntos).
    const planWriteCalls = () =>
      tenantUpdates().filter(
        (c) =>
          (c.args[0] as Record<string, unknown>).subscription_plan &&
          !(c.args[0] as Record<string, unknown>).subscription_status
      );

    const upgradeAuthorized = {
      external_reference: 'tenant-1:business',
      status: 'authorized',
      reason: 'Business',
    };

    it('aplica el plan nuevo cuando la rama ya estaba activa', async () => {
      // El checkout de upgrade no cambia `subscription_status`, asi que el
      // CAS de la transicion no matchea y el plan quedaba sin escribir (bug:
      // el pago se cobraba con el plan viejo).
      mockGetPreApprovalById.mockResolvedValue(upgradeAuthorized);
      queueOwnerResolution();
      supabaseMock.__queue('tenants', { data: [], error: null });
      supabaseMock.__queue('tenants', {
        data: { mercadopago_preapproval_id: 'pa-up', subscription_plan: 'starter' },
        error: null,
      });

      const result = await processMercadoPagoWebhook('pa-up', 'subscription_preapproval');

      expect(result.ok).toBe(true);
      expect(planWriteCalls()).toHaveLength(1);
      expect(planWriteCalls()[0].args[0]).toMatchObject({ subscription_plan: 'business' });
    });

    it('no toca el plan cuando el evento es de una suscripcion que ya no es la vigente', async () => {
      // El preapproval viejo (el upgrade no cancela al anterior) sigue activo en
      // MercadoPago y renueva cada mes. Sin esta guarda, esa renovacion
      // reescribiria el plan recien pagado y el tenant bajaria de plan solo.
      mockGetPreApprovalById.mockResolvedValue(upgradeAuthorized);
      queueOwnerResolution();
      supabaseMock.__queue('tenants', { data: [], error: null });
      supabaseMock.__queue('tenants', {
        data: { mercadopago_preapproval_id: 'pa-vigente', subscription_plan: 'business' },
        error: null,
      });

      const result = await processMercadoPagoWebhook('pa-viejo', 'subscription_preapproval');

      expect(result).toEqual({ ok: true, data: { received: true } });
      expect(planWriteCalls()).toHaveLength(0);
      // Tampoco deberia refrescar el periodo ni re-vincular el preapproval viejo.
      expect(
        supabaseMock.__calls.filter((c) => c.table === 'tenants' && c.method === 'update')
      ).toHaveLength(1);
    });

    it('no reescribe el plan en un renewal si la rama ya lo tiene', async () => {
      mockGetPreApprovalById.mockResolvedValue(upgradeAuthorized);
      queueOwnerResolution();
      supabaseMock.__queue('tenants', { data: [], error: null });
      supabaseMock.__queue('tenants', {
        data: { mercadopago_preapproval_id: 'pa-renew', subscription_plan: 'business' },
        error: null,
      });

      await processMercadoPagoWebhook('pa-renew', 'subscription_preapproval');

      expect(planWriteCalls()).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Webhook fuera de orden
  // -----------------------------------------------------------------------

  describe('webhook fuera de orden', () => {
    it('processes authorized after cancelled (re-subscription)', async () => {
      // First: cancelled
      mockGetPreApprovalById.mockResolvedValue({
        external_reference: 'tenant-1',
        status: 'cancelled',
      });
      queueOwnerResolution();
      supabaseMock.__queue('tenants', {
        data: { subscription_plan: 'business', mercadopago_preapproval_id: 'pa-old' },
        error: null,
      });
      supabaseMock.__queue('tenants', { data: null, error: null });
      await processMercadoPagoWebhook('pa-old', 'subscription_preapproval');

      // Second: new authorized (re-subscription with new preapproval)
      mockGetPreApprovalById.mockResolvedValue({
        external_reference: 'tenant-1:starter',
        status: 'authorized',
        reason: 'Starter',
        next_payment_date: '2026-12-01T00:00:00Z',
      });
      queueOwnerResolution();
      supabaseMock.__queue('tenants', { data: null, error: null });
      const result = await processMercadoPagoWebhook('pa-new', 'subscription_preapproval');
      expect(result.ok).toBe(true);

      // Verify the final write is the authorized one
      const data = tenantsWrites();
      expect(data.subscription_status).toBe('active');
      expect(data.mercadopago_preapproval_id).toBe('pa-new');
    });
  });

  // -----------------------------------------------------------------------
  // external_reference parsing
  // -----------------------------------------------------------------------

  describe('external_reference parsing', () => {
    it('extracts tenantId and plan from "tenantId:plan" format', async () => {
      mockGetPreApprovalById.mockResolvedValue({
        external_reference: 'abc-123:business',
        status: 'authorized',
        reason: '',
        next_payment_date: '2026-11-01T00:00:00Z',
      });
      queueOwnerResolution();
      supabaseMock.__queue('tenants', { data: null, error: null });

      await processMercadoPagoWebhook('pa-1', 'subscription_preapproval');

      const tenantUpdate = supabaseMock.__calls.find(
        (c) => c.table === 'tenants' && c.method === 'update'
      );
      const data = tenantUpdate!.args[0] as Record<string, unknown>;
      expect(data.subscription_plan).toBe('business');
    });

    it('ignores invalid plan in external_reference', async () => {
      mockGetPreApprovalById.mockResolvedValue({
        external_reference: 'abc-123:invalidplan',
        status: 'authorized',
        reason: '',
        next_payment_date: '2026-11-01T00:00:00Z',
      });
      queueOwnerResolution();
      supabaseMock.__queue('tenants', { data: null, error: null });

      await processMercadoPagoWebhook('pa-1', 'subscription_preapproval');

      const tenantUpdate = supabaseMock.__calls.find(
        (c) => c.table === 'tenants' && c.method === 'update'
      );
      const data = tenantUpdate!.args[0] as Record<string, unknown>;
      // Invalid plan not set; and reason is empty so no plan
      expect(data.subscription_plan).toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// resolveOwnerBranchIds
// ---------------------------------------------------------------------------

describe('resolveOwnerBranchIds', () => {
  beforeEach(() => {
    supabaseMock.__reset();
  });

  it('returns all branch tenant IDs for the owner', async () => {
    supabaseMock.__queue('tenant_users', { data: { user_id: 'owner-1' }, error: null });
    supabaseMock.__queue('tenant_users', {
      data: [{ tenant_id: 't-1' }, { tenant_id: 't-2' }],
      error: null,
    });

    const ids = await resolveOwnerBranchIds('t-1');
    expect(ids).toEqual(['t-1', 't-2']);
  });

  it('returns fallback when owner cannot be resolved', async () => {
    supabaseMock.__queue('tenant_users', { data: null, error: null });

    const ids = await resolveOwnerBranchIds('t-1');
    expect(ids).toEqual(['t-1']);
  });

  it('returns fallback when branches query returns empty', async () => {
    supabaseMock.__queue('tenant_users', { data: { user_id: 'owner-1' }, error: null });
    supabaseMock.__queue('tenant_users', { data: [], error: null });

    const ids = await resolveOwnerBranchIds('t-1');
    expect(ids).toEqual(['t-1']);
  });

  it('returns custom fallback when provided', async () => {
    supabaseMock.__queue('tenant_users', { data: null, error: null });

    const ids = await resolveOwnerBranchIds('t-1', ['fallback-1', 'fallback-2']);
    expect(ids).toEqual(['fallback-1', 'fallback-2']);
  });
});

// ---------------------------------------------------------------------------
// resolveOwnerUserId
// ---------------------------------------------------------------------------

describe('resolveOwnerUserId', () => {
  beforeEach(() => {
    supabaseMock.__reset();
  });

  it('returns the owner user_id', async () => {
    supabaseMock.__queue('tenant_users', { data: { user_id: 'user-xyz' }, error: null });
    const id = await resolveOwnerUserId('tenant-1');
    expect(id).toBe('user-xyz');
  });

  it('returns null when no owner found', async () => {
    supabaseMock.__queue('tenant_users', { data: null, error: null });
    const id = await resolveOwnerUserId('tenant-1');
    expect(id).toBeNull();
  });

  it('returns null on error (never throws)', async () => {
    // Force an error by not queuing anything - the mock returns { data: null }
    const id = await resolveOwnerUserId('tenant-1');
    expect(id).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Audit log (webhook_events)
// ---------------------------------------------------------------------------

describe('bitacora de webhooks', () => {
  const auditRow = () => {
    const insert = supabaseMock.__calls.find(
      (c) => c.table === 'webhook_events' && c.method === 'insert'
    );
    return insert?.args[0] as Record<string, unknown> | undefined;
  };

  beforeEach(() => {
    // Este describe esta fuera del que tiene el reset global, asi que necesita
    // su propio: sin el, `__calls` acumula y cada test lee la fila del primero.
    supabaseMock.__reset();
    mockGetPreApprovalById.mockReset();
    mockTrackEvent.mockReset();
    mockAfter.mockClear();
    afterCallbacks.length = 0;
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('logs a first activation as processed', async () => {
    mockGetPreApprovalById.mockResolvedValue({
      external_reference: 'tenant-1:business',
      status: 'authorized',
    });
    queueOwnerResolution();
    supabaseMock.__queue('tenants', { data: [{ id: 'tenant-1' }], error: null });
    supabaseMock.__queue('tenants', { error: null });
    supabaseMock.__queue('product_stock', { error: null });

    await processMercadoPagoWebhook('pa-1', 'subscription_preapproval');

    await flushAfter();

    const row = auditRow();
    expect(row).toMatchObject({
      provider: 'mercadopago',
      provider_event_id: 'pa-1',
      topic: 'subscription_preapproval',
      mp_status: 'authorized',
      outcome: 'processed',
      tenant_id: 'tenant-1',
      user_id: 'owner-1',
      error: null,
    });
  });

  it('logs a repeat delivery as duplicate, not as a new activation', async () => {
    // El caso que hace util la bitacora: sin `outcome`, un renewal legitimo se
    // veria igual que un webhook reenviado por error. La rama ya esta activa con
    // el mismo plan, asi que la transicion no matchea y la lectura del tenant
    // no encuentra un plan que aplicar.
    mockGetPreApprovalById.mockResolvedValue({
      external_reference: 'tenant-1:business',
      status: 'authorized',
    });
    queueOwnerResolution();
    supabaseMock.__queue('tenants', { data: [], error: null });
    supabaseMock.__queue('tenants', {
      data: { mercadopago_preapproval_id: 'pa-1', subscription_plan: 'business' },
      error: null,
    });

    await processMercadoPagoWebhook('pa-1', 'subscription_preapproval');

    await flushAfter();

    expect(auditRow()).toMatchObject({ outcome: 'duplicate', mp_status: 'authorized' });
  });

  it('logs a cancellation as processed', async () => {
    mockGetPreApprovalById.mockResolvedValue({
      external_reference: 'tenant-1',
      status: 'cancelled',
    });
    queueOwnerResolution();
    supabaseMock.__queue('tenants', {
      data: { subscription_plan: 'business', mercadopago_preapproval_id: 'pa-1' },
      error: null,
    });
    supabaseMock.__queue('tenants', { data: [{ id: 'tenant-1' }], error: null });

    await processMercadoPagoWebhook('pa-1', 'subscription_preapproval');

    await flushAfter();

    expect(auditRow()).toMatchObject({ outcome: 'processed', mp_status: 'cancelled' });
  });

  it('logs a stale cancellation as ignored', async () => {
    mockGetPreApprovalById.mockResolvedValue({
      external_reference: 'tenant-1',
      status: 'cancelled',
    });
    queueOwnerResolution();
    supabaseMock.__queue('tenants', {
      data: { subscription_plan: 'business', mercadopago_preapproval_id: 'pa-OTHER' },
      error: null,
    });

    const result = await processMercadoPagoWebhook('pa-1', 'subscription_preapproval');

    await flushAfter();

    expect(result.ok).toBe(true);
    expect(auditRow()).toMatchObject({
      outcome: 'ignored',
      error: expect.stringContaining('vigente'),
    });
  });

  it('logs a pending subscription as ignored', async () => {
    mockGetPreApprovalById.mockResolvedValue({
      external_reference: 'tenant-1',
      status: 'pending',
    });
    queueOwnerResolution();

    await processMercadoPagoWebhook('pa-1', 'subscription_preapproval');

    await flushAfter();

    expect(auditRow()).toMatchObject({ outcome: 'ignored', mp_status: 'pending' });
  });

  it('logs an unrelated topic as ignored', async () => {
    await processMercadoPagoWebhook('x-1', 'payment');

    await flushAfter();

    expect(auditRow()).toMatchObject({ outcome: 'ignored', topic: 'payment' });
  });

  it('logs a processing failure with its reason', async () => {
    mockGetPreApprovalById.mockRejectedValue(new Error('MP API 500'));
    queueOwnerResolution();

    const result = await processMercadoPagoWebhook('pa-1', 'subscription_preapproval');

    await flushAfter();

    expect(result).toEqual({ ok: false, error: 'Webhook processing failed', status: 500 });
    expect(auditRow()).toMatchObject({ outcome: 'error', error: 'MP API 500' });
  });

  it('logs a payload without external reference as an error', async () => {
    mockGetPreApprovalById.mockResolvedValue({ external_reference: null, status: 'authorized' });

    const result = await processMercadoPagoWebhook('pa-1', 'subscription_preapproval');

    await flushAfter();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
    expect(auditRow()).toMatchObject({ outcome: 'error', error: 'No external reference' });
  });

  it('defers the write so it does not block the response', async () => {
    mockGetPreApprovalById.mockResolvedValue({
      external_reference: 'tenant-1',
      status: 'pending',
    });
    queueOwnerResolution();

    await processMercadoPagoWebhook('pa-1', 'subscription_preapproval');

    await flushAfter();

    expect(mockAfter).toHaveBeenCalledTimes(1);
  });

  it('still answers ok when the audit write fails', async () => {
    // La bitacora nunca debe decidir la respuesta: un 500 por no poder loguear
    // hace que MercadoPago reintente un evento que ya se proceso.
    mockGetPreApprovalById.mockResolvedValue({
      external_reference: 'tenant-1',
      status: 'pending',
    });
    queueOwnerResolution();
    supabaseMock.__queue('webhook_events', { data: null, error: { message: 'boom' } });

    const result = await processMercadoPagoWebhook('pa-1', 'subscription_preapproval');

    await flushAfter();

    expect(result).toEqual({ ok: true, data: { received: true } });
  });

  it('does not log at all when the event has no id', async () => {
    const result = await processMercadoPagoWebhook(undefined, 'subscription_preapproval');

    await flushAfter();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
    expect(auditRow()).toBeUndefined();
  });
});

