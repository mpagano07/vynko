// Estado y persistencia del consentimiento de cookies. Vive fuera del
// componente para que el codigo que hace tracking real (`analytics-client`)
// pueda consultarlo sin importar un componente de UI, y para no duplicar la
// logica de lectura/escritura de la cookie entre consumidores.

export const CONSENT_COOKIE = 'vynko_cookie_consent';
export const CONSENT_VERSION = '1.0';

export type ConsentState = {
  version: string;
  necessary: true;
  functional: boolean;
  analytics: boolean;
  marketing: boolean;
  updatedAt: string;
};

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop()?.split(';').shift() || null;
  return null;
}

function setCookie(name: string, value: string, days = 365) {
  if (typeof document === 'undefined') return;
  const date = new Date();
  date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000);
  document.cookie = `${name}=${value}; expires=${date.toUTCString()}; path=/; SameSite=Lax`;
}

export function getCookieConsent(): ConsentState | null {
  const raw = getCookie(CONSENT_COOKIE);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(raw));
    if (parsed?.version === CONSENT_VERSION) return parsed as ConsentState;
  } catch {}
  return null;
}

export function saveCookieConsent(prefs: {
  functional: boolean;
  analytics: boolean;
  marketing: boolean;
}): ConsentState {
  const state: ConsentState = {
    version: CONSENT_VERSION,
    necessary: true,
    functional: prefs.functional,
    analytics: prefs.analytics,
    marketing: prefs.marketing,
    updatedAt: new Date().toISOString(),
  };
  setCookie(CONSENT_COOKIE, encodeURIComponent(JSON.stringify(state)));
  return state;
}

export function resetCookieConsent() {
  if (typeof document === 'undefined') return;
  document.cookie = `${CONSENT_COOKIE}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
  window.location.reload();
}
