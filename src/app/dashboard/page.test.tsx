import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import DashboardPage from './page';
import { useAuth } from '@/lib/hooks/useAuth';

const { replaceMock, pushMock } = vi.hoisted(() => ({ replaceMock: vi.fn(), pushMock: vi.fn() }));
const getSessionMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, push: pushMock }),
}));

vi.mock('next/dynamic', () => ({
  default: () => {
    const MockDynamic = () => <div data-testid="dynamic-block" />;
    return MockDynamic;
  },
}));

vi.mock('next/link', () => ({
  default: ({ href, children }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: vi.fn(),
}));

vi.mock('@/lib/supabaseClient', () => ({
  supabase: { auth: { getSession: getSessionMock } },
}));

const authMock = vi.mocked(useAuth);

function mockAuth(overrides: Partial<ReturnType<typeof useAuth>> = {}) {
  authMock.mockReturnValue({
    user: null,
    profile: null,
    tenant: null,
    tenants: [],
    role: null,
    loading: false,
    logout: vi.fn(),
    isAuthenticated: true,
    allTenants: false,
    loadProfileAndTenant: vi.fn(),
    switchTenant: vi.fn(),
    ...overrides,
  });
}

const fetchHandler = vi.fn();

function setupSession() {
  getSessionMock.mockResolvedValue({
    data: { session: { access_token: 'tok', refresh_token: 'ref' } },
  });
}

function mockSuccessfulEndpoints() {
  fetchHandler.mockImplementation((url: string) => {
    if (url.includes('/api/sales?today')) {
      return Promise.resolve({
        ok: true,
        json: async () => [{ total_cents: 12500 }, { total_cents: 7500 }],
      });
    }
    if (url.includes('/api/sales/monthly')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          total: 10000,
          saleCount: 4,
          prevTotal: 8000,
          variationPercent: 25,
          avgTicket: 2500,
        }),
      });
    }
    if (url.includes('/api/products/critical')) {
      return Promise.resolve({
        ok: true,
        json: async () => [{ id: 'p1', name: 'Coca', stock: 2, min_stock: 5 }],
      });
    }
    if (url.includes('/api/purchase-orders/pending')) {
      return Promise.resolve({
        ok: true,
        json: async () => [
          { id: 'po1', status: 'pending', expected_date: null, created_at: 'x', supplier_name: 'S', items: [] },
        ],
      });
    }
    return Promise.resolve({ ok: false, json: async () => ({}) });
  });
}

