import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AdminOpsPage from './page';
import { useAuth } from '@/lib/hooks/useAuth';
import { authFetch } from '@/lib/fetchWithTenant';
import type { KillSwitchState } from '@/lib/kill-switch-config';

const { replaceMock } = vi.hoisted(() => ({ replaceMock: vi.fn() }));
const authFetchMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn() }),
}));

vi.mock('@/lib/hooks/useAuth', () => ({ useAuth: vi.fn() }));

vi.mock('@/lib/fetchWithTenant', () => ({ authFetch: authFetchMock }));

const authMock = vi.mocked(useAuth);
const fetchMock = vi.mocked(authFetch);

const adminProfile = { id: 'u1', email: 'admin@vynko.app', full_name: 'Admin', is_admin: true };
const memberProfile = { id: 'u2', email: 'user@vynko.app', full_name: 'User', is_admin: false };

const ALL_ALIVE: KillSwitchState = {
  sales: false,
  payments: false,
  forecast: false,
  imports: false,
  maintenance: false,
};

const ALL_FLAGS = [
  { flag_key: 'kill_sales', enabled: false, rollout_percent: 100 },
  { flag_key: 'kill_payments', enabled: false, rollout_percent: 100 },
  { flag_key: 'kill_forecast', enabled: false, rollout_percent: 100 },
  { flag_key: 'kill_imports', enabled: false, rollout_percent: 100 },
  { flag_key: 'maintenance_mode', enabled: false, rollout_percent: 100 },
];

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as Response;
}

function mockBackend(options: {
  state?: Partial<KillSwitchState>;
  envOverrides?: Record<string, boolean>;
  flags?: typeof ALL_FLAGS;
  putOk?: boolean;
} = {}) {
  const state = { ...ALL_ALIVE, ...options.state };
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input);
    if (url === '/api/kill-switch/status') {
      return jsonResponse({ kill_switches: state, env_overrides: options.envOverrides ?? {} });
    }
    if (url === '/api/admin/feature-flags' && (!init || init.method !== 'PUT')) {
      return jsonResponse({ flags: options.flags ?? ALL_FLAGS });
    }
    if (url === '/api/admin/feature-flags' && init?.method === 'PUT') {
      return options.putOk === false
        ? jsonResponse({ error: 'No se pudo guardar el flag.' }, false)
        : jsonResponse({ flag: { flag_key: 'kill_sales', enabled: true, rollout_percent: 100 } });
    }
    throw new Error(`URL inesperada: ${url}`);
  });
}

async function renderPage() {
  render(<AdminOpsPage />);
  await screen.findByText('Ventas');
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockReturnValue({
    user: { id: 'u1' },
    profile: adminProfile,
    loading: false,
  } as ReturnType<typeof useAuth>);
  mockBackend();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('/admin/ops', () => {
  it('redirige al dashboard si el perfil no es admin', async () => {
    authMock.mockReturnValue({
      user: { id: 'u2' },
      profile: memberProfile,
      loading: false,
    } as ReturnType<typeof useAuth>);

    render(<AdminOpsPage />);

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/dashboard'));
  });

  it('muestra las cinco areas y su estado', async () => {
    mockBackend({ state: { sales: true } });

    await renderPage();

    expect(screen.getByText('Mantenimiento global')).toBeTruthy();
    expect(screen.getByText('Pagos (Paddle)')).toBeTruthy();
    expect(screen.getByText('Pronóstico')).toBeTruthy();
    expect(screen.getByText('Importación de productos')).toBeTruthy();
    expect(screen.getAllByText('MATADO')).toHaveLength(1);
    expect(screen.getAllByText('VIVO')).toHaveLength(4);
  });

  it('matar un area pide confirmacion y hace el PUT con enabled=true', async () => {
    await renderPage();

    fireEvent.click(screen.getAllByRole('button', { name: /Matar/i })[0]);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/feature-flags',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({
            flag_key: 'kill_sales',
            enabled: true,
            rollout_percent: 100,
          }),
        })
      )
    );
    expect(window.confirm).toHaveBeenCalled();
  });

  it('no hace nada si se cancela la confirmacion', async () => {
    vi.mocked(window.confirm).mockReturnValue(false);
    await renderPage();

    fireEvent.click(screen.getAllByRole('button', { name: /Matar/i })[0]);

    await waitFor(() => expect(window.confirm).toHaveBeenCalled());
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/admin/feature-flags',
      expect.objectContaining({ method: 'PUT' })
    );
  });

  it('revivir no pide confirmacion y manda enabled=false', async () => {
    mockBackend({
      state: { sales: true },
      flags: ALL_FLAGS.map((flag) =>
        flag.flag_key === 'kill_sales' ? { ...flag, enabled: true } : flag
      ),
    });
    await renderPage();

    fireEvent.click(screen.getByRole('button', { name: /Revivir/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/feature-flags',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({
            flag_key: 'kill_sales',
            enabled: false,
            rollout_percent: 100,
          }),
        })
      )
    );
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it('muestra candado y deshabilita el boton si la env fuerza el kill', async () => {
    mockBackend({ state: { forecast: true }, envOverrides: { forecast: true } });

    await renderPage();

    expect(screen.getByText(/Forzado por FEATURE_KILL_FORECAST/i)).toBeTruthy();
    const forecastButton = screen.getByRole('button', { name: /Revivir/i });
    expect(forecastButton).toBeDisabled();
  });

  it('muestra el error si el PUT falla', async () => {
    mockBackend({ putOk: false });
    await renderPage();

    fireEvent.click(screen.getAllByRole('button', { name: /Matar/i })[0]);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/feature-flags',
        expect.objectContaining({ method: 'PUT' })
      )
    );
    expect(await screen.findByText('No se pudo guardar el flag.')).toBeTruthy();
  });
});
