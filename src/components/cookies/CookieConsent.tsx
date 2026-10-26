'use client';

import { useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { getCookieConsent, saveCookieConsent, subscribeToConsent } from '@/lib/cookie-consent';

export { getCookieConsent, resetCookieConsent } from '@/lib/cookie-consent';

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
    subscribeToConsent,
    consentCookieSnapshot,
    consentCookieServerSnapshot
  );
  const [saved, setSaved] = useState(false);
  const [showCustomize, setShowCustomize] = useState(false);
  const [functional, setFunctional] = useState(true);
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);

  const saveConsent = (prefs: { functional?: boolean; analytics?: boolean; marketing?: boolean }) => {
    saveCookieConsent({
      functional: prefs.functional ?? functional,
      analytics: prefs.analytics ?? analytics,
      marketing: prefs.marketing ?? marketing,
    });
    setSaved(true);
    setShowCustomize(false);
  };

  const visible = !consentExists && !saved;

  if (!visible) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-[100] p-3">
      <div className="mx-auto max-w-2xl rounded-xl border border-gray-800 bg-gray-950/95 backdrop-blur-xl shadow-2xl">
        {!showCustomize ? (
          <div className="flex flex-col gap-3 p-3.5 md:flex-row md:items-center md:justify-between">
            <p className="text-xs text-gray-400 leading-relaxed">
              Usamos cookies esenciales para tu sesión y, con tu permiso, funcionales y analíticas.{' '}
              <Link href="/cookies" className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2">
                Más info
              </Link>
            </p>
            <div className="flex flex-shrink-0 items-center gap-2">
              <button
                onClick={() => setShowCustomize(true)}
                className="rounded-md border border-gray-700 px-2.5 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-900 transition-colors"
              >
                Personalizar
              </button>
              <button
                onClick={() => saveConsent({ functional: false, analytics: false, marketing: false })}
                className="rounded-md border border-gray-700 px-2.5 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-900 transition-colors"
              >
                Rechazar
              </button>
              <button
                onClick={() => saveConsent({ functional: true, analytics: true, marketing: true })}
                className="rounded-md bg-cyan-500 px-2.5 py-1.5 text-xs font-semibold text-gray-950 hover:bg-cyan-400 transition-colors"
              >
                Aceptar todas
              </button>
            </div>
          </div>
        ) : (
          <div className="p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">Preferencias de cookies</h2>
              <button onClick={() => setShowCustomize(false)} className="text-xs text-gray-400 hover:text-white">
                Volver
              </button>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-800 px-3 py-2">
                <div>
                  <p className="text-xs font-medium text-white">Esenciales (obligatorias)</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">Autenticación, sesión y seguridad.</p>
                </div>
                <span className="text-[11px] text-gray-500 flex-shrink-0">Siempre activas</span>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-800 px-3 py-2">
                <div>
                  <p className="text-xs font-medium text-white">Funcionales</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">Recuerdan preferencias (idioma/país).</p>
                </div>
                <label className="inline-flex items-center cursor-pointer flex-shrink-0">
                  <input type="checkbox" checked={functional} onChange={(e) => setFunctional(e.target.checked)} className="sr-only peer" />
                  <div className="w-8 h-[18px] bg-gray-700 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3.5 after:w-3.5 after:transition-all peer-checked:bg-cyan-500 relative"></div>
                </label>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-800 px-3 py-2">
                <div>
                  <p className="text-xs font-medium text-white">Analíticas</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">Medición de uso propia y de Vercel Analytics. Si la desactivás, no se cargan.</p>
                </div>
                <label className="inline-flex items-center cursor-pointer flex-shrink-0">
                  <input type="checkbox" checked={analytics} onChange={(e) => setAnalytics(e.target.checked)} className="sr-only peer" />
                  <div className="w-8 h-[18px] bg-gray-700 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3.5 after:w-3.5 after:transition-all peer-checked:bg-cyan-500 relative"></div>
                </label>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-800 px-3 py-2">
                <div>
                  <p className="text-xs font-medium text-white">Marketing</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">Personalización/publicidad. Actualmente no activas.</p>
                </div>
                <label className="inline-flex items-center cursor-pointer flex-shrink-0">
                  <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} className="sr-only peer" />
                  <div className="w-8 h-[18px] bg-gray-700 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3.5 after:w-3.5 after:transition-all peer-checked:bg-cyan-500 relative"></div>
                </label>
              </div>
            </div>
            <div className="flex justify-end">
              <button onClick={() => saveConsent({})} className="rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-gray-950 hover:bg-gray-100 transition-colors">
                Guardar preferencias
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
