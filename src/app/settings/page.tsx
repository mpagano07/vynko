'use client';

import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/lib/hooks/useAuth';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Settings, User, Building2, Loader2, Save, KeyRound, Users, Mail, X, Shield, ShieldCheck } from 'lucide-react';
import BiometricSettings from '@/components/auth/BiometricSettings';
import toast from 'react-hot-toast';

export default function SettingsPage() {
  const { user, profile, tenant, role } = useAuth();
  const router = useRouter();

  const [profileForm, setProfileForm] = useState({ full_name: '' });
  const [profileSynced, setProfileSynced] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  const [tenantForm, setTenantForm] = useState({ name: '', description: '' });
  const [tenantSynced, setTenantSynced] = useState(false);
  const [savingTenant, setSavingTenant] = useState(false);

  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [savingPassword, setSavingPassword] = useState(false);

  const [collaborators, setCollaborators] = useState<any[]>([]);
  const [pendingInvitations, setPendingInvitations] = useState<any[]>([]);
  const [loadingCollaborators, setLoadingCollaborators] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [inviteName, setInviteName] = useState('');
  const [inviting, setInviting] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const currentUserId = user?.id;
  const currentUserCollab = collaborators.find((c: any) => c.user_id === currentUserId);
  const isOwner = currentUserCollab?.role === 'owner';

  useEffect(() => {
    if (role && role === 'member') {
      router.replace('/dashboard');
    }
  }, [role, router]);

  useEffect(() => {
    async function fetchCollaborators() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch('/api/settings/collaborators', {
          headers: session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : {},
        });
        const data = await res.json();
        if (res.ok) {
          setCollaborators(data.collaborators || []);
          setPendingInvitations(data.pendingInvitations || []);
        }
      } catch {
        // silent
      } finally {
        setLoadingCollaborators(false);
      }
    }
    fetchCollaborators();
  }, []);

  const handleInvite = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;

    setInviting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/settings/collaborators', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole, full_name: inviteName.trim() }),
      });

      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Error al invitar');
        return;
      }

      if (data.invited) {
        toast.success(data.message || 'Invitación enviada');
        setPendingInvitations((prev) => [...prev, { id: 'pending', email: data.email, role: inviteRole }]);
      } else {
        toast.success('Colaborador agregado');
        setCollaborators((prev) => [...prev, data.collaborator]);
      }
      setInviteEmail('');
      setInviteName('');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error al invitar');
    } finally {
      setInviting(false);
    }
  }, [inviteEmail, inviteRole]);

  const handleRemove = useCallback(async (id: string) => {
    setRemovingId(id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/settings/collaborators/${id}`, {
        method: 'DELETE',
        headers: session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : {},
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || 'Error al remover');
        return;
      }

      toast.success('Colaborador removido');
      setCollaborators((prev) => prev.filter((c: any) => c.id !== id));
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error al remover');
    } finally {
      setRemovingId(null);
    }
  }, []);

  if (profile && !profileSynced) {
    setProfileForm({ full_name: profile.full_name || '' });
    setProfileSynced(true);
  }

  if (tenant && !tenantSynced) {
    setTenantForm({ name: tenant.name || '', description: tenant.description || '' });
    setTenantSynced(true);
  }

  const handleSaveProfile = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profileForm.full_name.trim()) {
      toast.error('El nombre es requerido');
      return;
    }

    setSavingProfile(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/settings/profile', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ full_name: profileForm.full_name.trim() }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al guardar');

      toast.success('Perfil actualizado');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar');
    } finally {
      setSavingProfile(false);
    }
  }, [profileForm.full_name]);

  const handleSaveTenant = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantForm.name.trim()) {
      toast.error('El nombre de la empresa es requerido');
      return;
    }

    setSavingTenant(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/settings/tenant', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          name: tenantForm.name.trim(),
          description: tenantForm.description,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al guardar');

      toast.success('Empresa actualizada');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar');
    } finally {
      setSavingTenant(false);
    }
  }, [tenantForm]);

  const handleChangePassword = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      toast.error('Las contraseñas no coinciden');
      return;
    }

    if (passwordForm.newPassword.length < 6) {
      toast.error('La contraseña debe tener al menos 6 caracteres');
      return;
    }

    setSavingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password: passwordForm.newPassword,
      });

      if (error) throw error;

      toast.success('Contraseña actualizada');
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error al actualizar contraseña');
    } finally {
      setSavingPassword(false);
    }
  }, [passwordForm]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <Settings className="h-8 w-8 text-gray-600 dark:text-gray-400" />
          Configuración
        </h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
          Administra tu perfil y los datos de tu empresa.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <User className="h-5 w-5 text-blue-500" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Perfil</h2>
          </div>

          <form onSubmit={handleSaveProfile} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                Email
              </label>
              <Input
                type="email"
                value={user?.email || ''}
                disabled
                className="bg-gray-50 dark:bg-gray-900/50"
              />
              <p className="text-xs text-gray-400 mt-1">El email no se puede modificar</p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                Nombre completo
              </label>
              <Input
                type="text"
                required
                placeholder="Tu nombre"
                value={profileForm.full_name}
                onChange={(e) => setProfileForm({ ...profileForm, full_name: e.target.value })}
              />
            </div>

            <Button type="submit" disabled={savingProfile}>
              {savingProfile ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-1" />Guardando...</>
              ) : (
                <><Save className="h-4 w-4 mr-1" />Guardar cambios</>
              )}
            </Button>
          </form>
        </Card>

        <Card className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <Building2 className="h-5 w-5 text-indigo-500" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Empresa</h2>
            {tenant && (
              <span className="ml-auto text-xs text-gray-400 font-mono">{tenant.slug}</span>
            )}
          </div>

          <form onSubmit={handleSaveTenant} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                Nombre de la empresa
              </label>
              <Input
                type="text"
                required
                placeholder="Nombre de tu empresa"
                value={tenantForm.name}
                onChange={(e) => setTenantForm({ ...tenantForm, name: e.target.value })}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                Descripción
              </label>
              <textarea
                className="flex w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                rows={3}
                placeholder="Breve descripción de tu negocio"
                value={tenantForm.description}
                onChange={(e) => setTenantForm({ ...tenantForm, description: e.target.value })}
              />
            </div>

            <Button type="submit" disabled={savingTenant}>
              {savingTenant ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-1" />Guardando...</>
              ) : (
                <><Save className="h-4 w-4 mr-1" />Guardar cambios</>
              )}
            </Button>
          </form>
        </Card>
      </div>

      <Card className="p-6 max-w-lg">
        <div className="flex items-center gap-2 mb-4">
          <KeyRound className="h-5 w-5 text-amber-500" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Cambiar contraseña</h2>
        </div>

        <form onSubmit={handleChangePassword} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
              Nueva contraseña
            </label>
            <Input
              type="password"
              required
              minLength={6}
              placeholder="Mínimo 6 caracteres"
              value={passwordForm.newPassword}
              onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
              Confirmar contraseña
            </label>
            <Input
              type="password"
              required
              minLength={6}
              placeholder="Repite la contraseña"
              value={passwordForm.confirmPassword}
              onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
            />
          </div>

          <Button type="submit" disabled={savingPassword}>
            {savingPassword ? (
              <><Loader2 className="h-4 w-4 animate-spin mr-1" />Actualizando...</>
            ) : (
              <><KeyRound className="h-4 w-4 mr-1" />Actualizar contraseña</>
            )}
          </Button>
        </form>
      </Card>
      <BiometricSettings />
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <Users className="h-5 w-5 text-green-500" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Colaboradores</h2>
          {tenant && (
            <span className="ml-auto text-xs text-gray-400">{loadingCollaborators ? '...' : `${collaborators.length} miembro${collaborators.length !== 1 ? 's' : ''}`}</span>
          )}
        </div>

        {loadingCollaborators ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : (
          <div className="space-y-3">
            {collaborators.map((c: any) => (
              <div
                key={c.id}
                className="flex items-center justify-between p-3 rounded-lg border border-gray-200 dark:border-gray-700"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-9 w-9 rounded-full bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center text-sm font-medium text-indigo-600 dark:text-indigo-300 flex-shrink-0">
                    {(c.full_name || c.email || '?').charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                      {c.full_name || 'Sin nombre'}
                    </p>
                    <p className="text-xs text-gray-500 truncate">{c.email}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  {c.role === 'owner' ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 px-2 py-1 rounded-full">
                      <ShieldCheck className="h-3 w-3" />
                      Propietario
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded-full">
                      <Shield className="h-3 w-3" />
                      {c.role === 'manager' ? 'Manager' : 'Miembro'}
                    </span>
                  )}

                  {isOwner && c.role !== 'owner' && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleRemove(c.id)}
                      disabled={removingId === c.id}
                      className="border-transparent text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20"
                    >
                      {removingId === c.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <X className="h-4 w-4" />
                      )}
                    </Button>
                  )}
                </div>
              </div>
            ))}

            {collaborators.length === 0 && (
              <p className="text-sm text-gray-500 text-center py-4">
                No hay colaboradores
              </p>
            )}
          </div>
        )}

        {pendingInvitations.length > 0 && (
          <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
            <p className="text-xs font-semibold text-amber-600 uppercase tracking-wider mb-2 flex items-center gap-1">
              <Mail className="h-3 w-3" />
              Invitaciones pendientes
            </p>
            <div className="space-y-2">
              {pendingInvitations.map((inv: any, idx: number) => (
                <div key={inv.id || idx} className="flex items-center justify-between p-2 rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="h-8 w-8 rounded-full bg-amber-200 dark:bg-amber-800 flex items-center justify-center text-sm font-medium text-amber-700 dark:text-amber-300 flex-shrink-0">
                      {(inv.email || '?').charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm text-amber-800 dark:text-amber-200 truncate">{inv.email}</p>
                      <p className="text-xs text-amber-600 dark:text-amber-400">
                        Pendiente — {inv.role === 'manager' ? 'Manager' : 'Miembro'}
                      </p>
                    </div>
                  </div>
                  <span className="text-xs text-amber-500 italic">Esperando registro</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {isOwner && (
          <form onSubmit={handleInvite} className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Invitar colaborador
            </p>
            <div className="flex gap-2">
              <div className="flex-1">
                <Input
                  type="text"
                  placeholder="Nombre"
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                />
              </div>
              <div className="flex-1">
                <Input
                  type="email"
                  required
                  placeholder="Email del usuario"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                />
              </div>
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value)}
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
              >
                <option value="member">Miembro</option>
                <option value="manager">Manager</option>
              </select>
              <Button type="submit" disabled={inviting}>
                {inviting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Mail className="h-4 w-4" />
                )}
              </Button>
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}
