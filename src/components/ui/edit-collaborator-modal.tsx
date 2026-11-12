'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Modal } from '@/components/ui/modal';
import { FormLabel } from '@/components/ui/form-label';
import { Pencil, Loader2, ShieldCheck, HelpCircle } from 'lucide-react';
import {
  ASSIGNABLE_ROLES,
  ROLE_HELP_TEXT,
  ROLE_OPTIONS,
  type TenantRole,
} from '@/lib/roles';

export interface TenantOption {
  id: string;
  name: string;
}

export interface MembershipInput {
  tenant_id: string;
  role: string;
}

interface EditCollaboratorModalProps {
  open: boolean;
  fullName?: string;
  email: string;
  role: TenantRole;
  tenants: TenantOption[];
  /** Rol actual en cada sucursal. La ausencia de una sucursal = no asignada. */
  memberships: MembershipInput[];
  canEditRole?: boolean;
  /**
   * Roles que este actor puede asignar. Un manager no puede nombrar otros
   * managers; el backend lo rechaza, pero el selector tampoco debe ofrecerlo.
   */
  allowedRoles?: TenantRole[];
  onCancel: () => void;
  onSave: (payload: {
    memberships: MembershipInput[];
    full_name?: string | null;
  }) => Promise<void>;
}

function isAssignable(role: string | null | undefined): role is TenantRole {
  return typeof role === 'string' && (ASSIGNABLE_ROLES as string[]).includes(role);
}

export function EditCollaboratorModal({
  open,
  fullName,
  email,
  role,
  tenants,
  memberships,
  canEditRole = true,
  allowedRoles = ASSIGNABLE_ROLES,
  onCancel,
  onSave,
}: EditCollaboratorModalProps) {
  const [name, setName] = useState(fullName ?? '');
  const [rolesByTenant, setRolesByTenant] = useState<Record<string, TenantRole>>(() => {
    const initial: Record<string, TenantRole> = {};
    for (const membership of memberships) {
      initial[membership.tenant_id] = isAssignable(membership.role) ? membership.role : 'member';
    }
    return initial;
  });
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  const defaultRole: TenantRole = isAssignable(role) ? role : 'member';
  const selectedTenantIds = Object.keys(rolesByTenant);

  const toggleTenant = (id: string) => {
    setRolesByTenant((prev) => {
      if (id in prev) {
        const next = { ...prev };
        delete next[id];
        return next;
      }
      return { ...prev, [id]: defaultRole };
    });
  };

  const setRoleFor = (id: string, value: string) => {
    if (!isAssignable(value)) return;
    setRolesByTenant((prev) => ({ ...prev, [id]: value }));
  };

  const handleSave = async () => {
    const selected = tenants.filter((t) => t.id in rolesByTenant);
    if (selected.length === 0) return;
    setSaving(true);
    try {
      await onSave({
        memberships: selected.map((t) => ({
          tenant_id: t.id,
          role: rolesByTenant[t.id] ?? 'member',
        })),
        // Vacío = no tocar el nombre. El backend ignora la cadena vacía para
        // que borrar el campo no deje a la persona "Sin nombre" por accidente.
        full_name: name.trim() || null,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onCancel} className="max-w-md">
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
            <FormLabel htmlFor="collaborator-name">Nombre</FormLabel>
            <Input
              id="collaborator-name"
              type="text"
              placeholder="Nombre del colaborador"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <p className="mt-1 text-xs text-gray-400">
              La persona también puede cambiarlo desde su perfil.
            </p>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <FormLabel className="mb-0 flex items-center gap-1">
                Sucursales y rol
                <span className="inline-flex cursor-help text-gray-400" title={ROLE_HELP_TEXT}>
                  <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
              </FormLabel>
              <span className="text-xs text-gray-400">
                {selectedTenantIds.length} de {tenants.length}
              </span>
            </div>

            {tenants.length > 0 ? (
              <div className="space-y-2">
                {tenants.map((t) => {
                  const checked = t.id in rolesByTenant;
                  const tenantRole = rolesByTenant[t.id] ?? defaultRole;
                  return (
                    <div
                      key={t.id}
                      className={`flex items-center gap-2 rounded-md border px-2.5 py-2 transition-colors ${
                        checked
                          ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-700'
                          : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700'
                      }`}
                    >
                      <label className="flex items-center gap-1.5 text-xs cursor-pointer min-w-0 flex-1">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleTenant(t.id)}
                          className="h-3.5 w-3.5 accent-blue-600"
                        />
                        <span
                          className={`truncate ${
                            checked
                              ? 'text-blue-700 dark:text-blue-300'
                              : 'text-gray-600 dark:text-gray-400'
                          }`}
                        >
                          {t.name}
                        </span>
                      </label>
                      {checked && (
                        <Select
                          value={tenantRole}
                          disabled={!canEditRole}
                          onChange={(e) => setRoleFor(t.id, e.target.value)}
                          aria-label={`Rol en ${t.name}`}
                          className="min-w-[8.5rem]"
                        >
                          {ROLE_OPTIONS.filter((option) =>
                            allowedRoles.includes(option.value)
                          ).map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </Select>
                      )}
                    </div>
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
      </Modal>
  );
}
