'use client';

import * as React from 'react';
import { Card } from '@/components/ui/card';
import { IconAction } from '@/components/ui/icon-action';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

export interface ModalProps {
  open?: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  titleClassName?: string;
  icon?: React.ReactNode;
  className?: string;
  panel?: boolean;
  /**
   * En mobile se ancla al borde inferior como hoja (bottom sheet). En pantallas
   * grandes mantiene el modal centrado de siempre.
   */
  sheet?: boolean;
  header?: React.ReactNode;
  backdropClose?: boolean;
  'aria-label'?: string;
  children: React.ReactNode;
}

/**
 * Pila de modales abiertos. `Escape` debe cerrar solo el último: si hay un
 * modal de confirmación encima de otro, el de abajo no tiene que desaparecer.
 * Es un módulo compartido para que todos los `Modal` respeten el orden.
 */
const openModalStack: string[] = [];

function useEscapeToClose(open: boolean, onClose: () => void) {
  const modalId = React.useId();
  const onCloseRef = React.useRef(onClose);

  // El callback suele ser una arrow inline distinta en cada render. Guardarlo
  // en un ref evita re-registrar el listener y alterar el orden de la pila.
  React.useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  React.useEffect(() => {
    if (!open) return;
    openModalStack.push(modalId);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (openModalStack[openModalStack.length - 1] !== modalId) return;
      event.preventDefault();
      onCloseRef.current();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      const index = openModalStack.lastIndexOf(modalId);
      if (index !== -1) openModalStack.splice(index, 1);
    };
  }, [open, modalId]);
}

export function Modal({
  open = true,
  onClose,
  title,
  titleClassName,
  icon,
  className,
  panel = false,
  sheet = false,
  header,
  backdropClose,
  'aria-label': ariaLabel,
  children,
}: ModalProps) {
  // El nombre accesible sale del título cuando existe; `aria-label` queda como
  // respaldo para los modales que no lo pasan.
  //
  // Los hooks van ANTES del early return de `open`: si se declararan después,
  // cambiar `open` entre renders cambiaría la cantidad de hooks.
  const titleId = React.useId();
  useEscapeToClose(open, onClose);

  if (!open) return null;

  // El overlay scrollea y el contenido va en un wrapper interno: un formulario
  // más alto que la pantalla (proveedores, productos, checkout) ya no queda
  // recortado y se puede llegar a los botones de cancelar/guardar. El
  // `min-h-full` mantiene el centrado vertical mientras el contenido entre.
  //
  // El z-index va por encima del banner de cookies (`z-[100]`): si no, en la
  // primera visita el banner tapa los botones del pie del modal y no se puede
  // confirmar ni cancelar.
  const handleBackdropMouseDown = backdropClose
    ? (event: React.MouseEvent<HTMLDivElement>) => {
        // El click puede caer en el padding del wrapper y no en el overlay, así
        // que se cierra salvo que haya empezado dentro del contenido.
        if ((event.target as HTMLElement).closest('[data-modal-content]')) return;
        onClose();
      }
    : undefined;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[110] overflow-y-auto overscroll-contain bg-black/55 backdrop-blur-xs"
      aria-label={ariaLabel}
      aria-labelledby={!ariaLabel && title ? titleId : undefined}
      onMouseDown={handleBackdropMouseDown}
    >
      <div
        className={cn(
          'flex min-h-full justify-center',
          sheet ? 'items-end p-0 sm:items-center sm:p-4' : 'items-center p-4'
        )}
      >
        {panel ? (
          <div
            data-modal-content
            className={cn(
              'w-full overflow-hidden bg-white shadow-2xl dark:bg-gray-900',
              sheet ? 'rounded-t-2xl sm:rounded-xl' : 'rounded-xl',
              className
            )}
          >
            {sheet && (
              <div className="flex justify-center pt-2 sm:hidden" aria-hidden="true">
                <span className="h-1.5 w-10 rounded-full bg-gray-300 dark:bg-gray-600" />
              </div>
            )}
            <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-2">{header}</div>
              <IconAction icon={X} label="Cerrar" tone="muted" size="md" onClick={onClose} />
            </div>
            {children}
          </div>
        ) : (
          <Card
            data-modal-content
            className={cn('relative w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-2xl p-6', className)}
          >
            <IconAction icon={X} label="Cerrar" tone="muted" size="md" className="absolute right-4 top-4" onClick={onClose} />
            {(icon || title) && (
              <h2 id={titleId} className={cn('flex items-center gap-2 text-xl font-bold text-gray-900 dark:text-white', titleClassName ?? 'mb-4')}>
                {icon}
                {title}
              </h2>
            )}
            {children}
          </Card>
        )}
      </div>
    </div>
  );
}
