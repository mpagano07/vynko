import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import AcceptInvitePage from '@/app/accept-invite/page';

const replaceMock = vi.fn();
const pushMock = vi.fn();
const refreshSessionMock = vi.fn(async () => true);

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, push: pushMock }),
}));

vi.mock('@/lib/contexts/auth-context', () => ({
  useAuthContext: () => ({ refreshSession: refreshSessionMock }),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

function response(body: unknown): Response {
  return { ok: true, json: async () => body } as Response;
}

beforeEach(() => {
  replaceMock.mockClear();
  pushMock.mockClear();
  refreshSessionMock.mockClear();
  vi.unstubAllGlobals();
});

describe('/accept-invite', () => {
  it('revalida la sesión antes de mandar al dashboard a una cuenta ya existente', async () => {
    // El invitado a dos sucursales es un usuario que ya tenía cuenta: el
    // AuthProvider cargó `/api/session` antes de que el POST creara las
    // membresías. Sin `refreshSession` el dashboard arranca con una sola
    // sucursal (o con las de antes) aunque el owner vea las dos activas.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response({ accepted: 2, requiresSetup: false }))
    );

    render(<AcceptInvitePage />);

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/dashboard'));
    expect(refreshSessionMock).toHaveBeenCalledTimes(1);
    expect(refreshSessionMock.mock.invocationCallOrder[0]).toBeLessThan(
      replaceMock.mock.invocationCallOrder[0]
    );
  });

  it('pide completar los datos de una cuenta nueva sin revalidar la sesión', async () => {
    const fetchMock = vi.fn(async () => response({ accepted: 1, requiresSetup: true }));
    vi.stubGlobal('fetch', fetchMock);

    render(<AcceptInvitePage />);

    expect(await screen.findByText(/Completá tus datos/i)).toBeInTheDocument();
    expect(refreshSessionMock).not.toHaveBeenCalled();
    expect(replaceMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('revalida también cuando no había invitaciones nuevas pendientes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ accepted: 0 })));

    render(<AcceptInvitePage />);

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/dashboard'));
    expect(refreshSessionMock).toHaveBeenCalledTimes(1);
  });
});
