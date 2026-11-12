import { describe, expect, it } from 'vitest';
import { summarizeImportRows } from './import-preview';

describe('summarizeImportRows', () => {
  it('cuenta como válidas las filas con los campos opcionales vacíos', () => {
    const preview = summarizeImportRows([
      { name: 'Coca Cola 1.5L', price: 1500, stock: 10 },
      { name: 'Agua 500ml', cost: '', min_stock: null },
    ]);

    expect(preview).toEqual({ total: 2, valid: 2, skipped: [] });
  });

  it('marca las filas sin nombre', () => {
    const preview = summarizeImportRows([{ name: '   ', price: 100 }]);

    expect(preview.valid).toBe(0);
    expect(preview.skipped).toEqual([
      { row: 1, name: '', error: 'Nombre requerido' },
    ]);
  });

  it('detecta precio inválido y costo negativo', () => {
    const preview = summarizeImportRows([
      { name: 'Producto A', price: 'abc' },
      { name: 'Producto B', cost: -5 },
    ]);

    expect(preview.skipped.map((issue) => issue.error)).toEqual([
      'El precio debe ser un número',
      'El costo debe ser un número no negativo',
    ]);
  });

  it('valida que los stocks sean enteros no negativos', () => {
    const preview = summarizeImportRows([
      { name: 'Producto A', stock: 1.5 },
      { name: 'Producto B', min_stock: -1 },
      { name: 'Producto C', max_stock: 'diez' },
    ]);

    expect(preview.valid).toBe(0);
    expect(preview.skipped.map((issue) => issue.row)).toEqual([1, 2, 3]);
  });

  it('informa el número de fila real y el nombre recortado', () => {
    const preview = summarizeImportRows([
      { name: 'Bien' },
      { name: '  Mal  ', price: -1 },
    ]);

    expect(preview.skipped).toEqual([
      { row: 2, name: 'Mal', error: 'El precio no puede ser negativo' },
    ]);
  });
});
