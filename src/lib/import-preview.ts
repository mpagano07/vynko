import { validatePrice, validateStock } from '@/lib/product-validation';

export interface ImportPreviewIssue {
  /** Número de fila del archivo, 1-based, igual al que reporta el servidor. */
  row: number;
  name: string;
  error: string;
}

export interface ImportPreview {
  total: number;
  valid: number;
  skipped: ImportPreviewIssue[];
}

/**
 * Validación previa del import de productos. Repite a propósito las reglas de
 * `prepareImport` (nombre, precio, costo y stocks) para que la persona vea qué
 * filas se van a omitir ANTES de mandar el archivo. El servidor sigue siendo la
 * autoridad: esto es solo un preview y no reemplaza sus validaciones.
 *
 * Las reglas se apoyan en los mismos helpers que usa la API para no inventar
 * mensajes distintos a los que después aparecen en el reporte.
 */
export function summarizeImportRows(rows: Record<string, unknown>[]): ImportPreview {
  const skipped: ImportPreviewIssue[] = [];

  rows.forEach((row, index) => {
    const rowNumber = index + 1;
    const name = String(row.name ?? '').trim();

    if (!name) {
      skipped.push({ row: rowNumber, name: '', error: 'Nombre requerido' });
      return;
    }

    const hasPrice = row.price !== undefined && row.price !== null && row.price !== '';
    if (hasPrice) {
      const priceError = validatePrice(row.price);
      if (priceError) {
        skipped.push({ row: rowNumber, name, error: priceError });
        return;
      }
    }

    if (row.cost !== undefined && row.cost !== null && row.cost !== '') {
      const cost = Number(row.cost);
      if (Number.isNaN(cost) || cost < 0) {
        skipped.push({
          row: rowNumber,
          name,
          error: 'El costo debe ser un número no negativo',
        });
        return;
      }
    }

    for (const field of ['stock', 'min_stock', 'max_stock'] as const) {
      const stockError = validateStock(row[field]);
      if (stockError) {
        skipped.push({ row: rowNumber, name, error: stockError });
        return;
      }
    }
  });

  return {
    total: rows.length,
    valid: rows.length - skipped.length,
    skipped,
  };
}