describe('DashboardPage: compuerta de onboarding (regresión)', () => {
  beforeEach(() => {
    replaceMock.mockClear();
    pushMock.mockClear();
    getSessionMock.mockReset();
    getSessionMock.mockResolvedValue({ data: { session: null } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
  });

  it('con sucursales pero sin tenant activo, NO redirige a onboarding y auto-selecciona la primera', async () => {
    const switchTenant = vi.fn();
    mockAuth({
      tenants: [{ id: 't1', name: 'Central', slug: 'central' }],
      tenant: null,
      switchTenant,
    });

    render(<DashboardPage />);

    await vi.waitFor(() => expect(switchTenant).toHaveBeenCalledWith('t1'));
    expect(replaceMock).not.toHaveBeenCalledWith('/onboarding');
  });

  it('sin sucursales, redirige a onboarding', async () => {
    mockAuth({ tenants: [], tenant: null });

    render(<DashboardPage />);

    await vi.waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/onboarding'));
  });

  it('con tenant activo no redirige ni cambia de sucursal', async () => {
    const switchTenant = vi.fn();
    mockAuth({
      tenants: [{ id: 't1', name: 'Central', slug: 'central' }],
      tenant: { id: 't1', name: 'Central', slug: 'central' },
      switchTenant,
    });

    render(<DashboardPage />);

    expect(switchTenant).not.toHaveBeenCalled();
    expect(replaceMock).not.toHaveBeenCalledWith('/onboarding');
    expect(screen.getByRole('heading', { name: /Hola/ })).toBeInTheDocument();
  });
});

describe('DashboardPage: redirecciones de sesión', () => {
  beforeEach(() => {
    replaceMock.mockClear();
    pushMock.mockClear();
    getSessionMock.mockReset();
    getSessionMock.mockResolvedValue({ data: { session: null } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
  });

  it('redirige a login cuando no está autenticado', async () => {
    mockAuth({ isAuthenticated: false });

    render(<DashboardPage />);

    await vi.waitFor(() => expect(pushMock).toHaveBeenCalledWith('/login'));
  });
});

describe('DashboardPage: carga de datos de un tenant', () => {
  beforeEach(() => {
    replaceMock.mockClear();
    pushMock.mockClear();
    getSessionMock.mockReset();
    getSessionMock.mockResolvedValue({ data: { session: null } });
    fetchHandler.mockReset();
    vi.stubGlobal('fetch', fetchHandler);
  });

  it('renderiza métricas y el estado según el stock crítico', async () => {
    setupSession();
    mockSuccessfulEndpoints();
    mockAuth({
      profile: { id: 'user-1', email: 'ana@tienda.com', full_name: 'Ana García' },
      tenant: { id: 't1', name: 'Central', slug: 'central' },
      tenants: [{ id: 't1', name: 'Central', slug: 'central' }],
    });

    render(<DashboardPage />);

    expect(screen.getByRole('heading', { name: 'Hola, Ana 👋' })).toBeInTheDocument();
    expect(screen.getByText('Central')).toBeInTheDocument();

    expect(await screen.findByText('Tenés 1 producto con stock crítico.')).toBeInTheDocument();
    expect(screen.getByText('+25%')).toBeInTheDocument();
    expect(screen.getByText('2 ventas')).toBeInTheDocument();
    expect(screen.getByText('productos por reponer')).toBeInTheDocument();

    const authHeaderCalls = fetchHandler.mock.calls.filter(([, init]) => {
      const headers = (init as RequestInit | undefined)?.headers as Record<string, string> | undefined;
      return headers?.Authorization === 'Bearer tok';
    });
    expect(authHeaderCalls.length).toBeGreaterThan(0);
  });

  it('muestra el estado sin ventas cuando la API no devuelve ventas hoy', async () => {
    setupSession();
    fetchHandler.mockImplementation((url: string) => {
      if (url.includes('/api/sales?today')) return Promise.resolve({ ok: true, json: async () => [] });
      return Promise.resolve({ ok: false, json: async () => ({}) });
    });
    mockAuth({ tenant: { id: 't1', name: 'Central', slug: 'central' } });

    render(<DashboardPage />);

    expect(await screen.findByText('Hoy todavía no registraste ventas.')).toBeInTheDocument();
    expect(screen.getByText('Sin ventas')).toBeInTheDocument();
  });
});

describe('DashboardPage: desglose multi-sucursal', () => {
  beforeEach(() => {
    replaceMock.mockClear();
    pushMock.mockClear();
    getSessionMock.mockReset();
    getSessionMock.mockResolvedValue({ data: { session: null } });
    fetchHandler.mockReset();
    vi.stubGlobal('fetch', fetchHandler);
  });

  it('agrega ventas de todas las sucursales y muestra el desglose', async () => {
    setupSession();
    mockSuccessfulEndpoints();
    mockAuth({
      allTenants: true,
      tenant: null,
      tenants: [
        { id: 't1', name: 'Central', slug: 'central' },
        { id: 't2', name: 'Norte', slug: 'norte' },
      ],
    });

    render(<DashboardPage />);

    expect(await screen.findByText('Todas las sucursales')).toBeInTheDocument();
    expect(await screen.findByText('Desglose por sucursal')).toBeInTheDocument();

    // sumas agregadas: 2 ventas de hoy por sucursal (12500 + 7500) => hoy $200 total
    expect(screen.getByText('Tenés 2 productos con stock crítico.')).toBeInTheDocument();

    // filas del desglose: cada sucursal con sus métricas
    const rows = screen.getAllByRole('row');
    const centralRow = rows.find((r) => r.textContent?.includes('Central'));
    const norteRow = rows.find((r) => r.textContent?.includes('Norte'));
    expect(centralRow).toBeTruthy();
    expect(norteRow).toBeTruthy();

    expect(fetchHandler).toHaveBeenCalledTimes(8); // 4 endpoints x 2 sucursales
  });
});