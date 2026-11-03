/**
 * Mensajes de error del import de planillas, aislados del parser.
 *
 * La pantalla de productos los necesita para mostrar el error aunque el parser
 * (que arrastra SheetJS) todavía no se haya descargado. Al vivir en un módulo
 * sin dependencias, importarlos no cuesta bundle.
 */

export const IMPORT_FILE_ERROR =
  'Error al leer el archivo. Asegurate de que sea un Excel (.xlsx o .xls) o un CSV válido';
export const IMPORT_EMPTY_FILE_ERROR = 'El archivo está vacío';
