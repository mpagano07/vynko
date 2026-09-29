import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ImgHTMLAttributes } from 'react';
import OnboardingPage from './page';
import { useAuth } from '@/lib/hooks/useAuth';
import toast from 'react-hot-toast';

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));

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

vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

const authMock = vi.mocked(useAuth);

// Con la cookie de sesion HttpOnly el componente no puede leer la sesion desde
// el navegador: decide a partir de la respuesta de `/api/session`, que es la
// unica fuente de verdad. Por eso `user` forma parte del body mockeado.
const AUTHENTICATED_USER = { id: 'u1', user_metadata: {} as Record<string, unknown> };

function mockApiSession(body: Record<string, unknown>, ok = true) {
  fetchMock.mockResolvedValue({
    ok,
    json: async () => ('user' in body ? body : { user: AUTHENTICATED_USER, ...body }),
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
    authMock.mockReturnValue({ setActiveTenant: vi.fn() } as unknown as ReturnType<typeof useAuth>);
    vi.stubGlobal('fetch', fetchMock);
    Object.defineProperty(window, 'location', {
      value: { href: '', reload: vi.fn(), replace: vi.fn() },
      writable: true,
      configurable: true,
    });
  });

  it('redirige al dashboard si el usuario ya tiene una empresa', async () => {
    mockApiSession({ tenants: [{ id: 't1' }], tenant: { id: 't1' } });

    render(<OnboardingPage />);

    await screen.findByText(/Verificando tu cuenta/i);
    await vi.waitFor(() => expect(window.location.replace).toHaveBeenCalledWith('/dashboard'));
    expect(screen.queryByText('Configura tu empresa')).not.toBeInTheDocument();
  });

  it('redirige al dashboard si /api/session devuelve un tenant activo', async () => {
    mockApiSession({ tenants: [], tenant: { id: 't1' } });

    render(<OnboardingPage />);

    await vi.waitFor(() => expect(window.location.replace).toHaveBeenCalledWith('/dashboard'));
    expect(screen.queryByText('Configura tu empresa')).not.toBeInTheDocument();
  });

  it('muestra el formulario solo para usuarios sin empresa', async () => {
    mockApiSession({ tenants: [], tenant: null });

    render(<OnboardingPage />);

    expect(await screen.findByText('Configura tu empresa')).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalledWith('/dashboard');
  });

  it('NO muestra el formulario si la DB marca onboarding completado aunque no haya sucursales', async () => {
    // Regresión: cuenta admin con empresa cuyo listado de sucursales llegue
    // vacío queda protegida por el flag onboarding_pending=false.
    mockApiSession({ tenants: [], tenant: null, onboarding_pending: false });

    render(<OnboardingPage />);

    await vi.waitFor(() => expect(window.location.replace).toHaveBeenCalledWith('/dashboard'));
    expect(screen.queryByText('Configura tu empresa')).not.toBeInTheDocument();
  });

  it('redirige a login si no hay sesión', async () => {
    // `user: null` es la señal de "sin sesión": el navegador no puede leer la
    // cookie, así que la respuesta del servidor es lo único que la delata.
    mockApiSession({ user: null, tenants: [], tenant: null });

    render(<OnboardingPage />);

    await vi.waitFor(() => expect(router.replace).toHaveBeenCalledWith('/login'));
  });

  it('NO muestra el formulario si la verificación falla: redirige al dashboard (fail closed)', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network'));

    render(<OnboardingPage />);

    await vi.waitFor(() => expect(window.location.replace).toHaveBeenCalledWith('/dashboard'));
    expect(screen.queryByText('Configura tu empresa')).not.toBeInTheDocument();
  });

  it('NO muestra el formulario si /api/session responde 404 con HTML (fail closed)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => {
        throw new Error("Unexpected token '<', \"<!DOCTYPE html>...");
      },
    });

    render(<OnboardingPage />);

    await vi.waitFor(() => expect(window.location.replace).toHaveBeenCalledWith('/dashboard'));
    expect(screen.queryByText('Configura tu empresa')).not.toBeInTheDocument();
  });
  it('crea la empresa automáticamente si user_metadata trae nombre/empresa del registro', async () => {
    const setActiveTenant = vi.fn();
    authMock.mockReturnValue({ setActiveTenant } as unknown as ReturnType<typeof useAuth>);

    fetchMock
      // guard /api/session: la metadata llega dentro de `user`
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          user: { id: 'u1', user_metadata: { company_name: 'Mi Ropa', full_name: 'Ana' } },
          tenants: [],
          tenant: null,
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ tenantId: 't1' }) }); // POST /api/onboarding

    render(<OnboardingPage />);

    expect(await screen.findByText(/¡Bienvenido!/)).toBeInTheDocument();
    expect(setActiveTenant).toHaveBeenCalledWith('t1');
    // Navegación dura, no `router.push`: si el router resuelve la transición sin
    // desmontar, el componente queda en `step === 'success'` y el usuario mira un
    // cartel que promete una redirección que no ocurre, sin error en consola.
    expect(window.location.replace).toHaveBeenCalledWith('/dashboard');
    expect(router.push).not.toHaveBeenCalledWith('/dashboard');
    expect(screen.queryByText('Configura tu empresa')).not.toBeInTheDocument();
  });

  it('si la auto-creación falla, muestra el formulario con nombre/empresa precargados', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          user: { id: 'u1', user_metadata: { company_name: 'Mi Ropa', full_name: 'Ana' } },
          tenants: [],
          tenant: null,
        }),
      })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'No se pudo crear' }) }); // POST /api/onboarding

    render(<OnboardingPage />);

    expect(await screen.findByText('Configura tu empresa')).toBeInTheDocument();
    expect((screen.getByPlaceholderText('Mi Tienda') as HTMLInputElement).value).toBe('Mi Ropa');
    expect((screen.getByPlaceholderText('Juan Pérez') as HTMLInputElement).value).toBe('Ana');
    expect(router.push).not.toHaveBeenCalledWith('/dashboard');
  });
});

