'use client';

import { useEffect, useState, useCallback } from 'react';
import { Download, X, Share } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) && !(window as unknown as { MSStream?: unknown }).MSStream;
}

export function InstallAppBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIOS, setShowIOS] = useState(false);
  const [dismissed, setDismissed] = useState(
    () => typeof window !== 'undefined' && !!localStorage.getItem('vynko-install-banner-dismissed')
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isStandalone() || dismissed) return;

    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const onAppInstalled = () => {
      setDeferredPrompt(null);
      setShowIOS(false);
      setDismissed(true);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);

    if (isIOS()) {
      const t = setTimeout(() => setShowIOS(true), 1500);
      return () => {
        clearTimeout(t);
        window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
        window.removeEventListener('appinstalled', onAppInstalled);
      };
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, [dismissed]);

  const installApp = useCallback(async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      setDeferredPrompt(null);
      if (choice.outcome === 'accepted') {
        setDismissed(true);
        localStorage.setItem('vynko-install-banner-dismissed', '1');
      }
    }
  }, [deferredPrompt]);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    localStorage.setItem('vynko-install-banner-dismissed', '1');
  }, []);

  if (isStandalone() || dismissed) return null;
  if (!deferredPrompt && !showIOS) return null;

  return (
    <div className="fixed bottom-4 inset-x-4 sm:inset-x-auto sm:right-4 z-[9998] sm:max-w-sm">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl p-4 flex items-start gap-3">
        {showIOS && !deferredPrompt ? (
          <>
            <div className="shrink-0 w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
              <Share className="w-5 h-5 text-cyan-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white">Instalá Vynko</p>
              <p className="text-xs text-gray-400 mt-1 leading-relaxed">
                Tocá el botón <span className="inline-flex items-center gap-1 align-middle bg-gray-800 border border-gray-600 rounded px-1.5 py-0.5 text-gray-200"><Share className="w-3 h-3" /> Compartir</span> y elegí{" "}
                <span className="font-medium text-gray-200">&quot;Agregar a pantalla de inicio&quot;</span>.
              </p>
            </div>
          </>
        ) : (
          <>
            <div className="shrink-0 w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
              <Download className="w-5 h-5 text-cyan-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white">Instalá la app de Vynko</p>
              <p className="text-xs text-gray-400 mt-1">Acceso rápido y sin conexión desde tu pantalla de inicio.</p>
              <button
                onClick={installApp}
                className="mt-3 w-full px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-black text-sm font-semibold rounded-lg transition-colors"
              >
                Instalar
              </button>
            </div>
          </>
        )}
        <button
          onClick={handleDismiss}
          aria-label="Cerrar"
          className="shrink-0 text-gray-500 hover:text-white transition-colors p-1"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
