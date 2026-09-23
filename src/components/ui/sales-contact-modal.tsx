'use client';

import { Button } from '@/components/ui/button';
import { Handshake, Mail, Copy, Check } from 'lucide-react';
import { useState } from 'react';
import { Modal } from '@/components/ui/modal';
import { SALES_EMAIL } from '@/lib/tenant-config';

interface SalesContactModalProps {
  open: boolean;
  onClose: () => void;
}

export function SalesContactModal({ open, onClose }: SalesContactModalProps) {
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(SALES_EMAIL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Modal onClose={onClose} className="max-w-md">
      <div className="flex flex-col items-center text-center">
          <div className="p-3 rounded-full mb-4 bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400">
            <Handshake className="h-6 w-6" />
          </div>

          <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
            Plan Enterprise a medida
          </h2>

          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Diseñamos módulos, integraciones y reportes personalizados para tu
            operación. Escribinos para recibir una cotización exclusiva.
          </p>

          <div className="flex items-center gap-2 w-full mb-5">
            <code className="flex-1 text-center text-sm font-mono bg-gray-100 dark:bg-gray-800 px-3 py-2 rounded-md text-gray-900 dark:text-gray-100 break-all">
              {SALES_EMAIL}
            </code>
          </div>

          <div className="flex flex-col gap-2 w-full">
            <Button type="button" variant="outline" onClick={handleCopy} className="w-full">
              {copied ? <Check className="h-4 w-4 mr-2 text-green-500" /> : <Copy className="h-4 w-4 mr-2" />}
              {copied ? 'Copiado' : 'Copiar correo'}
            </Button>
            <a
              href={`mailto:${SALES_EMAIL}?subject=${encodeURIComponent('Cotización Plan Enterprise - Vynko')}`}
              className="inline-flex items-center justify-center rounded-md font-medium transition-colors h-10 px-4 text-base bg-amber-500 text-black hover:bg-amber-400"
            >
              <Mail className="h-4 w-4 mr-2" />
              Contactar ventas
            </a>
          </div>
        </div>
      </Modal>
  );
}
