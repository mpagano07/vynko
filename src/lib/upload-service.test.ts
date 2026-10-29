import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseMock } from '@/test/supabase-mock';
import { deleteTenantProductImages } from './upload-service';

vi.mock('@/lib/supabaseAdmin', () => ({ supabaseAdmin: supabaseMock }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('deleteTenantProductImages', () => {
  beforeEach(() => {
    supabaseMock.__reset();
  });

  it('borra los archivos de la empresa e ignora carpetas virtuales', async () => {
    supabaseMock.__storageResults.list = {
      data: [
        { id: 'file-1', name: 'a.jpg' },
        { id: 'file-2', name: 'b.png' },
        { id: null, name: 'legacy-folder' },
      ],
      error: null,
    };

    const result = await deleteTenantProductImages('tenant-1');

    expect(result).toEqual({ ok: true, deleted: 2 });
    expect(supabaseMock.__storageCalls).toContainEqual({
      method: 'list',
      args: ['tenant-1', { limit: 1000, offset: 0 }],
    });

    const remove = supabaseMock.__storageCalls.find((call) => call.method === 'remove');
    expect(remove?.args[0]).toEqual(['tenant-1/a.jpg', 'tenant-1/b.png']);
  });

  it('devuelve error sin borrar si no puede listar el bucket', async () => {
    supabaseMock.__storageResults.list = {
      data: null,
      error: { message: 'storage down' },
    };

    const result = await deleteTenantProductImages('tenant-1');

    expect(result.ok).toBe(false);
    expect(
      supabaseMock.__storageCalls.some((call) => call.method === 'remove')
    ).toBe(false);
  });

  it('devuelve error si falla el borrado de objetos', async () => {
    supabaseMock.__storageResults.list = {
      data: [{ id: 'file-1', name: 'a.jpg' }],
      error: null,
    };
    supabaseMock.__storageResults.remove.error = { message: 'remove failed' };

    const result = await deleteTenantProductImages('tenant-1');

    expect(result.ok).toBe(false);
  });
});
