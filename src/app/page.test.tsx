import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { AnchorHTMLAttributes, ImgHTMLAttributes, ReactNode } from 'react';
import LandingPage from './page';
import { useAuth } from '@/lib/hooks/useAuth';
import { hasStoredSession } from '@/lib/contexts/auth-context';

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children?: ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

vi.mock('next/image', () => ({
  default: ({ src, alt, ...rest }: ImgHTMLAttributes<HTMLImageElement> & { src: string; alt: string }) => (
    // eslint-disable-next-line @next/next/no-img-element -- mock del componente Image
    <img src={src} alt={alt} {...rest} />
  ),
}));

vi.mock('recharts', () => {
  const PassThrough = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    ResponsiveContainer: PassThrough,
    BarChart: PassThrough,
    Bar: PassThrough,
    XAxis: PassThrough,
    YAxis: PassThrough,
    CartesianGrid: PassThrough,
  };
});

vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: vi.fn(),
}));

vi.mock('@/lib/contexts/auth-context', () => ({
  hasStoredSession: vi.fn(),
}));

const authMock = vi.mocked(useAuth);
const hasSessionMock = vi.mocked(hasStoredSession);

function mockUseAuth(overrides: Partial<ReturnType<typeof useAuth>> = {}) {
  authMock.mockReturnValue({
    user: null,
    profile: null,
    tenant: null,
    tenants: [],
    role: null,
    loading: true,
    logout: vi.fn(),
    isAuthenticated: false,
    allTenants: false,
    loadProfileAndTenant: vi.fn(),
    switchTenant: vi.fn(),
    ...overrides,
  });
}

function getNavbar() {
  return within(screen.getByRole('navigation'));
}

function makeUser(email: string) {
  return {
    id: 'u1',
    aud: 'authenticated',
    role: 'authenticated',
    email,
    email_confirmed_at: '2026-01-01T00:00:00.000Z',
    confirmed_at: '2026-01-01T00:00:00.000Z',
    last_sign_in_at: '2026-01-01T00:00:00.000Z',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: { email },
    identities: [],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

describe('LandingPage navbar', () => {
  beforeEach(() => {
    pushMock.mockClear();
    authMock.mockReset();
    hasSessionMock.mockReset();
  });

  it('con cookie de sesión y usuario aún cargando, muestra "Mi cuenta" y no el botón de logout vacío', () => {
    hasSessionMock.mockReturnValue(true);
    mockUseAuth({ user: null, profile: null, loading: true });

    render(<LandingPage />);

    const accountLink = getNavbar().getByRole('link', { name: 'Mi cuenta' });
    expect(accountLink).toHaveAttribute('href', '/dashboard');
    expect(getNavbar().getByRole('button', { name: 'Cerrar sesión' })).toBeInTheDocument();
    expect(getNavbar().queryByRole('link', { name: 'Iniciar sesión' })).not.toBeInTheDocument();
    expect(getNavbar().queryByRole('link', { name: 'Comenzar gratis' })).not.toBeInTheDocument();
  });

  it('con usuario y profile cargados, muestra el nombre real', () => {
    hasSessionMock.mockReturnValue(true);
    mockUseAuth({
      user: makeUser('ana@tienda.com'),
      profile: { id: 'u1', email: 'ana@tienda.com', full_name: 'Ana García' },
      loading: false,
    });

    render(<LandingPage />);

    expect(getNavbar().getByRole('link', { name: 'Ana García' })).toHaveAttribute('href', '/dashboard');
    expect(getNavbar().getByRole('button', { name: 'Cerrar sesión' })).toBeInTheDocument();
  });

  it('con usuario cargado pero sin profile, usa el email como fallback', () => {
    hasSessionMock.mockReturnValue(true);
    mockUseAuth({
      user: makeUser('ana@tienda.com'),
      profile: null,
      loading: false,
    });

    render(<LandingPage />);

    expect(getNavbar().getByRole('link', { name: 'ana@tienda.com' })).toHaveAttribute('href', '/dashboard');
    expect(getNavbar().getByRole('button', { name: 'Cerrar sesión' })).toBeInTheDocument();
  });

  it('sin sesión y chequeando, muestra el skeleton sin botones', () => {
    hasSessionMock.mockReturnValue(false);
    mockUseAuth({ user: null, profile: null, loading: true });

    render(<LandingPage />);

    expect(getNavbar().queryByRole('link', { name: 'Mi cuenta' })).not.toBeInTheDocument();
    expect(getNavbar().queryByRole('button', { name: 'Cerrar sesión' })).not.toBeInTheDocument();
    expect(getNavbar().queryByRole('link', { name: 'Iniciar sesión' })).not.toBeInTheDocument();
    expect(getNavbar().queryByRole('link', { name: 'Comenzar gratis' })).not.toBeInTheDocument();
  });

  it('sin sesión y chequeo terminado, muestra Iniciar sesión / Comenzar gratis', () => {
    hasSessionMock.mockReturnValue(false);
    mockUseAuth({ user: null, profile: null, loading: false });

    render(<LandingPage />);

    expect(getNavbar().getByRole('link', { name: 'Iniciar sesión' })).toHaveAttribute('href', '/login');
    expect(getNavbar().getByRole('link', { name: 'Comenzar gratis' })).toHaveAttribute('href', '/auth/signup');
    expect(getNavbar().queryByRole('button', { name: 'Cerrar sesión' })).not.toBeInTheDocument();
  });

  it('al hacer click en Cerrar sesión desloguea y vuelve al index', async () => {
    const logoutMock = vi.fn().mockResolvedValue(undefined);
    hasSessionMock.mockReturnValue(true);
    mockUseAuth({
      user: makeUser('ana@tienda.com'),
      profile: null,
      loading: false,
      logout: logoutMock,
    });

    render(<LandingPage />);

    fireEvent.click(getNavbar().getByRole('button', { name: 'Cerrar sesión' }));

    await waitFor(() => expect(logoutMock).toHaveBeenCalled());
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/'));
  });
});
