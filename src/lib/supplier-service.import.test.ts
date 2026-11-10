import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseMock } from '@/test/supabase-mock';
import { __resetRateLimitStateForTests } from '@/lib/rate-limit';
import { createActivityLog } from '@/lib/activity-log';
import { MAX_IMPORT_ROWS } from './excel-import-parse';
import { prepareSupplierImport } from './supplier-service';

const auth = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  allTenants: false,
  tenantIds: ['tenant-1'],
};

vi.mock('@/lib/supabaseAdmin', () => ({ supabaseAdmin: supabaseMock }));
vi.mock('@/lib/activity-log', () => ({ createActivityLog: vi.fn(async () => undefined) }));

/**
 * La respuesta de rol que consume `assertSupplierManager` en cada prepare.
 * El import de proveedores pasa por el mismo gate que el alta manual.
 */
function asManager(role = 'owner') {
  supabaseMock.__queue('tenant_users', { data: { role }, error: null });
}

function insertsOn(table: string) {
  return supabaseMock.__calls.filter((c) => c.table === table && c.method === 'insert');
}

function updatesOn(table: string) {
  return supabaseMock.__calls.filter((c) => c.table === table && c.method === 'update');
}

function existingSuppliers(rows: Record<string, unknown>[]) {
  supabaseMock.__queue('suppliers', { data: rows, error: null });
}

function queueCreatedSupplier(id: string) {
  supabaseMock.__queue('suppliers', { data: { id }, error: null });
}

async function run(rows: Record<string, unknown>[]) {
  const prepared = await prepareSupplierImport(auth, rows);
  if (!prepared.ok) throw new Error('prepareSupplierImport debió aceptar el archivo');
  return prepared.execute();
}

describe('prepareSupplierImport: guardas de entrada', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    __resetRateLimitStateForTests();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('rechaza un archivo vacío sin tocar la base', async () => {
    const result = await prepareSupplierImport(auth, []);
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(supabaseMock.__calls).toHaveLength(0);
  });

  it('corta un archivo con más filas que el máximo, sin tocar la base', async () => {
    const rows = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => ({ name: `Prov ${i}` }));
    const result = await prepareSupplierImport(auth, rows);

    expect(result).toMatchObject({ ok: false, status: 413 });
    expect(result.ok === false && result.error).toContain(String(MAX_IMPORT_ROWS));
    expect(supabaseMock.__calls).toHaveLength(0);
  });

  it('deja entrar a un owner pero no a un cajero', async () => {
    asManager('cashier');
    const result = await prepareSupplierImport(auth, [{ name: 'Distribuidora SA' }]);

    expect(result).toMatchObject({ ok: false, status: 403 });
    expect(result.ok === false && result.error).toContain('Sólo el dueño o un administrador');
    expect(insertsOn('suppliers')).toHaveLength(0);
    // El gate corre antes de leer los proveedores del tenant.
    expect(supabaseMock.__calls.filter((c) => c.table === 'suppliers')).toHaveLength(0);
  });

  it('un rol con manage_purchases (stock) también puede importar', async () => {
    asManager('stock');
    existingSuppliers([]);
    queueCreatedSupplier('sup-1');

    const result = await run([{ name: 'Distribuidora SA' }]);

    expect(result.summary.created).toBe(1);
  });

  it('devuelve 429 al superar el límite por usuario', async () => {
    for (let i = 0; i < 10; i++) {
      asManager();
      existingSuppliers([]);
      queueCreatedSupplier(`sup-${i}`);
      await run([{ name: `Prov ${i}` }]);
    }

    asManager();
    const bloqueado = await prepareSupplierImport(auth, [{ name: 'Prov 11' }]);
    expect(bloqueado).toMatchObject({ ok: false, status: 429 });
    expect(insertsOn('suppliers')).toHaveLength(10);
  });
});

