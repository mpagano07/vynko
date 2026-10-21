'use client';

import { resetCookieConsent } from '@/lib/cookie-consent';

export function ReviewCookiePreferences() {
  return (
    <button
      type="button"
      onClick={() => resetCookieConsent()}
      className="rounded-lg border border-cyan-500/40 px-4 py-2 text-sm font-semibold text-cyan-300 hover:bg-cyan-500/10 transition-colors"
    >
      Revisar mis preferencias de cookies
    </button>
  );
}
