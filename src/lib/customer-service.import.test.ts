import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseMock } from '@/test/supabase-mock';
import { __resetRateLimitStateForTests } from '@/lib/rate-limit';
import { createActivityLog } from '@/lib/activity-log';
import { MAX_IMPORT_ROWS } from './excel-import-parse';
import { prepareCustomerImport } from './customer-service';

const auth = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  allTenants: false,
  tenantIds: ['tenant-1'],
};

vi.mock('@/lib/supabaseAdmin', () => ({ supabaseAdmin: supabaseMock }));
vi.mock('@/lib/activity-log', () => ({ createActivityLog: vi.fn(async () => undefined) }));

function insertsOn() {
  return supabaseMock.__calls.filter((c) => c.table === 'customers' && c.method === 'insert');
}

function updatesOn() {
  return supabaseMock.__calls.filter((c) => c.table === 'customers' && c.method === 'update');
}

/** Lee los clientes existentes que hay en el tenant (Fase 2 del prepare). */
function existingCustomers(rows: Record<string, unknown>[]) {
  supabaseMock.__queue('customers', { data: rows, error: null });
}

/** Cola para un alta que sale bien: el insert pide la fila de vuelta. */
function queueCreatedCustomer(id: string) {
  supabaseMock.__queue('customers', { data: { id }, error: null });
}

async function run(auth_: typeof auth, rows: Record<string, unknown>[]) {
  const prepared = await prepareCustomerImport(auth_, rows);
  if (!prepared.ok) throw new Error('prepareCustomerImport debió aceptar el archivo');
  return prepared.execute();
}

describe('prepareCustomerImport: guardas de entrada', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    __resetRateLimitStateForTests();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('rechaza un archivo vacío sin tocar la base', async () => {
    const result = await prepareCustomerImport(auth, []);
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(supabaseMock.__calls).toHaveLength(0);
  });

  it('rechaza un payload que no es una lista', async () => {
    const result = await prepareCustomerImport(auth, undefined);
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it('corta un archivo con más filas que el máximo, sin tocar la base', async () => {
    const rows = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => ({ name: `Cliente ${i}` }));
    const result = await prepareCustomerImport(auth, rows);

    expect(result).toMatchObject({ ok: false, status: 413 });
    expect(result.ok === false && result.error).toContain(String(MAX_IMPORT_ROWS));
    expect(supabaseMock.__calls).toHaveLength(0);
  });

  it('devuelve 429 al superar el límite por usuario', async () => {
    for (let i = 0; i < 10; i++) {
      existingCustomers([]);
      queueCreatedCustomer(`cust-${i}`);
      await run(auth, [{ name: `Cliente ${i}` }]);
    }

    const bloqueado = await prepareCustomerImport(auth, [{ name: 'Cliente 11' }]);
    expect(bloqueado).toMatchObject({ ok: false, status: 429 });
    expect(insertsOn()).toHaveLength(10);
  });

  it('la cuota de clientes es independiente de la de productos', async () => {
    // Agota su propia cuota con 10 imports de clientes...
    for (let i = 0; i < 10; i++) {
      existingCustomers([]);
      queueCreatedCustomer(`cust-${i}`);
      await run(auth, [{ name: `Cliente ${i}` }]);
    }
    const bloqueado = await prepareCustomerImport(auth, [{ name: 'Cliente 11' }]);
    expect(bloqueado).toMatchObject({ ok: false, status: 429 });

    // ...y el import de productos conserva la suya: son contadores con claves
    // propias para que un dominio no le robe turno al otro.
    const { rateLimit } = await import('@/lib/rate-limit');
    const products = await rateLimit(`import:products:user:${auth.userId}`, 10, 60 * 60 * 1000);
    expect(products.ok).toBe(true);
  });
});

