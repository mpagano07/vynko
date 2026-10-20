import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseMock } from '@/test/supabase-mock';
import { processPaddleWebhook, type PaddleEvent } from './paddle-webhook-service';

vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: supabaseMock,
}));

const mockGetPaddleSubscription = vi.fn();
const mockCancelPaddleSubscription = vi.fn();

vi.mock('@/lib/paddle', () => ({
  getPaddleSubscription: (...args: unknown[]) => mockGetPaddleSubscription(...args),
  cancelPaddleSubscription: (...args: unknown[]) => mockCancelPaddleSubscription(...args),
}));

const mockTrackEvent = vi.fn();

vi.mock('@/lib/track-event', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}));

const mockLogger = { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() };

vi.mock('@/lib/logger', () => ({
  logger: {
    error: (...args: unknown[]) => mockLogger.error(...args),
    info: (...args: unknown[]) => mockLogger.info(...args),
    warn: (...args: unknown[]) => mockLogger.warn(...args),
    debug: (...args: unknown[]) => mockLogger.debug(...args),
  },
}));

// La bitacora se difiere con `after`. En tests `after` no existe, asi que se
// encolan los callbacks y `flushAfter()` los ejecuta a demanda.
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
 * Secuencia de queries a `tenant_users` que arma la resolucion del owner.
 *
 * Call flow inside processPaddleWebhook:
 *   1. resolveOwnerBranchIds(tenantId)
 *      └── resolveOwnerUserId(tenantId)  → tenant_users query #1
 *      └── tenant_users.select(tenant_id).eq(user_id)  → query #2
 *   2. resolveOwnerUserId(tenantId)  → tenant_users query #3
 */
function queueOwnerResolution(
  ownerUserId: string = 'owner-1',
  branchIds: string[] = ['tenant-1']
) {
  supabaseMock.__queue('tenant_users', { data: { user_id: ownerUserId }, error: null });
  supabaseMock.__queue('tenant_users', {
    data: branchIds.map((id) => ({ tenant_id: id })),
    error: null,
  });
  supabaseMock.__queue('tenant_users', { data: { user_id: ownerUserId }, error: null });
}

function tenantRow(overrides: Record<string, unknown> = {}) {
  return {
    subscription_plan: 'business',
    paddle_subscription_id: 'sub-1',
    paddle_pending_transaction_id: null,
    paddle_pending_plan: null,
    ...overrides,
  };
}

/** Encola la unica SELECT a `tenants` (el tenantRow). */
function queueTenantsSelect(row: Record<string, unknown> | null) {
  supabaseMock.__queue('tenants', { data: row, error: null });
}

const BASE_DATA: {
  id: string;
  status: string;
  customer_id: string;
  current_billing_period: { ends_at: string };
  // Los tests pasan `custom_data` vacio o `null` para cubrir los eventos sin
  // datos de tenant, asi que el tipo base tiene que aceptarlo.
  custom_data: Record<string, unknown> | null;
} = {
  id: 'sub-1',
  status: 'active',
  customer_id: 'ctm-1',
  current_billing_period: { ends_at: '2026-11-01T00:00:00Z' },
  custom_data: { tenant_id: 'tenant-1', plan: 'business' },
};

function subEvent(
  data: Partial<typeof BASE_DATA> = {},
  extra: Partial<PaddleEvent> = {}
): PaddleEvent {
  return {
    event_id: 'evt-1',
    event_type: 'subscription.updated',
    data: { ...BASE_DATA, ...data },
    ...extra,
  };
}

/** Merge de todos los UPDATE sobre `tenants`: el estado final escrito. */
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

function webhookLogRows() {
  return supabaseMock.__calls
    .filter((c) => c.table === 'webhook_events' && c.method === 'insert')
    .map((c) => c.args[0] as Record<string, unknown>);
}

beforeEach(() => {
  supabaseMock.__reset();
  mockGetPaddleSubscription.mockReset();
  mockCancelPaddleSubscription.mockReset();
  mockTrackEvent.mockReset();
  mockLogger.error.mockClear();
  mockLogger.info.mockClear();
  mockAfter.mockClear();
  afterCallbacks.length = 0;
});

// ---------------------------------------------------------------------------
// Enrutado de eventos
// ---------------------------------------------------------------------------

