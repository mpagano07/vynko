import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseMock } from '@/test/supabase-mock';
import { deleteAccount, exportAccountData } from '@/lib/account-service';

vi.mock('@/lib/supabaseAdmin', () => ({ supabaseAdmin: supabaseMock }));

const mockCancelAccountSubscriptions = vi.fn();
vi.mock('@/lib/account-subscriptions', () => ({
  cancelAccountSubscriptions: (...args: unknown[]) => mockCancelAccountSubscriptions(...args),
}));

const mockDeleteTenantProductImages = vi.fn();
vi.mock('@/lib/upload-service', () => ({
  deleteTenantProductImages: (...args: unknown[]) => mockDeleteTenantProductImages(...args),
}));

const mockRevokeGoogleDriveConnection = vi.fn();
vi.mock('@/lib/google/token-store', () => ({
  revokeGoogleDriveConnection: (...args: unknown[]) => mockRevokeGoogleDriveConnection(...args),
}));

const auth = { tenantId: 'tenant-1', userId: 'user-1', allTenants: false, tenantIds: ['tenant-1'] };

describe('exportAccountData', () => {
  beforeEach(() => {
    supabaseMock.__reset();
  });

  it('devuelve perfil, membresías y datos de las empresas propias', async () => {
    supabaseMock.__queue('profiles', {
      data: { id: 'user-1', email: 'a@b.com', full_name: 'Ana' },
    });
    supabaseMock.__queue('tenant_users', {
      data: [{ tenant_id: 'tenant-1', role: 'owner' }],
    });
    supabaseMock.__queue('tenants', { data: [{ id: 'tenant-1', name: 'Central' }] });
    // Una respuesta por tabla de negocio.
    supabaseMock.__queue('products', { data: [{ id: 'p1' }] });
    for (const table of [
      'product_stock', 'categories', 'suppliers', 'providers', 'customers', 'sales',
      'sale_items', 'sale_payments', 'cash_register_sessions', 'cash_movements',
      'commercial_documents', 'commercial_document_items', 'purchase_orders',
      'purchase_order_items', 'stock_movements', 'stock_history', 'stock_transfers',
      'stock_transfer_items', 'activity_logs',
    ]) {
      supabaseMock.__queue(table, { data: [] });
    }

    const result = await exportAccountData(auth);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const data = result.data as Record<string, unknown>;
    expect((data.account as Record<string, unknown>).profile).toMatchObject({ full_name: 'Ana' });
    expect(data.tenants).toHaveLength(1);
    expect((data.data as Record<string, unknown[]>).products).toEqual([{ id: 'p1' }]);
  });

  it('no exporta datos de una empresa donde solo es member', async () => {
    supabaseMock.__queue('profiles', { data: { id: 'user-1' } });
    supabaseMock.__queue('tenant_users', {
      data: [{ tenant_id: 'otra-empresa', role: 'member' }],
    });

    const result = await exportAccountData(auth);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const data = result.data as Record<string, unknown>;
    // Sin empresas propias: no se consulta ninguna tabla de negocio.
    expect(data.tenants).toEqual([]);
    expect(data.data).toEqual({});
    expect(
      supabaseMock.__calls.some((c) => c.table === 'products')
    ).toBe(false);
  });
});

