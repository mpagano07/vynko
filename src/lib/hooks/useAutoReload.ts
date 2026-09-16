'use client';

import { useEffect } from 'react';

const CHECK_INTERVAL_MS = 60_000;

export function useAutoReload(): void {
  useEffect(() => {
    let knownVersion: string | null = null;

    const check = async () => {
      try {
        const res = await fetch(`/api/version?cb=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as { version?: string };
        if (!data.version) return;
        if (knownVersion === null) {
          knownVersion = data.version;
          return;
        }
        if (data.version !== knownVersion) {
          window.location.reload();
        }
      } catch {
        // Errores de red transitorios: se reintenta en el próximo chequeo.
      }
    };

    void check();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    const interval = window.setInterval(() => void check(), CHECK_INTERVAL_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.clearInterval(interval);
    };
  }, []);
}