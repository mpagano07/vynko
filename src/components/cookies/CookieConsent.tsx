'use client';

import { useState, useSyncExternalStore } from 'react';
import Link from 'next/link';

const CONSENT_COOKIE = 'vynko_cookie_consent';
const CONSENT_VERSION = '1.0';

type ConsentState = {
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

export function resetCookieConsent() {
  if (typeof document === 'undefined') return;
  document.cookie = `${CONSENT_COOKIE}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
  window.location.reload();
}

// `document.cookie` no dispara eventos de cambio, y el unico escritor de la
// cookie de consentimiento es `saveConsent()` en este mismo componente, que ya
// re-renderiza. La suscripcion es un no-op que igual cumple el contrato de
// useSyncExternalStore (React re-checkea el snapshot en cada render).
function subscribeToConsentCookie() {
  return () => {};
}

function consentCookieSnapshot() {
  return getCookieConsent() !== null;
}

// En SSR no hay `document`, asi que el server snapshot asume consentimiento
// para que el HTML inicial no incluya el banner. Tras la hidratacion React
// re-checkea el snapshot real en el cliente y re-renderiza si falta la cookie.
function consentCookieServerSnapshot() {
  return true;
}

export default function CookieConsent() {
  const consentExists = useSyncExternalStore(
    subscribeToConsentCookie,
    consentCookieSnapshot,
    consentCookieServerSnapshot
  );
  const [saved, setSaved] = useState(false);
  const [showCustomize, setShowCustomize] = useState(false);
  const [functional, setFunctional] = useState(true);
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);

  const saveConsent = (prefs: Partial<ConsentState>) => {
    const state: ConsentState = {
      version: CONSENT_VERSION,
      necessary: true,
      functional: prefs.functional ?? functional,
      analytics: prefs.analytics ?? analytics,
      marketing: prefs.marketing ?? marketing,
      updatedAt: new Date().toISOString(),
    };
    setCookie(CONSENT_COOKIE, encodeURIComponent(JSON.stringify(state)));
    setSaved(true);
    setShowCustomize(false);
  };

  const visible = !consentExists && !saved;

  if (!visible) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-[100] p-4">
      <div className="mx-auto max-w-5xl rounded-2xl border border-gray-800 bg-gray-950/95 backdrop-blur-xl shadow-2xl">
        {!showCustomize ? (
          <div className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between">
            <div className="space-y-2">
              <h2 className="text-base font-semibold text-white">Usamos cookies</h2>
              <p className="text-sm text-gray-400 leading-relaxed">
                Utilizamos cookies esenciales para mantener tu sesión y el funcionamiento de la plataforma. También podemos usar cookies funcionales para recordar preferencias.{' '}
                <Link href="/cookies" className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2">
                  Política de Cookies
                </Link>{' '}
                ·{' '}
                <Link href="/privacidad" className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2">
                  Política de Privacidad
                </Link>
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                onClick={() => setShowCustomize(true)}
                className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-medium text-gray-300 hover:bg-gray-900 transition-colors"
              >
                Personalizar
              </button>
              <button
                onClick={() => saveConsent({ functional: false, analytics: false, marketing: false })}
                className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-medium text-gray-300 hover:bg-gray-900 transition-colors"
              >
                Rechazar opcionales
              </button>
              <button
                onClick={() => saveConsent({ functional: true, analytics: false, marketing: false })}
                className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-gray-950 hover:bg-cyan-400 transition-colors"
              >
                Aceptar esenciales
              </button>
              <button
                onClick={() => saveConsent({ functional: true, analytics: false, marketing: false })}
                className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-gray-950 hover:bg-gray-100 transition-colors"
              >
                Aceptar todas
              </button>
            </div>
          </div>
        ) : (
          <div className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-white">Preferencias de cookies</h2>
              <button onClick={() => setShowCustomize(false)} className="text-sm text-gray-400 hover:text-white">
                Volver
              </button>
            </div>
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-4 rounded-xl border border-gray-800 p-4">
                <div>
                  <p className="text-sm font-medium text-white">Esenciales (obligatorias)</p>
                  <p className="text-xs text-gray-400 mt-1">Necesarias para autenticación, sesión, seguridad y navegación básica.</p>
                </div>
                <span className="text-xs text-gray-500">Siempre activas</span>
              </div>
              <div className="flex items-start justify-between gap-4 rounded-xl border border-gray-800 p-4">
                <div>
                  <p className="text-sm font-medium text-white">Funcionales</p>
                  <p className="text-xs text-gray-400 mt-1">Recuerdan preferencias (idioma/país) para mejorar la experiencia.</p>
                </div>
                <label className="inline-flex items-center cursor-pointer">
                  <input type="checkbox" checked={functional} onChange={(e) => setFunctional(e.target.checked)} className="sr-only peer" />
                  <div className="w-9 h-5 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-cyan-500 relative"></div>
                </label>
              </div>
              <div className="flex items-start justify-between gap-4 rounded-xl border border-gray-800 p-4">
                <div>
                  <p className="text-sm font-medium text-white">Analíticas</p>
                  <p className="text-xs text-gray-400 mt-1">Medición anónima para mejorar el producto. Actualmente no activas.</p>
                </div>
                <label className="inline-flex items-center cursor-pointer">
                  <input type="checkbox" checked={analytics} onChange={(e) => setAnalytics(e.target.checked)} className="sr-only peer" />
                  <div className="w-9 h-5 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-cyan-500 relative"></div>
                </label>
              </div>
              <div className="flex items-start justify-between gap-4 rounded-xl border border-gray-800 p-4">
                <div>
                  <p className="text-sm font-medium text-white">Marketing</p>
                  <p className="text-xs text-gray-400 mt-1">Personalización/publicidad. Actualmente no activas.</p>
                </div>
                <label className="inline-flex items-center cursor-pointer">
                  <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} className="sr-only peer" />
                  <div className="w-9 h-5 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-cyan-500 relative"></div>
                </label>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row justify-end gap-2">
              <button onClick={() => saveConsent({})} className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-gray-950 hover:bg-gray-100 transition-colors">
                Guardar preferencias
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