describe('enrutado de eventos', () => {
  it('ignora los tipos de evento que no son de suscripcion ni de transaccion', async () => {
    const result = await processPaddleWebhook(subEvent({}, { event_type: 'customer.updated' }));

    expect(result.ok).toBe(true);
    expect(mockGetPaddleSubscription).not.toHaveBeenCalled();
    expect(tenantUpdates()).toHaveLength(0);
  });

  it('ignora una transaccion sin suscripcion asociada', async () => {
    const result = await processPaddleWebhook({
      event_id: 'evt-1',
      event_type: 'transaction.completed',
      data: { subscription_id: null },
    });

    expect(result.ok).toBe(true);
    expect(mockGetPaddleSubscription).not.toHaveBeenCalled();
  });

  it('ignora un estado que no dice nada (no adivina)', async () => {
    queueOwnerResolution();
    queueTenantsSelect(tenantRow());

    const result = await processPaddleWebhook(subEvent({ status: 'scheduled_to_cancel' }));

    expect(result.ok).toBe(true);
    expect(tenantUpdates()).toHaveLength(0);
    await flushAfter();
    expect(webhookLogRows()[0]).toMatchObject({ outcome: 'ignored' });
  });
});

// ---------------------------------------------------------------------------
// Validacion
// ---------------------------------------------------------------------------

describe('validacion', () => {
  it('devuelve 400 si falta el id de la suscripcion', async () => {
    const result = await processPaddleWebhook(subEvent({ id: undefined }));

    expect(result).toEqual({ ok: false, error: 'Missing subscription id', status: 400 });
  });

  it('devuelve 400 si no puede resolver el tenant', async () => {
    // Sin tenant_id en custom_data y sin fila que apunte a esa suscripcion.
    queueTenantsSelect(null);

    const result = await processPaddleWebhook(subEvent({ custom_data: {} }));

    expect(result).toEqual({ ok: false, error: 'No tenant', status: 400 });
  });

  it('devuelve 500 y no activa nada si una operacion de base revienta', async () => {
    queueOwnerResolution();
    supabaseMock.__queue(
      'tenants',
      { data: tenantRow(), error: null },
      { data: null, error: { message: 'boom' } }
    );

    const result = await processPaddleWebhook(subEvent());

    expect(result).toEqual({ ok: false, error: 'Webhook processing failed', status: 500 });
    await flushAfter();
    expect(webhookLogRows()[0]).toMatchObject({ outcome: 'error' });
  });
});

// ---------------------------------------------------------------------------
// Resolucion de tenant
// ---------------------------------------------------------------------------

describe('resolucion de tenant', () => {
  it('resuelve el tenant por paddle_subscription_id cuando custom_data no lo trae', async () => {
    queueTenantsSelect({ id: 'tenant-9' } as unknown as Record<string, unknown>);
    queueOwnerResolution();
    queueTenantsSelect(tenantRow({ paddle_subscription_id: 'sub-9' }));

    const result = await processPaddleWebhook(
      subEvent({ id: 'sub-9', custom_data: {} })
    );

    expect(result.ok).toBe(true);
    const lookup = supabaseMock.__calls.find(
      (c) => c.table === 'tenants' && c.method === 'eq' && c.args[0] === 'paddle_subscription_id'
    );
    expect(lookup).toBeDefined();
    expect(tenantsWrites().subscription_status).toBe('active');
  });
});

// ---------------------------------------------------------------------------
// Activacion (active / trialing)
// ---------------------------------------------------------------------------