describe('OnboardingPage formulario de empresa', () => {
  beforeEach(() => {
    router.replace.mockClear();
    router.push.mockClear();
    fetchMock.mockReset();
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
    authMock.mockReturnValue({ setActiveTenant: vi.fn() } as unknown as ReturnType<typeof useAuth>);
    vi.stubGlobal('fetch', fetchMock);
    Object.defineProperty(window, 'location', {
      value: { href: '', reload: vi.fn(), replace: vi.fn() },
      writable: true,
      configurable: true,
    });
  });

  it('crea la empresa, muestra el success y redirige al dashboard', async () => {
    const setActiveTenant = vi.fn();
    authMock.mockReturnValue({ setActiveTenant } as unknown as ReturnType<typeof useAuth>);

    fetchMock
      // guard /api/session
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ user: AUTHENTICATED_USER, tenants: [], tenant: null }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ tenantId: 't1' }) }); // POST /api/onboarding

    render(<OnboardingPage />);

    await screen.findByText('Configura tu empresa');
    fillCompanyForm();

    expect(await screen.findByText(/¡Bienvenido!/)).toBeInTheDocument();
    expect(screen.getByText(/Tu empresa Mi Shop ha sido creada/i)).toBeInTheDocument();

    expect(setActiveTenant).toHaveBeenCalledWith('t1');
    expect(window.location.replace).toHaveBeenCalledWith('/dashboard');
    expect(router.push).not.toHaveBeenCalledWith('/dashboard');
    expect(toast.success).toHaveBeenCalled();
  });

  it('no deja la pantalla de éxito como callejón sin salida si la navegación no ocurre', async () => {
    // Regresión del bug reportado: el usuario completaba el onboarding, veía
    // "Tu empresa X ha sido creada. Redirigiendo al dashboard..." y se quedaba
    // ahí indefinidamente, con la URL en /onboarding y la consola limpia.
    // `/api/session` y `/api/onboarding` responden bien, así que el problema no
    // era de datos: la redirección dependía de una navegación de cliente que
    // podía no-opearse sin desmontar el componente, dejando `step` en 'success'
    // y el cartel de "redirigiendo" colgado para siempre.
    const setActiveTenant = vi.fn();
    authMock.mockReturnValue({ setActiveTenant } as unknown as ReturnType<typeof useAuth>);

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ user: AUTHENTICATED_USER, tenants: [], tenant: null }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ tenantId: 't1' }) });

    render(<OnboardingPage />);

    await screen.findByText('Configura tu empresa');
    fillCompanyForm();

    expect(await screen.findByText(/¡Bienvenido!/)).toBeInTheDocument();

    // Toda salida de esta página tiene que ser una navegación dura. Cualquier
    // `router.push` al dashboard reintroduce el dead-end silencioso.
    await waitFor(() => expect(window.location.replace).toHaveBeenCalledWith('/dashboard'));
    expect(router.push).not.toHaveBeenCalledWith('/dashboard');
    expect(router.replace).not.toHaveBeenCalledWith('/dashboard');
  });

  it('no espera al refetch de sesión antes de redirigir', async () => {
    // El usuario reportaba que la pantalla de "Redirigiendo al dashboard..."
    // duraba varios segundos. La causa era `await switchTenant(tenantId)`: esa
    // llamada pega a `/api/session` y bloquea la navegación hasta que responde
    // (con un techo de PROFILE_LOAD_TIMEOUT_MS, 10s), y en desarrollo se le
    // suma la compilación en frío de la ruta. Peor: el trabajo era inútil, porque
    // la navegación dura que viene después recarga la página entera y el
    // AuthProvider resuelve perfil y rol desde cero.
    // Acá el fetch de sesión no resuelve nunca, así que cualquier espera se
    // manifiesta como un timeout. La navegación tiene que haber ocurrido igual.
    const setActiveTenant = vi.fn();
    authMock.mockReturnValue({ setActiveTenant } as unknown as ReturnType<typeof useAuth>);

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ user: AUTHENTICATED_USER, tenants: [], tenant: null }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ tenantId: 't1' }) })
      // Cualquier request posterior se queda colgado para siempre.
      .mockImplementation(() => new Promise(() => {}));

    render(<OnboardingPage />);

    await screen.findByText('Configura tu empresa');
    fillCompanyForm();

    expect(await screen.findByText(/¡Bienvenido!/)).toBeInTheDocument();
    expect(setActiveTenant).toHaveBeenCalledWith('t1');
    await waitFor(() => expect(window.location.replace).toHaveBeenCalledWith('/dashboard'));
  });

  it('muestra toast de error cuando la API falla y mantiene el formulario', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ user: AUTHENTICATED_USER, tenants: [], tenant: null }),
      })
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
