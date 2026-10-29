'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { authFetch } from '@/lib/fetchWithTenant';
import { Cloud, Loader2, Unplug } from 'lucide-react';
import toast from 'react-hot-toast';

/**
 * Permite revocar el acceso a Google Drive desde Configuración.
 *
 * La desconexión no se limita a borrar la fila local: llama al endpoint de
 * revocación de Google para que el permiso también desaparezca de la Cuenta de
 * Google del usuario.
 */
export function GoogleDriveConnectionCard() {
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await authFetch('/api/google/drive/connection');
        if (!res.ok) return;
        const data = (await res.json().catch(() => ({}))) as { connected?: boolean };
        if (!cancelled) setConnected(Boolean(data.connected));
      } catch {
        if (!cancelled) setConnected(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleDisconnect = useCallback(async () => {
    setDisconnecting(true);
    try {
      const res = await authFetch('/api/google/drive/connection', { method: 'DELETE' });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error || 'No se pudo desconectar Google Drive');
      }
      setConnected(false);
      toast.success('Google Drive desconectado');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'No se pudo desconectar Google Drive');
    } finally {
      setDisconnecting(false);
    }
  }, []);

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <Cloud className="h-5 w-5 text-indigo-500" />
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Google Drive</h2>
        <span className="ml-auto">
          {loading ? (
            <StatusBadge tone="grayMuted">Comprobando...</StatusBadge>
          ) : connected ? (
            <StatusBadge tone="emerald">Conectado</StatusBadge>
          ) : (
            <StatusBadge tone="grayMuted">No conectado</StatusBadge>
          )}
        </span>
      </div>

      <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">
        Vynko sólo accede a los archivos de Drive que elegís explícitamente al importar o
        exportar planillas.
      </p>
      <p className="text-xs text-gray-400 mb-4">
        {connected
          ? 'Si desconectás, la próxima vez te vamos a pedir autorización de nuevo.'
          : 'Podés conectar tu cuenta desde la importación o exportación de productos.'}
      </p>

      {!loading && connected && (
        <Button
          type="button"
          variant="outline"
          onClick={handleDisconnect}
          disabled={disconnecting}
          className="gap-2 border-red-300 text-red-600 hover:bg-red-50 hover:border-red-400 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-900/20"
        >
          {disconnecting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Unplug className="h-4 w-4" />
          )}
          {disconnecting ? 'Desconectando...' : 'Desconectar Google Drive'}
        </Button>
      )}
    </Card>
  );
}