describe('prepareCustomerImport: altas', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    __resetRateLimitStateForTests();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('crea con los defaults del formulario (consumidor final + DNI)', async () => {
    existingCustomers([]);
    queueCreatedCustomer('cust-1');

    const result = await run(auth, [{ name: 'Juan Pérez' }]);

    expect(result.summary).toEqual({ created: 1, updated: 0, skipped: 0, total: 1 });
    expect(insertsOn()[0].args[0]).toMatchObject({
      tenant_id: 'tenant-1',
      name: 'Juan Pérez',
      iva_condition: 'consumidor_final',
      document_type: 'DNI',
    });
  });

  it('normaliza el CUIT a dígitos y acepta los labels legibles', async () => {
    existingCustomers([]);
    queueCreatedCustomer('cust-1');

    const result = await run(auth, [
      {
        name: 'Distribuidora SA',
        cuit: '30-12345678-9',
        iva_condition: 'Responsable Inscripto',
        document_type: 'Pasaporte',
        document_number: 'AB123456',
      },
    ]);

    expect(result.summary.created).toBe(1);
    expect(insertsOn()[0].args[0]).toMatchObject({
      cuit: '30123456789',
      iva_condition: 'responsable_inscripto',
      document_type: 'Pasaporte',
      document_number: 'AB123456',
    });
  });

  it('omite la fila sin nombre pero sigue importando las otras', async () => {
    existingCustomers([]);
    queueCreatedCustomer('cust-1');

    const result = await run(auth, [{ name: '   ' }, { name: 'Juan Pérez' }]);

    expect(result.summary).toEqual({ created: 1, updated: 0, skipped: 1, total: 2 });
    expect(result.results[0]).toMatchObject({ row: 1, status: 'skipped', error: 'Nombre requerido' });
    expect(result.results[1]).toMatchObject({ row: 2, status: 'created', name: 'Juan Pérez' });
  });

  it('omite una condición de IVA que no reconoce, sin escribir nada', async () => {
    const result = await run(auth, [{ name: 'Juan', iva_condition: 'Extraterrestre' }]);

    expect(result.summary.skipped).toBe(1);
    expect(result.results[0]).toMatchObject({
      row: 1,
      status: 'skipped',
      error: 'La condición frente al IVA no es válida',
    });
    expect(insertsOn()).toHaveLength(0);
  });

  it('omite un tipo de documento que no reconoce', async () => {
    const result = await run(auth, [{ name: 'Juan', document_type: 'Licencia de conducir' }]);

    expect(result.summary.skipped).toBe(1);
    expect(result.results[0]).toMatchObject({
      row: 1,
      status: 'skipped',
      error: 'El tipo de documento no es válido',
    });
  });

  it('exige CUIT para dar de alta un Responsable Inscripto', async () => {
    existingCustomers([]);

    const result = await run(auth, [
      { name: 'Distribuidora SA', iva_condition: 'Responsable Inscripto' },
    ]);

    expect(result.summary).toEqual({ created: 0, updated: 0, skipped: 1, total: 1 });
    expect(result.results[0]).toMatchObject({
      row: 1,
      status: 'skipped',
      name: 'Distribuidora SA',
      error: 'Los Responsables Inscriptos necesitan un CUIT para facturar',
    });
    expect(insertsOn()).toHaveLength(0);
  });
});

