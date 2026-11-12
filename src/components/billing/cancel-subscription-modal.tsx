'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { AlertTriangle, LifeBuoy } from 'lucide-react';

export const CANCEL_REASONS = [
  { id: 'price', label: 'Me resulta caro' },
  { id: 'learning', label: 'No terminé de entender cómo usarlo' },
  { id: 'low_sales', label: 'No estoy teniendo ventas' },
  { id: 'closed', label: 'Cerré el negocio' },
  { id: 'other', label: 'Otro motivo' },
] as const;

export type CancelReasonId = (typeof CANCEL_REASONS)[number]['id'];

interface CancelSubscriptionModalProps {
  onClose: () => void;
  onSupport: () => void;
  /** Se llama solo si la persona decide seguir con la baja. */
  onContinue: (reason: CancelReasonId | null) => void;
  /** Fecha hasta la que mantiene el acceso, ya formateada. */
  periodEndLabel?: string | null;
}

/**
 * Paso de retención previo a la baja. No bloquea la cancelación: solo ofrece
 * ayuda y deja registrar un motivo. La confirmación destructiva sigue en
 * `ConfirmModal`, para que la baja nunca sea un solo click.
 */
export function CancelSubscriptionModal({
  onClose,
  onSupport,
  onContinue,
  periodEndLabel,
}: CancelSubscriptionModalProps) {
  const [reason, setReason] = useState<CancelReasonId | null>(null);

  return (
    <Modal onClose={onClose} className="max-w-md">
      <div className="flex flex-col items-center text-center">
        <div className="mb-4 rounded-full bg-amber-50 p-3 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400">
          <AlertTriangle className="h-6 w-6" aria-hidden="true" />
        </div>

        <h2 className="mb-2 text-lg font-bold text-gray-900 dark:text-white">
          Antes de cancelar
        </h2>
        <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
          Tu plan sigue activo hasta el final del período
          {periodEndLabel ? ` (${periodEndLabel})` : ''}. Si algo no está
          funcionando, contanos qué pasó y lo vemos juntos.
        </p>

        <fieldset className="mb-5 w-full text-left">
          <legend className="mb-2 text-xs font-semibold text-gray-500 dark:text-gray-400">
            ¿Qué te llevó a cancelar? (opcional)
          </legend>
          <div className="grid gap-2">
            {CANCEL_REASONS.map((option) => (
              <label
                key={option.id}
                className="flex cursor-pointer items-center gap-3 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50 has-[:checked]:border-indigo-500 has-[:checked]:bg-indigo-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800 dark:has-[:checked]:border-indigo-500 dark:has-[:checked]:bg-indigo-950/30"
              >
                <input
                  type="radio"
                  name="cancel-reason"
                  value={option.id}
                  checked={reason === option.id}
                  onChange={() => setReason(option.id)}
                  className="h-4 w-4 accent-indigo-600"
                />
                {option.label}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex w-full flex-col gap-2">
          <Button type="button" onClick={onSupport} className="w-full">
            <LifeBuoy className="h-4 w-4" aria-hidden="true" />
            Hablar con soporte
          </Button>
          <Button type="button" variant="outline" onClick={onClose} className="w-full">
            Mantener mi plan
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onContinue(reason)}
            className="w-full text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950/30 dark:hover:text-red-300"
          >
            Continuar con la baja
          </Button>
        </div>
      </div>
    </Modal>
  );
}
