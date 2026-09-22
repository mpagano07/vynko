'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

const COOKIE_CONSENT_KEY = 'vynko_cookie_consent';

export function CookieBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    try {
      const stored = localStorage.getItem(COOKIE_CONSENT_KEY);
      if (!stored) window.setTimeout(() => { if (!cancelled) setVisible(true); }, 0);
    } catch {
      // localStorage not available
    }
    return () => { cancelled = true; };
  }, []);

  const saveConsent = (accepted: boolean) => {
    try {
      localStorage.setItem(COOKIE_CONSENT_KEY, JSON.stringify({ accepted, date: new Date().toISOString() }));
    } catch {
      // ignore
    }
    setVisible(false);
  };

  const accept = () => saveConsent(true);
  const reject = () => saveConsent(false);

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label="Consentimiento de cookies"
      className="fixed bottom-0 left-0 right-0 z-[9999] p-4 md:p-6"
      style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
    >
      <div className="max-w-4xl mx-auto bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl p-5 md:p-6 flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-gray-300 leading-relaxed">
            Usamos cookies y almacenamiento local esenciales para autenticación y tus preferencias (tema, sucursal activa). No usamos cookies de rastreo ni publicidad. Podés aceptarlas, rechazarlas o retirar tu consentimiento en cualquier momento.{' '}
            <Link href="/cookies" className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2">
              Más información
            </Link>
          </p>
        </div>
        <div className="flex flex-wrap gap-2 flex-shrink-0">
          <button
            onClick={reject}
            className="px-4 py-2.5 border border-gray-600 hover:border-gray-400 text-gray-300 hover:text-white font-semibold rounded-lg text-sm transition-colors whitespace-nowrap"
          >
            Rechazar
          </button>
          <button
            onClick={accept}
            className="px-6 py-2.5 bg-cyan-500 hover:bg-cyan-400 text-black font-semibold rounded-lg text-sm transition-colors whitespace-nowrap"
          >
            Aceptar
          </button>
        </div>
      </div>
    </div>
  );
}