import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

type AuthState = {
  user: { id: string } | null;
  loading: boolean;
  tenants: { id: string }[];
};

const pathname = vi.hoisted(() => ({ current: '/dashboard' }));
const trackClientEvent = vi.hoisted(() => vi.fn());
const auth = vi.hoisted<AuthState>(() => ({
  user: { id: 'user-1' },
  loading: false,
  tenants: [{ id: 'tenant-1' }],
}));

vi.mock('next/navigation', () => ({
  usePathname: () => pathname.current,
}));

vi.mock('@/lib/contexts/auth-context', () => ({
  useAuthContext: () => auth,
}));

vi.mock('@/lib/analytics-client', () => ({
  trackClientEvent,
}));

import { AppReturnTracker } from './app-return-tracker';

describe('AppReturnTracker', () => {
  beforeEach(() => {
    pathname.current = '/dashboard';
    auth.user = { id: 'user-1' };
    auth.loading = false;
    auth.tenants = [{ id: 'tenant-1' }];
    trackClientEvent.mockClear();
  });

  it('registra el retorno una sola vez en una ruta privada con tenant', () => {
    const { rerender } = render(<AppReturnTracker />);

    expect(trackClientEvent).toHaveBeenCalledWith('app_return');
    rerender(<AppReturnTracker />);
    expect(trackClientEvent).toHaveBeenCalledTimes(1);
  });

  it('NO dispara en /onboarding: el endpoint exige tenant y el 401 manda a /login', () => {
    pathname.current = '/onboarding';

    render(<AppReturnTracker />);

    expect(trackClientEvent).not.toHaveBeenCalled();
  });

  it('NO dispara mientras el usuario no tiene empresas', () => {
    auth.tenants = [];

    render(<AppReturnTracker />);

    expect(trackClientEvent).not.toHaveBeenCalled();
  });

  it('NO dispara en el callback ni en pantallas publicas', () => {
    pathname.current = '/auth/callback';

    render(<AppReturnTracker />);

    expect(trackClientEvent).not.toHaveBeenCalled();
  });

  it('espera a que termine de cargar la sesion', () => {
    auth.loading = true;

    render(<AppReturnTracker />);

    expect(trackClientEvent).not.toHaveBeenCalled();
  });
});
