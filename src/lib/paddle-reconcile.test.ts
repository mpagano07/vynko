import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseMock } from '@/test/supabase-mock';
import { reconcilePaddleSubscriptions } from './paddle-reconcile';

vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: supabaseMock,
}));

const tenantRow = (
  id: string,
  status: string | null,
  subscriptionId: string | null = `sub-${id}`
) => ({
  id,
  subscription_status: status,
  paddle_subscription_id: subscriptionId,
});

const sub = (status: string) => ({
  id: 'sub-x',
  status,
  customerId: 'ctm-1',
  currentBillingPeriodEnd: '2026-11-01T00:00:00Z',
  customData: { tenant_id: 't1', plan: 'starter' },
});

describe('reconcilePaddleSubscriptions', () => {
  beforeEach(() => {
    supabaseMock.__reset();
  });

  describe('seleccion de candidatos', () => {
    it('solo compara tenants con suscripcion de Paddle', async () => {
      supabaseMock.__queue('tenants', { data: [], error: null });

      await reconcilePaddleSubscriptions({ fetchSubscription: vi.fn() });

      const select = supabaseMock.__calls.find(
        (c) => c.table === 'tenants' && c.method === 'select'
      );
      expect(select).toBeDefined();
      const notCall = supabaseMock.__calls.find((c) => c.method === 'not');
      expect(notCall).toBeDefined();
      expect(notCall!.args).toEqual(['paddle_subscription_id', 'is', null]);
    });

    it('limita cuantas suscripciones se comparan por corrida', async () => {
      supabaseMock.__queue('tenants', { data: [], error: null });

      await reconcilePaddleSubscriptions({ limit: 7, fetchSubscription: vi.fn() });

      const limitCall = supabaseMock.__calls.find((c) => c.method === 'limit');
      expect(limitCall).toBeDefined();
      expect(limitCall!.args[0]).toBe(7);
    });

    it('devuelve un reporte vacio si falla la query', async () => {
      supabaseMock.__queue('tenants', { data: null, error: { message: 'db down' } });

      const report = await reconcilePaddleSubscriptions({ fetchSubscription: vi.fn() });

      expect(report).toEqual({
        checked: 0,
        inSync: 0,
        repaired: 0,
        unreachable: 0,
        deferred: [],
        details: [],
      });
    });
  });

  describe('comparacion de estados', () => {
    it('no hace nada cuando la base ya coincide con una suscripcion activa', async () => {
      supabaseMock.__queue('tenants', { data: [tenantRow('t1', 'active')], error: null });
      const process = vi.fn();

      const report = await reconcilePaddleSubscriptions({
        fetchSubscription: vi.fn().mockResolvedValue(sub('active')),
        process,
      });

      expect(report.inSync).toBe(1);
      expect(report.repaired).toBe(0);
      expect(process).not.toHaveBeenCalled();
    });

    it('no hace nada cuando ambos lados estan cancelados', async () => {
      supabaseMock.__queue('tenants', { data: [tenantRow('t1', 'canceled')], error: null });
      const process = vi.fn();

      const report = await reconcilePaddleSubscriptions({
        fetchSubscription: vi.fn().mockResolvedValue(sub('canceled')),
        process,
      });

      expect(report.inSync).toBe(1);
      expect(process).not.toHaveBeenCalled();
    });

    it('trata trialing como activo', async () => {
      supabaseMock.__queue('tenants', { data: [tenantRow('t1', 'active')], error: null });
      const process = vi.fn();

      const report = await reconcilePaddleSubscriptions({
        fetchSubscription: vi.fn().mockResolvedValue(sub('trialing')),
        process,
      });

      expect(report.inSync).toBe(1);
      expect(process).not.toHaveBeenCalled();
    });

    it('trata paused como past_due', async () => {
      supabaseMock.__queue('tenants', { data: [tenantRow('t1', 'past_due')], error: null });
      const process = vi.fn();

      const report = await reconcilePaddleSubscriptions({
        fetchSubscription: vi.fn().mockResolvedValue(sub('paused')),
        process,
      });

      expect(report.inSync).toBe(1);
      expect(process).not.toHaveBeenCalled();
    });

    it('ignora un estado desconocido en vez de adivinar', async () => {
      supabaseMock.__queue('tenants', { data: [tenantRow('t1', 'active')], error: null });
      const process = vi.fn();

      const report = await reconcilePaddleSubscriptions({
        fetchSubscription: vi.fn().mockResolvedValue(sub('something_new')),
        process,
      });

      expect(process).not.toHaveBeenCalled();
      expect(report.repaired).toBe(0);
    });
  });

  describe('reparacion de divergencias', () => {
    it('repara una cancelacion perdida', async () => {
      supabaseMock.__queue('tenants', { data: [tenantRow('t1', 'active')], error: null });
      const process = vi.fn().mockResolvedValue({ ok: true, data: { received: true } });

      const report = await reconcilePaddleSubscriptions({
        fetchSubscription: vi.fn().mockResolvedValue(sub('canceled')),
        process,
      });

      expect(report.repaired).toBe(1);
      expect(report.details[0]).toEqual({
        tenantId: 't1',
        subscriptionId: 'sub-t1',
        outcome: 'repaired',
      });
    });

    it('repara una activacion perdida', async () => {
      supabaseMock.__queue('tenants', { data: [tenantRow('t1', 'canceled')], error: null });
      const process = vi.fn().mockResolvedValue({ ok: true, data: { received: true } });

      const report = await reconcilePaddleSubscriptions({
        fetchSubscription: vi.fn().mockResolvedValue(sub('active')),
        process,
      });

      expect(report.repaired).toBe(1);
    });

    it('repara un pago fallido que nunca llego a la base', async () => {
      supabaseMock.__queue('tenants', { data: [tenantRow('t1', 'active')], error: null });
      const process = vi.fn().mockResolvedValue({ ok: true, data: { received: true } });

      const report = await reconcilePaddleSubscriptions({
        fetchSubscription: vi.fn().mockResolvedValue(sub('past_due')),
        process,
      });

      expect(report.repaired).toBe(1);
    });

    it('reutiliza el camino del webhook con un evento sintetico sin event_id', async () => {
      // Delegar en processPaddleWebhook es lo que evita mantener dos versiones
      // de la regla de transicion. El evento va sin event_id para no ensuciar
      // la bitacora de webhooks.
      supabaseMock.__queue('tenants', { data: [tenantRow('t1', 'active')], error: null });
      const process = vi.fn().mockResolvedValue({ ok: true, data: { received: true } });

      await reconcilePaddleSubscriptions({
        fetchSubscription: vi.fn().mockResolvedValue(sub('canceled')),
        process,
      });

      const [event] = process.mock.calls[0] as [import('./paddle-webhook-service').PaddleEvent];
      expect(event.event_id).toBeUndefined();
      expect(event.event_type).toBe('subscription.updated');
      expect(event.data).toMatchObject({ id: 'sub-t1', status: 'canceled' });
    });
  });

  describe('fallos', () => {
    it('nunca cancela una suscripcion que no pudo verificar', async () => {
      supabaseMock.__queue('tenants', { data: [tenantRow('t1', 'active')], error: null });
      const process = vi.fn();

      const report = await reconcilePaddleSubscriptions({
        fetchSubscription: vi.fn().mockRejectedValue(new Error('Paddle 503')),
        process,
      });

      expect(process).not.toHaveBeenCalled();
      expect(report.repaired).toBe(0);
      expect(report.unreachable).toBe(1);
      expect(report.deferred).toEqual(['sub-t1']);
    });

    it('difiere el tenant cuando el camino del webhook falla', async () => {
      supabaseMock.__queue('tenants', { data: [tenantRow('t1', 'active')], error: null });
      const process = vi.fn().mockResolvedValue({
        ok: false,
        error: 'Webhook processing failed',
        status: 500,
      });

      const report = await reconcilePaddleSubscriptions({
        fetchSubscription: vi.fn().mockResolvedValue(sub('canceled')),
        process,
      });

      expect(report.repaired).toBe(0);
      expect(report.unreachable).toBe(1);
      expect(report.deferred).toEqual(['sub-t1']);
    });

    it('sigue con el resto de los tenants despues de un fallo puntual', async () => {
      supabaseMock.__queue('tenants', {
        data: [tenantRow('t1', 'active'), tenantRow('t2', 'active'), tenantRow('t3', 'active')],
        error: null,
      });
      const fetchSubscription = vi
        .fn()
        .mockRejectedValueOnce(new Error('Paddle 503'))
        .mockResolvedValue(sub('canceled'));
      const process = vi.fn().mockResolvedValue({ ok: true, data: { received: true } });

      const report = await reconcilePaddleSubscriptions({ fetchSubscription, process });

      expect(report.checked).toBe(3);
      expect(report.repaired).toBe(2);
      expect(report.unreachable).toBe(1);
    });
  });

  describe('conteo', () => {
    it('cuenta cada tenant comparado y cuadra con checked', async () => {
      supabaseMock.__queue('tenants', {
        data: [tenantRow('t1', 'active'), tenantRow('t2', 'active'), tenantRow('t3', 'active')],
        error: null,
      });
      const fetchSubscription = vi
        .fn()
        .mockResolvedValueOnce(sub('canceled'))
        .mockRejectedValueOnce(new Error('Paddle 503'))
        .mockResolvedValueOnce(sub('active'));
      const process = vi.fn().mockResolvedValue({ ok: true, data: { received: true } });

      const report = await reconcilePaddleSubscriptions({ fetchSubscription, process });

      expect(report.checked).toBe(3);
      expect(report.inSync).toBe(1);
      expect(report.repaired).toBe(1);
      expect(report.unreachable).toBe(1);
      expect(report.inSync + report.repaired + report.unreachable).toBe(report.checked);
      expect(report.details).toHaveLength(3);
    });
  });
});