describe('prepareSupplierImport: altas', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    __resetRateLimitStateForTests();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    asManager();
  });

  it('crea con los defaults del formulario (responsable inscripto + CUIT)', async () => {
    existingSuppliers([]);
    queueCreatedSupplier('sup-1');

    const result = await run([{ name: 'Distribuidora SA' }]);

    expect(result.summary).toEqual({ created: 1, updated: 0, skipped: 0, total: 1 });
    expect(insertsOn('suppliers')[0].args[0]).toMatchObject({
      tenant_id: 'tenant-1',
      name: 'Distribuidora SA',
      iva_condition: 'responsable_inscripto',
      document_type: 'CUIT',
    });
  });

  it('a diferencia de clientes, un Responsable Inscripto sin CUIT entra igual', async () => {
    existingSuppliers([]);
    queueCreatedSupplier('sup-1');

    const result = await run([
      { name: 'Distribuidora SA', iva_condition: 'Responsable Inscripto' },
    ]);

    expect(result.summary.created).toBe(1);
    expect(insertsOn('suppliers')[0].args[0]).toMatchObject({ cuit: null });
  });

  it('normaliza el CUIT y acepta los labels legibles de IVA y documento', async () => {
    existingSuppliers([]);
    queueCreatedSupplier('sup-1');

    const result = await run([
      {
        name: 'Distribuidora SA',
        cuit: '30-12345678-9',
        iva_condition: 'Monotributista',
        document_type: 'Cédula de Identidad',
        document_number: '1234567',
      },
    ]);

    expect(result.summary.created).toBe(1);
    expect(insertsOn('suppliers')[0].args[0]).toMatchObject({
      cuit: '30123456789',
      iva_condition: 'monotributista',
      document_type: 'CE',
      document_number: '1234567',
    });
  });

  it('el alta mantiene la tabla espejo providers con el mismo id', async () => {
    existingSuppliers([]);
    queueCreatedSupplier('sup-espejo');

    const result = await run([
      {
        name: 'Distribuidora SA',
        contact_name: 'María Gómez',
        notes: 'Entrega los martes',
        email: 'ventas@dist.com',
      },
    ]);

    expect(result.summary.created).toBe(1);
    const mirror = insertsOn('providers')[0].args[0] as Record<string, unknown>;
    expect(mirror).toMatchObject({
      id: 'sup-espejo',
      tenant_id: 'tenant-1',
      name: 'Distribuidora SA',
      email: 'ventas@dist.com',
    });
    // La tabla espeja no tiene contacto ni notas.
    expect(mirror).not.toHaveProperty('contact_name');
    expect(mirror).not.toHaveProperty('notes');
  });

  it('el contacto viaja a suppliers pero no al espejo providers', async () => {
    existingSuppliers([]);
    queueCreatedSupplier('sup-1');

    await run([{ name: 'Distribuidora SA', contact_name: 'María Gómez' }]);

    expect(insertsOn('suppliers')[0].args[0]).toMatchObject({ contact_name: 'María Gómez' });
    expect(insertsOn('providers')[0].args[0]).not.toHaveProperty('contact_name');
  });
});

