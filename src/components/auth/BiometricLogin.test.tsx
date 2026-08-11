import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Session, User } from '@supabase/supabase-js';
import BiometricLogin from './BiometricLogin';
import * as webauthn from '@/lib/webauthn';
import { supabase } from '@/lib/supabaseClient';
import toast from 'react-hot-toast';

const { pushMock, refreshMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      refreshSession: vi.fn(),
      setSession: vi.fn(),
    },
  },
}));

vi.mock('@/lib/webauthn', async () => {
  const actual = await vi.importActual<typeof import('@/lib/webauthn')>('@/lib/webauthn');
  return {
    ...actual,
    isPlatformAuthenticatorAvailable: vi.fn(),
    getStoredCredential: vi.fn(),
    getStoredRefreshToken: vi.fn(),
    clearStoredRefreshToken: vi.fn(),
    storeRefreshToken: vi.fn(),
    authenticateBiometric: vi.fn(),
  };
});

describe('BiometricLogin component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('no se renderiza si no hay credencial biométrica guardada', async () => {
    vi.mocked(webauthn.getStoredCredential).mockReturnValue(null);
    vi.mocked(webauthn.isPlatformAuthenticatorAvailable).mockResolvedValue(true);

    const { container } = render(<BiometricLogin />);
    expect(container.firstChild).toBeNull();
  });

  it('se renderiza cuando hay credencial biométrica y autenticador disponible', async () => {
    vi.mocked(webauthn.getStoredCredential).mockReturnValue({
      credentialId: 'cred-123',
      deviceName: 'Mobile Device',
      createdAt: Date.now(),
    });
    vi.mocked(webauthn.isPlatformAuthenticatorAvailable).mockResolvedValue(true);

    render(<BiometricLogin />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Ingresar con huella digital/i })).toBeInTheDocument();
    });
  });

  it('al autenticar correctamente con refresh token, inicia sesión y navega a /dashboard', async () => {
    vi.mocked(webauthn.getStoredCredential).mockReturnValue({
      credentialId: 'cred-123',
      deviceName: 'Mobile Device',
      createdAt: Date.now(),
    });
    vi.mocked(webauthn.isPlatformAuthenticatorAvailable).mockResolvedValue(true);
    vi.mocked(webauthn.authenticateBiometric).mockResolvedValue(true);
    vi.mocked(webauthn.getStoredRefreshToken).mockReturnValue('valid-refresh-token');

    vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: null }, error: null });
    vi.mocked(supabase.auth.refreshSession).mockResolvedValue({ data: { session: null, user: null }, error: null });

    // Mock fetch for exchangeRefreshToken
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
      }),
    } as Response);

    const mockSession = {
      access_token: 'new-access-token',
      refresh_token: 'new-refresh-token',
      user: { id: 'u1' },
    };

    vi.mocked(supabase.auth.setSession).mockResolvedValue({
      data: {
        session: mockSession as unknown as Session,
        user: mockSession.user as unknown as User,
      },
      error: null,
    });

    render(<BiometricLogin />);

    const button = await screen.findByRole('button', { name: /Ingresar con huella digital/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(webauthn.authenticateBiometric).toHaveBeenCalled();
      expect(webauthn.storeRefreshToken).toHaveBeenCalledWith('new-refresh-token');
      expect(toast.success).toHaveBeenCalledWith('Sesión iniciada con huella');
      expect(pushMock).toHaveBeenCalledWith('/dashboard');
    });
  });

  it('si el servidor devuelve 400 (token expirado), limpia el token guardado y muestra mensaje explicativo', async () => {
    vi.mocked(webauthn.getStoredCredential).mockReturnValue({
      credentialId: 'cred-123',
      deviceName: 'Mobile Device',
      createdAt: Date.now(),
    });
    vi.mocked(webauthn.isPlatformAuthenticatorAvailable).mockResolvedValue(true);
    vi.mocked(webauthn.authenticateBiometric).mockResolvedValue(true);
    vi.mocked(webauthn.getStoredRefreshToken).mockReturnValue('expired-refresh-token');

    vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: null }, error: null });
    vi.mocked(supabase.auth.refreshSession).mockResolvedValue({ data: { session: null, user: null }, error: null });

    // Mock HTTP 400 Bad Request
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: 'invalid_grant' }),
    } as Response);

    render(<BiometricLogin />);

    const button = await screen.findByRole('button', { name: /Ingresar con huella digital/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(webauthn.clearStoredRefreshToken).toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledWith(
        'La sesión de huella expiró. Iniciá sesión con tu email para reactivarla.'
      );
    });
  });

  it('si ocurre un error de red (fetch lanza excepción), NO limpia el token guardado y muestra aviso de conexión', async () => {
    vi.mocked(webauthn.getStoredCredential).mockReturnValue({
      credentialId: 'cred-123',
      deviceName: 'Mobile Device',
      createdAt: Date.now(),
    });
    vi.mocked(webauthn.isPlatformAuthenticatorAvailable).mockResolvedValue(true);
    vi.mocked(webauthn.authenticateBiometric).mockResolvedValue(true);
    vi.mocked(webauthn.getStoredRefreshToken).mockReturnValue('saved-refresh-token');

    vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: null }, error: null });
    vi.mocked(supabase.auth.refreshSession).mockResolvedValue({ data: { session: null, user: null }, error: null });

    // Network failure
    vi.mocked(global.fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'));

    render(<BiometricLogin />);

    const button = await screen.findByRole('button', { name: /Ingresar con huella digital/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(webauthn.clearStoredRefreshToken).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledWith('Error de conexión. Verificá tu red e intentalo de nuevo.');
    });
  });
});
