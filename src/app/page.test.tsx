import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { AnchorHTMLAttributes, ImgHTMLAttributes, ReactNode } from 'react';
import LandingPage from './page';
import { useAuth } from '@/lib/hooks/useAuth';

const { pushMock, replaceMock } = vi.hoisted(() => ({ pushMock: vi.fn(), replaceMock: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock }),
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

const authMock = vi.mocked(useAuth);

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
    refreshSession: vi.fn(async () => true),
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
    replaceMock.mockClear();
    authMock.mockReset();
    window.history.pushState({}, '', '/');
  });

  it('con la sesión todavía resolviéndose, muestra el skeleton y no el navbar de usuario', () => {
    // Antes se decidia el navbar leyendo la cookie desde el navegador, así que
    // mientras cargaba se mostraba "Mi cuenta" y después parpadeaba a
    // "Iniciar sesión" si la sesión no existía. Con la cookie HttpOnly no se
    // puede saber antes de preguntarle al servidor, así que se espera.
    mockUseAuth({ user: null, profile: null, loading: true });

    render(<LandingPage />);

    expect(getNavbar().queryByRole('link', { name: 'Mi cuenta' })).not.toBeInTheDocument();
    expect(getNavbar().queryByRole('button', { name: 'Cerrar sesión' })).not.toBeInTheDocument();
    expect(getNavbar().queryByRole('link', { name: 'Iniciar sesión' })).not.toBeInTheDocument();
    expect(getNavbar().queryByRole('link', { name: 'Comenzar gratis' })).not.toBeInTheDocument();
  });

  it('con usuario y profile cargados, muestra el nombre real', () => {
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
    mockUseAuth({ user: null, profile: null, loading: true });

    render(<LandingPage />);

    expect(getNavbar().queryByRole('link', { name: 'Mi cuenta' })).not.toBeInTheDocument();
    expect(getNavbar().queryByRole('button', { name: 'Cerrar sesión' })).not.toBeInTheDocument();
    expect(getNavbar().queryByRole('link', { name: 'Iniciar sesión' })).not.toBeInTheDocument();
    expect(getNavbar().queryByRole('link', { name: 'Comenzar gratis' })).not.toBeInTheDocument();
  });

  it('sin sesión y chequeo terminado, muestra Iniciar sesión / Comenzar gratis', () => {
    mockUseAuth({ user: null, profile: null, loading: false });

    render(<LandingPage />);

    expect(getNavbar().getByRole('link', { name: 'Iniciar sesión' })).toHaveAttribute('href', '/login');
    expect(getNavbar().getByRole('link', { name: 'Comenzar gratis' })).toHaveAttribute('href', '/auth/signup');
    expect(getNavbar().queryByRole('button', { name: 'Cerrar sesión' })).not.toBeInTheDocument();
  });

  it('sesión resuelta como anónima: no redirige ni muestra navbar de usuario', async () => {
    // El guard de "hay cookie pero el cliente no vio usuario" se elimino a
    // proposito: dependia de leer la cookie desde el navegador. Ahora si no hay
    // usuario es porque el servidor dijo que no hay sesion, y la respuesta
    // correcta es quedarse en la landing como visitante, sin adivinar.
    window.history.pushState({}, '', '/?code=confirm');
    mockUseAuth({ user: null, profile: null, loading: false, tenants: [] });

    render(<LandingPage />);

    expect(getNavbar().getByRole('link', { name: 'Iniciar sesión' })).toBeInTheDocument();
    expect(getNavbar().queryByRole('link', { name: 'Mi cuenta' })).not.toBeInTheDocument();
    expect(getNavbar().queryByRole('button', { name: 'Cerrar sesión' })).not.toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('con usuario autenticado sin empresa, redirige a /onboarding (post-confirmación)', async () => {
    window.history.pushState({}, '', '/?code=confirm');
    mockUseAuth({
      user: makeUser('ana@tienda.com'),
      profile: null,
      loading: false,
      tenants: [],
      loadProfileAndTenant: vi.fn(),
    });

    render(<LandingPage />);

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/onboarding'));
  });

  it('con usuario autenticado con empresa, redirige a /dashboard', async () => {
    window.history.pushState({}, '', '/?code=confirm');
    mockUseAuth({
      user: makeUser('ana@tienda.com'),
      profile: null,
      loading: false,
      tenant: { id: 't1', name: 'Mi Tienda', slug: 'mi-tienda' },
      tenants: [{ id: 't1', name: 'Mi Tienda', slug: 'mi-tienda' }],
      loadProfileAndTenant: vi.fn(),
    });

    render(<LandingPage />);

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/dashboard'));
  });

  it('usuario logueado que navega a la landing sin código de confirmación, redirige a /dashboard', async () => {
    window.history.pushState({}, '', '/');
    mockUseAuth({
      user: makeUser('ana@tienda.com'),
      profile: null,
      loading: false,
      tenant: { id: 't1', name: 'Mi Tienda', slug: 'mi-tienda' },
      tenants: [{ id: 't1', name: 'Mi Tienda', slug: 'mi-tienda' }],
      loadProfileAndTenant: vi.fn(),
    });

    render(<LandingPage />);

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/dashboard'));
  });

  it('al hacer click en Cerrar sesión desloguea y vuelve al index', async () => {
    const logoutMock = vi.fn().mockResolvedValue(undefined);
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

describe('LandingPage waitlist', () => {
  beforeEach(() => {
    authMock.mockReset();
    pushMock.mockClear();
    replaceMock.mockClear();
    mockUseAuth({ loading: false });
  });

  function getForm() {
    const input = screen.getByPlaceholderText('tu@email.com');
    return { input, form: input.closest('form') as HTMLFormElement };
  }

  it('muestra un error si se envía sin email', async () => {
    render(<LandingPage />);

    fireEvent.submit(getForm().form);

    expect(await screen.findByText('Ingresá tu email para continuar')).toBeInTheDocument();
  });

  it('muestra un error si el email no es válido y limpia el error al tipear', async () => {
    render(<LandingPage />);

    fireEvent.submit(getForm().form);
    expect(await screen.findByText('Ingresá tu email para continuar')).toBeInTheDocument();

    const { input, form } = getForm();
    fireEvent.change(input, { target: { value: 'no-es-un-email' } });
    expect(screen.queryByText('Ingresá tu email para continuar')).not.toBeInTheDocument();

    fireEvent.submit(form);
    expect(await screen.findByText('Email inválido')).toBeInTheDocument();
  });

  it('con email válido, redirige al registro con el email cargado', async () => {
    render(<LandingPage />);

    const { input, form } = getForm();
    fireEvent.change(input, { target: { value: 'ana@tienda.com' } });
    fireEvent.submit(form);

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/auth/signup?email=ana%40tienda.com'));
  });
});
