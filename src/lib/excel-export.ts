/**
 * Generacion de planillas de exportacion de productos en los formatos que
 * aceptan Tiendanube y MercadoLibre.
 *
 * El import (`excel-import-parse.ts`) ya sabe leer las planillas de ambas
 * plataformas; este modulo hace el camino inverso: arma filas con los
 * encabezados que esas plataformas esperan, para que un exportado desde
 * Vynko se pueda subir a TN/ML y un exportado de aca vuelva a entrar al
 * import sin tocar nada.
 *
 * Todo el trabajo es client-side: se arma el workbook con SheetJS (import
 * dinamico, igual que en el resto del codigo) y se descarga desde el
 * navegador.
 */

import type { Product } from '@/lib/types/product';
import type { Category } from '@/lib/types/category';

/**
 * `generico` es la planilla completa de Vynko (todos los campos internos),
 * pensada para backup o para quien solo quiere bajar un Excel. Tiendanube y
 * MercadoLibre son formatos de destino con sus propios encabezados.
 */
export type ExportPlatform = 'generico' | 'tiendanube' | 'mercadolibre';
export type ExportFormat = 'xls' | 'csv';

export const EXPORT_PLATFORM_LABELS: Record<ExportPlatform, string> = {
  generico: 'Genérico',
  tiendanube: 'Tiendanube',
  mercadolibre: 'MercadoLibre',
};

export const EXPORT_FORMAT_LABELS: Record<ExportFormat, string> = {
  xls: 'XLS',
  csv: 'CSV',
};

/**
 * Slug para el "Identificador de URL" de Tiendanube: minusculas, sin acentos,
 * y todo lo que no sea letra/digito colapsado a guion. Es el mismo criterio que
 * usa Tiendanube para armar el identificador a partir del nombre.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * La descripcion se guarda con HTML (el editor enriquecido). Tanto el CSV de
 * Tiendanube como la plantilla de MercadoLibre esperan texto plano, asi que
 * se quitan las etiquetas y se colapsan los espacios.
 */
