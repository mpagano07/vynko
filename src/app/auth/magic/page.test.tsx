import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import MagicLinkPage from '@/app/auth/magic/page';

const replaceMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

function setUrl(path: string) {
  window.history.replaceState({}, '', path);
}

function okResponse() {
  return { ok: true, json: async () => ({ success: true }) } as Response;
}

beforeEach(() => {
  replaceMock.mockClear();
  vi.unstubAllGlobals();
});

describe('/auth/magic', () => {
  it('canjea los tokens del fragmento y sigue a /accept-invite por defecto', async () => {
    setUrl(
      '/auth/magic#access_token=access-1&refresh_token=refresh-1&type=invite&expires_at=1'
    );
    const fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal('fetch', fetchMock);

    render(<MagicLinkPage />);

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/accept-invite'));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/session',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ access_token: 'access-1', refresh_token: 'refresh-1' }),
      })
    );
    // Los tokens no quedan en la barra de direcciones.
    expect(window.location.hash).toBe('');
  });

  it('respeta un next interno', async () => {
    setUrl(
      '/auth/magic?next=%2Fdashboard#access_token=access-1&refresh_token=refresh-1&type=invite'
    );
    vi.stubGlobal('fetch', vi.fn(async () => okResponse()));

    render(<MagicLinkPage />);

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/dashboard'));
  });

  it('ignora un next externo (open redirect)', async () => {
    setUrl(
      '/auth/magic?next=https%3A%2F%2Fevil.test%2Fsteal#access_token=access-1&refresh_token=refresh-1&type=invite'
    );
    vi.stubGlobal('fetch', vi.fn(async () => okResponse()));

    render(<MagicLinkPage />);

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/accept-invite'));
  });

  it('muestra el aviso de link vencido cuando no hay tokens ni code', async () => {
    setUrl('/auth/magic#error=access_denied&error_code=otp_expired');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<MagicLinkPage />);

    expect(await screen.findByText(/El link ya se usó o venció/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('muestra error si el servidor no puede abrir la sesión', async () => {
    setUrl('/auth/magic#access_token=access-1&refresh_token=refresh-1&type=invite');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false }) as Response));

    render(<MagicLinkPage />);

    expect(await screen.findByText(/El link ya se usó o venció/i)).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
