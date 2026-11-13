import { describe, expect, it } from 'vitest';
import { rateLimitRejection } from './rate-limit-response';

describe('rateLimitRejection', () => {
  it('devuelve 429 con el retry-after de la ventana cuando se excedió el límite', async () => {
    const response = rateLimitRejection({ ok: false, retryAfterSeconds: 42 });

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('42');
    await expect(response.json()).resolves.toEqual({
      error: 'Demasiados intentos. Probá de nuevo más tarde.',
    });
  });

  it('devuelve 503 cuando el store no respondió', async () => {
    const response = rateLimitRejection(
      { ok: false, retryAfterSeconds: 30, storeUnavailable: true },
      'Mensaje propio del endpoint'
    );

    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toBe('30');
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('temporalmente no disponible');
    // El mensaje del endpoint aplica al 429, no al 503: no se filtra el motivo
    // interno de la caída del store.
    expect(body.error).not.toContain('Mensaje propio');
  });
});
