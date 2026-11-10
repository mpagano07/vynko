/**
 * Lectura y normalizacion de la planilla que alimenta las importaciones.
 *
 * Vive fuera del componente de productos por dos razones: la pagina es un
 * archivo de 1800 lineas y la logica de columnas no se podia testear, y
 * sobre todo porque el parseo es la unica frontera donde un archivo de
 * terceros puede meter basura en la base. Todo lo que llega de aca vuelve a
 * ser validado por el servicio de import correspondiente, pero un default
 * destructivo en esta capa (un precio vacio convertido a 0) llega intacto
 * hasta el write.
 *
 * Los alias de columnas son por dominio: `parseWorkbookFile` lee planillas de
 * productos y `parsePartyWorkbookFile` las de clientes/proveedores. El resto
 * (firmas de archivo, CSV, limites) es compartido.
 */

// Solo tipos: se borran al compilar, no arrastran la libreria al bundle.
import type { WorkBook, WorkSheet } from 'xlsx';
import {
  IMPORT_EMPTY_FILE_ERROR,
  IMPORT_FILE_ERROR,
} from '@/lib/excel-import-errors';

/**
 * Alias de encabezados aceptados. Cada clave se pliega con `foldImportHeader`
 * (minusculas, sin acentos) antes de indexarse, asi que la variante acentuada y
 * la pelada conviven sin problema y quedan igualadas.
 */
const IMPORT_COLUMN_ALIASES: Record<string, string> = {
  nombre: 'name',
  producto: 'name',
  name: 'name',
  titulo: 'name',
  title: 'name',
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
  categorias: 'category_name',
  categories: 'category_name',
  imagen: 'image_url',
  imagenes: 'image_url',
  images: 'image_url',
  image: 'image_url',
  foto: 'image_url',
  fotos: 'image_url',
  image_url: 'image_url',
  deposito: 'deposito',
  'depósito': 'deposito',
  ubicacion: 'deposito',
  'ubicación': 'deposito',
  pasillo: 'pasillo',
  estanteria: 'estanteria',
  'estantería': 'estanteria',
  estante: 'estanteria',
};

/**
 * Normaliza un encabezado para poder compararlo contra los alias: minusculas,
 * sin espacios al borde, sin acentos y con los espacios internos colapsados a
 * uno. Los exportadores de terceros escriben el mismo campo con y sin tilde
 * ("Categoría"/"Categorias", "Descripción"/"Descripcion"), asi que comparar en
 * crudo dejaba afuera columnas que el usuario si completo.
 */
