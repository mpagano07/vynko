import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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

  it('con tenant activo no redirige ni cambia de sucursal', () => {
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