describe('activacion', () => {
  it('activa la suscripcion y escribe plan, periodo, provider y customer', async () => {
    queueOwnerResolution();
    queueTenantsSelect(tenantRow());

    const result = await processPaddleWebhook(subEvent());

    expect(result.ok).toBe(true);

    const writes = tenantsWrites();
    expect(writes.subscription_status).toBe('active');
    expect(writes.billing_provider).toBe('paddle');
    expect(writes.paddle_subscription_id).toBe('sub-1');
    expect(writes.subscription_plan).toBe('business');
    expect(writes.paddle_customer_id).toBe('ctm-1');
    expect(writes.subscription_current_period_end).toBe('2026-11-01T00:00:00Z');

    expect(mockTrackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'subscription_started',
        tenantId: 'tenant-1',
        metadata: expect.objectContaining({ plan: 'business', provider: 'paddle' }),
      })
    );
  });

  it('trata trialing como activo', async () => {
    queueOwnerResolution();
    queueTenantsSelect(tenantRow());

    await processPaddleWebhook(subEvent({ status: 'trialing' }));

    expect(tenantsWrites().subscription_status).toBe('active');
  });

  it('refresca el periodo en una renovacion sin disparar subscription_started de nuevo', async () => {
    // Ya estaba activo: el compare-and-set no matchea (fila vacia) y no hay
    // cambio de plan pendiente. El periodo igual se refresca.
    queueOwnerResolution();
    supabaseMock.__queue(
      'tenants',
      { data: tenantRow(), error: null },
      { data: [], error: null }
    );

    const result = await processPaddleWebhook(
      subEvent({ current_billing_period: { ends_at: '2026-12-01T00:00:00Z' } })
    );

    expect(result.ok).toBe(true);
    expect(mockTrackEvent).not.toHaveBeenCalled();
    expect(tenantsWrites().subscription_current_period_end).toBe('2026-12-01T00:00:00Z');
    await flushAfter();
    expect(webhookLogRows()[0]).toMatchObject({ outcome: 'duplicate' });
  });

  it('ignora el evento de una suscripcion que ya no es la vigente, si no hay cambio de plan', async () => {
    queueOwnerResolution();
    queueTenantsSelect(tenantRow({ paddle_subscription_id: 'sub-old' }));

    const result = await processPaddleWebhook(subEvent({ id: 'sub-new' }));

    expect(result.ok).toBe(true);
    expect(tenantUpdates()).toHaveLength(0);
    expect(mockTrackEvent).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Cambio de plan pendiente
// ---------------------------------------------------------------------------

describe('cambio de plan pendiente', () => {
  it('aplica el plan destino, limpia el pendiente y cancela la suscripcion vieja', async () => {
    queueOwnerResolution();
    queueTenantsSelect(
      tenantRow({
        subscription_plan: 'business',
        paddle_subscription_id: 'sub-old',
        paddle_pending_transaction_id: 'tx-1',
        paddle_pending_plan: 'starter',
      })
    );

    const result = await processPaddleWebhook(subEvent({ id: 'sub-new' }));

    expect(result.ok).toBe(true);

    const writes = tenantsWrites();
    // El plan pendiente (starter) gana sobre el de custom_data (business).
    expect(writes.subscription_plan).toBe('starter');
    expect(writes.paddle_subscription_id).toBe('sub-new');
    expect(writes.paddle_pending_transaction_id).toBeNull();
    expect(writes.paddle_pending_plan).toBeNull();

    expect(mockCancelPaddleSubscription).toHaveBeenCalledWith('sub-old', false);
    expect(mockTrackEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'subscription_started' })
    );
  });

  it('no aplica ni limpia el pendiente en una renovacion de la suscripcion vigente', async () => {
    // Un renewal no es prueba de que el cambio de plan se pago: el pendiente
    // tiene que sobrevivir hasta que llegue el evento de la transaccion nueva.
    queueOwnerResolution();
    queueTenantsSelect(
      tenantRow({
        paddle_subscription_id: 'sub-1',
        paddle_pending_transaction_id: 'tx-1',
        paddle_pending_plan: 'starter',
      })
    );

    await processPaddleWebhook(subEvent({ id: 'sub-1' }));

    expect(mockCancelPaddleSubscription).not.toHaveBeenCalled();
    expect(
      tenantUpdates().filter(
        (c) => 'paddle_pending_transaction_id' in (c.args[0] as Record<string, unknown>)
      )
    ).toHaveLength(0);
    // El plan sigue siendo el de la suscripcion vigente, no el pendiente.
    expect(tenantsWrites().subscription_plan).toBe('business');
  });

  it('aplica el pendiente cuando transaction.completed trae la transaccion del checkout', async () => {
    mockGetPaddleSubscription.mockResolvedValue({
      status: 'active',
      customerId: 'ctm-1',
      currentBillingPeriodEnd: '2027-01-01T00:00:00Z',
      customData: { tenant_id: 'tenant-1', plan: 'business' },
    });
    queueOwnerResolution();
    queueTenantsSelect(
      tenantRow({
        paddle_subscription_id: 'sub-old',
        paddle_pending_transaction_id: 'tx-1',
        paddle_pending_plan: 'starter',
      })
    );

    const result = await processPaddleWebhook({
      event_id: 'evt-tx',
      event_type: 'transaction.completed',
      data: { id: 'tx-1', subscription_id: 'sub-new' },
    });

    expect(result.ok).toBe(true);
    const writes = tenantsWrites();
    expect(writes.subscription_plan).toBe('starter');
    expect(writes.paddle_pending_transaction_id).toBeNull();
    expect(writes.paddle_pending_plan).toBeNull();
    expect(writes.paddle_subscription_id).toBe('sub-new');
    expect(mockCancelPaddleSubscription).toHaveBeenCalledWith('sub-old', false);
  });

  it('no aplica el pendiente si la transaccion no es la del checkout', async () => {
    mockGetPaddleSubscription.mockResolvedValue({
      status: 'active',
      customerId: 'ctm-1',
      currentBillingPeriodEnd: '2027-01-01T00:00:00Z',
      customData: { tenant_id: 'tenant-1', plan: 'business' },
    });
    queueOwnerResolution();
    queueTenantsSelect(
      tenantRow({
        paddle_subscription_id: null,
        paddle_pending_transaction_id: 'tx-1',
        paddle_pending_plan: 'starter',
      })
    );

    await processPaddleWebhook({
      event_id: 'evt-tx',
      event_type: 'transaction.completed',
      data: { id: 'tx-other', subscription_id: 'sub-new' },
    });

    const writes = tenantsWrites();
    expect(writes.subscription_plan).toBe('business');
    expect(writes).not.toHaveProperty('paddle_pending_transaction_id');
    expect(writes).not.toHaveProperty('paddle_subscription_id');
    expect(mockCancelPaddleSubscription).not.toHaveBeenCalled();
  });

  it('si el cambio de plan revienta al cancelar, la transicion ya quedo aplicada', async () => {
    queueOwnerResolution();
    queueTenantsSelect(
      tenantRow({
        paddle_subscription_id: 'sub-old',
        paddle_pending_transaction_id: 'tx-1',
        paddle_pending_plan: 'starter',
      })
    );
    mockCancelPaddleSubscription.mockRejectedValue(new Error('Paddle 503'));

    const result = await processPaddleWebhook(subEvent({ id: 'sub-new' }));

    // El error de cancelacion es no-fatal: el plan ya se aplico y el webhook
    // responde 200 para que Paddle no reintente un evento ya consumido.
    expect(result.ok).toBe(true);
    expect(tenantsWrites().subscription_plan).toBe('starter');
  });
});

