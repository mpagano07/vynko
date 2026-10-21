'use client';

import { useCallback, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormLabel } from '@/components/ui/form-label';
import { useAuth } from '@/lib/hooks/useAuth';
import { authFetch } from '@/lib/fetchWithTenant';
import { Download, Loader2, ShieldAlert, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useRouter } from 'next/navigation';

/**
 * Seccion de autoservicio de datos del titular (LEG-7):
 *  - Exportar: descarga un JSON con el perfil, las empresas propias y sus
 *    registros de negocio (portabilidad, art. 14 Ley 25.326 / art. 20 RGPD).
 *  - Eliminar cuenta: borrado irreversible con confirmacion escrita.
 *
 * Antes ambos derechos dependian de mandar un mail a privacidad@vynko.dev; esto
 * los vuelve ejercibles sin intervencion manual.
 */
export function AccountDangerZone() {
  const { logout } = useAuth();
  const router = useRouter();
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const res = await authFetch('/api/account/export');
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'No se pudo generar la exportación');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vynko-datos-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('Descarga lista');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error al exportar');
    } finally {
      setExporting(false);
    }
  }, []);

  const handleDelete = useCallback(async () => {
    if (confirmText !== 'ELIMINAR') return;
    setDeleting(true);
    try {
      const res = await authFetch('/api/account', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'ELIMINAR' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudo eliminar la cuenta');

      toast.success('Cuenta eliminada');
      await logout();
      router.push('/');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error al eliminar la cuenta');
      setDeleting(false);
    }
  }, [confirmText, logout, router]);

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-2">
          <Download className="h-5 w-5 text-indigo-500" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Exportar mis datos</h2>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Descargá un archivo con tu perfil, tus empresas y sus registros de negocio
          (productos, ventas, clientes, documentos). Es tu derecho de acceso y portabilidad.
        </p>
        <Button onClick={handleExport} disabled={exporting} variant="outline">
          {exporting ? (
            <><Loader2 className="h-4 w-4 animate-spin mr-1" />Generando...</>
          ) : (
            <><Download className="h-4 w-4 mr-1" />Descargar mis datos</>
          )}
        </Button>
      </Card>

      <Card className="p-6 border-red-200 dark:border-red-900/50">
        <div className="flex items-center gap-2 mb-2">
          <ShieldAlert className="h-5 w-5 text-red-500" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Eliminar mi cuenta</h2>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">
          Esta acción es <strong>permanente e irreversible</strong>. Se eliminan tu cuenta,
          las empresas que administrás y todos sus datos (inventario, ventas, documentos).
        </p>
        <p className="text-xs text-gray-400 mb-4">
          En empresas donde solo sos colaborador, únicamente se elimina tu acceso; los datos
          de esas empresas pertenecen a su titular.
        </p>
        <div className="max-w-xs">
          <FormLabel>
            Escribí <span className="font-mono text-red-500">ELIMINAR</span> para confirmar
          </FormLabel>
          <Input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="ELIMINAR"
            className="mb-3"
          />
        </div>
        <Button
          onClick={handleDelete}
          disabled={deleting || confirmText !== 'ELIMINAR'}
          variant="outline"
          className="border-red-300 text-red-600 hover:bg-red-50 hover:border-red-400 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-900/20"
        >
          {deleting ? (
            <><Loader2 className="h-4 w-4 animate-spin mr-1" />Eliminando...</>
          ) : (
            <><Trash2 className="h-4 w-4 mr-1" />Eliminar cuenta definitivamente</>
          )}
        </Button>
      </Card>
    </div>
  );
}
