'use client';

import { PencilLine, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface StickySaveBarProps {
  /** Se monta solo cuando el formulario tiene cambios sin guardar. */
  open: boolean;
  saving?: boolean;
  disabled?: boolean;
  onDiscard: () => void;
  message?: string;
  saveLabel?: string;
}

/**
 * Barra fija para formularios largos. Se renderiza dentro del `<form>`, así el
 * botón principal hace `submit` sin duplicar handlers ni conectar formularios
 * por id. Es una tarjeta flotante, con el mismo lenguaje visual que las cards
 * (borde suave, sombra y acento indigo) y arranca después del sidebar para no
 * taparlo.
 */
export function StickySaveBar({
  open,
  saving = false,
  disabled = false,
  onDiscard,
  message = 'Tenés cambios sin guardar',
  saveLabel = 'Guardar cambios',
}: StickySaveBarProps) {
  if (!open) return null;

  return (
    <div
      role="region"
      aria-label={message}
      className="fixed inset-x-0 bottom-0 z-40 px-4 md:left-60 md:px-6 lg:px-8"
      style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
    >
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 rounded-xl border border-gray-200 bg-white/95 p-3 shadow-lg backdrop-blur-sm dark:border-gray-700 dark:bg-gray-800/95 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex min-w-0 items-center gap-2.5 text-sm text-gray-700 dark:text-gray-200">
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-300"
            aria-hidden="true"
          >
            <PencilLine className="h-4 w-4" />
          </span>
          <span className="truncate font-medium">{message}</span>
        </p>
        <div className="flex shrink-0 items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onDiscard}
            disabled={saving}
          >
            Descartar
          </Button>
          <Button type="submit" size="sm" loading={saving} disabled={disabled}>
            {saving ? (
              'Guardando...'
            ) : (
              <>
                <Save className="h-4 w-4" aria-hidden="true" />
                {saveLabel}
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
