'use client';

import { AlertTriangle } from 'lucide-react';

export function ErrorState({
  title = 'Algo salió mal',
  description = 'Por favor, intenta de nuevo más tarde.',
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="text-center py-20">
      <AlertTriangle className="h-12 w-12 mx-auto text-red-400 mb-3" />
      <p className="text-lg font-medium text-gray-900 dark:text-gray-100">{title}</p>
      <p className="text-sm text-gray-500 mt-1">{description}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 rounded-lg bg-indigo-500 px-6 py-2 text-sm font-medium text-white hover:bg-indigo-600"
        >
          Reintentar
        </button>
      )}
    </div>
  );
}