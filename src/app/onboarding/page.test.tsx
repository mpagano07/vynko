import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ImgHTMLAttributes } from 'react';
import OnboardingPage from './page';
import { useAuth } from '@/lib/hooks/useAuth';

const { replaceMock } = vi.hoisted(() => ({ replaceMock: vi.fn() }));

const sessionMock = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn() }),
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

describe('OnboardingPage guard', () => {
  beforeEach(() => {
    replaceMock.mockClear();
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
    await vi.waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/dashboard'));
    expect(screen.queryByText('Configura tu empresa')).not.toBeInTheDocument();
  });

  it('redirige al dashboard si /api/session devuelve un tenant activo', async () => {
    mockSession({ access_token: 'token', refresh_token: 'refresh' });
    mockApiSession({ tenants: [], tenant: { id: 't1' } });

    render(<OnboardingPage />);

    await vi.waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/dashboard'));
    expect(screen.queryByText('Configura tu empresa')).not.toBeInTheDocument();
  });

  it('muestra el formulario solo para usuarios sin empresa', async () => {
    mockSession({ access_token: 'token', refresh_token: 'refresh' });
    mockApiSession({ tenants: [], tenant: null });

    render(<OnboardingPage />);

    expect(await screen.findByText('Configura tu empresa')).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalledWith('/dashboard');
  });

  it('redirige a login si no hay sesión', async () => {
    mockSession(null);

    render(<OnboardingPage />);

    await vi.waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/login'));
  });
});
