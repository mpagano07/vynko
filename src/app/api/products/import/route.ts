import { getAuth } from '@/lib/api-auth';
import { prepareImport } from '@/lib/product-service';
import { logger } from '@/lib/logger';

/**
 * Import de productos con progreso por streaming.
 *
 * El import puede tardar minutos (miles de filas, varias queries por fila), y
 * el cliente necesita un contador "X de N" mientras corre. La respuesta no
 * puede ser un JSON que llega al final porque justamente ahí no hay progreso
 * que mostrar, así que se devuelve NDJSON: una línea por evento.
 *
 *   {"type":"progress","processed":50,"total":2000,"created":48,"updated":2,"skipped":0}
 *   {"type":"done","results":[...],"summary":{...}}
 *   {"type":"error","error":"..."}
 *
 * Las guardas se resuelven ANTES de abrir el stream (`prepareImport`), para
 * que un 401/403/413/429 siga siendo un JSON con su status y no un stream con
 * un error adentro. Una vez que el stream arranca el status ya es 200 y la
 * única forma de avisar de un fallo es el evento `error`.
 */
export async function POST(request: Request) {
  const auth = await getAuth(request);
  if (!auth) return Response.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await request.json();
  const prepared = await prepareImport(auth, body?.products as Record<string, unknown>[] | undefined);
  if (!prepared.ok) {
    return Response.json({ error: prepared.error }, { status: prepared.status });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      try {
        const result = await prepared.execute((progress) => send({ type: 'progress', ...progress }));
        send({ type: 'done', ...result });
      } catch (error) {
        logger.error('importProducts: el stream fallo', { error });
        send({ type: 'error', error: 'Ocurrio un error inesperado. Intenta de nuevo.' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      // nginx y compañía bufferean la respuesta por defecto, y con buffering
      // el progreso llegaría todo junto al final: exactamente lo que se quiere
      // evitar.
      'X-Accel-Buffering': 'no',
    },
  });
}
