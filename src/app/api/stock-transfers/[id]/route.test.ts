import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAuth } from '@/lib/api-auth';
import { createActivityLog } from '@/lib/activity-log';
import { supabaseMock } from '@/test/supabase-mock';
import { PATCH } from './route';

const mockAuthOrigin = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  allTenants: false,
  tenantIds: ['tenant-1', 'tenant-2'],
};

const mockAuthDestination = {
  tenantId: 'tenant-2',
  userId: 'user-1',
  allTenants: false,
  tenantIds: ['tenant-1', 'tenant-2'],
};

vi.mock('@/lib/api-auth', () => ({
  getAuth: vi.fn(async () => mockAuthOrigin),
}));

vi.mock('@/lib/supabaseAdmin', async () => {
  const mod = await import('@/test/supabase-mock');
  return { supabaseAdmin: mod.supabaseMock };
});

vi.mock('@/lib/activity-log', () => ({
  createActivityLog: vi.fn(async () => undefined),
}));

function makeRequest(status: string): Request {
  return new Request('http://localhost/api/stock-transfers/tr-1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
}

const routeParams = Promise.resolve({ id: 'tr-1' });

// La transferencia existe, es del tenant origen del mockAuth y arranca en el
// estado que el test dice.
function queueTransfer(status: string) {
  supabaseMock.__queue('stock_transfers', {
    data: {
      id: 'tr-1',
      from_tenant_id: 'tenant-1',
      to_tenant_id: 'tenant-2',
      status,
      created_by: 'user-1',
    },
  });
}

function queueOwnerRole() {
  supabaseMock.__queue('tenant_users', {
    data: { tenant_id: 'tenant-1', role: 'owner' },
  });
}

describe('PATCH /api/stock-transfers/[id]', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    vi.mocked(getAuth).mockResolvedValue(mockAuthOrigin);
    vi.mocked(createActivityLog).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const rpcRow = (status: string) => ({
    ok: true,
    code: null,
    current_status: null,
    row: {
      id: 'tr-1',
      from_tenant_id: 'tenant-1',
      to_tenant_id: 'tenant-2',
      status,
      created_by: 'user-1',
    },
  });

  it('envia: descuenta stock y cambia estado en UNA llamada', async () => {
    queueTransfer('pending');
    queueOwnerRole();
    supabaseMock.__rpcResults.send_transfer = { data: [rpcRow('in_transit')], error: null };

    const res = await PATCH(makeRequest('in_transit'), { params: routeParams } as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('in_transit');

    expect(supabaseMock.rpc).toHaveBeenCalledWith('send_transfer', {
      p_transfer_id: 'tr-1',
      p_by: 'user-1',
    });
    expect(createActivityLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'sent', entityType: 'stock_transfer', entityId: 'tr-1' })
    );
  });

  it('recibe: acredita stock en destino y cambia estado en UNA llamada', async () => {
    vi.mocked(getAuth).mockResolvedValue(mockAuthDestination);
    queueTransfer('in_transit');
    supabaseMock.__queue('tenant_users', {
      data: { tenant_id: 'tenant-2', role: 'owner' },
    });
    supabaseMock.__rpcResults.receive_transfer = { data: [rpcRow('received')], error: null };

    const res = await PATCH(makeRequest('received'), { params: routeParams } as never);
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('received');

    expect(supabaseMock.rpc).toHaveBeenCalledWith('receive_transfer', {
      p_transfer_id: 'tr-1',
      p_by: 'user-1',
    });
    expect(createActivityLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'received', entityType: 'stock_transfer', entityId: 'tr-1' })
    );
  });

  it('propaga el mensaje de stock insuficiente de la funcion', async () => {
    queueTransfer('pending');
    queueOwnerRole();
    supabaseMock.__rpcResults.send_transfer = {
      data: null,
      error: {
        code: 'P0001',
        message: 'Stock insuficiente de "Coca" en origen. Disponible: 2, requerido: 5',
      },
    };

    const res = await PATCH(makeRequest('in_transit'), { params: routeParams } as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(
      'Stock insuficiente de "Coca" en origen. Disponible: 2, requerido: 5'
    );
  });

  it('devuelve la transicion de un perdedor de carrera con el status real', async () => {
    queueTransfer('pending');
    queueOwnerRole();
    // Otra operacion gano y ya dejo la transferencia en 'in_transit': la foto
    // que leyo este request era vieja, la RPC lo ve y lo dice.
    supabaseMock.__rpcResults.send_transfer = {
      data: [{ ok: false, code: 'wrong_status', current_status: 'in_transit', row: null }],
      error: null,
    };

    const res = await PATCH(makeRequest('in_transit'), { params: routeParams } as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(
      'No se puede cambiar la transferencia de "in_transit" a "in_transit"'
    );
  });

  it('devuelve 404 cuando la funcion no encuentra la transferencia', async () => {
    queueTransfer('pending');
    queueOwnerRole();
    supabaseMock.__rpcResults.send_transfer = {
      data: [{ ok: false, code: 'not_found', current_status: null, row: null }],
      error: null,
    };

    const res = await PATCH(makeRequest('in_transit'), { params: routeParams } as never);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('Transferencia no encontrada');
  });

  it('no reporta un error de infraestructura como stock', async () => {
    queueTransfer('pending');
    queueOwnerRole();
    supabaseMock.__rpcResults.send_transfer = {
      data: null,
      error: { code: '42501', message: 'permission denied for function send_transfer' },
    };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await PATCH(makeRequest('in_transit'), { params: routeParams } as never);
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Ocurrio un error inesperado. Intenta de nuevo.');
    consoleError.mockRestore();
  });

  it('rechaza una transicion invalida sin llamar a la funcion', async () => {
    // El tenant destino quiere 'received' de una transferencia 'pending': la
    // direccion es correcta (destino), pero la transicion no existe.
    vi.mocked(getAuth).mockResolvedValue(mockAuthDestination);
    queueTransfer('pending');
    supabaseMock.__queue('tenant_users', {
      data: { tenant_id: 'tenant-2', role: 'owner' },
    });

    const res = await PATCH(makeRequest('received'), { params: routeParams } as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(
      'No se puede cambiar la transferencia de "pending" a "received"'
    );
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it('rechaza un estado desconocido', async () => {
    queueTransfer('pending');
    queueOwnerRole();

    const res = await PATCH(makeRequest('purged'), { params: routeParams } as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Estado inválido');
  });
});