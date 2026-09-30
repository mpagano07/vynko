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

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/55 backdrop-blur-xs"
      aria-label={ariaLabel}
      aria-labelledby={!ariaLabel && title ? titleId : undefined}
      onMouseDown={backdropClose ? (e) => { if (e.target === e.currentTarget) onClose(); } : undefined}
    >
      {panel ? (
        <div className={cn('w-full overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-gray-900', className)}>
          <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-gray-800">
            <div className="flex items-center gap-2">{header}</div>
            <IconAction icon={X} label="Cerrar" tone="muted" size="md" onClick={onClose} />
          </div>
          {children}
        </div>
      ) : (
        <Card className={cn('relative w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-2xl p-6', className)}>
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
  );
}