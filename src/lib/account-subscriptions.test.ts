import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseMock } from '@/test/supabase-mock';
import { cancelAccountSubscriptions } from './account-subscriptions';

vi.mock('@/lib/supabaseAdmin', () => ({ supabaseAdmin: supabaseMock }));

const mockGetPaddleSubscription = vi.fn();
const mockCancelPaddleSubscription = vi.fn();
const mockGetPaddleTransaction = vi.fn();
const mockCancelPaddleTransaction = vi.fn();

vi.mock('@/lib/paddle', () => ({
  getPaddleSubscription: (...args: unknown[]) => mockGetPaddleSubscription(...args),
  cancelPaddleSubscription: (...args: unknown[]) => mockCancelPaddleSubscription(...args),
  getPaddleTransaction: (...args: unknown[]) => mockGetPaddleTransaction(...args),
  cancelPaddleTransaction: (...args: unknown[]) => mockCancelPaddleTransaction(...args),
}));

const mockGetPreApprovalById = vi.fn();
const mockCancelPreApproval = vi.fn();

vi.mock('@/lib/mercadopago', () => ({
  getPreApprovalById: (...args: unknown[]) => mockGetPreApprovalById(...args),
  cancelPreApproval: (...args: unknown[]) => mockCancelPreApproval(...args),
}));