// ---------------------------------------------------------------------------
// Cancelacion
// ---------------------------------------------------------------------------

describe('cancelacion', () => {
  it('cancela, baja a free y limpia paddle_subscription_id', async () => {
    queueOwnerResolution();
    queueTenantsSelect(tenantRow({ subscription_plan: 'business' }));

    const result = await processPaddleWebhook(
      subEvent({ status: 'canceled' })
    );

    expect(result.ok).toBe(true);

    const writes = tenantsWrites();
    expect(writes.subscription_status).toBe('canceled');
    expect(writes.subscription_plan).toBe('free');
    expect(writes.paddle_subscription_id).toBeNull();

    expect(mockTrackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'subscription_cancelled',
        metadata: expect.objectContaining({ provider: 'paddle', source: 'webhook' }),
      })
    );
  });

  it('baja a free solo si el plan era pago', async () => {
    queueOwnerResolution();
    queueTenantsSelect(tenantRow({ subscription_plan: 'free' }));

    await processPaddleWebhook(subEvent({ status: 'canceled' }));

    expect(tenantsWrites().subscription_plan).toBe('free');
  });

  it('ignora la cancelacion de una suscripcion que ya no es la vigente', async () => {
    queueOwnerResolution();
    queueTenantsSelect(tenantRow({ paddle_subscription_id: 'sub-old' }));

    const result = await processPaddleWebhook(
      subEvent({ id: 'sub-new', status: 'canceled' })
    );

    expect(result.ok).toBe(true);
    expect(tenantUpdates()).toHaveLength(0);
    expect(mockTrackEvent).not.toHaveBeenCalled();
  });

  it('no dispara subscription_cancelled si ya estaba cancelado', async () => {
    queueOwnerResolution();
    supabaseMock.__queue(
      'tenants',
      { data: tenantRow(), error: null },
      { data: [], error: null }
    );

    const result = await processPaddleWebhook(subEvent({ status: 'canceled' }));

    expect(result.ok).toBe(true);
    expect(mockTrackEvent).not.toHaveBeenCalled();
    await flushAfter();
    expect(webhookLogRows()[0]).toMatchObject({ outcome: 'duplicate' });
  });
});

// ---------------------------------------------------------------------------
// Pago fallido
// ---------------------------------------------------------------------------