describe('prepareCustomerImport: matcheo y updates', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    __resetRateLimitStateForTests();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('matchea por CUIT aunque el archivo lo traiga con guiones', async () => {
    existingCustomers([
      { id: 'cust-9', name: 'Juan Pérez', cuit: '20123456789', email: 'viejo@ejemplo.com' },
    ]);

    const result = await run(auth, [
      { name: 'Juan Pedro Pérez', cuit: '20-12345678-9', email: 'nuevo@ejemplo.com' },
    ]);

    expect(result.summary).toEqual({ created: 0, updated: 1, skipped: 0, total: 1 });
    expect(insertsOn()).toHaveLength(0);
    expect(updatesOn()[0].args[0]).toMatchObject({
      name: 'Juan Pedro Pérez',
      email: 'nuevo@ejemplo.com',
      cuit: '20123456789',
    });
  });

  it('matchea por nombre (case-insensitive) cuando la fila no trae CUIT', async () => {
    existingCustomers([{ id: 'cust-1', name: 'Juan Pérez', cuit: null }]);

    const result = await run(auth, [{ name: 'juan perez' }]);

    expect(result.summary.updated).toBe(1);
    expect(updatesOn()[0].args[0]).toMatchObject({ name: 'juan perez' });
  });

  it('una celda vacía significa "no informar": conserva el valor existente', async () => {
    existingCustomers([
      {
        id: 'cust-1',
        name: 'Juan Pérez',
        email: 'juan@ejemplo.com',
        phone: '11 1234-5678',
        address: 'Calle Falsa 123',
        cuit: '20123456789',
        iva_condition: 'responsable_inscripto',
        document_type: 'CUIT',
        document_number: '30123456789',
      },
    ]);

    const result = await run(auth, [
      { name: 'Juan Pérez', email: '', phone: '', address: '' },
    ]);

    expect(result.summary.updated).toBe(1);
    const payload = updatesOn()[0].args[0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('email');
    expect(payload).not.toHaveProperty('phone');
    expect(payload).not.toHaveProperty('address');
    expect(payload).not.toHaveProperty('cuit');
    expect(payload).not.toHaveProperty('document_number');
  });

  it('sin la columna fiscal, el update no toca los datos fiscales del cliente', async () => {
    existingCustomers([
      {
        id: 'cust-1',
        name: 'Juan Pérez',
        cuit: '20123456789',
        iva_condition: 'responsable_inscripto',
        document_type: 'CUIT',
      },
    ]);

    const result = await run(auth, [{ name: 'Juan Pérez', email: 'nuevo@ejemplo.com' }]);

    expect(result.summary.updated).toBe(1);
    const payload = updatesOn()[0].args[0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('iva_condition');
    expect(payload).not.toHaveProperty('document_type');
    expect(payload).not.toHaveProperty('cuit');
  });

  it('valida el registro final: un update que queda Responsable Inscripto sin CUIT se omite', async () => {
    existingCustomers([
      { id: 'cust-1', name: 'Juan Pérez', cuit: null, iva_condition: 'consumidor_final', document_type: 'DNI' },
    ]);

    const result = await run(auth, [
      { name: 'Juan Pérez', iva_condition: 'Responsable Inscripto' },
    ]);

    expect(result.summary).toEqual({ created: 0, updated: 0, skipped: 1, total: 1 });
    expect(result.results[0]).toMatchObject({
      row: 1,
      status: 'skipped',
      error: 'Los Responsables Inscriptos necesitan un CUIT para facturar',
    });
    expect(updatesOn()).toHaveLength(0);
  });

  it('un update sin CUIT reutiliza el CUIT que ya tenía el cliente', async () => {
    existingCustomers([
      { id: 'cust-1', name: 'Juan Pérez', cuit: '20123456789', iva_condition: 'responsable_inscripto', document_type: 'CUIT' },
    ]);

    const result = await run(auth, [
      { name: 'Juan Pérez', iva_condition: 'Responsable Inscripto', email: 'juan@ejemplo.com' },
    ]);

    expect(result.summary.updated).toBe(1);
    expect(updatesOn()[0].args[0]).toMatchObject({ email: 'juan@ejemplo.com' });
  });

  it('el mismo cliente repetido en el archivo actualiza en vez de duplicar', async () => {
    existingCustomers([]);
    queueCreatedCustomer('cust-1');

    const result = await run(auth, [
      { name: 'Juan Pérez', cuit: '20123456789', email: 'uno@ejemplo.com' },
      { name: 'Juan Pedro Pérez', cuit: '20123456789', email: 'dos@ejemplo.com' },
    ]);

    expect(result.summary).toEqual({ created: 1, updated: 1, skipped: 0, total: 2 });
    expect(insertsOn()).toHaveLength(1);
  });
});

describe('prepareCustomerImport: reporte, progreso y log', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    __resetRateLimitStateForTests();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('emite el progreso una vez por fila, arrancando en 0 y terminando en el total', async () => {
    existingCustomers([]);
    queueCreatedCustomer('cust-1');
    queueCreatedCustomer('cust-2');
    queueCreatedCustomer('cust-3');

    const seen: number[] = [];
    const prepared = await prepareCustomerImport(auth, [
      { name: 'Uno' },
      { name: 'Dos' },
      { name: 'Tres' },
    ]);
    if (!prepared.ok) throw new Error('prepareCustomerImport debió aceptar el archivo');

    const result = await prepared.execute((progress) => seen.push(progress.processed));

    expect(seen).toEqual([0, 1, 2, 3]);
    expect(result.summary).toEqual({ created: 3, updated: 0, skipped: 0, total: 3 });
  });

  it('cuenta las filas inválidas como procesadas aunque nunca lleguen a escribir', async () => {
    // Fila 1 sin nombre (se descarta en la validación), fila 2 valida. La barra
    // no puede quedar en "1 de 2" al terminar por culpa de la fila descartada.
    existingCustomers([]);
    queueCreatedCustomer('cust-1');

    const prepared = await prepareCustomerImport(auth, [{ name: '' }, { name: 'Juan' }]);
    if (!prepared.ok) throw new Error('prepareCustomerImport debió aceptar el archivo');

    const seen: number[] = [];
    const result = await prepared.execute((progress) => seen.push(progress.processed));

    expect(seen[0]).toBe(1);
    expect(seen[seen.length - 1]).toBe(2);
    expect(result.summary).toEqual({ created: 1, updated: 0, skipped: 1, total: 2 });
  });

  it('deja un solo log de actividad resumen con kind customers', async () => {
    existingCustomers([]);
    queueCreatedCustomer('cust-1');
    queueCreatedCustomer('cust-2');

    await run(auth, [{ name: 'Uno' }, { name: 'Dos' }]);

    expect(vi.mocked(createActivityLog)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createActivityLog)).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        userId: 'user-1',
        action: 'imported',
        entityType: 'import',
        details: { kind: 'customers', created: 2, updated: 0, skipped: 0, total: 2 },
      }),
    );
  });

  it('una fila que falla en la base se reporta y no frena el resto', async () => {
    existingCustomers([]);
    queueCreatedCustomer('cust-1');
    supabaseMock.__queue('customers', { data: null, error: { message: 'deadlock detected' } });
    queueCreatedCustomer('cust-3');

    const result = await run(auth, [{ name: 'Uno' }, { name: 'Dos' }, { name: 'Tres' }]);

    expect(result.summary).toEqual({ created: 2, updated: 0, skipped: 1, total: 3 });
    expect(result.results[1]).toMatchObject({
      row: 2,
      status: 'skipped',
      name: 'Dos',
      error: 'Ocurrio un error inesperado. Intenta de nuevo.',
    });
  });
});
