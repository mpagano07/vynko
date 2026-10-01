/**
 * Lectura y normalizacion de la planilla que alimenta la importacion de
 * productos.
 *
 * Vive fuera del componente de productos por dos razones: la pagina es un
 * archivo de 1800 lineas y la logica de columnas no se podia testear, y
 * sobre todo porque el parseo es la unica frontera donde un archivo de
 * terceros puede meter basura en la base. Todo lo que llega de aca vuelve a
 * ser validado por `importProducts`, pero un default destructivo en esta capa
 * (un precio vacido convertido a 0) llega intacto hasta el write.
 */

/** Alias de encabezados aceptados. La clave es el encabezado ya normalizado. */
export const IMPORT_COLUMN_ALIASES: Record<string, string> = {
  nombre: 'name',
  producto: 'name',
  name: 'name',
  sku: 'sku',
  codigo: 'sku',
  'código': 'sku',
  barcode: 'barcode',
  'código de barras': 'barcode',
  'codigo de barras': 'barcode',
  gtin: 'barcode',
  precio: 'price',
  price: 'price',
  'precio venta': 'price',
  costo: 'cost',
  cost: 'cost',
  stock: 'stock',
  cantidad: 'stock',
  minimo: 'min_stock',
  'stock mínimo': 'min_stock',
  'min stock': 'min_stock',
  min_stock: 'min_stock',
  maximo: 'max_stock',
  'stock máximo': 'max_stock',
  'max stock': 'max_stock',
  max_stock: 'max_stock',
  descripcion: 'description',
  description: 'description',
  categoria: 'category_name',
  'categoría': 'category_name',
  category: 'category_name',
  deposito: 'deposito',
  'depósito': 'deposito',
  ubicacion: 'deposito',
  'ubicación': 'deposito',
  pasillo: 'pasillo',
  estanteria: 'estanteria',
  'estantería': 'estanteria',
  estante: 'estanteria',
};

/** Columnas cuyo valor se interpreta como numero. */
const NUMERIC_COLUMNS = ['price', 'cost', 'stock', 'min_stock', 'max_stock'] as const;

export const IMPORT_FILE_ERROR =
  'Error al leer el archivo. Asegurate de que sea un Excel válido (.xlsx o .xls)';
export const IMPORT_EMPTY_FILE_ERROR = 'El archivo está vacío';

/**
 * Convierte el texto de una celda numerica en number.
 *
 * Excel viene con el formato de la maquina que exporto el archivo, asi que
 * conviven "1.234,56" (AR), "1,234.56" (US) y "1234.56" (CSV). La regla es
 * que el separador que aparece mas a la derecha es el decimal; cuando hay
 * uno solo, se mira cuantos digitos quedan despues para decidir si es
 * separador de miles ("1.234" -> 1234) o decimal ("1234,5" -> 1234.5).
 *
 * Devuelve `undefined` cuando la celda esta vacia. No devuelve 0: un precio
 * o un stock en blanco significa "no informado", y convertirlo en 0 pisa el
 * valor que ya tiene el producto.
 */
export function parseSpreadsheetNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'boolean') return undefined;

  const raw = String(value).trim();
  if (raw === '') return undefined;

  // Se saca todo lo que no sea digito o separador: "$ 1.234,56", "50%", "(120)".
  const stripped = raw.replace(/[^0-9.,]/g, '');
  if (stripped === '') return NaN;

  const lastComma = stripped.lastIndexOf(',');
  const lastDot = stripped.lastIndexOf('.');

  let normalized: string;
  if (lastComma > -1 && lastDot > -1) {
    // Ambos presentes: el ultimo en aparecer es el decimal.
    const decimalSep = lastComma > lastDot ? ',' : '.';
    const thousandsSep = decimalSep === ',' ? '.' : ',';
    normalized = stripped.split(thousandsSep).join('').replace(decimalSep, '.');
  } else if (lastComma > -1) {
    // Solo comas: "1,234" es miles, "1234,56" es decimal.
    normalized =
      /,\d{3}$/.test(stripped) && !/,\d{1,2}$/.test(stripped)
        ? stripped.replace(/,/g, '')
        : stripped.replace(',', '.');
  } else if (lastDot > -1) {
    // Solo puntos: "1.234" es miles, "1234.56" es decimal.
    normalized =
      /\.\d{3}$/.test(stripped) && !/\.\d{1,2}$/.test(stripped)
        ? stripped.replace(/\./g, '')
        : stripped;
  } else {
    normalized = stripped;
  }

  return Number(normalized);
}

