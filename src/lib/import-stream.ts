/**
 * Lectura del NDJSON que streamean las rutas de import de la API
 * (productos, clientes y proveedores).
 *
 * El servidor manda una línea por evento: `progress` mientras escribe cada
 * fila y un `done` final con el reporte. Se corta por '\n' a medida que llegan
 * los chunks (y no al final) justamente para que el contador avance durante el
 * import; un chunk de red puede traer varias líneas o media línea, por eso el
 * sobrante queda en `buffer` hasta el próximo chunk.
 *
 * Vivió adentro de la página de productos hasta que clientes y proveedores
 * necesitaron importar con el mismo protocolo; ahora es un módulo para que las
 * tres páginas lo compartan.
 */

export type ImportProgressState = { processed: number; total: number };

export type ImportStreamResult = {
  results: { row: number; status: string; name?: string; error?: string }[];
  summary: { created: number; updated: number; skipped: number; total: number };
};

export async function readImportStream(
  body: ReadableStream<Uint8Array>,
  onProgress: (progress: ImportProgressState) => void,
): Promise<ImportStreamResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const collected: { result: ImportStreamResult | null } = { result: null };
  let buffer = '';

  const handleLine = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as Record<string, unknown>;
    if (event.type === 'progress') {
      onProgress({ processed: Number(event.processed), total: Number(event.total) });
    } else if (event.type === 'done') {
      collected.result = {
        results: (event.results ?? []) as ImportStreamResult['results'],
        summary: event.summary as ImportStreamResult['summary'],
      };
    } else if (event.type === 'error') {
      throw new Error(String(event.error || 'Error al importar'));
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      handleLine(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
    }
  }
  if (buffer.trim()) handleLine(buffer);

  if (!collected.result) throw new Error('La importacion no devolvio resultados');
  return collected.result;
}
