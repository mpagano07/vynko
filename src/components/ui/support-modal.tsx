'use client';

import { Button } from '@/components/ui/button';
import { Mail, Copy, Check } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { useState } from 'react';

interface SupportModalProps {
  open: boolean;
  onClose: () => void;
}

const SUPPORT_EMAIL = 'soporte@vynko.dev';

export function SupportModal({ open, onClose }: SupportModalProps) {
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(SUPPORT_EMAIL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Modal onClose={onClose} className="max-w-sm">
      <div className="flex flex-col items-center text-center">
          <div className="p-3 rounded-full mb-4 bg-indigo-50 dark:bg-indigo-950/30 text-indigo-600 dark:text-indigo-400">
            <Mail className="h-6 w-6" />
          </div>

          <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1">
            Contactar soporte
          </h2>

          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Escribinos a nuestro correo para consultas de facturación o soporte. Las cotizaciones de planes enterprise se gestionan por ventas.
          </p>

          <div className="flex items-center gap-2 w-full mb-5">
            <code className="flex-1 text-center text-sm font-mono bg-gray-100 dark:bg-gray-800 px-3 py-2 rounded-md text-gray-900 dark:text-gray-100 break-all">
              {SUPPORT_EMAIL}
            </code>
          </div>

          <div className="flex flex-col gap-2 w-full">
            <Button type="button" variant="outline" onClick={handleCopy} className="w-full">
              {copied ? <Check className="h-4 w-4 mr-2 text-green-500" /> : <Copy className="h-4 w-4 mr-2" />}
              {copied ? 'Copiado' : 'Copiar correo'}
            </Button>
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="inline-flex items-center justify-center rounded-md font-medium transition-colors h-10 px-4 text-base bg-indigo-600 text-white hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600"
            >
              Abrir en mi correo
            </a>
          </div>
        </div>
      </Modal>
  );
}
