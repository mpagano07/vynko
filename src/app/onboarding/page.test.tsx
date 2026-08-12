import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ImgHTMLAttributes } from 'react';
import OnboardingPage from './page';
import { useAuth } from '@/lib/hooks/useAuth';
import toast from 'react-hot-toast';

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));

const sessionMock = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => router,
}));

vi.mock('next/image', () => ({
  default: ({ src, alt, ...rest }: ImgHTMLAttributes<HTMLImageElement> & { src: string; alt: string }) => (
    // eslint-disable-next-line @next/next/no-img-element -- mock del componente Image
    <img src={src} alt={alt} {...rest} />
  ),
}));

vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: sessionMock,
    },
  },
}));

vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

const authMock = vi.mocked(useAuth);

function mockSession(session: unknown) {
  sessionMock.mockResolvedValue({ data: { session } });
}

function mockApiSession(body: unknown, ok = true) {
  fetchMock.mockResolvedValue({
    ok,
    json: async () => body,
  });
}

function fillCompanyForm() {
  fireEvent.change(screen.getByPlaceholderText('Mi Tienda'), { target: { value: 'Mi Shop' } });
  fireEvent.change(screen.getByPlaceholderText('Juan Pérez'), { target: { value: 'Ana' } });
  const form = screen.getByRole('button', { name: 'Crear empresa' }).closest('form') as HTMLFormElement;
  fireEvent.submit(form);
}

describe('OnboardingPage guard', () => {
  beforeEach(() => {
    router.replace.mockClear();
    router.push.mockClear();
    fetchMock.mockReset();
    sessionMock.mockReset();
    authMock.mockReturnValue({ switchTenant: vi.fn() } as unknown as ReturnType<typeof useAuth>);
    vi.stubGlobal('fetch', fetchMock);
  });

  it('redirige al dashboard si el usuario ya tiene una empresa', async () => {
    mockSession({ access_token: 'token', refresh_token: 'refresh' });
    mockApiSession({ tenants: [{ id: 't1' }], tenant: { id: 't1' } });

    render(<OnboardingPage />);

    await screen.findByText(/Verificando tu cuenta/i);
    await vi.waitFor(() => expect(router.replace).toHaveBeenCalledWith('/dashboard'));
    expect(screen.queryByText('Configura tu empresa')).not.toBeInTheDocument();
  });

  it('redirige al dashboard si /api/session devuelve un tenant activo', async () => {
    mockSession({ access_token: 'token', refresh_token: 'refresh' });
    mockApiSession({ tenants: [], tenant: { id: 't1' } });

    render(<OnboardingPage />);

    await vi.waitFor(() => expect(router.replace).toHaveBeenCalledWith('/dashboard'));
    expect(screen.queryByText('Configura tu empresa')).not.toBeInTheDocument();
  });

  it('muestra el formulario solo para usuarios sin empresa', async () => {
    mockSession({ access_token: 'token', refresh_token: 'refresh' });
    mockApiSession({ tenants: [], tenant: null });

    render(<OnboardingPage />);

    expect(await screen.findByText('Configura tu empresa')).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalledWith('/dashboard');
  });

  it('redirige a login si no hay sesión', async () => {
    mockSession(null);

    render(<OnboardingPage />);

    await vi.waitFor(() => expect(router.replace).toHaveBeenCalledWith('/login'));
  });

  it('muestra el formulario si la verificación de sesión falla', async () => {
    mockSession({ access_token: 'token', refresh_token: 'refresh' });
    fetchMock.mockRejectedValueOnce(new Error('network'));

    render(<OnboardingPage />);

    expect(await screen.findByText('Configura tu empresa')).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalledWith('/dashboard');
  });
});

describe('OnboardingPage formulario de empresa', () => {
  beforeEach(() => {
    router.replace.mockClear();
    router.push.mockClear();
    fetchMock.mockReset();
    sessionMock.mockReset();
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
    mockSession({ access_token: 'token', refresh_token: 'refresh' });
    authMock.mockReturnValue({ switchTenant: vi.fn() } as unknown as ReturnType<typeof useAuth>);
    vi.stubGlobal('fetch', fetchMock);
  });

  it('crea la empresa, muestra el success y redirige al dashboard', async () => {
    const switchTenant = vi.fn().mockResolvedValue(undefined);
    authMock.mockReturnValue({ switchTenant } as unknown as ReturnType<typeof useAuth>);

    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ tenants: [], tenant: null }) }) // guard /api/session
      .mockResolvedValueOnce({ ok: true, json: async () => ({ tenantId: 't1' }) }); // POST /api/onboarding

    render(<OnboardingPage />);

    await screen.findByText('Configura tu empresa');
    fillCompanyForm();

    expect(await screen.findByText(/¡Bienvenido!/)).toBeInTheDocument();
    expect(screen.getByText(/Tu empresa Mi Shop ha sido creada/i)).toBeInTheDocument();

    await waitFor(() => expect(switchTenant).toHaveBeenCalledWith('t1'));
    expect(router.push).toHaveBeenCalledWith('/dashboard');
    expect(toast.success).toHaveBeenCalled();
  });

  it('muestra toast de error cuando la API falla y mantiene el formulario', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ tenants: [], tenant: null }) })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'No se pudo crear la empresa' }),
      });

    render(<OnboardingPage />);

    await screen.findByText('Configura tu empresa');
    fillCompanyForm();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('No se pudo crear la empresa'));
    expect(screen.queryByText(/¡Bienvenido!/)).not.toBeInTheDocument();
    expect(screen.getByText('Crear empresa')).toBeInTheDocument();
  });
});