const mockTrackEvent = vi.fn();
vi.mock('@/lib/track-event', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const baseRow = {
  billing_provider: null,
  paddle_subscription_id: null,
  paddle_pending_transaction_id: null,
  mercadopago_preapproval_id: null,
  mercadopago_pending_preapproval_id: null,
  subscription_plan: 'business',
  subscription_status: 'active',
};

function tenantUpdatePayload(): Record<string, unknown> | undefined {
  const update = supabaseMock.__calls.find(
    (call) => call.table === 'tenants' && call.method === 'update'
  );
  return update?.args[0] as Record<string, unknown> | undefined;
}

describe('cancelAccountSubscriptions', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    mockGetPaddleSubscription.mockReset();
    mockCancelPaddleSubscription.mockReset();
    mockGetPaddleTransaction.mockReset();
    mockCancelPaddleTransaction.mockReset();
    mockGetPreApprovalById.mockReset();
    mockCancelPreApproval.mockReset();
    mockTrackEvent.mockReset();
    mockTrackEvent.mockResolvedValue(undefined);
  });

  it('no consulta nada si el usuario no tiene empresas propias', async () => {
    const result = await cancelAccountSubscriptions('user-1', []);

    expect(result.ok).toBe(true);
    expect(supabaseMock.__calls).toHaveLength(0);
  });

  it('cancela una sola vez la suscripción compartida por varias ramas', async () => {
    supabaseMock.__queue('tenants', {
      data: [
        { id: 'tenant-1', ...baseRow, paddle_subscription_id: 'sub-1' },
        { id: 'tenant-2', ...baseRow, paddle_subscription_id: 'sub-1' },
      ],
    });
    supabaseMock.__queue('tenants', { data: null, error: null });

    mockGetPaddleSubscription.mockResolvedValue({ id: 'sub-1', status: 'active' });
    mockCancelPaddleSubscription.mockResolvedValue({ id: 'sub-1', status: 'canceled' });

    const result = await cancelAccountSubscriptions('user-1', ['tenant-1', 'tenant-2']);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.canceledPaddleSubscriptions).toBe(1);

    expect(mockCancelPaddleSubscription).toHaveBeenCalledTimes(1);
    expect(mockCancelPaddleSubscription).toHaveBeenCalledWith('sub-1', true);

    const payload = tenantUpdatePayload();
    expect(payload).toMatchObject({
      subscription_status: 'canceled',
      subscription_plan: 'free',
      paddle_subscription_id: null,
    });

    expect(mockTrackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'subscription_cancelled',
        userId: 'user-1',
        tenantId: 'tenant-1',
        metadata: expect.objectContaining({ source: 'account_deletion', provider: 'paddle' }),
      })
    );
  });

  it('no vuelve a cancelar una suscripción de Paddle ya cancelada', async () => {
    supabaseMock.__queue('tenants', {
      data: [{ id: 'tenant-1', ...baseRow, paddle_subscription_id: 'sub-1' }],
    });
    supabaseMock.__queue('tenants', { data: null, error: null });

    mockGetPaddleSubscription.mockResolvedValue({ id: 'sub-1', status: 'canceled' });

    const result = await cancelAccountSubscriptions('user-1', ['tenant-1']);

    expect(result.ok).toBe(true);
    expect(mockCancelPaddleSubscription).not.toHaveBeenCalled();
    expect(tenantUpdatePayload()?.paddle_subscription_id).toBeNull();
  });

  it('cancela el preapproval vigente y el pendiente de MercadoPago', async () => {
    supabaseMock.__queue('tenants', {
      data: [
        {
          id: 'tenant-1',
          ...baseRow,
          mercadopago_preapproval_id: 'pa-current',
          mercadopago_pending_preapproval_id: 'pa-pending',
        },
      ],
    });
    supabaseMock.__queue('tenants', { data: null, error: null });

    mockGetPreApprovalById.mockImplementation(async (id: string) => ({
      id,
      status: 'authorized',
    }));
    mockCancelPreApproval.mockResolvedValue({});

    const result = await cancelAccountSubscriptions('user-1', ['tenant-1']);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.canceledMercadoPagoPreapprovals).toBe(2);
    expect(mockCancelPreApproval).toHaveBeenCalledWith('pa-current');
    expect(mockCancelPreApproval).toHaveBeenCalledWith('pa-pending');

    expect(tenantUpdatePayload()).toMatchObject({
      subscription_status: 'canceled',
      mercadopago_preapproval_id: null,
      mercadopago_pending_preapproval_id: null,
    });
    expect(mockTrackEvent).toHaveBeenCalledTimes(1);
  });

  it('aborta y no actualiza la base si Paddle rechaza la cancelación', async () => {
    supabaseMock.__queue('tenants', {
      data: [{ id: 'tenant-1', ...baseRow, paddle_subscription_id: 'sub-1' }],
    });

    mockGetPaddleSubscription.mockResolvedValue({ id: 'sub-1', status: 'active' });
    mockCancelPaddleSubscription.mockRejectedValue(new Error('Paddle API 500: boom'));

    const result = await cancelAccountSubscriptions('user-1', ['tenant-1']);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(502);
    expect(tenantUpdatePayload()).toBeUndefined();
  });

  it('cancela la suscripción creada por una transacción cuyo webhook aún no llegó', async () => {
    supabaseMock.__queue('tenants', {
      data: [
        {
          id: 'tenant-1',
          ...baseRow,
          subscription_status: 'free',
          paddle_pending_transaction_id: 'txn-1',
        },
      ],
    });
    supabaseMock.__queue('tenants', { data: null, error: null });

    mockGetPaddleTransaction.mockResolvedValue({
      id: 'txn-1',
      status: 'completed',
      origin: 'api',
      subscriptionId: 'sub-new',
    });
    mockGetPaddleSubscription.mockResolvedValue({ id: 'sub-new', status: 'active' });
    mockCancelPaddleSubscription.mockResolvedValue({ id: 'sub-new', status: 'canceled' });

    const result = await cancelAccountSubscriptions('user-1', ['tenant-1']);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.canceledPaddleSubscriptions).toBe(1);
    expect(mockCancelPaddleSubscription).toHaveBeenCalledWith('sub-new', true);
    expect(mockCancelPaddleTransaction).not.toHaveBeenCalled();
    expect(tenantUpdatePayload()).toMatchObject({
      subscription_status: 'canceled',
      paddle_pending_transaction_id: null,
    });
  });

  it('cancela la transacción pendiente de Paddle sin bloquear por errores', async () => {
    supabaseMock.__queue('tenants', {
      data: [
        {
          id: 'tenant-1',
          ...baseRow,
          subscription_status: 'free',
          paddle_pending_transaction_id: 'txn-1',
        },
      ],
    });
    supabaseMock.__queue('tenants', { data: null, error: null });

    mockGetPaddleTransaction.mockResolvedValue({ id: 'txn-1', status: 'ready', origin: 'api' });
    mockCancelPaddleTransaction.mockResolvedValue({ id: 'txn-1', status: 'canceled', origin: 'api' });

    const result = await cancelAccountSubscriptions('user-1', ['tenant-1']);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.canceledPaddleTransactions).toBe(1);

    const payload = tenantUpdatePayload();
    expect(payload?.paddle_pending_transaction_id).toBeNull();
    expect(payload?.subscription_status).toBeUndefined();
  });

  it('aborta si Paddle responde 404 en vez de asumir que ya no existe', async () => {
    supabaseMock.__queue('tenants', {
      data: [{ id: 'tenant-1', ...baseRow, paddle_subscription_id: 'sub-gone' }],
    });

    mockGetPaddleSubscription.mockRejectedValue(new Error('Paddle API 404: not found'));

    const result = await cancelAccountSubscriptions('user-1', ['tenant-1']);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(502);
    expect(mockCancelPaddleSubscription).not.toHaveBeenCalled();
    expect(tenantUpdatePayload()).toBeUndefined();
  });
});