describe('pago fallido', () => {
  it('marca past_due cuando el pago falla', async () => {
    queueOwnerResolution();
    queueTenantsSelect(tenantRow());

    await processPaddleWebhook(subEvent({ status: 'past_due' }));

    expect(tenantsWrites().subscription_status).toBe('past_due');
  });

  it('trata paused como past_due', async () => {
    queueOwnerResolution();
    queueTenantsSelect(tenantRow());

    await processPaddleWebhook(subEvent({ status: 'paused' }));

    expect(tenantsWrites().subscription_status).toBe('past_due');
  });

  it('no escribe nada si ya estaba past_due', async () => {
    queueOwnerResolution();
    queueTenantsSelect(tenantRow());
    // El compare-and-set neq('subscription_status','past_due') no matchea.
    supabaseMock.__queue('tenants', { data: null, error: null });

    await processPaddleWebhook(subEvent({ status: 'past_due' }));

    // Solo el update de past_due; no hubo transicion de estado ni de plan.
    expect(tenantUpdates()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// transaction.completed relee la suscripcion
// ---------------------------------------------------------------------------

describe('transaction.completed', () => {
  it('relee la suscripcion creada por la transaccion y la activa', async () => {
    // El evento no trae estado ni periodo: el servicio vuelve a Paddle y usa el
    // custom_data de la suscripcion (Paddle lo copia de la transaccion).
    mockGetPaddleSubscription.mockResolvedValue({
      id: 'sub-9',
      status: 'active',
      customerId: 'ctm-9',
      currentBillingPeriodEnd: '2026-12-01T00:00:00Z',
      customData: { tenant_id: 'tenant-1', plan: 'starter' },
    });
    queueOwnerResolution();
    queueTenantsSelect(tenantRow({ paddle_subscription_id: null }));

    const result = await processPaddleWebhook({
      event_id: 'evt-1',
      event_type: 'transaction.completed',
      data: { subscription_id: 'sub-9', custom_data: null },
    });

    expect(result.ok).toBe(true);
    expect(mockGetPaddleSubscription).toHaveBeenCalledWith('sub-9');

    const writes = tenantsWrites();
    expect(writes.subscription_status).toBe('active');
    expect(writes.paddle_subscription_id).toBe('sub-9');
    expect(writes.subscription_plan).toBe('starter');
    expect(writes.paddle_customer_id).toBe('ctm-9');
    expect(writes.subscription_current_period_end).toBe('2026-12-01T00:00:00Z');
  });

  it('con custom_data vacio en la transaccion, resuelve el tenant por paddle_subscription_id', async () => {
    mockGetPaddleSubscription.mockResolvedValue({
      id: 'sub-9',
      status: 'active',
      customerId: 'ctm-9',
      currentBillingPeriodEnd: '2026-12-01T00:00:00Z',
      customData: null,
    });
    // Lookup por paddle_subscription_id, luego el tenantRow.
    supabaseMock.__queue(
      'tenants',
      { data: { id: 'tenant-9' }, error: null },
      { data: tenantRow({ paddle_subscription_id: 'sub-9' }), error: null }
    );
    queueOwnerResolution('owner-1', ['tenant-9']);

    const result = await processPaddleWebhook({
      event_id: 'evt-1',
      event_type: 'transaction.completed',
      data: { subscription_id: 'sub-9', custom_data: null },
    });

    expect(result.ok).toBe(true);
    const lookup = supabaseMock.__calls.find(
      (c) => c.table === 'tenants' && c.method === 'eq' && c.args[0] === 'paddle_subscription_id'
    );
    expect(lookup).toBeDefined();
    expect(tenantsWrites().subscription_status).toBe('active');
  });
});

// ---------------------------------------------------------------------------
// Bitacora (webhook_events)
// ---------------------------------------------------------------------------

describe('bitacora', () => {
  it('registra el evento con provider paddle y el outcome', async () => {
    queueOwnerResolution();
    queueTenantsSelect(tenantRow());

    await processPaddleWebhook(subEvent({}, { event_id: 'evt-42' }));
    await flushAfter();

    expect(webhookLogRows()).toHaveLength(1);
    expect(webhookLogRows()[0]).toMatchObject({
      provider: 'paddle',
      provider_event_id: 'evt-42',
      delivery_id: 'evt-42',
      topic: 'subscription.updated',
      mp_status: 'active',
      outcome: 'processed',
      tenant_id: 'tenant-1',
    });
  });

  it('no deja bitacora sin event_id (asi llegan los eventos sinteticos de reconciliacion)', async () => {
    queueOwnerResolution();
    queueTenantsSelect(tenantRow());

    await processPaddleWebhook(subEvent({}, { event_id: undefined }));
    await flushAfter();

    expect(webhookLogRows()).toHaveLength(0);
  });
});
