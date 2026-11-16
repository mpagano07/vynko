'use client';

import { useState } from 'react';
import { Lock, Store } from 'lucide-react';
import { useAuth } from '@/lib/hooks/useAuth';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

/**
 * Pantalla que reemplaza a las secciones que sólo operan sobre una sucursal
 * cuando el usuario está en "Todas las sucursales". Evita el "Cargando..."
 * infinito y ofrece elegir la sucursal en el mismo lugar.
 */
export function BranchRequiredState({ section }: { section?: string }) {
  const { tenants, switchTenant } = useAuth();
  const [switchingId, setSwitchingId] = useState<string | null>(null);

  const handleSelect = async (tenantId: string) => {
    setSwitchingId(tenantId);
    try {
      await switchTenant(tenantId);
    } finally {
      setSwitchingId(null);
    }
  };

  return (
    <Card className="mx-auto max-w-lg p-8 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 dark:bg-amber-500/10">
        <Lock className="h-7 w-7 text-amber-500 dark:text-amber-400" />
      </div>
      <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
        Elegí una sucursal
      </h1>
      <p className="mx-auto mt-1 max-w-sm text-sm text-gray-500 dark:text-gray-400">
        {section ? `“${section}” trabaja` : 'Esta sección trabaja'} con una sucursal a la vez.
        En “Todas las sucursales” no hay stock, caja ni documentos consolidados para mostrar.
      </p>

      {tenants.length > 0 ? (
        <div className="mt-5 space-y-2 text-left">
          {tenants.map((tenant) => (
            <Button
              key={tenant.id}
              variant="outline"
              className="w-full justify-start"
              loading={switchingId === tenant.id}
              disabled={switchingId !== null && switchingId !== tenant.id}
              onClick={() => handleSelect(tenant.id)}
            >
              <Store className="h-4 w-4 text-gray-400" />
              <span className="truncate">{tenant.name}</span>
            </Button>
          ))}
        </div>
      ) : (
        <p className="mt-5 text-sm text-gray-500 dark:text-gray-400">
          No hay sucursales disponibles. Pedile a un responsable que te asigne una.
        </p>
      )}
    </Card>
  );
}
