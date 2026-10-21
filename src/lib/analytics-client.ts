import { authFetch } from '@/lib/fetchWithTenant';
import { getCookieConsent } from '@/lib/cookie-consent';

/**
 * Eventos que se originan en el navegador. Va por `authFetch` y no por
 * `fetch` a secas para que salga el header de tenant activo: el endpoint usa
 * `getAuth`, que sin ese header cae en el primer tenant de la lista.
 *
 * Fire-and-forget a proposito: el usuario esta abriendo WhatsApp o
 * navigating, y esperar un round-trip para decidir si se registro el evento
 * lo trabaria. Un fallo de analytics no puede romper la venta ni la
 * navegacion, asi que el error se traga y el control sigue en la UI.
 *
 * Gateado por consentimiento: si la persona rechazo las cookies analiticas
 * (o todavia no eligio), el evento no sale. Antes se mandaba siempre, con lo
 * que el banner de cookies prometia algo que el codigo no cumplia.
 */
export function trackClientEvent(
  type: 'whatsapp_ticket' | 'app_return' | 'forecast_opened',
  metadata?: Record<string, unknown>
): void {
  if (typeof window === 'undefined') return;

  if (!getCookieConsent()?.analytics) return;

  void authFetch('/api/analytics/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, metadata }),
  }).catch(() => {});
}