export function foldImportHeader(header: string): string {
  return header
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * Indice de alias con las claves ya plegadas. Se arma una sola vez al cargar el
 * modulo: plegar en cada celda seria recorrer el diccionario por fila.
 */
const IMPORT_COLUMN_ALIASES_FOLDED: Record<string, string> = Object.fromEntries(
  Object.entries(IMPORT_COLUMN_ALIASES).map(([key, target]) => [foldImportHeader(key), target])
);

/**
 * Alias de encabezados para la importación de terceros (clientes y
 * proveedores). Las claves se plegan igual que las de productos: escribir
 * "Teléfono" o "Telefono" da lo mismo. Comparten mapa los dos tipos porque la
 * lista blanca de cada servicio se encarga de ignorar lo que no le corresponde
 * (un archivo de clientes con columna "Contacto" no rompe nada).
 *
 * "CUIT" y "Número de documento" viajan como texto: el servicio los normaliza
 * con `normalizePartyTaxFields`, que ya sabe quedarse sólo con los dígitos.
 */
const PARTY_IMPORT_COLUMN_ALIASES: Record<string, string> = {
  nombre: 'name',
  name: 'name',
  'razon social': 'name',
  cliente: 'name',
  proveedor: 'name',
  contacto: 'contact_name',
  'contacto nombre': 'contact_name',
  'persona de contacto': 'contact_name',
  contact_name: 'contact_name',
  email: 'email',
  mail: 'email',
  correo: 'email',
  'correo electronico': 'email',
  telefono: 'phone',
  celular: 'phone',
  phone: 'phone',
  direccion: 'address',
  domicilio: 'address',
  address: 'address',
  notas: 'notes',
  observaciones: 'notes',
  notes: 'notes',
  cuit: 'cuit',
  'condicion iva': 'iva_condition',
  'condicion frente al iva': 'iva_condition',
  iva: 'iva_condition',
  'tipo de documento': 'document_type',
  'numero de documento': 'document_number',
  'nro documento': 'document_number',
  dni: 'document_number',
  document_number: 'document_number',
};

/** Columnas cuyo valor se interpreta como numero. */
const NUMERIC_COLUMNS = ['price', 'cost', 'stock', 'min_stock', 'max_stock'] as const;

/**
 * Configuración del parseo por dominio. Los alias pliegan distinto (productos
 * vs terceros), las columnas numéricas sólo existen en productos y el mínimo de
 * columnas reconocidas para dar por buena una fila de encabezado baja a 1 en
 * terceros: una planilla con la sola columna "Nombre" ya es un import válido de
 * clientes.
 */
type ParserConfig = {
  aliasesFolded: Record<string, string>;
  numericColumns: readonly string[];
  minRecognizedColumns: number;
};

const PRODUCTS_PARSER: ParserConfig = {
  aliasesFolded: IMPORT_COLUMN_ALIASES_FOLDED,
  numericColumns: NUMERIC_COLUMNS,
  minRecognizedColumns: 2,
};

const PARTY_PARSER: ParserConfig = {
  aliasesFolded: Object.fromEntries(
    Object.entries(PARTY_IMPORT_COLUMN_ALIASES).map(([key, target]) => [foldImportHeader(key), target])
  ),
  numericColumns: [],
  minRecognizedColumns: 1,
};

export { IMPORT_FILE_ERROR, IMPORT_EMPTY_FILE_ERROR } from '@/lib/excel-import-errors';

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
 * Mapea los encabezados de una fila a las claves que entiende el servicio de
 * import de productos. Los encabezados desconocidos se conservan tal cual: la
 * lista blanca del servicio los ignora, pero asi el preview muestra
 * exactamente lo que vino del archivo.
 */
export function mapImportColumns(row: Record<string, unknown>): Record<string, unknown> {
  return mapImportColumnsWith(row, PRODUCTS_PARSER);
}

/** Mapeo de encabezados parametrizado por dominio (ver `ParserConfig`). */
function mapImportColumnsWith(row: Record<string, unknown>, config: ParserConfig): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};
  for (const [col, val] of Object.entries(row)) {
    const key = config.aliasesFolded[foldImportHeader(col)] || col;
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
  return normalizeImportRowWith(row, PRODUCTS_PARSER);
}

