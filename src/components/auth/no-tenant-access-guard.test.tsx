import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { NoTenantAccessGuard } from '@/components/auth/no-tenant-access-guard';

const replaceMock = vi.fn();
let pathname = '/dashboard';
let contextValue: { noTenantAccess: boolean; loading: boolean };

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
  usePathname: () => pathname,
}));

vi.mock('@/lib/contexts/auth-context', () => ({
  useAuthContext: () => contextValue,
}));

beforeEach(() => {
  replaceMock.mockClear();
  pathname = '/dashboard';
  contextValue = { noTenantAccess: false, loading: false };
});

describe('NoTenantAccessGuard', () => {
  it('manda a /sin-acceso a una sesión sin empresas', () => {
    contextValue = { noTenantAccess: true, loading: false };
    render(<NoTenantAccessGuard />);

    expect(replaceMock).toHaveBeenCalledWith('/sin-acceso');
  });

  it('no molesta a una sesión normal', () => {
    contextValue = { noTenantAccess: false, loading: false };
    render(<NoTenantAccessGuard />);

    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('no decide mientras la sesión todavía está cargando', () => {
    // Antes de que resuelva `/api/session` no se sabe si el usuario tiene
    // empresas: expulsar en ese momento sacaría a cualquiera de la app.
    contextValue = { noTenantAccess: true, loading: true };
    render(<NoTenantAccessGuard />);

    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('no se redirige a sí mismo', () => {
    pathname = '/sin-acceso';
    contextValue = { noTenantAccess: true, loading: false };
    render(<NoTenantAccessGuard />);

    expect(replaceMock).not.toHaveBeenCalled();
  });
});
