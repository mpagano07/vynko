'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/hooks/useAuth';
import { ChevronDown, ChevronUp, Check, Plus, Loader2, Pencil } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { PLAN_LIMITS } from '@/lib/plans';
import type { PlanId } from '@/lib/plans';
import toast from 'react-hot-toast';

export function TenantSwitcher() {
  const { tenant, tenants, switchTenant } = useAuth();
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [creatingTenant, setCreatingTenant] = useState(false);
  const [newTenantName, setNewTenantName] = useState('');
  const [creating, setCreating] = useState(false);
  const createInputRef = useRef<HTMLInputElement>(null);
  const [renamingTenantId, setRenamingTenantId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  const currentPlan = tenant?.subscription_plan || 'starter';
  const maxBranches = PLAN_LIMITS[currentPlan as PlanId]?.branches ?? 1;
  const canAddBranch = tenants.length < maxBranches;

  const handleRename = async (tenantId: string) => {
    if (!renameValue.trim()) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/settings/tenant', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-active-tenant-id': tenantId,
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ name: renameValue.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al renombrar');
      toast.success('Sucursal renombrada');
      setRenamingTenantId(null);
      await switchTenant(tenant?.id || tenantId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error');
    }
  };

  useEffect(() => {
    if (renamingTenantId) renameInputRef.current?.focus();
  }, [renamingTenantId]);

  const handleCreateTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTenantName.trim()) return;
    setCreating(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/tenants', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ name: newTenantName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Error al crear sucursal');
        return;
      }
      toast.success('Sucursal creada');
      setNewTenantName('');
      setCreatingTenant(false);
      setSwitcherOpen(false);
      await switchTenant(data.tenant.id);
    } catch {
      toast.error('Error al crear sucursal');
    } finally {
      setCreating(false);
    }
  };

  useEffect(() => {
    if (creatingTenant) {
      createInputRef.current?.focus();
    }
  }, [creatingTenant]);

  if (!tenants || tenants.length === 0) return null;

  return (
    <div className="relative">
      <div className="flex items-center gap-2 w-full px-2 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700/50 hover:bg-gray-200/70 dark:hover:bg-gray-700/60 transition-colors cursor-pointer"
        onClick={() => setSwitcherOpen(!switcherOpen)}
      >
        <div className="w-6 h-6 rounded-md bg-blue-500/20 flex items-center justify-center flex-shrink-0">
          <span className="text-xs font-bold text-blue-500 dark:text-blue-400">{tenants.length > 1 && !tenant ? 'T' : (tenant?.name || 'T')[0].toUpperCase()}</span>
        </div>
        <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 truncate flex-1 text-left">{!tenant && tenants.length > 0 ? 'Todas las sucursales' : (tenant?.name || 'Seleccionar')}</p>
        {switcherOpen ? <ChevronUp className="h-4 w-4 text-gray-500 dark:text-gray-400 flex-shrink-0" /> : <ChevronDown className="h-4 w-4 text-gray-500 dark:text-gray-400 flex-shrink-0" />}
      </div>
      {switcherOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => { setSwitcherOpen(false); setCreatingTenant(false); }} />
          <div className="absolute left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl z-20 py-1 max-h-56 overflow-y-auto">
            <button
              onClick={() => {
                if (!tenant || tenants.length > 1) {
                  switchTenant('__all__');
                }
                setSwitcherOpen(false);
              }}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm text-left hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors border-b border-gray-100 dark:border-gray-700 mb-1"
            >
              <div className="w-5 h-5 rounded bg-gray-100 dark:bg-gray-700 flex items-center justify-center flex-shrink-0">
                <span className="text-[10px] font-bold text-blue-500 dark:text-blue-400">T</span>
              </div>
              <span className="truncate flex-1 text-gray-800 dark:text-gray-200 font-medium">Todas las sucursales</span>
              {!tenant && (
                <Check className="h-4 w-4 text-blue-500 dark:text-blue-400 flex-shrink-0" />
              )}
            </button>
            {tenants.map((t) => (
              <div key={t.id} className="group flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                {renamingTenantId === t.id ? (
                  <form
                    onSubmit={(e) => { e.preventDefault(); handleRename(t.id); }}
                    className="flex items-center gap-1 w-full"
                  >
                    <input
                      ref={renameInputRef}
                      type="text"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      className="flex-1 px-2 py-1 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-gray-900 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <button type="submit" className="p-1 text-blue-500 dark:text-blue-400 hover:text-blue-600">
                      <Check className="h-3.5 w-3.5" />
                    </button>
                  </form>
                ) : (
                  <>
                    <button
                      onClick={() => {
                        if (t.id !== tenant?.id) {
                          switchTenant(t.id);
                        }
                        setSwitcherOpen(false);
                      }}
                      className="flex items-center gap-2 flex-1 min-w-0"
                    >
                      <div className="w-5 h-5 rounded bg-gray-100 dark:bg-gray-700 flex items-center justify-center flex-shrink-0">
                        <span className="text-[10px] font-bold text-gray-600 dark:text-gray-300">{(t.name || 'T')[0].toUpperCase()}</span>
                      </div>
                      <span className="truncate flex-1 text-gray-800 dark:text-gray-200 text-left">{t.name}</span>
                    </button>
                    {t.id === tenant?.id && (
                      <Check className="h-4 w-4 text-blue-500 dark:text-blue-400 flex-shrink-0" />
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); setRenamingTenantId(t.id); setRenameValue(t.name); }}
                      className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                      title="Renombrar"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </div>
            ))}
            <div className="border-t border-gray-100 dark:border-gray-700 mt-1 pt-1">
              {creatingTenant ? (
                <form onSubmit={handleCreateTenant} className="px-3 py-2">
                  <input
                    ref={createInputRef}
                    type="text"
                    value={newTenantName}
                    onChange={(e) => setNewTenantName(e.target.value)}
                    placeholder="Nombre de la sucursal"
                    className="w-full px-2 py-1.5 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-gray-900 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    disabled={creating}
                  />
                  <div className="flex gap-1.5 mt-1.5">
                    <button
                      type="submit"
                      disabled={creating || !newTenantName.trim()}
                      className="flex-1 px-2 py-1 text-xs font-medium bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded text-white transition-colors"
                    >
                      {creating ? <Loader2 className="h-3 w-3 animate-spin mx-auto" /> : 'Crear'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setCreatingTenant(false); setNewTenantName(''); }}
                      disabled={creating}
                      className="px-2 py-1 text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                    >
                      Cancelar
                    </button>
                  </div>
                </form>
              ) : canAddBranch ? (
                <button
                  onClick={() => setCreatingTenant(true)}
                  className="flex items-center gap-2 w-full px-3 py-2 text-sm text-left text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  <Plus className="h-4 w-4" />
                  <span>Nueva sucursal</span>
                </button>
              ) : (
                <div className="px-3 py-2 text-xs text-gray-500">
                  Límite de {maxBranches} sucursal{maxBranches !== 1 ? 'es' : ''} alcanzado para tu plan ({currentPlan}).
                  <Link href="/billing" className="text-blue-500 dark:text-blue-400 hover:underline ml-1">Mejorar plan</Link>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}