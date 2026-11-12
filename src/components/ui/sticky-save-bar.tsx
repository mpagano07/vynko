'use client';

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
 * por id. En escritorio arranca después del sidebar (`md:left-60`) para no
 * taparlo; en mobile ocupa todo el ancho.
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
      className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white/95 px-4 py-3 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur-sm dark:border-gray-700 dark:bg-gray-900/95 md:left-60"
      style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
    >
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3">
        <p className="flex min-w-0 items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
          <span
            className="h-2 w-2 shrink-0 rounded-full bg-amber-500"
            aria-hidden="true"
          />
          <span className="truncate">{message}</span>
        </p>
        <div className="flex shrink-0 items-center gap-2">
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
            {saving ? 'Guardando...' : saveLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