/**
 * Mapea los encabezados de una fila a las claves que entiende
 * `importProducts`. Los encabezados desconocidos se conservan tal cual: la
 * lista blanca del servicio los ignora, pero asi el preview muestra
 * exactamente lo que vino del archivo.
 */
export function mapImportColumns(row: Record<string, unknown>): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};
  for (const [col, val] of Object.entries(row)) {
    const key = IMPORT_COLUMN_ALIASES[col.toLowerCase().trim()] || col;
    mapped[key] = val;
  }
  return mapped;
}

/**
 * Mapea los encabezados y convierte las columnas numericas.
 *
 * Ademas aplana cualquier valor que no sea primitivo. Una celda con formato de
 * fecha llega como `Date` de SheetJS, y las columnas desconocidas se copian
 * tal cual, asi que sin esto la salida del parseo podia traer objetos anidados
 * hacia la UI y hacia el cuerpo del POST. Aplanar aca deja la garantia de que
 * lo que sale de este modulo son strings, numeros y booleanos.
 */
export function normalizeImportRow(row: Record<string, unknown>): Record<string, unknown> {
  const mapped = mapImportColumns(row);

  for (const [key, value] of Object.entries(mapped)) {
    if (value !== null && typeof value === 'object') {
      mapped[key] = value instanceof Date ? value.toISOString() : String(value);
    }
  }

  for (const col of NUMERIC_COLUMNS) {
    if (mapped[col] === undefined) continue;
    const parsed = parseSpreadsheetNumber(mapped[col]);
    if (parsed === undefined) {
      delete mapped[col];
    } else {
      mapped[col] = parsed;
    }
  }

  return mapped;
}

export type ParsedImportFile = {
  rows: Record<string, unknown>[];
  columns: string[];
};

/**
 * Normaliza las filas que devuelve `sheet_to_json`. No filtra ni deduplica:
 * decidir que filas son importables es tarea del servicio, que puede
 * contrario reportar fila por fila.
 */
export function parseImportRows(raw: Record<string, unknown>[]): ParsedImportFile {
  const columns = raw.length > 0 ? Object.keys(raw[0]) : [];
  return { rows: raw.map(normalizeImportRow), columns };
}

export type ParseWorkbookResult =
  | { ok: true; rows: Record<string, unknown>[]; columns: string[] }
  | { ok: false; error: string };

/** Tope de peso del archivo. Por arriba, `XLSX.read` cuelga la pestana. */
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
/** Tope de filas. El costo del import es lineal en queries: 2000 filas ya son ~10.000. */
export const MAX_IMPORT_ROWS = 5000;

/** Un .xlsx es un zip (firma "PK\x03\x04") y un .xls es un compound file de OLE2. */
const ZIP_SIGNATURE = [0x50, 0x4b];
const OLE2_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0];

/** Extensiones que el import acepta. Allowlist, no denylist. */
const ALLOWED_EXTENSIONS = ['.xlsx', '.xls'] as const;

/**
 * Extensiones que se rechazan con un mensaje propio porque el usuario las
 * va a reconocer y la causa probable no es "me equivoque de archivo".
 *
 * `.xlsm`/`.xlsb` no son un riesgo de ejecucion: la libreria no corre VBA, los
 * macros quedan como bytes dentro de un zip. Se rechazan igual para no dar la
 * sensacion de que "se importo tu planilla con macros" cuando en realidad se
 * leyo el contenido y se tiro el resto.
 */
const REJECTED_EXTENSIONS: Record<string, string> = {
  '.php': 'Los archivos .php no se importan. Guardá tu catálogo como .xlsx o .xls.',
  '.php5': 'Los archivos .php5 no se importan. Guardá tu catálogo como .xlsx o .xls.',
  '.phtml': 'Los archivos .phtml no se importan. Guardá tu catálogo como .xlsx o .xls.',
  '.phar': 'Los archivos .phar no se importan. Guardá tu catálogo como .xlsx o .xls.',
  '.htaccess': 'Los archivos .htaccess no se importan. Guardá tu catálogo como .xlsx o .xls.',
  '.sh': 'Los archivos .sh no se importan. Guardá tu catálogo como .xlsx o .xls.',
  '.js': 'Los archivos .js no se importan. Guardá tu catálogo como .xlsx o .xls.',
  '.html': 'Los archivos .html no se importan. Guardá tu catálogo como .xlsx o .xls.',
  '.svg': 'Los archivos .svg no se importan. Guardá tu catálogo como .xlsx o .xls.',
  '.xlsm': 'Los Excel con macros (.xlsm) no se importan. Guardá tu planilla como .xlsx sin macros.',
  '.xlsb': 'Los Excel binarios (.xlsb) no se importan. Guardá tu planilla como .xlsx.',
  '.csv': 'Los CSV todavía no se importan. Abrí el CSV en Excel y guardalo como .xlsx.',
};

