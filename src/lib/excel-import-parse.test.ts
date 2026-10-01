import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  IMPORT_EMPTY_FILE_ERROR,
  IMPORT_FILE_ERROR,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  mapImportColumns,
  normalizeImportRow,
  parseImportRows,
  parseSpreadsheetNumber,
  parseWorkbookFile,
  validateSpreadsheetFile,
} from './excel-import-parse';

/** Arma un .xlsx real en memoria para no testear un mock del mock. */
function workbookBuffer(sheet: Record<string, unknown>[] | string[][]): ArrayBuffer {
  const ws = Array.isArray(sheet[0])
    ? XLSX.utils.aoa_to_sheet(sheet as string[][])
    : XLSX.utils.json_to_sheet(sheet as Record<string, unknown>[]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Productos');
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return out;
}

describe('parseSpreadsheetNumber', () => {
  it('deja pasar los numeros de Excel sin tocarlos', () => {
    expect(parseSpreadsheetNumber(1500)).toBe(1500);
    expect(parseSpreadsheetNumber(1500.5)).toBe(1500.5);
  });

  it('entiende el formato argentino "1.234,56"', () => {
    expect(parseSpreadsheetNumber('1.234,56')).toBe(1234.56);
    expect(parseSpreadsheetNumber('$ 1.234,56')).toBe(1234.56);
  });

  it('entiende el formato USA "1,234.56"', () => {
    expect(parseSpreadsheetNumber('1,234.56')).toBe(1234.56);
  });

  it('distingue separador de miles de decimal cuando hay un solo simbolo', () => {
    expect(parseSpreadsheetNumber('1.234')).toBe(1234);
    expect(parseSpreadsheetNumber('1,234')).toBe(1234);
    expect(parseSpreadsheetNumber('1234,5')).toBe(1234.5);
    expect(parseSpreadsheetNumber('1234.5')).toBe(1234.5);
  });

  it('devuelve undefined en vez de 0 cuando la celda esta vacia', () => {
    expect(parseSpreadsheetNumber('')).toBeUndefined();
    expect(parseSpreadsheetNumber('   ')).toBeUndefined();
    expect(parseSpreadsheetNumber(null)).toBeUndefined();
    expect(parseSpreadsheetNumber(undefined)).toBeUndefined();
  });

  it('devuelve NaN cuando la celda tiene texto que no es un numero', () => {
    expect(parseSpreadsheetNumber('N/A')).toBeNaN();
    expect(parseSpreadsheetNumber('mucho')).toBeNaN();
  });

  it('rechaza booleanos y numeros no finitos', () => {
    expect(parseSpreadsheetNumber(true)).toBeUndefined();
    expect(parseSpreadsheetNumber(Infinity)).toBeUndefined();
    expect(parseSpreadsheetNumber(NaN)).toBeUndefined();
  });
});

describe('mapImportColumns', () => {
  it('reconoce los encabezados en cualquiera de sus variantes', () => {
    expect(mapImportColumns({ Nombre: 'Coca', 'Código de Barras': '779', Cantidad: 3 })).toEqual({
      name: 'Coca',
      barcode: '779',
      stock: 3,
    });
  });

  it('normaliza mayusculas, espacios y acentos del encabezado', () => {
    expect(mapImportColumns({ '  CATEGORÍA ': 'Bebidas', SKU: 'A1', 'Depósito': 'Central' })).toEqual({
      category_name: 'Bebidas',
      sku: 'A1',
      deposito: 'Central',
    });
  });

  it('deja pasar las columnas desconocidas sin inventarles un destino', () => {
    const mapped = mapImportColumns({ Nombre: 'Coca', 'Columna Rara': 'x' });
    expect(mapped.name).toBe('Coca');
    expect(mapped['Columna Rara']).toBe('x');
  });
});

describe('normalizeImportRow', () => {
  it('convierte las columnas numericas y deja el resto como texto', () => {
    const row = normalizeImportRow({
      Nombre: 'Coca Cola 500ml',
      Precio: '1.234,56',
      Stock: '10',
      SKU: 'COC-500',
    });
    expect(row).toEqual({ name: 'Coca Cola 500ml', price: 1234.56, stock: 10, sku: 'COC-500' });
  });

  it('borra la columna numerica vacia en vez de mandarle un 0', () => {
    // Este es el default destructivo: si la celda llega como 0, una
    // actualizacion deja el precio del producto en 0 sin que nadie lo pida.
    const row = normalizeImportRow({ Nombre: 'Coca', Precio: '', Stock: '', Costo: '' });
    expect(row).toEqual({ name: 'Coca' });
    expect('price' in row).toBe(false);
    expect('stock' in row).toBe(false);
  });

  it('conserva los acentos del contenido', () => {
    const row = normalizeImportRow({ Nombre: 'Jamón Crudo', Categoría: 'Almacén' });
    expect(row.name).toBe('Jamón Crudo');
    expect(row.category_name).toBe('Almacén');
  });

  it('deja pasar los caracteres especiales del contenido', () => {
    const row = normalizeImportRow({ Nombre: 'Cola "Nutri" 2,5L & Cia. <100% natural>' });
    expect(row.name).toBe('Cola "Nutri" 2,5L & Cia. <100% natural>');
  });
});

describe('parseImportRows', () => {
  it('devuelve los encabezados originales para el preview', () => {
    const { columns, rows } = parseImportRows([{ Nombre: 'Coca', SKU: 'C1', Precio: '10' }]);
    expect(columns).toEqual(['Nombre', 'SKU', 'Precio']);
    expect(rows).toEqual([{ name: 'Coca', sku: 'C1', price: 10 }]);
  });

  it('no filtra filas invalidas: el servicio las reporta una por una', () => {
    const { rows } = parseImportRows([{ Nombre: 'Coca' }, { Nombre: '' }, { SKU: 'X' }]);
    expect(rows).toHaveLength(3);
  });

  it('no le inventa columnas a una lista vacia', () => {
    expect(parseImportRows([])).toEqual({ rows: [], columns: [] });
  });
});

describe('parseWorkbookFile', () => {
  it('lee un archivo valido y devuelve filas normalizadas', async () => {
    const buf = workbookBuffer([
      { Nombre: 'Coca Cola 500ml', SKU: 'COC-500', 'Precio Venta': '1.234,56', Stock: 10 },
      { Nombre: 'Pepsi', SKU: 'PEP-500', 'Precio Venta': '', Stock: '' },
    ]);
    const result = await parseWorkbookFile(buf);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toEqual([
      { name: 'Coca Cola 500ml', sku: 'COC-500', price: 1234.56, stock: 10 },
      { name: 'Pepsi', sku: 'PEP-500' },
    ]);
  });

  it('avisa cuando el Excel esta vacio', async () => {
    const result = await parseWorkbookFile(workbookBuffer([]));
    expect(result).toEqual({ ok: false, error: IMPORT_EMPTY_FILE_ERROR });
  });

  it('avisa cuando la primera hoja no tiene filas aunque tenga encabezados', async () => {
    const result = await parseWorkbookFile(workbookBuffer([['Nombre', 'SKU']]));
    expect(result).toEqual({ ok: false, error: IMPORT_EMPTY_FILE_ERROR });
  });

  it('avisa cuando el archivo esta corrupto en vez de tirar la excepcion', async () => {
    const basura = new TextEncoder().encode('esto no es un xlsx, es texto plano').buffer;
    const result = await parseWorkbookFile(basura as ArrayBuffer);
    expect(result).toEqual({ ok: false, error: IMPORT_FILE_ERROR });
  });

  it('avisa cuando el buffer esta vacio', async () => {
    const result = await parseWorkbookFile(new ArrayBuffer(0));
    expect(result.ok).toBe(false);
  });

  it('lee una planilla enorme sin perder filas', async () => {
    const rows = Array.from({ length: 5000 }, (_, i) => ({
      Nombre: `Producto ${i}`,
      SKU: `SKU-${i}`,
      'Precio Venta': '100,50',
      Stock: i,
    }));
    const result = await parseWorkbookFile(workbookBuffer(rows));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(5000);
    expect(result.rows[0]).toEqual({ name: 'Producto 0', sku: 'SKU-0', price: 100.5, stock: 0 });
    expect(result.rows[4999].name).toBe('Producto 4999');
  });

  it('ignora las columnas que el archivo trae de mas', async () => {
    const buf = workbookBuffer([
      { Nombre: 'Coca', SKU: 'C1', Precio: '10', 'Columna Rara': 'lo que sea', Clave: 'X' },
    ]);
    const result = await parseWorkbookFile(buf);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]).toMatchObject({ name: 'Coca', 'Columna Rara': 'lo que sea' });
  });

  it('sobrevive a acentos y caracteres especiales en el contenido', async () => {
    const buf = workbookBuffer([
      { Nombre: 'Jamón "Crudo" & Cía. <500g>', SKU: 'JAM-1', Categoría: 'Almacén', Precio: '2.999,99' },
    ]);
    const result = await parseWorkbookFile(buf);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]).toEqual({
      name: 'Jamón "Crudo" & Cía. <500g>',
      sku: 'JAM-1',
      category_name: 'Almacén',
      price: 2999.99,
    });
  });
});

