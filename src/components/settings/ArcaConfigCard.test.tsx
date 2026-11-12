import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ArcaConfigCard } from './ArcaConfigCard';
import type { ArcaConfig } from '@/lib/types/arca';

const authFetchMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock('@/lib/fetchWithTenant', () => ({ authFetch: authFetchMock }));
vi.mock('react-hot-toast', () => ({ default: toastMock }));

function makeConfig(overrides: Partial<ArcaConfig> = {}): ArcaConfig {
  return {
    id: 'arca-1',
    tenant_id: 't1',
    cuit: '20409378472',
    punto_venta: 3,
    environment: 'homologacion',
    concept: 1,
    has_cert: true,
    has_key: true,
    is_active: false,
    is_sandbox: false,
    ...overrides,
  };
}

function mockApi(config: ArcaConfig) {
  authFetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/api/arca/config' && init?.method === 'POST') {
      return { ok: true, json: async () => ({ success: true }) };
    }
    if (url === '/api/arca/config') {
      return { ok: true, json: async () => config };
    }
    if (url === '/api/arca/test') {
      return {
        ok: true,
        json: async () => ({ serverHealth: { appServer: 'OK' }, lastVoucher: 1 }),
      };
    }
    return { ok: false, json: async () => ({}) };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ArcaConfigCard - asistente', () => {
  it('arranca con los datos fiscales precargados y permite revisar antes de guardar', async () => {
    mockApi(makeConfig());
    render(<ArcaConfigCard />);

    expect(await screen.findByDisplayValue('20-40937847-2')).toBeInTheDocument();
    expect(screen.getByDisplayValue('3')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(screen.getByText('Certificados Digitales de ARCA')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(screen.getByText('CUIT emisor')).toBeInTheDocument();
    expect(screen.getByText('Certificado y clave cargados')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Guardar Configuración/i }));

    await waitFor(() => {
      expect(authFetchMock).toHaveBeenCalledWith(
        '/api/arca/config',
        expect.objectContaining({ method: 'POST' })
      );
    });

    const postCall = authFetchMock.mock.calls.find(
      ([url, init]) => url === '/api/arca/config' && init?.method === 'POST'
    );
    const body = JSON.parse(postCall?.[1]?.body as string);
    expect(body).toMatchObject({
      cuit: '20-40937847-2',
      punto_venta: 3,
      environment: 'homologacion',
      concept: 1,
    });
  });

  it('no deja avanzar si el CUIT no tiene 11 dígitos', async () => {
    mockApi(makeConfig());
    render(<ArcaConfigCard />);

    const cuitInput = await screen.findByDisplayValue('20-40937847-2');
    fireEvent.change(cuitInput, { target: { value: '20-409' } });
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Ingresá los 11 dígitos del CUIT emisor.');
    expect(screen.queryByText('Certificados Digitales de ARCA')).not.toBeInTheDocument();
  });

  it('deshabilita la prueba de conexión si faltan credenciales', async () => {
    mockApi(makeConfig({ has_cert: false, has_key: false }));
    render(<ArcaConfigCard />);

    await screen.findByDisplayValue('20-40937847-2');
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(screen.getByText(/la prueba de conexión va a quedar deshabilitada/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(screen.getByText('Faltan certificado o clave')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Probar Conexión con ARCA/i })).toBeDisabled();
  });

  it('en sandbox no exige certificados y permite probar la conexión', async () => {
    mockApi(makeConfig({ has_cert: false, has_key: false, is_sandbox: true }));
    render(<ArcaConfigCard />);

    await screen.findByDisplayValue('20-40937847-2');
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));

    expect(screen.getByText('Sandbox (CAE simulado)')).toBeInTheDocument();
    const testButton = screen.getByRole('button', { name: /Probar Conexión con ARCA/i });
    expect(testButton).toBeEnabled();

    fireEvent.click(testButton);
    await waitFor(() => {
      expect(authFetchMock).toHaveBeenCalledWith('/api/arca/test', { method: 'POST' });
    });
  });
});
