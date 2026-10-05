import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseMock } from '@/test/supabase-mock';
import { recordWebhookEvent } from './mercadopago-webhook-log';

vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: supabaseMock,
}));

const mockAfter = vi.fn();
vi.mock('next/server', () => ({
  after: (cb: () => unknown) => mockAfter(cb),
}));

describe('recordWebhookEvent', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    mockAfter.mockReset();
  });

  const base = {
    providerEventId: 'pa-123',
    topic: 'subscription_preapproval',
    outcome: 'processed' as const,
  };

  it('inserts the event with the outcome', async () => {
    supabaseMock.__queue('webhook_events', { data: null, error: null });

    await recordWebhookEvent(base);

    const insert = supabaseMock.__calls.find(
      (c) => c.table === 'webhook_events' && c.method === 'insert'
    );
    expect(insert).toBeDefined();
    const row = insert!.args[0] as Record<string, unknown>;
    expect(row.provider).toBe('mercadopago');
    expect(row.provider_event_id).toBe('pa-123');
    expect(row.topic).toBe('subscription_preapproval');
    expect(row.outcome).toBe('processed');
  });

  it('records which statuses we could not process', async () => {
    supabaseMock.__queue('webhook_events', { data: null, error: null });

    await recordWebhookEvent({ ...base, outcome: 'error', error: 'MP API timeout' });

    const insert = supabaseMock.__calls.find((c) => c.method === 'insert');
    const row = insert!.args[0] as Record<string, unknown>;
    expect(row.outcome).toBe('error');
    expect(row.error).toBe('MP API timeout');
  });

  it('distinguishes a duplicate delivery from a real transition', async () => {
    // Es la razon de existir de `outcome`: sin separar estos dos, un renewal
    // legitimo se ve igual que un webhook reenviado por error.
    supabaseMock.__queue('webhook_events', { data: null, error: null });
    await recordWebhookEvent({ ...base, outcome: 'duplicate' });

    const insert = supabaseMock.__calls.find((c) => c.method === 'insert');
    expect((insert!.args[0] as Record<string, unknown>).outcome).toBe('duplicate');
  });

  it('stores nulls instead of undefined for absent fields', async () => {
    supabaseMock.__queue('webhook_events', { data: null, error: null });

    await recordWebhookEvent(base);

    const insert = supabaseMock.__calls.find((c) => c.method === 'insert');
    const row = insert!.args[0] as Record<string, unknown>;
    expect(row.tenant_id).toBeNull();
    expect(row.user_id).toBeNull();
    expect(row.error).toBeNull();
    expect(row.mp_status).toBeNull();
  });

  it('never throws when the insert fails', async () => {
    // Una bitacora que puede tumbar el flujo que audita es peor que no tenerla.
    supabaseMock.__queue('webhook_events', { data: null, error: { message: 'boom' } });

    await expect(recordWebhookEvent(base)).resolves.toBeUndefined();
  });

  it('never throws when the whole supabase call blows up', async () => {
    const originalFrom = supabaseMock.from;
    supabaseMock.from = () => {
      throw new Error('supabase caido');
    };

    await expect(recordWebhookEvent(base)).resolves.toBeUndefined();

    supabaseMock.from = originalFrom;
  });

  it('does not let a logging failure break the webhook', async () => {
    // El servicio devuelve ok aunque la bitacora falle: si el webhook responde
    // 500 por no poder loguear, MercadoPago reintenta un evento que ya se
    // proceso, que es peor que perder la fila de bitacora.
    const originalFrom = supabaseMock.from;
    supabaseMock.from = () => {
      throw new Error('supabase caido');
    };

    await expect(recordWebhookEvent(base)).resolves.toBeUndefined();

    supabaseMock.from = originalFrom;
  });
});