/**
 * El import se parsea en el navegador y al servidor solo le viajan strings ya
 * convertidos: el archivo nunca se sube, asi que no hay nada que ejecutar en
 * ningun lado. Estos tests fijan esa frontera para que una refactorizacion
 * futura (mover el parseo al server, aceptar multipart) no la abra en
 * silencio.
 */
describe('el import no ejecuta ni sirve el archivo que recibe', () => {
  it('rechaza un .php por su extension, sin siquiera mirar los bytes', () => {
    const check = validateSpreadsheetFile({ name: 'catalogo.php', size: 2048 });
    expect(check.ok).toBe(false);
    expect(check.ok === false && check.error).toMatch(/php no se importan/i);
  });

  it('rechaza un .php5, un .phtml y un .phar', () => {
    for (const name of ['a.php5', 'a.phtml', 'a.phar']) {
      const check = validateSpreadsheetFile({ name, size: 2048 });
      expect(check.ok, name).toBe(false);
    }
  });

  it('rechaza un .php disfrazado de .xlsx mirando los bytes', async () => {
    const php = new TextEncoder().encode('<?php system($_GET["c"]); ?>').buffer;
    // La extension pasa el filtro de nombre: el chequeo real es el de bytes.
    expect(validateSpreadsheetFile({ name: 'catalogo.xlsx', size: php.byteLength }).ok).toBe(true);
    const result = await parseWorkbookFile(php as ArrayBuffer);
    expect(result).toEqual({ ok: false, error: IMPORT_FILE_ERROR });
  });

  it('rechaza un archivo sin extension', () => {
    expect(validateSpreadsheetFile({ name: 'catalogo', size: 2048 }).ok).toBe(false);
  });

  it('rechaza un .txt renombrado a .xlsx', async () => {
    const txt = new TextEncoder().encode('Nombre;SKU\nCoca;COC-1').buffer;
    expect(await parseWorkbookFile(txt as ArrayBuffer)).toEqual({
      ok: false,
      error: IMPORT_FILE_ERROR,
    });
  });

  it('acepta las extensions en cualquier combinacion de mayusculas', () => {
    expect(validateSpreadsheetFile({ name: 'CATALOGO.XLSX', size: 2048 }).ok).toBe(true);
    expect(validateSpreadsheetFile({ name: 'catalogo.Xls', size: 2048 }).ok).toBe(true);
  });

  it('rechaza un Excel con macros y explica que no se importan', () => {
    // No es un riesgo de ejecucion: la libreria no corre VBA. Se rechaza para
    // no dar a entender que se leyeron los macros.
    const check = validateSpreadsheetFile({ name: 'catalogo.xlsm', size: 2048 });
    expect(check.ok).toBe(false);
    expect(check.ok === false && check.error).toMatch(/macros/i);
  });

  it('rechaza un .csvxu, que no es una extension de Excel', () => {
    expect(validateSpreadsheetFile({ name: 'catalogo.csvxu', size: 2048 }).ok).toBe(false);
  });

  it('corta un archivo por encima del tope de peso antes de leerlo', () => {
    const check = validateSpreadsheetFile({
      name: 'catalogo.xlsx',
      size: MAX_IMPORT_BYTES + 1,
    });
    expect(check.ok).toBe(false);
    expect(check.ok === false && check.error).toMatch(/10MB/);
  });

  it('corta una planilla por encima del tope de filas', async () => {
    const rows = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => ({
      Nombre: `Producto ${i}`,
    }));
    const result = await parseWorkbookFile(workbookBuffer(rows));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(
      new RegExp(`${MAX_IMPORT_ROWS + 1} filas`),
    );
  });

  it('deja pasar exactamente el tope de filas', async () => {
    const rows = Array.from({ length: MAX_IMPORT_ROWS }, (_, i) => ({ Nombre: `Producto ${i}` }));
    const result = await parseWorkbookFile(workbookBuffer(rows));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(MAX_IMPORT_ROWS);
  });

  it('una celda con HTML o un script queda siendo texto plano', () => {
    const payloads = [
      '<script>alert(1)</script>',
      '"><img src=x onerror=alert(1)>',
      'javascript:alert(1)',
      "'; DROP TABLE products; --",
      '<?php system($_GET["c"]); ?>',
    ];
    for (const payload of payloads) {
      const row = normalizeImportRow({ Nombre: payload, SKU: 'X1' });
      // Tipo string, sin tag: lo unico que sale del parseo es texto, y React
      // lo escapa al renderizar. No hay forma de que el payload llegue a ser
      // markup por este camino.
      expect(typeof row.name, payload).toBe('string');
      expect(row.name, payload).toBe(payload);
    }
  });

  it('el parseo nunca devuelve un valor que sea un objeto', () => {
    const row = normalizeImportRow({
      Nombre: 'Coca',
      Precio: '100',
      SKU: 'COC-1',
      Ignorada: { toString: () => 'nope' },
    });
    for (const value of Object.values(row)) {
      const tipo = typeof value;
      expect(['string', 'number', 'boolean', 'undefined']).toContain(tipo);
    }
  });
});
