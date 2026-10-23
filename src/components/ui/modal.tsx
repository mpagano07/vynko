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
  header?: React.ReactNode;
  backdropClose?: boolean;
  'aria-label'?: string;
  children: React.ReactNode;
}

export function Modal({
  open = true,
  onClose,
  title,
  titleClassName,
  icon,
  className,
  panel = false,
  header,
  backdropClose,
  'aria-label': ariaLabel,
  children,
}: ModalProps) {
  // El nombre accesible sale del título cuando existe; `aria-label` queda como
  // respaldo para los modales que no lo pasan.
  //
  // El hook va ANTES del early return de `open`: si se declarara después,
  // cambiar `open` entre renders cambiaría la cantidad de hooks.
  const titleId = React.useId();

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
      <div className="flex min-h-full items-center justify-center p-4">
        {panel ? (
          <div
            data-modal-content
            className={cn('w-full overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-gray-900', className)}
          >
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