function normalizeImportRowWith(row: Record<string, unknown>, config: ParserConfig): Record<string, unknown> {
  const mapped = mapImportColumnsWith(row, config);

  for (const [key, value] of Object.entries(mapped)) {
    if (value !== null && typeof value === 'object') {
      mapped[key] = value instanceof Date ? value.toISOString() : String(value);
    }
  }

  for (const col of config.numericColumns) {
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
  return parseRowsWith(raw, PRODUCTS_PARSER);
}

function parseRowsWith(raw: Record<string, unknown>[], config: ParserConfig): ParsedImportFile {
  const columns = raw.length > 0 ? Object.keys(raw[0]) : [];
  return { rows: raw.map((row) => normalizeImportRowWith(row, config)), columns };
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
const ALLOWED_EXTENSIONS = ['.xlsx', '.xls', '.csv'] as const;

/** Sufijo aceptado para el consejo de guardado, reusado en los mensajes. */
const SAVE_AS = '.xlsx, .xls o .csv';

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
  '.php': `Los archivos .php no se importan. Guardá tu catálogo como ${SAVE_AS}.`,
  '.php5': `Los archivos .php5 no se importan. Guardá tu catálogo como ${SAVE_AS}.`,
  '.phtml': `Los archivos .phtml no se importan. Guardá tu catálogo como ${SAVE_AS}.`,
  '.phar': `Los archivos .phar no se importan. Guardá tu catálogo como ${SAVE_AS}.`,
  '.htaccess': `Los archivos .htaccess no se importan. Guardá tu catálogo como ${SAVE_AS}.`,
  '.sh': `Los archivos .sh no se importan. Guardá tu catálogo como ${SAVE_AS}.`,
  '.js': `Los archivos .js no se importan. Guardá tu catálogo como ${SAVE_AS}.`,
  '.html': `Los archivos .html no se importan. Guardá tu catálogo como ${SAVE_AS}.`,
  '.svg': `Los archivos .svg no se importan. Guardá tu catálogo como ${SAVE_AS}.`,
  '.xlsm': 'Los Excel con macros (.xlsm) no se importan. Guardá tu planilla como .xlsx sin macros.',
  '.xlsb': 'Los Excel binarios (.xlsb) no se importan. Guardá tu planilla como .xlsx.',
};

/** Extension de un nombre de archivo, en minusculas y con el punto incluido. */
function fileExtension(name: string): string {
  const trimmed = (name ?? '').trim();
  const dot = trimmed.lastIndexOf('.');
  return dot > -1 ? trimmed.slice(dot).toLowerCase() : '';
}

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
  const ext = fileExtension(file.name ?? '');

  if (file.size === 0) return { ok: false, error: IMPORT_EMPTY_FILE_ERROR };

  if (file.size > MAX_IMPORT_BYTES) {
    return {
      ok: false,
      error: 'El archivo supera los 10MB. Volvé a exportarlo sin imágenes para achicarlo.',
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
function looksLikeSpreadsheet(buf: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buf, 0, Math.min(8, buf.byteLength));
  const matches = (signature: number[]) => signature.every((b, i) => bytes[i] === b);
  return matches(ZIP_SIGNATURE) || matches(OLE2_SIGNATURE);
}

/**
 * Decodifica un CSV a texto, o devuelve `null` si el contenido no parece texto
 * delimitado (por ejemplo, un binario renombrado a `.csv`). Sin este chequeo,
 * SheetJS leería bytes basura como una fila unica y el usuario veria "el
 * archivo está vacío" en vez de "no es un CSV".
 */
function decodeCsvText(buf: ArrayBuffer): string | null {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  const sample = text.slice(0, 8192);
  if (sample.trim() === '') return null;
  // Un binario distinto de xlsx (un png, un pdf) trae NUL y decodifica lleno de
  // U+FFFD; un CSV de texto no tiene ninguno de los dos.
  if (sample.includes('\u0000')) return null;
  const replacement = (sample.match(/\uFFFD/g) ?? []).length;
  if (replacement > sample.length * 0.1) return null;
  // Un CSV real trae separador o, al menos, mas de una linea.
  const firstLine = sample.split(/\r?\n/, 1)[0] ?? '';
  if (!/[,;\t]/.test(firstLine) && !/\r?\n/.test(sample)) return null;
  return text;
}

/**
 * Fila de encabezado dentro de un bloque de celdas.
 *
 * Los exportadores no siempre arrancan en la fila 1: la plantilla multi-pestana
 * de Mercado Libre trae filas de titulo y ayuda arriba de los nombres de
 * columna. Se toma como encabezado la primera fila con una columna de nombre
 * reconocida y al menos otra de la lista blanca, para no confundir una fila de
 * ayuda suelta con los encabezados. Devuelve -1 cuando no encuentra ninguna.
 */
function findImportHeaderRow(matrix: unknown[][], config: ParserConfig): number {
  for (let r = 0; r < matrix.length; r++) {
    const row = matrix[r];
    if (!Array.isArray(row)) continue;
    let hasName = false;
    let recognized = 0;
    for (const cell of row) {
      if (typeof cell !== 'string') continue;
      const target = config.aliasesFolded[foldImportHeader(cell)];
      if (!target) continue;
      recognized++;
      if (target === 'name') hasName = true;
    }
    if (hasName && recognized >= config.minRecognizedColumns) return r;
  }
  return -1;
}

/** Filas de una hoja, ya detectada la fila de encabezado. */
function extractSheetRows(
  XLSX: typeof import('xlsx'),
  ws: WorkSheet,
  config: ParserConfig
): { rows: Record<string, unknown>[]; detectedHeader: boolean } {
  const matrix = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: '',
    blankrows: false,
  }) as unknown[][];
  const headerRow = findImportHeaderRow(matrix, config);
  const rows = XLSX.utils.sheet_to_json(ws, {
    range: headerRow >= 0 ? headerRow : 0,
    defval: '',
  }) as Record<string, unknown>[];
  return { rows, detectedHeader: headerRow >= 0 };
}

