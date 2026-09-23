'use client';

import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';
import { Modal } from '@/components/ui/modal';

interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'default';
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  variant = 'default',
  onConfirm,
  onCancel,
  loading = false,
}: ConfirmModalProps) {
  if (!open) return null;

  return (
    <Modal onClose={onCancel} className="max-w-sm">
      <div className="flex flex-col items-center text-center">
          <div className={`p-3 rounded-full mb-4 ${
            variant === 'danger'
              ? 'bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400'
              : 'bg-indigo-50 dark:bg-indigo-950/30 text-indigo-600 dark:text-indigo-400'
          }`}>
            <AlertTriangle className="h-6 w-6" />
          </div>

          <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
            {title}
          </h2>

          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
            {message}
          </p>

          <div className="flex items-center gap-3 w-full">
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={loading}
              className="flex-1"
            >
              {cancelLabel}
            </Button>
            <Button
              type="button"
              onClick={onConfirm}
              disabled={loading}
              className={`flex-1 ${variant === 'danger' ? '!bg-red-600 hover:!bg-red-700' : ''}`}
            >
              {loading ? 'Procesando...' : confirmLabel}
            </Button>
          </div>
        </div>
      </Modal>
  );
}