describe('deleteAccount', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    mockCancelAccountSubscriptions.mockReset();
    mockDeleteTenantProductImages.mockReset();
    mockRevokeGoogleDriveConnection.mockReset();
    mockCancelAccountSubscriptions.mockResolvedValue({
      ok: true,
      data: {
        canceledPaddleSubscriptions: 0,
        canceledMercadoPagoPreapprovals: 0,
        canceledPaddleTransactions: 0,
      },
    });
    mockDeleteTenantProductImages.mockResolvedValue({ ok: true, deleted: 0 });
    mockRevokeGoogleDriveConnection.mockResolvedValue(undefined);
  });

  it('exige la confirmación escrita', async () => {
    const result = await deleteAccount(auth, { confirm: 'si' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
    expect(supabaseMock.auth.admin.deleteUser).not.toHaveBeenCalled();
    expect(mockCancelAccountSubscriptions).not.toHaveBeenCalled();
  });

  it('borra las empresas propias, las membresías y el usuario auth', async () => {
    supabaseMock.__queue('tenant_users', { data: [{ tenant_id: 'tenant-1', role: 'owner' }] });
    supabaseMock.__queue('tenants', { data: null, error: null });
    supabaseMock.__queue('tenant_users', { data: null, error: null });

    const result = await deleteAccount(auth, { confirm: 'ELIMINAR' });
    expect(result.ok).toBe(true);
    expect(supabaseMock.auth.admin.deleteUser).toHaveBeenCalledWith('user-1');

    expect(mockCancelAccountSubscriptions).toHaveBeenCalledWith('user-1', ['tenant-1']);
    expect(mockRevokeGoogleDriveConnection).toHaveBeenCalledWith('user-1');
    expect(mockDeleteTenantProductImages).toHaveBeenCalledWith('tenant-1');

    const tenantDelete = supabaseMock.__calls.find(
      (c) => c.table === 'tenants' && c.method === 'delete'
    );
    expect(tenantDelete).toBeTruthy();
  });

  it('aborta si no puede leer las empresas propias', async () => {
    supabaseMock.__queue('tenant_users', {
      data: null,
      error: { message: 'db down' },
    });

    const result = await deleteAccount(auth, { confirm: 'ELIMINAR' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(500);

    expect(mockCancelAccountSubscriptions).not.toHaveBeenCalled();
    expect(supabaseMock.auth.admin.deleteUser).not.toHaveBeenCalled();
  });

  it('aborta sin borrar nada si no se puede cancelar la suscripción', async () => {
    supabaseMock.__queue('tenant_users', { data: [{ tenant_id: 'tenant-1', role: 'owner' }] });
    mockCancelAccountSubscriptions.mockResolvedValueOnce({
      ok: false,
      error: 'No se pudo cancelar tu suscripción.',
      status: 502,
    });

    const result = await deleteAccount(auth, { confirm: 'ELIMINAR' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(502);

    expect(
      supabaseMock.__calls.some((c) => c.table === 'tenants' && c.method === 'delete')
    ).toBe(false);
    expect(mockDeleteTenantProductImages).not.toHaveBeenCalled();
    expect(supabaseMock.auth.admin.deleteUser).not.toHaveBeenCalled();
  });

  it('aborta sin borrar la base si falla la limpieza de imágenes', async () => {
    supabaseMock.__queue('tenant_users', { data: [{ tenant_id: 'tenant-1', role: 'owner' }] });
    mockDeleteTenantProductImages.mockResolvedValueOnce({
      ok: false,
      error: 'No se pudieron eliminar las imágenes de tus productos.',
    });

    const result = await deleteAccount(auth, { confirm: 'ELIMINAR' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(500);

    expect(
      supabaseMock.__calls.some((c) => c.table === 'tenants' && c.method === 'delete')
    ).toBe(false);
    expect(supabaseMock.auth.admin.deleteUser).not.toHaveBeenCalled();
  });

  it('no bloquea el borrado si Google Drive no responde', async () => {
    supabaseMock.__queue('tenant_users', { data: [{ tenant_id: 'tenant-1', role: 'owner' }] });
    supabaseMock.__queue('tenants', { data: null, error: null });
    supabaseMock.__queue('tenant_users', { data: null, error: null });
    mockRevokeGoogleDriveConnection.mockRejectedValueOnce(new Error('network'));

    const result = await deleteAccount(auth, { confirm: 'ELIMINAR' });
    expect(result.ok).toBe(true);
    expect(supabaseMock.auth.admin.deleteUser).toHaveBeenCalledWith('user-1');
  });

  it('no borra empresas de terceros donde solo es member', async () => {
    // Sin tenants propios.
    supabaseMock.__queue('tenant_users', { data: [{ tenant_id: 'ajena' }] });
    supabaseMock.__queue('tenant_users', { data: null, error: null });

    const result = await deleteAccount(auth, { confirm: 'ELIMINAR' });
    expect(result.ok).toBe(true);

    expect(mockCancelAccountSubscriptions).toHaveBeenCalledWith('user-1', []);
    expect(mockDeleteTenantProductImages).not.toHaveBeenCalled();
    expect(
      supabaseMock.__calls.some((c) => c.table === 'tenants' && c.method === 'delete')
    ).toBe(false);
    expect(supabaseMock.auth.admin.deleteUser).toHaveBeenCalledWith('user-1');
  });
});
