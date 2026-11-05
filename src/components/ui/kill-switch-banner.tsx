'use client';

import { AlertTriangle } from 'lucide-react';
import { useKillSwitches } from '@/lib/hooks/useKillSwitches';
import type { KillArea } from '@/lib/kill-switch';

const AREA_MESSAGE: Record<KillArea, string> = {
  sales: 'Las ventas están deshabilitadas temporalmente.',
  payments: 'Los cobros están deshabilitados temporalmente.',
  forecast: 'El pronóstico está deshabilitado temporalmente.',
  imports: 'La importación de productos está deshabilitada temporalmente.',
};

const AREAS: KillArea[] = ['sales', 'payments', 'forecast', 'imports'];

/**
 * Aviso de modo incidente. No bloquea nada por si solo: el servidor ya devuelve
 * 503 en las rutas afectadas. Esto existe para que la persona entienda por que
 * el boton no funciona en vez de pensar que la app se rompio.
 */
export function KillSwitchBanner() {
  const { killSwitches } = useKillSwitches();

  const messages: string[] = [];
  if (killSwitches.maintenance) {
    messages.push('Mantenimiento general: las operaciones están deshabilitadas.');
  }
  for (const area of AREAS) {
    if (killSwitches[area]) messages.push(AREA_MESSAGE[area]);
  }

  if (messages.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
    >
      <div className="mx-auto flex max-w-7xl items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div>
          <p className="font-medium">Modo incidente</p>
          <ul className="list-inside list-disc">
            {messages.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