function plainText(html: string | undefined): string {
  if (!html) return '';
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function categoryName(categories: Category[], categoryId?: string): string {
  if (!categoryId) return '';
  return categories.find((c) => c.id === categoryId)?.name ?? '';
}

function imageList(product: Product): string {
  if (product.images && product.images.length > 0) return product.images.filter(Boolean).join(', ');
  return product.image_url || '';
}

/**
 * Columnas genericas: todos los campos internos del producto, el mismo set que
 * exportaba Vynko antes de los formatos de plataforma. Es el que usa quien
 * solo quiere una planilla propia o un backup, sin depender de Tiendanube o
 * MercadoLibre.
 */
function genericRow(product: Product, categories: Category[]): Record<string, unknown> {
  return {
    'Nombre': product.name,
    'Categoría': categoryName(categories, product.category_id),
    'SKU': product.sku || '',
    'Código de Barras': product.barcode || '',
    'Descripción': plainText(product.description),
    'Costo': product.cost ?? 0,
    'Precio Venta': product.price ?? 0,
    'Stock': product.stock ?? 0,
    'Stock Mínimo': product.min_stock ?? 0,
    'Stock Máximo': product.max_stock ?? 0,
    'Depósito': product.deposito || '',
    'Pasillo': product.pasillo || '',
    'Estantería': product.estanteria || '',
  };
}

/**
 * Columnas Tiendanube. Se alinean con los alias del import: Nombre,
 * Categorías, Código de barras, SKU, Precio, Costo, Stock, Stock mínimo,
 * Descripción e Imágenes mapean directo; "Identificador de URL" y "Activo"
 * pasan sin mapear (el import los ignora), pero las necesita el import de TN.
 */
function tiendanubeRow(product: Product, categories: Category[]): Record<string, unknown> {
  return {
    'Nombre': product.name,
    'Identificador de URL': slugify(product.name),
    'Categorías': categoryName(categories, product.category_id),
    'SKU': product.sku || '',
    'Código de barras': product.barcode || '',
    'Precio': product.price ?? 0,
    'Costo': product.cost ?? '',
    'Stock': product.stock ?? 0,
    'Stock mínimo': product.min_stock ?? '',
    'Descripción': plainText(product.description),
    'Imágenes': imageList(product),
    'Activo': product.is_active === false ? 'NO' : 'SÍ',
  };
}

/**
 * Columnas MercadoLibre (plantilla de publicacion masiva). "Título", "Precio",
 * "Cantidad" (stock), "Código" (SKU), "GTIN" (codigo de barras), "Categoría",
 * "Descripción" e "Imágenes" son justamente los alias que ya reconoce el
 * import, asi que el archivo vuelve a entrar a Vynko sin perdida.
 */
function mercadolibreRow(product: Product, categories: Category[]): Record<string, unknown> {
  return {
    'Título': product.name,
    'Precio': product.price ?? 0,
    'Cantidad': product.stock ?? 0,
    'Código': product.sku || '',
    'GTIN': product.barcode || '',
    'Categoría': categoryName(categories, product.category_id),
    'Descripción': plainText(product.description),
    'Imágenes': product.images?.filter(Boolean).join(' ') || product.image_url || '',
  };
}

export function buildExportRows(
  products: Product[],
  categories: Category[],
  platform: ExportPlatform,
): Record<string, unknown>[] {
  const toRow =
    platform === 'generico' ? genericRow : platform === 'tiendanube' ? tiendanubeRow : mercadolibreRow;
  return products.map((product) => toRow(product, categories));
}

/**
 * Nombre del archivo. El generico se queda con `productos_YYYY-MM-DD` (es el
 * de siempre); los de plataforma agregan el destino para no mezclarlos.
 */
export function exportFileName(platform: ExportPlatform, format: ExportFormat, now = new Date()): string {
  const day = now.toISOString().slice(0, 10);
  const base = platform === 'generico' ? 'productos' : `productos_${platform}`;
  return `${base}_${day}.${format}`;
}

/**
 * Dispara la descarga de un Blob. El BOM va solo en CSV: sin el, Excel en
 * Windows abre el UTF-8 y muestra los acentos rotos ("CategorÃ­as").
 *
 * Es la misma mecánica para cualquier planilla (productos, clientes,
 * proveedores), así que vive exportada acá para el resto de los exportadores.
 */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Neutraliza la inyección de fórmulas en CSV.
 *
 * Las celdas las escribe el usuario (nombre de producto, de cliente, notas) y
 * el CSV lo abre una planilla: un valor que empieza con `=`, `+`, `-`, `@`,
 * tab o CR se interpreta como fórmula al abrirlo en Excel/Sheets, y puede
 * ejecutar `HYPERLINK`, `cmd` o exfiltrar datos de la hoja.
 *
 * Se prefija con un apóstrofo, que es la receta de OWASP: la planilla muestra
 * el texto literal en vez de evaluarlo. Solo se aplica al CSV; en XLS el valor
 * se escribe como celda de texto y no se evalúa.
 */
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

export function sanitizeSpreadsheetCell(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return FORMULA_TRIGGER.test(value) ? `'${value}` : value;
}

export function sanitizeSpreadsheetRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, sanitizeSpreadsheetCell(value)])
  );
}

/**
 * Serializa filas ya armadas a un Blob de planilla.
 * Para XLS se escribe un BIFF8 real (la extension .xls es la que aceptan los
 * importadores de TN y ML); para CSV se serializa con separador coma y
 * comillas donde hace falta.
 */
export async function sheetToBlob(
  rows: Record<string, unknown>[],
  sheetName: string,
  format: ExportFormat
): Promise<Blob> {
  const XLSX = await import('xlsx');
  if (format === 'csv') {
    const ws = XLSX.utils.json_to_sheet(rows.map(sanitizeSpreadsheetRow));
    const csv = XLSX.utils.sheet_to_csv(ws);
    return new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' });
  }

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const data = XLSX.write(wb, { type: 'array', bookType: 'xls' }) as ArrayBuffer;
  return new Blob([data], { type: 'application/vnd.ms-excel' });
}

/**
 * Genera el Blob de la planilla sin descargarla.
 */
export async function generateExportBlob(options: {
  products: Product[];
  categories: Category[];
  platform: ExportPlatform;
  format: ExportFormat;
  now?: Date;
}): Promise<{ blob: Blob; fileName: string }> {
  const { products, categories, platform, format } = options;
  const rows = buildExportRows(products, categories, platform);
  const sheetName = platform === 'generico' ? 'Productos' : EXPORT_PLATFORM_LABELS[platform];
  const blob = await sheetToBlob(rows, sheetName, format);
  return { blob, fileName: exportFileName(platform, format, options.now) };
}

/**
 * Genera y descarga la planilla.
 */
export async function exportProductsFile(options: {
  products: Product[];
  categories: Category[];
  platform: ExportPlatform;
  format: ExportFormat;
  now?: Date;
}): Promise<void> {
  const { blob, fileName } = await generateExportBlob(options);
  downloadBlob(blob, fileName);
}
