import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parsePartyWorkbookFile } from './excel-import-parse';
import { buildPartyExportRows, partyExportFileName, type PartyExportRecord } from './party-export';

const CUSTOMER: PartyExportRecord = {
  name: 'Distribuidora SA',
  email: 'ventas@dist.com',
  phone: '11 1234-5678',
  address: 'Av. Siempreviva 742',
  cuit: '30123456789',
  iva_condition: 'responsable_inscripto',
  document_type: 'CUIT',
  document_number: '30123456789',
};

const SUPPLIER: PartyExportRecord = {
  ...CUSTOMER,
  name: 'Distribuidora del Sur SA',
  contact_name: 'María Gómez',
  notes: 'Entrega los martes',
  iva_condition: 'monotributista',
  document_type: 'CE',
  document_number: 'AB1234',
};

/** Arma un .xlsx real en memoria para probar el ida y vuelta, no un mock. */
function workbookBuffer(rows: Record<string, unknown>[], sheetName: string): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), sheetName);
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

describe('buildPartyExportRows: clientes', () => {
  const rows = buildPartyExportRows([CUSTOMER], 'customers');

  it('usa las columnas del import de clientes', () => {
    expect(Object.keys(rows[0])).toEqual([
      'Nombre',
      'CUIT',
      'Condición IVA',
      'Tipo de documento',
      'Número de documento',
      'Email',
      'Teléfono',
      'Dirección',
    ]);
  });

  it('escribe el CUIT formateado y los labels legibles de IVA y documento', () => {
    expect(rows[0]).toMatchObject({
      'Nombre': 'Distribuidora SA',
      'CUIT': '30-12345678-9',
      'Condición IVA': 'Responsable Inscripto',
      'Tipo de documento': 'CUIT',
      'Email': 'ventas@dist.com',
    });
  });

  it('los campos vacíos van como celda vacía, no como null ni undefined', () => {
    const rows2 = buildPartyExportRows(
      [{ name: 'Juan Pérez', cuit: null, iva_condition: null, document_type: null }],
      'customers',
    );
    expect(rows2[0]).toMatchObject({
      'Nombre': 'Juan Pérez',
      'CUIT': '',
      'Condición IVA': '',
      'Tipo de documento': '',
    });
  });
});

describe('buildPartyExportRows: proveedores', () => {
  const rows = buildPartyExportRows([SUPPLIER], 'suppliers');

  it('agrega contacto y notas, que sólo existen para proveedores', () => {
    expect(Object.keys(rows[0])).toEqual([
      'Nombre',
      'Contacto',
      'CUIT',
      'Condición IVA',
      'Tipo de documento',
      'Número de documento',
      'Email',
      'Teléfono',
      'Dirección',
      'Notas',
    ]);
  });

  it('mapea contacto y notas', () => {
    expect(rows[0]).toMatchObject({
      'Contacto': 'María Gómez',
      'Notas': 'Entrega los martes',
    });
  });

  it('un código de documento sin label cae al valor crudo', () => {
    const rows2 = buildPartyExportRows(
      [{ name: 'X', document_type: 'CUIL', iva_condition: 'sujeto_exento' }],
      'suppliers',
    );
    expect(rows2[0]).toMatchObject({
      'Tipo de documento': 'CUIL',
      'Condición IVA': 'Sujeto Exento',
    });
  });
});

describe('partyExportFileName', () => {
  it('usa la fecha del día y el formato pedido', () => {
    const now = new Date('2026-11-10T12:00:00Z');
    expect(partyExportFileName('customers', 'xls', now)).toBe('clientes_2026-11-10.xls');
    expect(partyExportFileName('suppliers', 'csv', now)).toBe('proveedores_2026-11-10.csv');
  });
});

describe('ida y vuelta con el import', () => {
  it('un export de clientes vuelve a entrar por parsePartyWorkbookFile', async () => {
    const exported = buildPartyExportRows([CUSTOMER, { name: 'Juan Pérez' }], 'customers');
    const parsed = await parsePartyWorkbookFile(workbookBuffer(exported, 'Clientes'), {
      fileName: 'clientes.xlsx',
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows[0]).toMatchObject({
      name: 'Distribuidora SA',
      cuit: '30-12345678-9',
      iva_condition: 'Responsable Inscripto',
      document_type: 'CUIT',
      document_number: '30123456789',
      email: 'ventas@dist.com',
      phone: '11 1234-5678',
      address: 'Av. Siempreviva 742',
    });
  });

  it('un export de proveedores vuelve a entrar por parsePartyWorkbookFile', async () => {
    const exported = buildPartyExportRows([SUPPLIER], 'suppliers');
    const parsed = await parsePartyWorkbookFile(workbookBuffer(exported, 'Proveedores'), {
      fileName: 'proveedores.xlsx',
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows[0]).toMatchObject({
      name: 'Distribuidora del Sur SA',
      contact_name: 'María Gómez',
      notes: 'Entrega los martes',
      iva_condition: 'Monotributista',
      document_type: 'Cédula de Identidad',
      document_number: 'AB1234',
    });
  });

  it('una planilla de clientes con una sola columna Nombre ya es un import válido', async () => {
    // El mínimo de columnas reconocidas baja a 1 en terceros: reimportar la
    // lista de nombres alcanza para dar de alta/clientes actualizar.
    const parsed = await parsePartyWorkbookFile(
      workbookBuffer([{ Nombre: 'Juan Pérez' }], 'Clientes'),
      { fileName: 'clientes.xlsx' },
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows[0]).toEqual({ name: 'Juan Pérez' });
  });

  it('las columnas desconocidas pasan de largo sin romper el parseo', async () => {
    const exported = buildPartyExportRows([CUSTOMER], 'customers');
    exported[0]['Rubro'] = 'Almacén';
    const parsed = await parsePartyWorkbookFile(workbookBuffer(exported, 'Clientes'), {
      fileName: 'clientes.xlsx',
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows[0]).toMatchObject({ name: 'Distribuidora SA', Rubro: 'Almacén' });
  });
});
