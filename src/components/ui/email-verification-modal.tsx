'use client';

import { Button } from '@/components/ui/button';
import { MailCheck } from 'lucide-react';
import { Modal } from '@/components/ui/modal';

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
    <Modal onClose={onClose} className="max-w-md">
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
      </Modal>
  );
}
