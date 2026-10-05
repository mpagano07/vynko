/**
 * Validacion de forma del payload del webhook de MercadoPago.
 *
 * No hay `zod` en el proyecto, asi que la validacion es manual y explicita.
 *
 * Que NO hace: verificar la firma. La firma se valida aparte, sobre el cuerpo
 * crudo, porque necesita el texto exacto que MercadoPago firmo. Esta funcion
 * solo se ocupa de que el JSON tenga la forma que el servicio da por hecha.
 *
 * Que protege: el servicio leia `body.data.id` y `body.type` a traves de un
 * cast a `Record<string, unknown>`. Con un `data` que es un array, un `type` que
 * es un objeto o un `id` numerico, el error no aparece en el route sino mas
 * adentro, cuando ya se llamo a la API de MercadoPago o se fue a escribir a la
 * base. Aca el rechazo es temprano y el mensaje dice que esta mal.
 */

export type WebhookPayload = {
  id: string;
  topic: string;
};

export type ParseResult =
  | { ok: true; data: WebhookPayload }
  | { ok: false; reason: string };

/**
 * Id de preapproval de MercadoPago.
 *
 * Se exige un string no vacio y sin caracteres de control: un id con un salto de
 * linea o un NUL no puede ser un preapproval real, y dejarla pasar solo mueve
 * el problema a la consulta contra la API.
 */
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export function isValidId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && ID_PATTERN.test(value);
}

export function parseWebhookPayload(body: unknown): ParseResult {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, reason: 'Payload must be a JSON object' };
  }

  const record = body as Record<string, unknown>;

  const rawTopic = record.type;
  if (rawTopic === undefined || rawTopic === null) {
    return { ok: false, reason: 'Missing `type`' };
  }
  if (typeof rawTopic !== 'string') {
    return { ok: false, reason: '`type` must be a string' };
  }

  const rawData = record.data;
  if (rawData !== undefined && rawData !== null && typeof rawData !== 'object') {
    return { ok: false, reason: '`data` must be an object when present' };
  }
  if (Array.isArray(rawData)) {
    return { ok: false, reason: '`data` must be an object when present' };
  }

  // MercadoPago manda el id en `data.id`. Algunas cargas lo traen en la raiz;
  // se acepta por compatibilidad con lo que ya estaba en produccion.
  const idCandidates: unknown[] = [];
  if (rawData && typeof rawData === 'object' && !Array.isArray(rawData)) {
    idCandidates.push((rawData as Record<string, unknown>).id);
  }
  idCandidates.push(record.id);

  const id = idCandidates.find(isValidId);
  if (id === undefined) {
    return { ok: false, reason: '`data.id` must be a non-empty string' };
  }

  return { ok: true, data: { id, topic: rawTopic } };
}