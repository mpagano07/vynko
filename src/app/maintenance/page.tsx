import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

/**
 * Pantalla de mantenimiento global.
 *
 * El proxy reescribe aca las rutas de la app cuando `maintenance_mode` (o la
 * env `MAINTENANCE_MODE`) esta activo, y responde 503 con `Retry-After`. La
 * pagina esta en `PUBLIC_PATHS` para que el gate de auth no la mande a /login
 * y en `NOINDEX_PATHS` para que no compita con las landings.
 */
export const metadata: Metadata = {
  title: 'Mantenimiento · Vynko',
  robots: { index: false, follow: false },
};

export default function MaintenancePage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 p-8">
      <Card className="w-full max-w-md p-8 text-center bg-gray-800 border border-gray-700">
        <Image
          src="/icons/vynkoLogout.png?v=3"
          alt="Vynko"
          width={1530}
          height={590}
          sizes="128px"
          className="h-10 w-auto object-contain mx-auto mb-6"
        />

        <Wrench className="h-10 w-10 text-amber-500 mx-auto" />

        <h1 className="text-2xl font-bold text-white mt-4 mb-2">Estamos en mantenimiento</h1>
        <p className="text-gray-400">
          Estamos haciendo una pausa programada para cuidar tus datos. Volvé a intentar en unos
          minutos.
        </p>

        <div className="mt-8 flex flex-col gap-3">
          <Link href="/login">
            <Button className="w-full">Ir al inicio de sesión</Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
