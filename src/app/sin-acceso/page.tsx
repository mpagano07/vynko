import Link from 'next/link';
import Image from 'next/image';
import { ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

/**
 * Pantalla para una sesion valida sin ninguna empresa asociada.
 *
 * El caso real es que al usuario lo sacaron de todos los tenants: antes caia en
 * el dashboard y cada pedido devolvia 401, sin ninguna explicacion de por que la
 * app no le funcionaba. `/sin-acceso` esta en `publicPaths` del proxy, asi que el
 * gate no la vuelve a redirigir.
 */
export default function NoAccessPage() {
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

        <ShieldAlert className="h-10 w-10 text-amber-500 mx-auto" />

        <h1 className="text-2xl font-bold text-white mt-4 mb-2">No tenés acceso a ninguna empresa</h1>
        <p className="text-gray-400">
          Tu cuenta está activa, pero ya no figura como colaborador de ninguna empresa. Si
          creés que es un error, pedile a un owner que te vuelva a invitar.
        </p>

        <div className="mt-8 flex flex-col gap-3">
          <Link href="/auth/forgot-password">
            <Button variant="outline" className="w-full border-gray-600 text-gray-300 hover:bg-gray-700 hover:text-white">
              Recuperar mi contraseña
            </Button>
          </Link>
          <Link href="/login">
            <Button className="w-full">Ir al inicio de sesión</Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
