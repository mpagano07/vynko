import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseMock } from '@/test/supabase-mock';
import { reconcileSubscriptions } from './mercadopago-reconcile';

vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: supabaseMock,
}));

const tenantRow = (
  id: string,
  status: string | null,
  preapprovalId: string | null = `pa-${id}`
) => ({
  id,
  subscription_status: status,
  mercadopago_preapproval_id: preapprovalId,
});

describe('reconcileSubscriptions', () => {
  beforeEach(() => {
    supabaseMock.__reset();
  });

  describe('seleccion de candidatos', () => {
    it('only compares tenants that have a preapproval id', async () => {
      supabaseMock.__queue('tenants', { data: [], error: null });

      await reconcileSubscriptions({ fetchPreapproval: vi.fn() });

      const select = supabaseMock.__calls.find(
        (c) => c.table === 'tenants' && c.method === 'select'
      );
      expect(select).toBeDefined();
      const notCall = supabaseMock.__calls.find((c) => c.method === 'not');
      expect(notCall).toBeDefined();
      expect(notCall!.args).toEqual(['mercadopago_preapproval_id', 'is', null]);
    });

    it('caps how many tenants are compared per run', async () => {
      // Si no se limitara, la cantidad de llamadas a la API de MP crecería con
      // el numero de tenants hasta pasarse del limite de MercadoPago.
      supabaseMock.__queue('tenants', { data: [], error: null });

      await reconcileSubscriptions({ limit: 7, fetchPreapproval: vi.fn() });

      const limitCall = supabaseMock.__calls.find((c) => c.method === 'limit');
      expect(limitCall).toBeDefined();
      expect(limitCall!.args[0]).toBe(7);
    });

    it('returns an empty report when the tenant query fails', async () => {
      supabaseMock.__queue('tenants', { data: null, error: { message: 'db down' } });

      const report = await reconcileSubscriptions({ fetchPreapproval: vi.fn() });

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
    it('does nothing when the base already matches an authorized subscription', async () => {
      supabaseMock.__queue('tenants', {
        data: [tenantRow('t1', 'active')],
        error: null,
      });
      const fetchPreapproval = vi.fn().mockResolvedValue({ status: 'authorized' });
      const process = vi.fn();

      const report = await reconcileSubscriptions({ fetchPreapproval, process });

      expect(report.inSync).toBe(1);
      expect(report.repaired).toBe(0);
      // Es el caso mas comun: no se debe reescribir la fila en cada corrida.
      expect(process).not.toHaveBeenCalled();
    });

    it('does nothing when both sides are cancelled', async () => {
      supabaseMock.__queue('tenants', { data: [tenantRow('t1', 'canceled')], error: null });
      const process = vi.fn();

      const report = await reconcileSubscriptions({
        fetchPreapproval: vi.fn().mockResolvedValue({ status: 'cancelled' }),
        process,
      });

      expect(report.inSync).toBe(1);
      expect(process).not.toHaveBeenCalled();
    });

    it('ignores a pending subscription instead of repairing it', async () => {
      // Un preapproval en `pending` es un checkout que nunca se completo, no una
      // divergencia. Reactivar aca le daria acceso a alguien que no pago.
      supabaseMock.__queue('tenants', {
        data: [tenantRow('t1', 'canceled')],
        error: null,
      });
      const process = vi.fn();

      const report = await reconcileSubscriptions({
        fetchPreapproval: vi.fn().mockResolvedValue({ status: 'pending' }),
        process,
      });

      expect(process).not.toHaveBeenCalled();
      expect(report.inSync).toBe(1);
      expect(report.repaired).toBe(0);
    });

    it('ignores an unknown status rather than guessing', async () => {
      supabaseMock.__queue('tenants', { data: [tenantRow('t1', 'active')], error: null });
      const process = vi.fn();

      const report = await reconcileSubscriptions({
        fetchPreapproval: vi.fn().mockResolvedValue({ status: 'something_new' }),
        process,
      });

      expect(process).not.toHaveBeenCalled();
      expect(report.repaired).toBe(0);
    });
  });

  describe('reparacion de divergencias', () => {
    it('repairs a lost cancellation', async () => {
      // El escenario que motiva esto: la cancelacion llego a MP pero el webhook
      // se perdio, asi que el tenant sigue con acceso y pagando.
      supabaseMock.__queue('tenants', { data: [tenantRow('t1', 'active')], error: null });
      const process = vi.fn().mockResolvedValue({ ok: true, data: { received: true } });

      const report = await reconcileSubscriptions({
        fetchPreapproval: vi.fn().mockResolvedValue({ status: 'cancelled' }),
        process,
      });

      expect(process).toHaveBeenCalledWith('pa-t1', 'subscription_preapproval');
      expect(report.repaired).toBe(1);
      expect(report.details[0]).toEqual({
        tenantId: 't1',
        preapprovalId: 'pa-t1',
        outcome: 'repaired',
      });
    });

    it('repairs a lost activation', async () => {
      supabaseMock.__queue('tenants', { data: [tenantRow('t1', 'canceled')], error: null });
      const process = vi.fn().mockResolvedValue({ ok: true, data: { received: true } });

      const report = await reconcileSubscriptions({
        fetchPreapproval: vi.fn().mockResolvedValue({ status: 'authorized' }),
        process,
      });

      expect(report.repaired).toBe(1);
    });

    it('repairs a pause that never reached the base', async () => {
      supabaseMock.__queue('tenants', { data: [tenantRow('t1', 'active')], error: null });
      const process = vi.fn().mockResolvedValue({ ok: true, data: { received: true } });

      const report = await reconcileSubscriptions({
        fetchPreapproval: vi.fn().mockResolvedValue({ status: 'paused' }),
        process,
      });

      expect(report.repaired).toBe(1);
      expect(process).toHaveBeenCalledWith('pa-t1', 'subscription_preapproval');
    });

    it('reuses the webhook path so both stay in sync', async () => {
      // Delegar en processMercadoPagoWebhook es lo que evita mantener dos
      // versiones de la regla de transicion.
      supabaseMock.__queue('tenants', { data: [tenantRow('t1', 'active')], error: null });
      const process = vi.fn().mockResolvedValue({ ok: true, data: { received: true } });

      await reconcileSubscriptions({
        fetchPreapproval: vi.fn().mockResolvedValue({ status: 'cancelled' }),
        process,
      });

      const [preapprovalId, topic] = process.mock.calls[0];
      expect(preapprovalId).toBe('pa-t1');
      expect(topic).toBe('subscription_preapproval');
    });
  });

  describe('fallos', () => {
    it('never cancels a subscription it could not verify', async () => {
      supabaseMock.__queue('tenants', { data: [tenantRow('t1', 'active')], error: null });
      const process = vi.fn();

      const report = await reconcileSubscriptions({
        fetchPreapproval: vi.fn().mockRejectedValue(new Error('MP 503')),
        process,
      });

      // Lo que NO debe pasar: asumir cancelado porque no se pudo consultar.
      expect(process).not.toHaveBeenCalled();
      expect(report.repaired).toBe(0);
      expect(report.unreachable).toBe(1);
      expect(report.deferred).toEqual(['pa-t1']);
    });

    it('defers the tenant when the webhook path itself fails', async () => {
      supabaseMock.__queue('tenants', { data: [tenantRow('t1', 'active')], error: null });
      const process = vi.fn().mockResolvedValue({
        ok: false,
        error: 'Webhook processing failed',
        status: 500,
      });

      const report = await reconcileSubscriptions({
        fetchPreapproval: vi.fn().mockResolvedValue({ status: 'cancelled' }),
        process,
      });

      expect(report.repaired).toBe(0);
      expect(report.unreachable).toBe(1);
      expect(report.deferred).toEqual(['pa-t1']);
    });

    it('keeps reconciling the remaining tenants after one fails', async () => {
      supabaseMock.__queue('tenants', {
        data: [tenantRow('t1', 'active'), tenantRow('t2', 'active'), tenantRow('t3', 'active')],
        error: null,
      });
      const fetchPreapproval = vi
        .fn()
        .mockRejectedValueOnce(new Error('MP 503'))
        .mockResolvedValue({ status: 'cancelled' })
        .mockResolvedValue({ status: 'cancelled' });
      const process = vi.fn().mockResolvedValue({ ok: true, data: { received: true } });

      const report = await reconcileSubscriptions({ fetchPreapproval, process });

      // Un fallo puntual de la API no puede abortar toda la corrida.
      expect(report.checked).toBe(3);
      expect(report.repaired).toBe(2);
      expect(report.unreachable).toBe(1);
    });
  });

  describe('conteo', () => {
    it('counts every tenant that was compared', async () => {
      // t1 y t2 divergen (MP cancelada/autorizada al reves de la base) y t3 ya
      // esta en sync. Solo t3 cuenta como inSync.
      supabaseMock.__queue('tenants', {
        data: [
          tenantRow('t1', 'active'),
          tenantRow('t2', 'canceled'),
          tenantRow('t3', 'active'),
        ],
        error: null,
      });
      const fetchPreapproval = vi.fn().mockImplementation((id: string) =>
        Promise.resolve({ status: id === 'pa-t1' ? 'cancelled' : 'authorized' })
      );
      const process = vi.fn().mockResolvedValue({ ok: true, data: { received: true } });

      const report = await reconcileSubscriptions({ fetchPreapproval, process });

      expect(report.checked).toBe(3);
      expect(report.inSync).toBe(1);
      expect(report.repaired).toBe(2);
      expect(report.unreachable).toBe(0);
      expect(report.details).toHaveLength(3);
    });

    it('adds up to the total examined, including unverifiable ones', async () => {
      // inSync + repaired + unreachable tiene que cuadrar con checked, o el
      // reporte miente sobre cuanto se cubrio en la corrida.
      supabaseMock.__queue('tenants', {
        data: [tenantRow('t1', 'active'), tenantRow('t2', 'active'), tenantRow('t3', 'active')],
        error: null,
      });
      const fetchPreapproval = vi
        .fn()
        .mockResolvedValueOnce({ status: 'authorized' })
        .mockRejectedValueOnce(new Error('MP 503'))
        .mockResolvedValueOnce({ status: 'cancelled' });
      const process = vi.fn().mockResolvedValue({ ok: true, data: { received: true } });

      const report = await reconcileSubscriptions({ fetchPreapproval, process });

      expect(report.inSync + report.repaired + report.unreachable).toBe(report.checked);
      expect(report.checked).toBe(3);
    });
  });
});