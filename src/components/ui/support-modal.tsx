'use client';

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Mail, Copy, Check, X } from 'lucide-react';
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/55 backdrop-blur-xs">
      <Card className="w-full max-w-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-2xl p-6 relative">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 p-1 rounded-md text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-700"
          aria-label="Cerrar"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="flex flex-col items-center text-center">
          <div className="p-3 rounded-full mb-4 bg-indigo-50 dark:bg-indigo-950/30 text-indigo-600 dark:text-indigo-400">
            <Mail className="h-6 w-6" />
          </div>

          <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1">
            Contactar soporte
          </h2>

          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Escribinos a nuestro correo para facturación o planes enterprise.
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
      </Card>
    </div>
  );
}
