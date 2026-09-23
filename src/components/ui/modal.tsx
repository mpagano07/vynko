'use client';

import * as React from 'react';
import { Card } from '@/components/ui/card';
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
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/55 backdrop-blur-xs"
      aria-label={ariaLabel}
      onMouseDown={backdropClose ? (e) => { if (e.target === e.currentTarget) onClose(); } : undefined}
    >
      {panel ? (
        <div className={cn('w-full overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-gray-900', className)}>
          <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-gray-800">
            <div className="flex items-center gap-2">{header}</div>
            <button
              onClick={onClose}
              aria-label="Cerrar"
              className="p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          {children}
        </div>
      ) : (
        <Card className={cn('relative w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-2xl p-6', className)}>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="absolute right-4 top-4 p-1 rounded-md text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-700"
          >
            <X className="h-5 w-5" />
          </button>
          {(icon || title) && (
            <h2 className={cn('flex items-center gap-2 text-xl font-bold text-gray-900 dark:text-white', titleClassName ?? 'mb-4')}>
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