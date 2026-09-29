import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { trackEvent, trackAppReturn } from './track-event';
import { supabaseMock } from '@/test/supabase-mock';

vi.mock('@/lib/supabaseAdmin', async () => {
  const mod = await import('@/test/supabase-mock');
  return { supabaseAdmin: mod.supabaseMock };
});

function insertCalls() {
  return supabaseMock.__calls.filter((c) => c.table === 'analytics_events' && c.method === 'insert');
}

describe('track-event', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('graba el evento con user_id para poder atribuirlo a una persona', async () => {
    // Sin user_id el embudo no se puede construir: habria que atribuir por
    // email, y un mismo usuario tiene varias sucursales.
    supabaseMock.__queue('analytics_events', { data: null, error: null });

    await trackEvent({
      type: 'signup',
      userId: 'user-1',
      userEmail: 'a@b.com',
      userName: 'Ana',
      metadata: { via: 'email' },
    });

    expect(insertCalls()).toHaveLength(1);
    expect(insertCalls()[0]?.args[0]).toEqual({
      event_type: 'signup',
      user_id: 'user-1',
      user_email: 'a@b.com',
      user_name: 'Ana',
      tenant_id: null,
      metadata: { via: 'email' },
    });
  });

  it('no consulta profiles si ya viene el nombre y el email', async () => {
    supabaseMock.__queue('analytics_events', { data: null, error: null });

    await trackEvent({ type: 'signup', userId: 'user-1', userEmail: 'a@b.com', userName: 'Ana' });

    expect(supabaseMock.__calls.some((c) => c.table === 'profiles')).toBe(false);
  });

  it('resuelve email y nombre desde profiles si no vienen', async () => {
    supabaseMock.__queue('profiles', { data: { email: 'a@b.com', full_name: 'Ana' }, error: null });
    supabaseMock.__queue('analytics_events', { data: null, error: null });

    await trackEvent({ type: 'product_created', userId: 'user-1' });

    expect(insertCalls()[0]?.args[0]).toMatchObject({
      user_id: 'user-1',
      user_email: 'a@b.com',
      user_name: 'Ana',
    });
  });

  it('no inserta un first_* que ya existe', async () => {
    // El chequeo previo evita el round-trip del insert en el caso comun. La
    // garantia real de unicidad es el indice parcial de la migracion 040.
    supabaseMock.__queue('analytics_events', { data: { id: 'evt-1' }, error: null });

    await trackEvent({ type: 'first_sale', userId: 'user-1' });

    expect(insertCalls()).toHaveLength(0);
  });

  it('inserta un first_* que es el primero', async () => {
    supabaseMock.__queue('analytics_events', { data: null, error: null });
    supabaseMock.__queue('profiles', { data: null, error: null });
    supabaseMock.__queue('analytics_events', { data: null, error: null });

    await trackEvent({ type: 'first_sale', userId: 'user-1' });

    expect(insertCalls()).toHaveLength(1);
  });

  it('no loguea el 23505 de dos first_* simultaneos', async () => {
    // Dos cajas abiertas al mismo tiempo hacen dos requests. Gana una y la
    // otra recibe unique_violation: es el comportamiento buscado, no un error.
    supabaseMock.__queue('analytics_events', { data: null, error: null });
    supabaseMock.__queue('profiles', { data: null, error: null });
    supabaseMock.__queue('analytics_events', { data: null, error: { code: '23505', message: 'duplicate' } });

    await trackEvent({ type: 'first_cash_open', userId: 'user-1' });

    expect(console.error).not.toHaveBeenCalled();
  });

  it('loguea el error si el insert falla con otro codigo', async () => {
    // 23514 = check_violation: el tipo no esta en la constraint. Pasa si la
    // migracion 040 todavia no se aplico, y hay que enterarse.
    supabaseMock.__queue('analytics_events', { data: null, error: null });
    supabaseMock.__queue('profiles', { data: null, error: null });
    supabaseMock.__queue('analytics_events', { data: null, error: { code: '23514', message: 'check' } });

    await trackEvent({ type: 'first_purchase', userId: 'user-1' });

    expect(console.error).toHaveBeenCalledWith(
      '[analytics] no se pudo grabar first_purchase:',
      'check'
    );
  });

  it('nunca tira, aunque el insert explote', async () => {
    // La venta que el usuario estaba haciendo tiene que guardarse igual: un
    // evento de analytics es telemetria, no parte del negocio.
    supabaseMock.__queue('analytics_events', { data: null, error: null });
    supabaseMock.__queue('profiles', { data: null, error: null });
    supabaseMock.__queue('analytics_events', { data: null, error: { code: '99999', message: 'boom' } });

    await expect(trackEvent({ type: 'first_sale', userId: 'user-1' })).resolves.toBeUndefined();
  });

  it('ignora el evento si no hay userId', async () => {
    await trackEvent({ type: 'signup', userId: '' });

    expect(insertCalls()).toHaveLength(0);
  });
});

describe('trackAppReturn', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('graba el primer app_return', async () => {
    supabaseMock.__queue('analytics_events', { data: null, error: null });
    supabaseMock.__queue('analytics_events', { data: null, error: null });
    supabaseMock.__queue('profiles', { data: null, error: null });
    supabaseMock.__queue('analytics_events', { data: null, error: null });

    await trackAppReturn({ userId: 'user-1' });

    expect(insertCalls()).toHaveLength(1);
    expect(insertCalls()[0]?.args[0]).toMatchObject({ event_type: 'app_return' });
  });

  it('corta si el ultimo volvio hace menos de 24 horas', async () => {
    // Sin este corte, un usuario que abre la app 50 veces al dia genera 50
    // filas y el paso de retencion queda tapado por el ruido.
    const hace2h = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    supabaseMock.__queue('analytics_events', { data: { created_at: hace2h }, error: null });

    await trackAppReturn({ userId: 'user-1' });

    expect(insertCalls()).toHaveLength(0);
  });

  it('graba si el ultimo volvio hace mas de 24 horas', async () => {
    const hace30h = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString();
    supabaseMock.__queue('analytics_events', { data: { created_at: hace30h }, error: null });
    supabaseMock.__queue('analytics_events', { data: null, error: null });
    supabaseMock.__queue('profiles', { data: null, error: null });
    supabaseMock.__queue('analytics_events', { data: null, error: null });

    await trackAppReturn({ userId: 'user-1' });

    expect(insertCalls()).toHaveLength(1);
  });
});
