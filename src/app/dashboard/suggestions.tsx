"use client";

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Lightbulb } from 'lucide-react';
import Link from 'next/link';

const SUGGESTIONS = [
  { text: 'Agregá colaboradores para que cada empleado tenga su propio usuario.', cta: 'Configurar', href: '/settings' },
  { text: 'Activá códigos QR para que tus productos se escaneen al instante.', cta: 'Activar', href: '/codigos' },
  { text: 'Registrá una compra para mantener el stock siempre actualizado.', cta: 'Registrar', href: '/providers' },
  { text: 'Creá categorías para encontrar tus productos más rápido.', cta: 'Crear', href: '/products' },
  { text: 'Gestioná tus documentos comerciales.', cta: 'Ver', href: '/documentos' },
];

export default function Suggestions() {
  return (
    <div className="pb-4">
      <div className="flex items-center gap-1.5 mb-3">
        <Lightbulb className="h-3.5 w-3.5 text-amber-500" />
        <h2 className="text-sm font-medium text-gray-900 dark:text-white">Sugerencia</h2>
      </div>
      <Card className="p-4 flex items-center justify-between gap-4">
        <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{SUGGESTIONS[0].text}</p>
        <Link href={SUGGESTIONS[0].href}>
          <Button size="sm" variant="outline" className="h-7 px-3 text-xs font-medium whitespace-nowrap">
            {SUGGESTIONS[0].cta}
          </Button>
        </Link>
      </Card>
    </div>
  );
}
