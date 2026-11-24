import {
  foldImportHeader,
  isVariantImportRow,
  parseVariantAttributes,
  VARIANT_ATTRIBUTE_REQUIRED_ERROR,
  VARIANT_LABEL_REQUIRED_ERROR,
} from '@/lib/excel-import-parse';
import { validatePrice, validateStock } from '@/lib/product-validation';

function rowValue(row: Record<string, unknown>, ...keys: string[]): unknown {
  const folded = new Map(
    Object.entries(row).map(([key, value]) => [foldImportHeader(key), value] as const)
  );
  for (const key of keys) {
    const value = folded.get(foldImportHeader(key));
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

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
    const isVariant = isVariantImportRow(row);
    const parentName = String(
      (isVariant
        ? rowValue(row, 'parent_name', 'producto principal', 'producto padre', 'nombre padre', 'parent', 'name', 'nombre', 'producto', 'titulo')
        : row.name) ?? ''
    ).trim();
    const variantLabel = isVariant
      ? String(rowValue(row, 'variant_label', 'etiqueta variante', 'etiqueta de variante', 'variante', 'variant') ?? '').trim()
      : '';
    const name = isVariant && variantLabel ? `${parentName} · ${variantLabel}` : parentName;

    if (!parentName) {
      skipped.push({ row: rowNumber, name: '', error: 'Nombre requerido' });
      return;
    }

    if (isVariant && !variantLabel) {
      skipped.push({ row: rowNumber, name, error: VARIANT_LABEL_REQUIRED_ERROR });
      return;
    }

    if (isVariant) {
      const attributes = parseVariantAttributes(
        rowValue(row, 'variant_attributes', 'atributos variante', 'atributos de variante', 'atributos') ?? ''
      );
      if (attributes.length === 0) {
        skipped.push({ row: rowNumber, name, error: VARIANT_ATTRIBUTE_REQUIRED_ERROR });
        return;
      }
    }

    const priceSource = isVariant
      ? rowValue(row, 'variant_price', 'precio variante', 'precio de variante', 'price', 'precio')
      : row.price;
    const hasPrice = priceSource !== undefined && priceSource !== null && priceSource !== '';
    if (hasPrice) {
      const priceError = validatePrice(priceSource);
      if (priceError) {
        skipped.push({ row: rowNumber, name, error: priceError });
        return;
      }
    }

    const costSource = isVariant
      ? rowValue(row, 'variant_cost', 'costo variante', 'costo de variante', 'cost', 'costo')
      : row.cost;
    if (costSource !== undefined && costSource !== null && costSource !== '') {
      const cost = Number(costSource);
      if (Number.isNaN(cost) || cost < 0) {
        skipped.push({
          row: rowNumber,
          name,
          error: 'El costo debe ser un número no negativo',
        });
        return;
      }
    }

    const stockSources = isVariant
      ? {
          stock: rowValue(row, 'variant_stock', 'stock variante', 'stock de variante', 'stock'),
          min_stock: rowValue(row, 'variant_min_stock', 'stock minimo variante', 'stock mínimo variante', 'min stock variante', 'min_stock'),
          max_stock: rowValue(row, 'variant_max_stock', 'stock maximo variante', 'stock máximo variante', 'max stock variante', 'max_stock'),
        }
      : { stock: row.stock, min_stock: row.min_stock, max_stock: row.max_stock };
    for (const field of ['stock', 'min_stock', 'max_stock'] as const) {
      const stockError = validateStock(stockSources[field]);
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
