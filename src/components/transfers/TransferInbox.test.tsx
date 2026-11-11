import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TransferInbox } from './TransferInbox';
import { authFetch } from '@/lib/fetchWithTenant';

vi.mock('@/lib/fetchWithTenant', () => ({
  authFetch: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

const authFetchMock = vi.mocked(authFetch);

const transfer = (overrides: Record<string, unknown> = {}) => ({
  id: 'tr1',
  from_tenant_id: 't1',
  to_tenant_id: 't2',
  from_tenant_name: 'Central',
  to_tenant_name: 'Norte',
  status: 'pending',
  created_at: '2026-11-01T12:00:00Z',
  updated_at: '2026-11-01T12:00:00Z',
  created_by_name: 'Ana',
  items: [{ id: 'i1', product_id: 'p1', product_name: 'Café', quantity: 3 }],
  ...overrides,
});

describe('TransferInbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('trae los estados activos en un único GET y ordena pendientes antes que en tránsito', async () => {
    authFetchMock.mockImplementation(async () => ({
      ok: true,
      json: async () => [
        transfer({ id: 'tr2', from_tenant_name: 'Sur', to_tenant_name: 'Este', status: 'in_transit' }),
        transfer({ id: 'tr1', from_tenant_name: 'Central', to_tenant_name: 'Norte', status: 'pending' }),
      ],
    }));

    const { container } = render(<TransferInbox currentTenantId="t1" />);

    // Una sola llamada, con ambos estados.
    await waitFor(() => {
      expect(authFetchMock).toHaveBeenCalledTimes(1);
      expect(authFetchMock).toHaveBeenCalledWith('/api/stock-transfers?status=pending,in_transit');
    });

    await screen.findByText('Central');
    // El orden en el DOM es pendiente arriba, en tránsito abajo.
    const origins = screen.getAllByText(/^(Central|Sur)$/).map((el) => el.textContent);
    expect(origins).toEqual(['Central', 'Sur']);
    expect(screen.getByText('2')).toBeInTheDocument();

    // Los nombres de producto vienen del propio listado: nada de enriquecer
    // con pedidos extra al catálogo.
    expect(
      authFetchMock.mock.calls.filter(([url]) => String(url).includes('/api/products'))
    ).toHaveLength(0);
    expect(container).not.toBeEmptyDOMElement();
  });

  it('no renderiza nada cuando no hay transferencias activas', async () => {
    authFetchMock.mockImplementation(async () => ({ ok: true, json: async () => [] }));

    const { container } = render(<TransferInbox currentTenantId="t1" />);

    await waitFor(() => expect(authFetchMock).toHaveBeenCalledTimes(1));
    expect(container).toBeEmptyDOMElement();
  });

  it('muestra error con reintentar cuando la carga falla, y se recupera', async () => {
    authFetchMock
      .mockRejectedValueOnce(new Error('network down'))
      .mockImplementation(async () => ({
        ok: true,
        json: async () => [transfer()],
      }));

    const { container } = render(<TransferInbox currentTenantId="t1" />);

    expect(await screen.findByText('No se pudieron cargar las transferencias activas.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /reintentar/i }));

    await screen.findByText('Central');
    expect(container).not.toBeEmptyDOMElement();
    expect(authFetchMock).toHaveBeenCalledTimes(2);
  });

  it('confirma la recepción con PATCH y refresca la bandeja y la página', async () => {
    authFetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        return { ok: true, json: async () => ({ id: 'tr1', status: 'received' }) };
      }
      return { ok: true, json: async () => [transfer({ status: 'in_transit', from_tenant_id: 't2', to_tenant_id: 't1', from_tenant_name: 'Sur', to_tenant_name: 'Central' })] };
    });
    const onAction = vi.fn();

    render(<TransferInbox currentTenantId="t1" onAction={onAction} />);

    // Los botones de acción viven en el cuerpo expandido de la tarjeta.
    fireEvent.click(await screen.findByRole('button', { name: /expandir detalles/i }));
    fireEvent.click(await screen.findByRole('button', { name: /confirmar recepción/i }));

    await waitFor(() => {
      expect(authFetchMock).toHaveBeenCalledWith('/api/stock-transfers/tr1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'received' }),
      });
    });
    // La acción refresca la bandeja (segundo GET) y avisa a la página:
    // GET inicial + PATCH + GET de refresco.
    await waitFor(() => expect(authFetchMock).toHaveBeenCalledTimes(3));
    const getCalls = authFetchMock.mock.calls.filter(([url]) => String(url).includes('/api/stock-transfers?'));
    expect(getCalls).toHaveLength(2);
    expect(onAction).toHaveBeenCalled();
  });
});