/**
 * Junta las filas de todas las hojas con encabezado reconocible.
 *
 * La plantilla multi-pestana de Mercado Libre tiene una hoja por categoria; se
 * concatenan todas para no perder productos. La hoja de "Ayuda" no tiene una
 * fila de encabezado valida, asi que queda afuera sola. Cuando ninguna hoja
 * tiene encabezado reconocible se conserva el comportamiento historico de leer
 * la primera hoja con la fila 1 como encabezado.
 */
function extractWorkbookRows(
  XLSX: typeof import('xlsx'),
  wb: WorkBook,
  config: ParserConfig
): Record<string, unknown>[] {
  const sheets = wb.SheetNames.map((name) => wb.Sheets[name]).filter(
    (ws): ws is WorkSheet => Boolean(ws)
  );

  const detected: Record<string, unknown>[] = [];
  let firstNonEmpty: Record<string, unknown>[] | null = null;
  for (const ws of sheets) {
    const { rows, detectedHeader } = extractSheetRows(XLSX, ws, config);
    if (rows.length > 0 && firstNonEmpty === null) firstNonEmpty = rows;
    if (detectedHeader && rows.length > 0) detected.push(...rows);
  }

  return detected.length > 0 ? detected : firstNonEmpty ?? [];
}

/**
 * Lee el buffer de un archivo .xlsx/.xls/.csv y devuelve las filas ya
 * normalizadas para el import de productos.
 *
 * El formato se decide por contenido: una firma de zip/OLE2 es un Excel; si no
 * y la extension declarada es `.csv`, se decodifica como texto delimitado. Una
 * imagen o un binario renombrado a `.csv` no pasa el chequeo de texto y cae en
 * `{ ok: false }`.
 *
 * `xlsx` se importa de forma dinamica para que la libreria (~1MB) no entre en
 * el chunk principal de la pagina de productos: solo se descarga cuando el
 * usuario elige un archivo.
 *
 * Un archivo corrupto y una planilla sin filas son el mismo problema para quien
 * lo carga, asi que los dos caminos devuelven `{ ok: false }` con un mensaje y
 * la UI decide que toast mostrar.
 */
export async function parseWorkbookFile(
  buf: ArrayBuffer,
  options: { fileName?: string } = {}
): Promise<ParseWorkbookResult> {
  return parseWorkbookFor(buf, options, PRODUCTS_PARSER);
}

/**
 * La misma lectura de planilla para la importación de clientes y proveedores:
 * mismos formatos, mismos límites de peso y filas, otros alias de columnas
 * (ver `PARTY_IMPORT_COLUMN_ALIASES`).
 */
export async function parsePartyWorkbookFile(
  buf: ArrayBuffer,
  options: { fileName?: string } = {}
): Promise<ParseWorkbookResult> {
  return parseWorkbookFor(buf, options, PARTY_PARSER);
}

async function parseWorkbookFor(
  buf: ArrayBuffer,
  options: { fileName?: string },
  config: ParserConfig
): Promise<ParseWorkbookResult> {
  if (buf.byteLength === 0) {
    return { ok: false, error: IMPORT_EMPTY_FILE_ERROR };
  }

  const binary = looksLikeSpreadsheet(buf);
  if (!binary && fileExtension(options.fileName ?? '') !== '.csv') {
    return { ok: false, error: IMPORT_FILE_ERROR };
  }

  let raw: Record<string, unknown>[];
  try {
    const XLSX = await import('xlsx');
    let wb: WorkBook;
    if (binary) {
      wb = XLSX.read(buf, { type: 'array' });
    } else {
      const text = decodeCsvText(buf);
      if (text === null) return { ok: false, error: IMPORT_FILE_ERROR };
      wb = XLSX.read(text, { type: 'string' });
    }
    raw = extractWorkbookRows(XLSX, wb, config);
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

  const { rows, columns } = parseRowsWith(raw, config);
  return { ok: true, rows, columns };
}
