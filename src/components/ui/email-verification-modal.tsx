'use client';

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MailCheck, X } from 'lucide-react';

interface EmailVerificationModalProps {
  open: boolean;
  email: string;
  onClose: () => void;
  onGoToLogin: () => void;
}

export function EmailVerificationModal({
  open,
  email,
  onClose,
  onGoToLogin,
}: EmailVerificationModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/55 backdrop-blur-xs">
      <Card className="w-full max-w-md bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-2xl p-6 relative">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 p-1 rounded-md text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-700"
          aria-label="Cerrar"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="flex flex-col items-center text-center">
          <div className="p-3 rounded-full mb-4 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400">
            <MailCheck className="h-6 w-6" />
          </div>

          <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
            Revisá tu email para confirmar el registro
          </h2>

          <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">
            Te enviamos un correo de verificación a
          </p>
          <p className="text-sm font-medium text-gray-800 dark:text-gray-200 mb-4 break-all">
            {email}
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
            Hacé clic en el botón del email para confirmar tu cuenta y poder ingresar.
            ¿No lo recibiste? Revisá la carpeta de spam.
          </p>

          <Button
            type="button"
            onClick={onGoToLogin}
            className="w-full"
          >
            Ir a iniciar sesión
          </Button>
        </div>
      </Card>
    </div>
  );
}
