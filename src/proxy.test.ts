import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { checkSubscriptionBlocked } from '@/lib/checkSubscription';

vi.mock('@supabase/ssr', () => ({ createServerClient: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/checkSubscription', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/checkSubscription')>();
  return { ...original, checkSubscriptionBlocked: vi.fn() };
});

const serverClientMock = vi.mocked(createServerClient);
const adminClientMock = vi.mocked(createClient);
const subscriptionMock = vi.mocked(checkSubscriptionBlocked);

let adminQueue: Array<Record<string, unknown> | null>;

function makeServerClient(user: { id: string } | null) {
  const getUser = vi.fn().mockResolvedValue({ data: { user }, error: null });
  serverClientMock.mockImplementation(() => {
    return { auth: { getUser } } as never;
  });
}

function makeAdminClient() {
  adminClientMock.mockReturnValue({
    from: () => {
      const builder = {
        select: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        in: vi.fn(() => builder),
        single: () => Promise.resolve(adminQueue.shift() ?? { data: null, error: null }),
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve(adminQueue.shift() ?? { data: null, error: null }).then(resolve),
      };
      return builder as never;
    },
  } as never);
}

function request(pathname = '/dashboard') {
  return new NextRequest(`http://localhost${pathname}`);
}

describe('proxy: compuerta de onboarding (regresión: usuario con cuenta no debe caer en onboarding)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    adminQueue = [];
    subscriptionMock.mockReturnValue({ blocked: false });
    makeServerClient({ id: 'user-1' });
    makeAdminClient();
  });

  it('no redirige a onboarding si el usuario tiene una empresa', async () => {
    adminQueue.push({ data: [{ tenant_id: 't1' }], error: null });
    adminQueue.push({ data: [{ subscription_status: 'active' }], error: null });

    const res = await proxy(request('/dashboard'));

    expect(res.status).toBe(200);
    expect(res.headers.get('x-tenant-id')).toBe('t1');
  });

  it('NO redirige a onboarding cuando la query de membresías falla (fail open)', async () => {
    // Ej: token en pleno refresh / error transitorio de RLS en el arranque.
    adminQueue.push({ data: null, error: { message: 'auth/invalid JWT' } });

    const res = await proxy(request('/dashboard'));

    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  it('redirige a onboarding SOLO ante una membresía definitivamente vacía', async () => {
    adminQueue.push({ data: [], error: null });

    const res = await proxy(request('/dashboard'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/onboarding');
  });

  it('redirige a login si no hay sesión', async () => {
    makeServerClient(null);

    const res = await proxy(request('/dashboard'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
  });

  it('permite el acceso a la raíz sin autenticación', async () => {
    makeServerClient(null);

    const res = await proxy(request('/'));

    expect(res.status).toBe(200);
  });

  it('permite el acceso a rutas públicas sin autenticación', async () => {
    makeServerClient(null);

    for (const p of ['/login', '/auth', '/auth/callback', '/onboarding', '/accept-invite']) {
      const res = await proxy(request(p));
      expect(res.status).toBe(200);
    }
  });

  it('redirige a /billing cuando la suscripción del tenant está bloqueada', async () => {
    subscriptionMock.mockReturnValue({
      blocked: true,
      reason: 'trial_expired',
      message: 'Tu período de prueba finalizó.',
    });
    adminQueue.push({ data: [{ tenant_id: 't1' }], error: null });
    adminQueue.push({ data: [{ subscription_status: 'free', subscription_plan: 'starter' }], error: null });

    const res = await proxy(request('/dashboard'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/billing');
    expect(res.headers.get('location')).toContain('blocked=trial_expired');
  });

  it('consolida la suscripción de todas las sucursales del dueño (no bloquea si hay una activa)', async () => {
    subscriptionMock.mockImplementation(() => ({ blocked: false }));
    adminQueue.push({ data: [{ tenant_id: 't1' }, { tenant_id: 't2' }], error: null });
    adminQueue.push({
      data: [
        { subscription_status: 'free', subscription_plan: 'starter', created_at: '2026-06-10T00:00:00Z' },
        { subscription_status: 'active', subscription_plan: 'business', created_at: '2026-07-26T00:00:00Z' },
      ],
      error: null,
    });

    const res = await proxy(request('/dashboard'));

    expect(res.status).toBe(200);
    expect(res.headers.get('x-tenant-id')).toBe('t1');
  });

  it('no evalúa el bloqueo de suscripción en la página de billing', async () => {
    adminQueue.push({ data: [{ tenant_id: 't1' }], error: null });

    const res = await proxy(request('/billing'));

    expect(res.status).toBe(200);
    expect(res.headers.get('x-tenant-id')).toBe('t1');
    expect(subscriptionMock).not.toHaveBeenCalled();
  });

  it('sigue de largo si el tenant no existe (sin datos ni error)', async () => {
    adminQueue.push({ data: [{ tenant_id: 't1' }], error: null });
    adminQueue.push({ data: null, error: null });

    const res = await proxy(request('/dashboard'));

    expect(res.status).toBe(200);
    expect(res.headers.get('x-tenant-id')).toBe('t1');
    expect(subscriptionMock).not.toHaveBeenCalled();
  });
});
