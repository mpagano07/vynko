'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Pencil, X, Loader2, Shield, ShieldCheck, HelpCircle } from 'lucide-react';

export interface TenantOption {
  id: string;
  name: string;
}

interface EditCollaboratorModalProps {
  open: boolean;
  fullName?: string;
  email: string;
  role: 'owner' | 'manager' | 'member';
  tenants: TenantOption[];
  defaultTenantIds: string[];
  canEditRole?: boolean;
  onCancel: () => void;
  onSave: (payload: { role: string; tenant_ids: string[] }) => Promise<void>;
}

export function EditCollaboratorModal({
  open,
  fullName,
  email,
  role,
  tenants,
  defaultTenantIds,
  canEditRole = true,
  onCancel,
  onSave,
}: EditCollaboratorModalProps) {
  const [editRole, setEditRole] = useState(role);
  const [selectedTenantIds, setSelectedTenantIds] = useState<string[]>(defaultTenantIds);
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  const toggleTenant = (id: string) => {
    setSelectedTenantIds((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
  };

  const handleSave = async () => {
    if (selectedTenantIds.length === 0) return;
    setSaving(true);
    try {
      await onSave({ role: editRole, tenant_ids: selectedTenantIds });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/55 backdrop-blur-xs">
      <Card className="w-full max-w-md bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-2xl p-6 relative">
        <button
          onClick={onCancel}
          className="absolute right-4 top-4 p-1 rounded-md text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-700"
          aria-label="Cerrar"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="flex items-center gap-3 mb-5">
          <div className="p-2.5 rounded-full bg-indigo-50 dark:bg-indigo-950/30 text-indigo-600 dark:text-indigo-400">
            <Pencil className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white truncate">
              Editar colaborador
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
              {fullName || 'Sin nombre'} — {email}
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5 flex items-center gap-1">
              Rol
              <span
                className="inline-flex cursor-help text-gray-400"
                title="Miembro: puede cobrar y ver ventas. Manager: además gestiona precios, productos y configuración de cobro. Propietario: control total de la empresa."
              >
                <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
            </label>
            <select
              value={editRole}
              disabled={!canEditRole || role === 'owner'}
              onChange={(e) => setEditRole(e.target.value as 'member' | 'manager')}
              className="flex w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
            >
              <option value="member">Miembro</option>
              <option value="manager">Manager</option>
            </select>
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
              <Shield className="h-3.5 w-3.5" />
              Sucursales asignadas
            </p>
            {tenants.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {tenants.map((t) => {
                  const checked = selectedTenantIds.includes(t.id);
                  return (
                    <label
                      key={t.id}
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-xs cursor-pointer transition-colors ${
                        checked
                          ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300'
                          : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleTenant(t.id)}
                        className="sr-only"
                      />
                      {checked ? '✓' : '○'} {t.name}
                    </label>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-gray-400">No hay sucursales disponibles.</p>
            )}
          </div>

          <div className="flex items-center gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={saving}
              className="flex-1"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={handleSave}
              disabled={saving || selectedTenantIds.length === 0}
              className="flex-1"
            >
              {saving ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-1" />Guardando...</>
              ) : (
                <><ShieldCheck className="h-4 w-4 mr-1" />Guardar</>
              )}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}