describe('prepareSupplierImport: matcheo y updates', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    __resetRateLimitStateForTests();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    asManager();
  });

  it('matchea por CUIT y actualiza suppliers y providers', async () => {
    existingSuppliers([
      { id: 'sup-9', name: 'Distribuidora SA', cuit: '30123456789', email: 'viejo@dist.com' },
    ]);

    const result = await run([
      { name: 'Distribuidora del Sur SA', cuit: '30-12345678-9', email: 'nuevo@dist.com' },
    ]);

    expect(result.summary).toEqual({ created: 0, updated: 1, skipped: 0, total: 1 });
    expect(insertsOn('suppliers')).toHaveLength(0);
    expect(updatesOn('suppliers')[0].args[0]).toMatchObject({
      name: 'Distribuidora del Sur SA',
      email: 'nuevo@dist.com',
      cuit: '30123456789',
    });
    expect(updatesOn('providers')[0].args[0]).toMatchObject({
      name: 'Distribuidora del Sur SA',
      email: 'nuevo@dist.com',
      cuit: '30123456789',
    });
  });

  it('matchea por nombre (case-insensitive) cuando la fila no trae CUIT', async () => {
    existingSuppliers([{ id: 'sup-1', name: 'Distribuidora SA', cuit: null }]);

    const result = await run([{ name: 'distribuidora sa' }]);

    expect(result.summary.updated).toBe(1);
    expect(updatesOn('suppliers')[0].args[0]).toMatchObject({ name: 'distribuidora sa' });
  });

  it('una celda vacía significa "no informar": conserva lo existente', async () => {
    existingSuppliers([
      {
        id: 'sup-1',
        name: 'Distribuidora SA',
        contact_name: 'María Gómez',
        email: 'viejo@dist.com',
        notes: 'Entrega los martes',
        cuit: '30123456789',
      },
    ]);

    const result = await run([
      { name: 'Distribuidora SA', email: '', notes: '', contact_name: '' },
    ]);

    expect(result.summary.updated).toBe(1);
    for (const table of ['suppliers', 'providers']) {
      const payload = updatesOn(table)[0].args[0] as Record<string, unknown>;
      expect(payload).not.toHaveProperty('email');
      expect(payload).not.toHaveProperty('notes');
      expect(payload).not.toHaveProperty('cuit');
    }
    expect(updatesOn('suppliers')[0].args[0]).not.toHaveProperty('contact_name');
  });

  it('sin la columna fiscal, el update no toca los datos fiscales del proveedor', async () => {
    existingSuppliers([
      { id: 'sup-1', name: 'Distribuidora SA', iva_condition: 'monotributista', document_type: 'CUIT' },
    ]);

    const result = await run([{ name: 'Distribuidora SA', email: 'nuevo@dist.com' }]);

    expect(result.summary.updated).toBe(1);
    const payload = updatesOn('suppliers')[0].args[0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('iva_condition');
    expect(payload).not.toHaveProperty('document_type');
  });

  it('el mismo proveedor repetido en el archivo actualiza en vez de duplicar', async () => {
    existingSuppliers([]);
    queueCreatedSupplier('sup-1');

    const result = await run([
      { name: 'Distribuidora SA', cuit: '30123456789', email: 'uno@dist.com' },
      { name: 'Distribuidora SA', cuit: '30123456789', email: 'dos@dist.com' },
    ]);

    expect(result.summary).toEqual({ created: 1, updated: 1, skipped: 0, total: 2 });
    expect(insertsOn('suppliers')).toHaveLength(1);
    expect(insertsOn('providers')).toHaveLength(1);
  });
});

describe('prepareSupplierImport: reporte y log', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    __resetRateLimitStateForTests();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    asManager();
  });

  it('emite el progreso una vez por fila, arrancando en 0 y terminando en el total', async () => {
    existingSuppliers([]);
    queueCreatedSupplier('sup-1');
    queueCreatedSupplier('sup-2');
    queueCreatedSupplier('sup-3');

    const seen: number[] = [];
    const prepared = await prepareSupplierImport(auth, [
      { name: 'Uno' },
      { name: 'Dos' },
      { name: 'Tres' },
    ]);
    if (!prepared.ok) throw new Error('prepareSupplierImport debió aceptar el archivo');

    const result = await prepared.execute((progress) => seen.push(progress.processed));

    expect(seen).toEqual([0, 1, 2, 3]);
    expect(result.summary).toEqual({ created: 3, updated: 0, skipped: 0, total: 3 });
  });

  it('deja un solo log de actividad resumen con kind suppliers', async () => {
    existingSuppliers([]);
    queueCreatedSupplier('sup-1');
    queueCreatedSupplier('sup-2');

    await run([{ name: 'Uno' }, { name: 'Dos' }]);

    expect(vi.mocked(createActivityLog)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createActivityLog)).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        userId: 'user-1',
        action: 'imported',
        entityType: 'import',
        details: { kind: 'suppliers', created: 2, updated: 0, skipped: 0, total: 2 },
      }),
    );
  });

  it('una fila que falla en la base se reporta y no frena el resto', async () => {
    existingSuppliers([]);
    queueCreatedSupplier('sup-1');
    supabaseMock.__queue('suppliers', { data: null, error: { message: 'deadlock detected' } });
    queueCreatedSupplier('sup-3');

    const result = await run([{ name: 'Uno' }, { name: 'Dos' }, { name: 'Tres' }]);

    expect(result.summary).toEqual({ created: 2, updated: 0, skipped: 1, total: 3 });
    expect(result.results[1]).toMatchObject({
      row: 2,
      status: 'skipped',
      name: 'Dos',
      error: 'Ocurrio un error inesperado. Intenta de nuevo.',
    });
  });
});
