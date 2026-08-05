'use client';

import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';

export function NetworkStatusNotifier() {
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    // Initial check
    if (typeof window !== 'undefined') {
      setIsOffline(!navigator.onLine);
    }

    const handleOffline = () => setIsOffline(true);
    const handleOnline = () => setIsOffline(false);

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  if (!isOffline) return null;

  return (
    <div className="fixed top-0 inset-x-0 z-[9999] bg-amber-600 text-white px-4 py-2 text-center text-xs font-semibold flex items-center justify-center gap-2 shadow-lg animate-pulse">
      <WifiOff className="w-4 h-4" />
      <span>Sin conexión a internet. Los cambios o cobros no se guardarán hasta recuperar la señal.</span>
    </div>
  );
}