/**
 * Lo unico que el navegador mira antes de dejar elegir el archivo es el
 * atributo `accept`, y ese es solo una sugerencia: se esquivaria con "mostrar
 * todos los archivos" o tirando el archivo sobre la pagina. Por eso el tipo se
 * valida aca y no en el `<input>`.
 *
 * El nombre del archivo tampoco es una garantia de nada (se renombra en un
 * segundo), asi que la decision final la toma `looksLikeSpreadsheet` sobre los
 * bytes. Las dos capas hacen falta: el nombre da un mensaje util, los bytes dan
 * la respuesta.
 */
export function validateSpreadsheetFile(
  file: { name: string; size: number }
): { ok: true } | { ok: false; error: string } {
  const name = (file.name ?? '').trim();
  const dot = name.lastIndexOf('.');
  const ext = dot > -1 ? name.slice(dot).toLowerCase() : '';

  if (file.size === 0) return { ok: false, error: IMPORT_EMPTY_FILE_ERROR };

  if (file.size > MAX_IMPORT_BYTES) {
    return {
      ok: false,
      error: 'El archivo supera los 10MB. Volvé a exportarlo desde Excel sin imágenes para achicarlo.',
    };
  }

  const rejected = REJECTED_EXTENSIONS[ext];
  if (rejected) return { ok: false, error: rejected };

  if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) {
    return { ok: false, error: IMPORT_FILE_ERROR };
  }

  return { ok: true };
}

/**
 * Un .xlsx es un zip (firma "PK\x03\x04") y un .xls es un compound file de OLE2.
 * SheetJS es tan permisivo que un .txt renombrado a .xlsx, o un .php con la
 * extension cambiada, se leen como una planilla sin filas: sin este chequeo el
 * usuario ve "el archivo está vacío" y reintenta para siempre.
 */
export function looksLikeSpreadsheet(buf: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buf, 0, Math.min(8, buf.byteLength));
  const matches = (signature: number[]) => signature.every((b, i) => bytes[i] === b);
  return matches(ZIP_SIGNATURE) || matches(OLE2_SIGNATURE);
}

/**
 * Lee el buffer de un archivo .xlsx/.xls y devuelve las filas ya normalizadas.
 *
 * `xlsx` se importa de forma dinamica para que la libreria (~1MB) no entre en
 * el chunk principal de la pagina de productos: solo se descarga cuando el
 * usuario elige un archivo.
 *
 * Un archivo corrupto y una planilla sin filas son el mismo problema para quien
 * lo carga, asi que los dos caminos devuelven `{ ok: false }` con un mensaje y
 * la UI decide que toast mostrar.
 */
export async function parseWorkbookFile(buf: ArrayBuffer): Promise<ParseWorkbookResult> {
  if (buf.byteLength === 0) {
    return { ok: false, error: IMPORT_EMPTY_FILE_ERROR };
  }
  if (!looksLikeSpreadsheet(buf)) {
    return { ok: false, error: IMPORT_FILE_ERROR };
  }

  let raw: Record<string, unknown>[];
  try {
    const XLSX = await import('xlsx');
    const wb = XLSX.read(buf, { type: 'array' });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) return { ok: false, error: IMPORT_EMPTY_FILE_ERROR };
    const ws = wb.Sheets[sheetName];
    if (!ws) return { ok: false, error: IMPORT_EMPTY_FILE_ERROR };
    raw = XLSX.utils.sheet_to_json(ws, { defval: '' }) as Record<string, unknown>[];
  } catch {
    return { ok: false, error: IMPORT_FILE_ERROR };
  }

  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: IMPORT_EMPTY_FILE_ERROR };
  }

  if (raw.length > MAX_IMPORT_ROWS) {
    return {
      ok: false,
      error: `El archivo tiene ${raw.length} filas y el máximo por importación es ${MAX_IMPORT_ROWS}. Dividilo en varios archivos.`,
    };
  }

  const { rows, columns } = parseImportRows(raw);
  return { ok: true, rows, columns };
}
