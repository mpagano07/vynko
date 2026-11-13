import { NextResponse } from 'next/server';
import type { RateLimitOptions, RateLimitResult } from '@/lib/rate-limit';

/**
 * Politica para endpoints de credenciales.
 *
 * Login, alta, recuperacion y cambio de contrasena usan este objeto: si el
 * contador distribuido no responde, se corta con 503 en vez de dejar pasar
 * intentos sin limite. Ver `RateLimitOptions.onStoreError`.
 */
export const STRICT_RATE_LIMIT: RateLimitOptions = { onStoreError: 'deny' };

/**
 * Traduce un resultado bloqueado a la respuesta HTTP que corresponde.
 *
 * Distingue dos casos que antes se veian iguales:
 *
 * - `storeUnavailable`: no se pudo verificar el limite -> 503. El reintento es
 *   corto (30 s) porque el problema suele ser transitorio o una migracion que se
 *   aplica enseguida.
 * - limite excedido -> 429 con el retry-after real de la ventana.
 *
 * Todos los endpoints de auth responden el mismo cuerpo para no revelar detalles
 * internos del store.
 */
export function rateLimitRejection(
  result: RateLimitResult,
  message = 'Demasiados intentos. Probá de nuevo más tarde.'
): NextResponse {
  if (result.storeUnavailable) {
    return NextResponse.json(
      { error: 'Servicio temporalmente no disponible. Probá de nuevo en unos minutos.' },
      { status: 503, headers: { 'Retry-After': String(result.retryAfterSeconds) } }
    );
  }

  return NextResponse.json(
    { error: message },
    { status: 429, headers: { 'Retry-After': String(result.retryAfterSeconds) } }
  );
}
