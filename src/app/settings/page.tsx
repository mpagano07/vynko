'use client';

import { useState, useCallback, useEffect, Suspense } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { authFetch } from '@/lib/fetchWithTenant';
import { Button } from '@/components/ui/button';
import { ShortLabel } from '@/components/ui/short-label';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Tabs, TabPanel } from '@/components/ui/tabs';
import { EditCollaboratorModal } from '@/components/ui/edit-collaborator-modal';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { Settings, User, Building2, Loader2, Save, KeyRound, Users, Mail, X, Shield, ShieldCheck, FileText, MapPin, Palette, ListChecks, Percent, Ticket, Pencil, HelpCircle, RefreshCw, Search, Trash2, UserCheck, UserX, Crown, Clock } from 'lucide-react';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { Select } from '@/components/ui/select';
import { FormLabel } from '@/components/ui/form-label';
import { StatusBadge } from '@/components/ui/status-badge';
import { PageHeader } from '@/components/ui/page-header';
import { validatePassword, PASSWORD_MIN_LENGTH } from '@/lib/password-policy';
import toast from 'react-hot-toast';
import {
  PAYMENT_METHODS,
  DEFAULT_CHECKOUT_SETTINGS,
  normalizeCheckoutSettings,
  type PaymentAdjustments,
} from '@/lib/payment-methods';
import { canUseFacturacion } from '@/lib/arca/access';
import {
  ROLE_DESCRIPTIONS,
  ROLE_HELP_TEXT,
  ROLE_OPTIONS,
  assignableRolesFor,
  canAssignRole,
  canManageCollaboratorRole,
  getRoleLabel,
  hasCapability,
  highestRole,
  type TenantRole,
} from '@/lib/roles';
import { ArcaConfigCard } from '@/components/settings/ArcaConfigCard';
import { AccountDangerZone } from '@/components/settings/AccountDangerZone';
import { GoogleDriveConnectionCard } from '@/components/settings/GoogleDriveConnectionCard';

interface CollaboratorMembership {
  id: string;
  tenant_id: string;
  tenant_name: string;
  role: string;
  status?: string;
  joined_at?: string | null;
}

interface Collaborator {
  user_id: string;
  full_name?: string;
  email: string;
  role: TenantRole;
  active?: boolean;
  tenants?: { id: string; name: string }[];
  tenant_users_ids?: string[];
  memberships?: CollaboratorMembership[];
  joined_at?: string | null;
}

interface PendingInvitation {
  id?: string;
  email: string;
  role: string;
  created_at?: string | null;
  expires_at?: string | null;
  expired?: boolean;
  invited_by_name?: string | null;
  tenant_id?: string;
  tenant_name?: string;
}

/**
 * Acción destructiva o sensible que espera confirmación. Guardar el callback
 * en el estado permite usar el mismo `ConfirmModal` para revocar, quitar,
 * desactivar y transferir sin abrir diálogos nativos del navegador.
 */
interface PendingConfirmation {
  title: string;
  message: string;
  confirmLabel: string;
  confirmLabelShort?: string;
  variant?: 'danger' | 'default';
  action: () => Promise<void> | void;
}

function capitalizeWords(value: string): string {
  return value.replace(/(^|\s)(\p{L})/gu, (_, pre: string, ch: string) => pre + ch.toUpperCase());
}

/**
 * Color por rol para los chips de sucursal y el badge principal. Mantiene
 * legible de un vistazo quién vende, quién administra y quién solo consulta.
 */
const ROLE_CHIP_CLASSES: Record<TenantRole, string> = {
  owner: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  manager: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
  cashier: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  stock: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300',
  viewer: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  member: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
};

function roleChipClass(role: string): string {
  return role in ROLE_CHIP_CLASSES
    ? ROLE_CHIP_CLASSES[role as TenantRole]
    : ROLE_CHIP_CLASSES.member;
}

const ROLE_BADGE_TONES: Record<TenantRole, 'amberSoft' | 'indigo' | 'emerald' | 'blue' | 'grayMuted'> = {
  owner: 'amberSoft',
  manager: 'indigo',
  cashier: 'emerald',
  stock: 'blue',
  viewer: 'grayMuted',
  member: 'grayMuted',
};

function roleBadgeTone(role: TenantRole) {
  return ROLE_BADGE_TONES[role] ?? 'grayMuted';
}

function formatCuit(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 10) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
  return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`;
}

function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 12);
  if (digits.length <= 2) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
  return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6)}`;
}

const validTabs = ['perfil', 'empresa', 'facturacion', 'colaboradores', 'preferencias', 'cuenta'];

/**
 * Pestañas que dependen de un permiso. Mi Perfil, Preferencias y Mi Cuenta son
 * de autoservicio: las ve cualquier rol, incluso un cajero o un consulta.
 */
function canAccessTab(tab: string, canManageTenant: boolean, canFacturacion: boolean): boolean {
  if (tab === 'empresa' || tab === 'colaboradores') return canManageTenant;
  if (tab === 'facturacion') return canFacturacion;
  return true;
}

function formatShortDate(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
        </div>
      }
    >
      <SettingsContent />
    </Suspense>
  );
}

function SettingsContent() {
  const { user, profile, tenant, tenants, role, loading: authLoading, logout, loadProfileAndTenant } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedTab = searchParams?.get('tab');
  // La pestaña de Facturación ARCA es una feature en pruebas: por ahora sólo la
  // ve la cuenta admin (además de la visibilidad en el sidebar).
  const canFacturacion = canUseFacturacion(profile, tenant);
  // Empresa, facturación y colaboradores son de administración. El resto de las
  // pestañas (perfil, preferencias y cuenta) son de autoservicio para cualquier
  // rol: un cajero también necesita cambiar su nombre y su contraseña.
  const canManageTenant = hasCapability(role, 'manage_tenant');

  const initialTab =
    requestedTab && (validTabs.includes(requestedTab) || requestedTab === 'arca')
      ? (requestedTab === 'arca' ? 'facturacion' : requestedTab)
      : 'perfil';

  const [activeTab, setActiveTab] = useState(initialTab);

  useEffect(() => {
    if (!requestedTab || authLoading) return;
    const normalized = requestedTab === 'arca' ? 'facturacion' : requestedTab;
    if (!validTabs.includes(normalized)) return;
    // Una pestaña sin permiso cae en Mi Perfil en vez de dejar un panel vacío.
    if (!canAccessTab(normalized, canManageTenant, canFacturacion)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveTab('perfil');
      return;
    }
    setActiveTab(normalized);
  }, [requestedTab, authLoading, canManageTenant, canFacturacion]);

  const [profileForm, setProfileForm] = useState({ full_name: '' });
  const [profileSynced, setProfileSynced] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  const [tenantForm, setTenantForm] = useState({
    company_name: '',
    description: '',
    razon_social: '',
    cuit: '',
    punto_venta: 1,
    iva_condition: 'responsable_inscripto',
    ingresos_brutos: '',
    inicio_actividades: '',
    business_address: '',
    business_city: '',
    business_province: '',
    business_zip: '',
    business_phone: '',
    business_email: '',
  });
  const [tenantSynced, setTenantSynced] = useState(false);
  const [savingTenant, setSavingTenant] = useState(false);

  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [savingPassword, setSavingPassword] = useState(false);

  const [checkoutForm, setCheckoutForm] = useState<PaymentAdjustments>(
    DEFAULT_CHECKOUT_SETTINGS.payment_adjustments
  );
  const [checkoutPaperSize, setCheckoutPaperSize] = useState<'58mm' | '80mm'>('58mm');
  const [checkoutShowReceipt, setCheckoutShowReceipt] = useState(true);
  const [checkoutSynced, setCheckoutSynced] = useState(false);
  const [savingCheckout, setSavingCheckout] = useState(false);
  const [savingTicket, setSavingTicket] = useState(false);
  const [canEditCheckout, setCanEditCheckout] = useState(false);

  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [pendingInvitations, setPendingInvitations] = useState<PendingInvitation[]>([]);
  const [loadingCollaborators, setLoadingCollaborators] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [inviteName, setInviteName] = useState('');
  const [inviting, setInviting] = useState(false);
  const [resendingInvite, setResendingInvite] = useState<string | null>(null);
  const [revokingInvite, setRevokingInvite] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removingBranchId, setRemovingBranchId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [transferringId, setTransferringId] = useState<string | null>(null);
  const [selectedTenantIds, setSelectedTenantIds] = useState<string[]>([]);
  const [editingCollab, setEditingCollab] = useState<Collaborator | null>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [collabSearch, setCollabSearch] = useState('');
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(null);
  const [confirming, setConfirming] = useState(false);

  const reloadCollaborators = useCallback(async () => {
    try {
      const res = await authFetch('/api/settings/collaborators');
      const data = await res.json();
      if (res.ok) {
        setCollaborators(data.collaborators || []);
        setPendingInvitations(data.pendingInvitations || []);
      }
    } catch {
      toast.error('Error al cargar los colaboradores');
    }
  }, []);

  const requestConfirmation = useCallback((next: PendingConfirmation) => {
    setConfirmation(next);
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!confirmation) return;
    setConfirming(true);
    try {
      await confirmation.action();
    } finally {
      setConfirming(false);
      setConfirmation(null);
    }
  }, [confirmation]);

  const currentUserId = user?.id;
  const currentUserCollab = collaborators.find((c) => c.user_id === currentUserId);
  // El rol "de equipo" es el más alto del actor en todas las sucursales que
  // administra; para las acciones puntuales manda el rol de esa sucursal.
  const teamRole = currentUserCollab?.role ?? role;

  const myRoleByTenant = new Map(
    (currentUserCollab?.memberships ?? []).map((m) => [m.tenant_id, m.role])
  );
  // `listCollaborators` ya viene filtrado al alcance del actor, así que sus
  // membresías son exactamente las sucursales que puede administrar.
  const managedTenantIds = new Set(
    collaborators.flatMap((c) => (c.memberships ?? []).map((m) => m.tenant_id))
  );
  const manageableTenants = canManageTenant
    ? tenants.filter((t) => managedTenantIds.has(t.id))
    : [];
  const manageableIdsKey = manageableTenants.map((t) => t.id).join(',');

  const assignableForMe = assignableRolesFor(teamRole);
  const roleOptions = ROLE_OPTIONS.filter((option) => assignableForMe.includes(option.value));

  const canInvite = tenant?.subscription_plan === 'business' || tenant?.subscription_plan === 'enterprise';

  // Las sucursales arrancan desmarcadas a propósito: invitar es otorgar acceso
  // y una lista preseleccionada convierte "enviar" en "enviar a todas" sin que
  // nadie lo haya decidido. La selección tiene que ser explícita.

  const normalizedSearch = collabSearch.trim().toLowerCase();
  const filteredCollaborators = normalizedSearch
    ? collaborators.filter((c) => {
        const haystack = [
          c.full_name || '',
          c.email || '',
          c.role || '',
          ...(c.memberships || []).flatMap((m) => [m.tenant_name, m.role]),
          ...(c.tenants || []).map((t) => t.name),
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(normalizedSearch);
      })
    : collaborators;

  useEffect(() => {
    if (profile && !profileSynced) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProfileForm({ full_name: profile.full_name || '' });
      setProfileSynced(true);
    }
  }, [profile, profileSynced]);

  useEffect(() => {
    if (tenant && !tenantSynced) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTenantForm({
        company_name: tenant.company_name || tenant.name || '',
        description: tenant.description || '',
        razon_social: tenant.razon_social || '',
        cuit: tenant.cuit || '',
        punto_venta: tenant.punto_venta || 1,
        iva_condition: tenant.iva_condition || 'responsable_inscripto',
        ingresos_brutos: tenant.ingresos_brutos || '',
        inicio_actividades: tenant.inicio_actividades || '',
        business_address: tenant.business_address || '',
        business_city: tenant.business_city || '',
        business_province: tenant.business_province || '',
        business_zip: tenant.business_zip || '',
        business_phone: tenant.business_phone || '',
        business_email: tenant.business_email || '',
      });
      setTenantSynced(true);
    }
  }, [tenant, tenantSynced]);

  useEffect(() => {
    if (authLoading) return;
    if (!canManageTenant) {
      // Un rol operativo no puede ver el equipo: no se pide una API que
      // devolvería 403 ni se deja el spinner encendido.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoadingCollaborators(false);
      return;
    }
    reloadCollaborators().finally(() => setLoadingCollaborators(false));
  }, [authLoading, canManageTenant, reloadCollaborators]);

  useEffect(() => {
    if (!canManageTenant || !tenant || checkoutSynced) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch('/api/settings/checkout');
        const data = await res.json();
        if (!res.ok || cancelled) return;
        const settings = normalizeCheckoutSettings(data.settings);
        setCheckoutForm(settings.payment_adjustments);
        setCheckoutPaperSize(settings.paper_size);
        setCheckoutShowReceipt(settings.show_receipt);
        setCanEditCheckout(data.canEdit === true);
      } catch {
        // silent
      } finally {
        if (!cancelled) setCheckoutSynced(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenant, checkoutSynced, canManageTenant]);

  const saveCheckoutConfig = useCallback(async () => {
    const res = await authFetch('/api/settings/checkout', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        payment_adjustments: checkoutForm,
        paper_size: checkoutPaperSize,
        show_receipt: checkoutShowReceipt,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Error al guardar la configuración');
    }
  }, [checkoutForm, checkoutPaperSize, checkoutShowReceipt]);

  const handleSaveCheckout = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEditCheckout) return;
    setSavingCheckout(true);
    try {
      await saveCheckoutConfig();
      toast.success('Ajustes por medio de pago guardados');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar la configuración');
    } finally {
      setSavingCheckout(false);
    }
  }, [canEditCheckout, saveCheckoutConfig]);

  const handleSaveTicket = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEditCheckout) return;
    setSavingTicket(true);
    try {
      await saveCheckoutConfig();
      toast.success('Configuración de ticket guardada');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar la configuración');
    } finally {
      setSavingTicket(false);
    }
  }, [canEditCheckout, saveCheckoutConfig]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;

    const availableTenantIds = manageableIdsKey ? manageableIdsKey.split(',') : [];
    // Sin sucursal elegida no se manda nada: antes una lista vacía se
    // interpretaba como "todas" y la invitación salía a cada sucursal.
    const targetTenantIds = selectedTenantIds.filter((id) => availableTenantIds.includes(id));
    if (targetTenantIds.length === 0) {
      toast.error('Elegí al menos una sucursal para enviar la invitación');
      return;
    }

    setInviting(true);
    try {
      const res = await authFetch('/api/settings/collaborators', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: inviteEmail.trim(),
          role: inviteRole,
          full_name: inviteName.trim() || null,
          tenant_ids: targetTenantIds,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Error al invitar');
        return;
      }

      if (data.invited) {
        toast.success(data.message || 'Invitación enviada');
      } else {
        toast.success('Colaborador agregado');
      }
      // Se recarga la lista en vez de insertar una copia optimista: el backend
      // devuelve el colaborador ya agrupado por usuario y las invitaciones con
      // su id real. Antes se hacía un append local que duplicaba la fila (misma
      // `user_id` => misma key de React) cuando el email ya era miembro, y las
      // invitaciones quedaban con ids sintéticos que no se podían revocar.
      await reloadCollaborators();
      setInviteEmail('');
      setInviteName('');
      // La próxima invitación vuelve a empezar sin sucursales marcadas.
      setSelectedTenantIds([]);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error al invitar');
    } finally {
      setInviting(false);
    }
  };

  const handleResendInvite = useCallback(async (inv: PendingInvitation) => {
    setResendingInvite(inv.id || inv.email);
    try {
      const res = await authFetch('/api/settings/collaborators', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: inv.email,
          role: inv.role,
          full_name: null,
          // Reenvía solo la sucursal de esta invitación. Antes mandaba `[]`,
          // que el backend interpretaba como "todas las sucursales".
          tenant_ids: inv.tenant_id ? [inv.tenant_id] : [],
          // Un reenvío explícito saltea el enfriamiento entre invitaciones
          // iguales; si no, el botón devolvía 409 durante 10 minutos.
          resend: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Error al reenviar la invitación');
        return;
      }
      const now = new Date().toISOString();
      setPendingInvitations((prev) => prev.map((item) =>
        item.email === inv.email && item.tenant_id === inv.tenant_id
          ? { ...item, created_at: now, expired: false }
          : item
      ));
      toast.success('Invitación reenviada por email');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error al reenviar la invitación');
    } finally {
      setResendingInvite(null);
    }
  }, []);

  const revokeInvite = useCallback(async (inv: PendingInvitation) => {
    const invitationId = inv.id!;
    setRevokingInvite(invitationId);
    try {
      const res = await authFetch(`/api/settings/invitations/${invitationId}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || 'Error al revocar la invitación');
        return;
      }
      toast.success('Invitación revocada');
      setPendingInvitations((prev) => prev.filter((i) => i.id !== invitationId));
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error al revocar la invitación');
    } finally {
      setRevokingInvite(null);
    }
  }, []);

  const handleRevokeInvite = useCallback((inv: PendingInvitation) => {
    if (!inv.id || inv.id.startsWith('pending-')) {
      toast.error('Recargá la página para revocar esta invitación');
      return;
    }
    requestConfirmation({
      title: 'Revocar invitación',
      message: `¿Revocar la invitación a ${inv.email}${inv.tenant_name ? ` en ${inv.tenant_name}` : ''}? El email ya no va a poder usarse para entrar.`,
      confirmLabel: 'Revocar',
      variant: 'danger',
      action: () => revokeInvite(inv),
    });
  }, [requestConfirmation, revokeInvite]);

  const removeFromTeam = useCallback(async (collab: Collaborator) => {
    setRemovingId(collab.user_id);
    try {
      const res = await authFetch(`/api/settings/collaborators/${collab.user_id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || 'Error al eliminar');
        return;
      }

      toast.success('Colaborador eliminado');
      setCollaborators((prev) => prev.filter((c) => c.user_id !== collab.user_id));
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error al eliminar');
    } finally {
      setRemovingId(null);
    }
  }, []);

  const handleRemoveFromTeam = useCallback((collab: Collaborator) => {
    requestConfirmation({
      title: 'Eliminar del equipo',
      message: `¿Eliminar a ${collab.full_name || collab.email} de todo el equipo? Pierde sus membresías en todas las sucursales.`,
      confirmLabel: 'Eliminar',
      variant: 'danger',
      action: () => removeFromTeam(collab),
    });
  }, [requestConfirmation, removeFromTeam]);

  const removeFromBranch = useCallback(async (collab: Collaborator, tenantId: string) => {
    setRemovingBranchId(`${collab.user_id}:${tenantId}`);
    try {
      const res = await authFetch(
        `/api/settings/collaborators/${collab.user_id}?tenant_id=${encodeURIComponent(tenantId)}`,
        { method: 'DELETE' }
      );

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || 'Error al quitar de la sucursal');
        return;
      }

      toast.success('Colaborador quitado de la sucursal');
      setCollaborators((prev) => prev
        .map((c) => {
          if (c.user_id !== collab.user_id) return c;
          const memberships = (c.memberships || []).filter((m) => m.tenant_id !== tenantId);
          const tenantList = (c.tenants || []).filter((t) => t.id !== tenantId);
          return { ...c, memberships, tenants: tenantList, tenant_users_ids: memberships.map((m) => m.id) };
        })
        .filter((c) => c.user_id !== collab.user_id || (c.memberships?.length ?? c.tenants?.length ?? 0) > 0)
      );
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error al quitar de la sucursal');
    } finally {
      setRemovingBranchId(null);
    }
  }, []);

  const handleRemoveFromBranch = useCallback((collab: Collaborator, tenantId: string, tenantName: string) => {
    requestConfirmation({
      title: 'Quitar de la sucursal',
      message: `¿Quitar a ${collab.full_name || collab.email} de ${tenantName}?`,
      confirmLabel: 'Quitar',
      variant: 'danger',
      action: () => removeFromBranch(collab, tenantId),
    });
  }, [requestConfirmation, removeFromBranch]);

  const toggleActive = useCallback(async (collab: Collaborator) => {
    const nextActive = collab.active === false;
    const action = nextActive ? 'reactivar' : 'desactivar';
    setTogglingId(collab.user_id);
    try {
      const res = await authFetch(`/api/settings/collaborators/${collab.user_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextActive ? 'active' : 'inactive' }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || `Error al ${action}`);
        return;
      }
      toast.success(nextActive ? 'Colaborador reactivado' : 'Colaborador desactivado');
      setCollaborators((prev) => prev.map((c) => c.user_id === collab.user_id
        ? {
            ...c,
            active: nextActive,
            memberships: (c.memberships || []).map((m) => ({
              ...m,
              status: nextActive ? 'active' : 'inactive',
            })),
          }
        : c));
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : `Error al ${action}`);
    } finally {
      setTogglingId(null);
    }
  }, []);

  const handleToggleActive = useCallback((collab: Collaborator) => {
    const nextActive = collab.active === false;
    requestConfirmation({
      title: nextActive ? 'Reactivar colaborador' : 'Desactivar colaborador',
      message: nextActive
        ? `¿Reactivar a ${collab.full_name || collab.email}? Vuelve a tener acceso con su rol actual.`
        : `¿Desactivar a ${collab.full_name || collab.email}? Conserva el historial y podés reactivarlo después.`,
      confirmLabel: nextActive ? 'Reactivar' : 'Desactivar',
      confirmLabelShort: nextActive ? 'Reactivar' : 'Desactivar',
      variant: nextActive ? 'default' : 'danger',
      action: () => toggleActive(collab),
    });
  }, [requestConfirmation, toggleActive]);

  const transferOwnership = useCallback(async (
    collab: Collaborator,
    tenantId: string,
    tenantName: string
  ) => {
    setTransferringId(`${collab.user_id}:${tenantId}`);
    try {
      const res = await authFetch(
        `/api/settings/collaborators/${collab.user_id}/transfer-ownership`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenant_id: tenantId }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Error al transferir la propiedad');
        return;
      }
      toast.success(`Propiedad de ${tenantName} transferida`);
      await reloadCollaborators();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error al transferir la propiedad');
    } finally {
      setTransferringId(null);
    }
  }, [reloadCollaborators]);

  const handleTransferOwnership = useCallback((
    collab: Collaborator,
    tenantId: string,
    tenantName: string
  ) => {
    requestConfirmation({
      title: 'Transferir propiedad',
      message: `¿Transferir la propiedad de ${tenantName} a ${collab.full_name || collab.email}? Vas a quedar como Manager de esa sucursal y dejás de ser propietario.`,
      confirmLabel: 'Transferir propiedad',
      confirmLabelShort: 'Transferir',
      variant: 'danger',
      action: () => transferOwnership(collab, tenantId, tenantName),
    });
  }, [requestConfirmation, transferOwnership]);

  const handleSaveProfile = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profileForm.full_name.trim()) {
      toast.error('El nombre es requerido');
      return;
    }

    setSavingProfile(true);
    try {
      const res = await authFetch('/api/settings/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
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

    setSavingTenant(true);
    try {
      const res = await authFetch('/api/settings/tenant', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_name: tenantForm.company_name.trim() || null,
          description: tenantForm.description,
          razon_social: tenantForm.razon_social.trim() || null,
          cuit: tenantForm.cuit.trim() || null,
          punto_venta: Number(tenantForm.punto_venta) || 1,
          iva_condition: tenantForm.iva_condition,
          ingresos_brutos: tenantForm.ingresos_brutos.trim() || null,
          inicio_actividades: tenantForm.inicio_actividades || null,
          business_address: tenantForm.business_address.trim() || null,
          business_city: tenantForm.business_city.trim() || null,
          business_province: tenantForm.business_province,
          business_zip: tenantForm.business_zip.trim() || null,
          business_phone: tenantForm.business_phone.trim() || null,
          business_email: tenantForm.business_email.trim() || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al guardar');

      // Refrescar el tenant del contexto para que las demás vistas (facturación,
      // ventas, documentos) tomen la nueva condición de IVA y datos fiscales sin
      // necesidad de recargar la página.
      await loadProfileAndTenant();
      toast.success('Empresa actualizada');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar');
    } finally {
      setSavingTenant(false);
    }
  }, [tenantForm, loadProfileAndTenant]);

  const handleChangePassword = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      toast.error('Las contraseñas no coinciden');
      return;
    }

    const check = validatePassword(passwordForm.newPassword, { email: user?.email });
    if (!check.ok) {
      toast.error(check.error);
      return;
    }

    setSavingPassword(true);
    try {
      // Un solo pedido con las dos contrasenas. Antes eran dos: un `verify` con
      // la actual y un `change` aparte, y como eran independientes el `verify`
      // no ataba a nada (alcanzaba con no mandarlo). El servidor ahora exige la
      // actual en la misma operacion que aplica la nueva.
      const res = await fetch('/api/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: passwordForm.currentPassword,
          newPassword: passwordForm.newPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Error al actualizar contraseña');

      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });

      // El cambio revoca todas las sesiones, incluida esta. Hay que sacar al
      // usuario al login en vez de dejarlo en una pantalla que ya no tiene
      // sesion y que va a fallar en cada pedido.
      toast.success('Contraseña actualizada. Volvé a iniciar sesión.');
      await logout();
      router.push('/login');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error al actualizar contraseña');
    } finally {
      setSavingPassword(false);
    }
  }, [passwordForm, user?.email, logout, router]);

  const handleUpdateCollab = useCallback(async (
    collab: Collaborator,
    payload: {
      memberships: { tenant_id: string; role: string }[];
      full_name?: string | null;
    }
  ) => {
    try {
      const res = await authFetch(`/api/settings/collaborators/${collab.user_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Error al actualizar');
        return;
      }

      toast.success('Colaborador actualizado');
      const allTenants = tenants.map(t => ({ id: t.id, name: t.name }));
      setCollaborators((prev) => prev.map((c) => {
        if (c.user_id !== collab.user_id) return c;
        const currentMemberships = c.memberships || [];
        const nextMemberships: CollaboratorMembership[] = payload.memberships.flatMap(({ tenant_id, role }) => {
          const tenant = allTenants.find((t) => t.id === tenant_id);
          if (!tenant) return [];
          const existing = currentMemberships.find((m) => m.tenant_id === tenant_id);
          return [{
            id: existing?.id || `pending-${tenant_id}`,
            tenant_id,
            tenant_name: tenant.name,
            role,
            joined_at: existing?.joined_at ?? null,
          }];
        });
        return {
          ...c,
          role: highestRole(nextMemberships.map((m) => m.role)),
          // Si el nombre vino vacío, se conserva el actual: el backend tampoco
          // lo borra, así que la fila no debe mostrar algo distinto.
          full_name: payload.full_name?.trim() || c.full_name,
          tenants: allTenants.filter(t => payload.memberships.some((m) => m.tenant_id === t.id)),
          memberships: nextMemberships,
          tenant_users_ids: nextMemberships.map((m) => m.id),
        };
      }));
      setEditModalOpen(false);
      setEditingCollab(null);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error al actualizar');
    }
  }, [tenants]);

  const tabs = [
    { id: 'perfil', label: 'Mi Perfil', icon: <User className="h-4 w-4" /> },
    ...(canManageTenant
      ? [{ id: 'empresa', label: 'Datos de Empresa', icon: <Building2 className="h-4 w-4" /> }]
      : []),
    ...(canFacturacion
      ? [{ id: 'facturacion', label: 'Facturación ARCA', icon: <FileText className="h-4 w-4" /> }]
      : []),
    ...(canManageTenant
      ? [{ id: 'colaboradores', label: 'Colaboradores', icon: <Users className="h-4 w-4" /> }]
      : []),
    { id: 'preferencias', label: 'Preferencias', icon: <Ticket className="h-4 w-4" /> },
    { id: 'cuenta', label: 'Mi Cuenta', icon: <Shield className="h-4 w-4" /> },
  ];

  if (authLoading) return null;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Settings className="h-8 w-8 text-gray-600 dark:text-gray-400" />}
        title="Configuración"
        subtitle="Administra tu perfil, tus preferencias y los datos de tu empresa."
      />

      <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

      <TabPanel id="perfil" activeTab={activeTab}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
            <div className="space-y-6">
              <Card className="p-6">
                <div className="flex items-center gap-2 mb-4">
                  <User className="h-5 w-5 text-blue-500" />
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Perfil</h2>
                </div>

                <form onSubmit={handleSaveProfile} className="space-y-4">
                  <div>
                    <FormLabel>
                      Email
                    </FormLabel>
                    <Input
                      type="email"
                      value={user?.email || ''}
                      disabled
                      className="bg-gray-50 dark:bg-gray-900/50"
                    />
                    <p className="text-xs text-gray-400 mt-1">El email no se puede modificar</p>
                  </div>

                  <div>
                    <FormLabel>
                      Nombre completo
                    </FormLabel>
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
                      <><Save className="h-4 w-4 mr-1" /><ShortLabel short="Guardar">Guardar cambios</ShortLabel></>
                    )}
                  </Button>
                </form>
              </Card>
            </div>

            <div className="space-y-6">
              <Card className="p-6">
                <div className="flex items-center gap-2 mb-4">
                  <KeyRound className="h-5 w-5 text-amber-500" />
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Cambiar contraseña</h2>
                </div>

                <form onSubmit={handleChangePassword} className="space-y-4">
                  <div>
                    <FormLabel>
                      Contraseña actual
                    </FormLabel>
                    <Input
                      type="password"
                      required
                      placeholder="Tu contraseña actual"
                      value={passwordForm.currentPassword}
                      onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
                    />
                  </div>

                  <div>
                    <FormLabel>
                      Nueva contraseña
                    </FormLabel>
                    <Input
                      type="password"
                      required
                      minLength={PASSWORD_MIN_LENGTH}
                      placeholder={`Mínimo ${PASSWORD_MIN_LENGTH} caracteres`}
                      value={passwordForm.newPassword}
                      onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                    />
                  </div>

                  <div>
                    <FormLabel>
                      Confirmar contraseña
                    </FormLabel>
                    <Input
                      type="password"
                      required
                      minLength={PASSWORD_MIN_LENGTH}
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

                  {/* El aviso va antes del boton y no solo en el toast: el cambio
                      revoca TODAS las sesiones, incluida la de este navegador. Si
                      el usuario tiene otra sesion abierta (el celular, la
                      tablet), se cae ahi tambien y sin aviso. Es lo correcto
                      para un cambio de contraseña pensado para recuperar una
                      cuenta, pero surprising si no se dice antes. */}
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Al cambiarla se cierran todas las sesiones abiertas, en este
                    dispositivo y en cualquier otro donde tengas Vynko abierto.
                  </p>
                </form>
              </Card>
            </div>
          </div>
      </TabPanel>

      <TabPanel id="empresa" activeTab={activeTab}>
        <div className="space-y-6">
          <Card className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <Building2 className="h-5 w-5 text-indigo-500" />
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Empresa</h2>
              {tenant && (
                <span className="ml-auto text-xs text-gray-400 font-mono">{tenant.slug}</span>
              )}
            </div>

            <form onSubmit={handleSaveTenant} className="space-y-4">
              <div className="border-b border-gray-100 dark:border-gray-800 pb-4 mb-4">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Información General</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div>
                    <FormLabel>
                      Nombre de la empresa
                    </FormLabel>
                    <Input
                      type="text"
                      placeholder="Nombre de tu empresa"
                      value={tenantForm.company_name}
                      onChange={(e) => setTenantForm({ ...tenantForm, company_name: e.target.value })}
                    />
                  </div>
                  <div>
                    <FormLabel>
                      Teléfono
                    </FormLabel>
                    <Input
                      type="text"
                      placeholder="11-1234-5678"
                      value={tenantForm.business_phone}
                      onChange={(e) => setTenantForm({ ...tenantForm, business_phone: formatPhone(e.target.value) })}
                    />
                  </div>
                  <div>
                    <FormLabel>
                      Email de contacto
                    </FormLabel>
                    <Input
                      type="email"
                      placeholder="empresa@ejemplo.com"
                      value={tenantForm.business_email}
                      onChange={(e) => setTenantForm({ ...tenantForm, business_email: e.target.value })}
                    />
                  </div>
                </div>
                <div className="mt-4">
                  <FormLabel>
                    Descripción
                  </FormLabel>
                  <textarea
                    className="flex w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                    rows={2}
                    placeholder="Breve descripción de tu negocio"
                    value={tenantForm.description}
                    onChange={(e) => setTenantForm({ ...tenantForm, description: e.target.value })}
                  />
                </div>
              </div>

              <div className="border-b border-gray-100 dark:border-gray-800 pb-4 mb-4">
                <h3 className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                  <FileText className="h-3.5 w-3.5" />
                  Datos de Facturación
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <FormLabel>
                      Razón Social
                    </FormLabel>
                    <Input
                      type="text"
                      placeholder="Razón social (si difiere del nombre)"
                      value={tenantForm.razon_social}
                      onChange={(e) => setTenantForm({ ...tenantForm, razon_social: e.target.value })}
                    />
                  </div>
                  <div>
                    <FormLabel>
                      CUIT
                    </FormLabel>
                    <Input
                      type="text"
                      placeholder="XX-XXXXXXXX-X"
                      value={tenantForm.cuit}
                      onChange={(e) => setTenantForm({ ...tenantForm, cuit: formatCuit(e.target.value) })}
                    />
                  </div>
                  <div>
                    <FormLabel>
                      Condición frente al IVA
                    </FormLabel>
                    <Select
                      value={tenantForm.iva_condition}
                      onChange={(e) => setTenantForm({ ...tenantForm, iva_condition: e.target.value })}
                    >
                      <option value="responsable_inscripto">Responsable Inscripto</option>
                      <option value="monotributista">Monotributista</option>
                      <option value="consumidor_final">Consumidor Final</option>
                      <option value="sujeto_exento">Sujeto Exento</option>
                      <option value="responsable_no_inscripto">Responsable No Inscripto</option>
                    </Select>
                  </div>
                  <div>
                    <FormLabel>
                      Punto de Venta
                    </FormLabel>
                    <Input
                      type="number"
                      min={1}
                      placeholder="1"
                      value={tenantForm.punto_venta}
                      onChange={(e) => setTenantForm({ ...tenantForm, punto_venta: parseInt(e.target.value) || 1 })}
                    />
                    <p className="text-xs text-gray-400 mt-1">Corresponde al punto de venta de esta sucursal</p>
                  </div>
                  <div>
                    <FormLabel>
                      Ingresos Brutos
                    </FormLabel>
                    <Input
                      type="text"
                      placeholder="N° de ingresos brutos"
                      value={tenantForm.ingresos_brutos}
                      onChange={(e) => setTenantForm({ ...tenantForm, ingresos_brutos: e.target.value })}
                    />
                  </div>
                  <div>
                    <FormLabel>
                      Inicio de Actividades
                    </FormLabel>
                    <Input
                      type="date"
                      value={tenantForm.inicio_actividades}
                      onChange={(e) => setTenantForm({ ...tenantForm, inicio_actividades: e.target.value })}
                    />
                  </div>
                </div>
              </div>

              <div className="border-b border-gray-100 dark:border-gray-800 pb-4 mb-4">
                <h3 className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                  <MapPin className="h-3.5 w-3.5" />
                  Domicilio Fiscal
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="md:col-span-3">
                    <FormLabel>
                      Dirección
                    </FormLabel>
                    <Input
                      type="text"
                      placeholder="Calle y número"
                      value={tenantForm.business_address}
                      onChange={(e) => setTenantForm({ ...tenantForm, business_address: capitalizeWords(e.target.value) })}
                    />
                  </div>
                  <div>
                    <FormLabel>
                      Ciudad
                    </FormLabel>
                    <Input
                      type="text"
                      placeholder="Ciudad"
                      value={tenantForm.business_city}
                      onChange={(e) => setTenantForm({ ...tenantForm, business_city: capitalizeWords(e.target.value) })}
                    />
                  </div>
                  <div>
                    <FormLabel>
                      Provincia
                    </FormLabel>
                    <Select
                      value={tenantForm.business_province}
                      onChange={(e) => setTenantForm({ ...tenantForm, business_province: e.target.value })}
                    >
                      <option value="">Seleccionar...</option>
                      <option value="Buenos Aires">Buenos Aires</option>
                      <option value="CABA">CABA</option>
                      <option value="Catamarca">Catamarca</option>
                      <option value="Chaco">Chaco</option>
                      <option value="Chubut">Chubut</option>
                      <option value="Córdoba">Córdoba</option>
                      <option value="Corrientes">Corrientes</option>
                      <option value="Entre Ríos">Entre Ríos</option>
                      <option value="Formosa">Formosa</option>
                      <option value="Jujuy">Jujuy</option>
                      <option value="La Pampa">La Pampa</option>
                      <option value="La Rioja">La Rioja</option>
                      <option value="Mendoza">Mendoza</option>
                      <option value="Misiones">Misiones</option>
                      <option value="Neuquén">Neuquén</option>
                      <option value="Río Negro">Río Negro</option>
                      <option value="Salta">Salta</option>
                      <option value="San Juan">San Juan</option>
                      <option value="San Luis">San Luis</option>
                      <option value="Santa Cruz">Santa Cruz</option>
                      <option value="Santa Fe">Santa Fe</option>
                      <option value="Santiago del Estero">Santiago del Estero</option>
                      <option value="Tierra del Fuego">Tierra del Fuego</option>
                      <option value="Tucumán">Tucumán</option>
                    </Select>
                  </div>
                  <div>
                    <FormLabel>
                      Código Postal
                    </FormLabel>
                    <Input
                      type="text"
                      placeholder="CP"
                      value={tenantForm.business_zip}
                      onChange={(e) => setTenantForm({ ...tenantForm, business_zip: e.target.value })}
                    />
                  </div>
                </div>
              </div>

              <Button type="submit" disabled={savingTenant}>
                {savingTenant ? (
                  <><Loader2 className="h-4 w-4 animate-spin mr-1" />Guardando...</>
                ) : (
                  <><Save className="h-4 w-4 mr-1" /><ShortLabel short="Guardar">Guardar cambios</ShortLabel></>
                )}
              </Button>
            </form>
          </Card>
        </div>
      </TabPanel>

      <TabPanel id="facturacion" activeTab={activeTab}>
        <div className="space-y-6">
          {canFacturacion && <ArcaConfigCard />}
        </div>
      </TabPanel>

      <TabPanel id="colaboradores" activeTab={activeTab}>
        <div className="space-y-6">
          <Card className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <Users className="h-5 w-5 text-green-500" />
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Colaboradores</h2>
              {tenant && (
                <span className="ml-auto text-xs text-gray-400">
                  {loadingCollaborators
                    ? '...'
                    : `${filteredCollaborators.length} miembro${filteredCollaborators.length !== 1 ? 's' : ''}${normalizedSearch ? ` de ${collaborators.length}` : ''}`}
                </span>
              )}
            </div>

            {!loadingCollaborators && collaborators.length > 0 && (
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  type="search"
                  value={collabSearch}
                  onChange={(e) => setCollabSearch(e.target.value)}
                  placeholder="Buscar por nombre, email o sucursal..."
                  className="pl-9"
                  aria-label="Buscar colaboradores"
                />
              </div>
            )}

            {loadingCollaborators ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
              </div>
            ) : (
              <div className="space-y-3">
                {filteredCollaborators.map((c) => (
                  <div
                    key={c.user_id}
                    className="flex items-center justify-between p-3 rounded-lg border border-gray-200 dark:border-gray-700"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="h-9 w-9 rounded-full bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center text-sm font-medium text-indigo-600 dark:text-indigo-300 flex-shrink-0">
                        {(c.full_name || c.email || '?').charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                          {c.full_name || 'Sin nombre'}
                        </p>
                        <p className="text-xs text-gray-500 truncate">{c.email}</p>
                        {formatShortDate(c.joined_at) && (
                          <p className="text-[11px] text-gray-400">
                            En el equipo desde {formatShortDate(c.joined_at)}
                          </p>
                        )}
                        {(c.memberships?.length ?? 0) > 0 ? (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {c.memberships!.map((m) => (
                              <span
                                key={m.id}
                                className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded ${roleChipClass(m.role)} ${m.status === 'inactive' ? 'opacity-50' : ''}`}
                              >
                                {m.tenant_name}
                                <span className="opacity-70">· {getRoleLabel(m.role)}{m.status === 'inactive' ? ' · inactivo' : ''}</span>
                                {canManageCollaboratorRole(myRoleByTenant.get(m.tenant_id) ?? role, m.role) && (
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveFromBranch(c, m.tenant_id, m.tenant_name)}
                                    disabled={removingBranchId === `${c.user_id}:${m.tenant_id}`}
                                    title={`Quitar de ${m.tenant_name}`}
                                    aria-label={`Quitar a ${c.full_name || c.email} de ${m.tenant_name}`}
                                    className="inline-flex items-center justify-center rounded-sm hover:text-red-600 disabled:opacity-50"
                                  >
                                    {removingBranchId === `${c.user_id}:${m.tenant_id}` ? (
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                      <X className="h-3 w-3" />
                                    )}
                                  </button>
                                )}
                                {myRoleByTenant.get(m.tenant_id) === 'owner' && m.role !== 'owner' && (
                                  <button
                                    type="button"
                                    onClick={() => handleTransferOwnership(c, m.tenant_id, m.tenant_name)}
                                    disabled={transferringId === `${c.user_id}:${m.tenant_id}`}
                                    title={`Transferir la propiedad de ${m.tenant_name}`}
                                    aria-label={`Transferir la propiedad de ${m.tenant_name} a ${c.full_name || c.email}`}
                                    className="inline-flex items-center justify-center rounded-sm hover:text-amber-700 disabled:opacity-50"
                                  >
                                    {transferringId === `${c.user_id}:${m.tenant_id}` ? (
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                      <Crown className="h-3 w-3" />
                                    )}
                                  </button>
                                )}
                              </span>
                            ))}
                          </div>
                        ) : (
                          c.tenants && c.tenants.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {c.tenants.map((t) => (
                                <span key={t.id} className="text-[10px] bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded">
                                  {t.name}
                                </span>
                              ))}
                            </div>
                          )
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                      <StatusBadge
                        tone={roleBadgeTone(c.role)}
                        className="py-1"
                        icon={c.role === 'owner' ? <ShieldCheck className="h-3 w-3" /> : <Shield className="h-3 w-3" />}
                      >
                        <span title={ROLE_DESCRIPTIONS[c.role] || undefined}>
                          {getRoleLabel(c.role)}
                        </span>
                      </StatusBadge>

                      {c.active === false && (
                        <StatusBadge tone="grayMuted" className="py-1" icon={<Clock className="h-3 w-3" />}>
                          Inactivo
                        </StatusBadge>
                      )}

                      {canManageCollaboratorRole(teamRole, c.role) && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setEditingCollab(c);
                            setEditModalOpen(true);
                          }}
                          aria-label={`Editar ${c.full_name || c.email}`}
                          title="Editar rol y sucursales"
                          className="text-gray-500 hover:text-indigo-600 hover:border-indigo-400 dark:hover:text-indigo-400"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}

                      {canManageCollaboratorRole(teamRole, c.role) && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleToggleActive(c)}
                          disabled={togglingId === c.user_id}
                          aria-label={`${c.active === false ? 'Reactivar' : 'Desactivar'} a ${c.full_name || c.email}`}
                          title={c.active === false ? 'Reactivar colaborador' : 'Desactivar sin borrar el historial'}
                          className="border-transparent text-gray-500 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                        >
                          {togglingId === c.user_id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : c.active === false ? (
                            <UserCheck className="h-4 w-4" />
                          ) : (
                            <UserX className="h-4 w-4" />
                          )}
                        </Button>
                      )}

                      {canManageCollaboratorRole(teamRole, c.role) && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleRemoveFromTeam(c)}
                          disabled={removingId === c.user_id}
                          aria-label={`Eliminar a ${c.full_name || c.email} del equipo`}
                          title="Eliminar del equipo"
                          className="border-transparent text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20"
                        >
                          {removingId === c.user_id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </Button>
                      )}
                    </div>
                  </div>
                ))}

                {filteredCollaborators.length === 0 && collaborators.length > 0 && (
                  <p className="text-sm text-gray-500 text-center py-6">
                    No hay colaboradores que coincidan con «{collabSearch}».
                  </p>
                )}

                {collaborators.length === 0 && (
                  <EmptyState
                    icon={Users}
                    title="No hay colaboradores"
                    description="Invitá a tu equipo para que trabaje con vos en las sucursales."
                  />
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
                  {pendingInvitations.map((inv) => {
                    const invitedAt = formatShortDate(inv.created_at);
                    const meta = [
                      `${inv.expired ? 'Vencida' : 'Pendiente'} — ${getRoleLabel(inv.role)}`,
                      inv.tenant_name ? `Sucursal ${inv.tenant_name}` : null,
                      invitedAt ? `Invitada el ${invitedAt}` : null,
                      inv.invited_by_name ? `por ${inv.invited_by_name}` : null,
                    ].filter(Boolean).join(' · ');

                    return (
                      <div key={inv.id ?? `${inv.email}:${inv.tenant_id ?? ''}`} className={`flex items-center justify-between gap-3 p-2 rounded-lg border ${inv.expired ? 'bg-gray-50 dark:bg-gray-900/20 border-gray-200 dark:border-gray-700' : 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800'}`}>
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="h-8 w-8 rounded-full bg-amber-200 dark:bg-amber-800 flex items-center justify-center text-sm font-medium text-amber-700 dark:text-amber-300 flex-shrink-0">
                            {(inv.email || '?').charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className={`text-sm truncate ${inv.expired ? 'text-gray-700 dark:text-gray-300' : 'text-amber-800 dark:text-amber-200'}`}>{inv.email}</p>
                            <p className={`text-xs truncate ${inv.expired ? 'text-gray-500 dark:text-gray-400' : 'text-amber-600 dark:text-amber-400'}`}>{meta}</p>
                          </div>
                        </div>
                        {canManageTenant && canAssignRole(teamRole, inv.role) && (
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={resendingInvite === (inv.id || inv.email)}
                              onClick={() => handleResendInvite(inv)}
                            >
                              {resendingInvite === (inv.id || inv.email) ? (
                                <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />Reenviando...</>
                              ) : (
                                <><RefreshCw className="h-3.5 w-3.5 mr-1" />Reenviar</>
                              )}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={revokingInvite === inv.id}
                              onClick={() => handleRevokeInvite(inv)}
                              className="border-transparent text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20"
                            >
                              {revokingInvite === inv.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <><X className="h-3.5 w-3.5 mr-1" />Revocar</>
                              )}
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {canManageTenant && !canInvite && (
              <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 text-sm text-gray-500">
                Tu plan actual (Starter) incluye 1 usuario.{' '}
                <Link href="/billing" className="text-indigo-500 hover:underline">Mejorá tu plan para invitar colaboradores</Link>.
              </div>
            )}

            {canManageTenant && canInvite && (
              <form onSubmit={handleInvite} className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 space-y-4">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Invitar colaborador
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  <div>
                    <FormLabel>
                      Nombre
                    </FormLabel>
                    <Input
                      type="text"
                      placeholder="Nombre"
                      value={inviteName}
                      onChange={(e) => setInviteName(e.target.value)}
                    />
                  </div>
                  <div>
                    <FormLabel>
                      Email
                    </FormLabel>
                    <Input
                      type="email"
                      required
                      placeholder="Email del usuario"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                    />
                  </div>
                  <div>
                    <FormLabel className="flex items-center gap-1">
                      Rol
                      <span
                        className="inline-flex cursor-help text-gray-400"
                        title={ROLE_HELP_TEXT}
                      >
                        <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
                      </span>
                    </FormLabel>
                    <Select
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value)}
                    >
                      {roleOptions.map((option) => (
                        <option key={option.value} value={option.value} title={option.description}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>

                <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-gray-500">
                      Sucursales asignadas
                    </p>
                    <span className="text-[11px] text-gray-400">
                      {selectedTenantIds.length} de {manageableTenants.length}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {manageableTenants.map((t) => {
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
                            onChange={() => {
                              setSelectedTenantIds((prev) =>
                                checked ? prev.filter((id) => id !== t.id) : [...prev, t.id]
                              );
                            }}
                            className="sr-only"
                          />
                          {checked ? '✓' : '○'} {t.name}
                        </label>
                      );
                    })}
                    {manageableTenants.length === 0 && (
                      <p className="text-xs text-gray-400">No hay sucursales disponibles.</p>
                    )}
                  </div>
                  {manageableTenants.length > 0 && selectedTenantIds.length === 0 && (
                    <p className="mt-2 text-xs text-gray-400">
                      Elegí al menos una sucursal. No se envía nada hasta que lo hagas.
                    </p>
                  )}
                </div>

                <Button type="submit" disabled={inviting || selectedTenantIds.length === 0}>
                  {inviting ? (
                    <><Loader2 className="h-4 w-4 animate-spin mr-1" />Enviando...</>
                  ) : (
                    <><Mail className="h-4 w-4 mr-1" />Enviar invitación</>
                  )}
                </Button>
              </form>
            )}
          </Card>
        </div>
      </TabPanel>

      <TabPanel id="preferencias" activeTab={activeTab}>
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
            <Card className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Palette className="h-5 w-5 text-purple-500" />
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100">Tema</span>
                </div>
                <ThemeToggle />
              </div>
            </Card>

            <Card className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ListChecks className="h-5 w-5 text-cyan-500" />
                  <div>
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100">Guía de primeros pasos</span>
                    <p className="text-[11px] text-gray-400">Mostrar la guía de configuración en el panel de control.</p>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!user?.id}
                  onClick={() => {
                    try {
                      localStorage.setItem(`vynko_onboarding_force_show_${user!.id}`, 'true');
                    } catch { /* noop */ }
                    // Se limpia tambien en la cuenta: si solo se tocara el
                    // localStorage, la guia reapareceria en el otro dispositivo.
                    void (async () => {
                      try {
                        await authFetch('/api/onboarding/checklist', {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ dismissed: false }),
                        });
                      } catch { /* la preferencia queda solo en este dispositivo */ }
                    })();
                    toast.success('Guía reactivada. Volvé al dashboard.');
                  }}
                >
                  Mostrar
                </Button>
              </div>
            </Card>
          </div>

          {canManageTenant && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
              <Card className="p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Percent className="h-5 w-5 text-indigo-500" />
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Ajustes por medio de pago</h2>
                  {!canEditCheckout && (
                    <span className="ml-auto text-xs text-gray-400">Solo el propietario o manager puede editar</span>
                  )}
                </div>

                <form onSubmit={handleSaveCheckout} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {PAYMENT_METHODS.filter((m) => m.id !== 'mercadopago').map((method) => {
                      const value = checkoutForm[method.id];
                      return (
                        <div
                          key={method.id}
                          className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2"
                        >
<div className="flex items-center justify-between gap-2">
                          <span className="text-sm text-gray-700 dark:text-gray-300 min-w-0 truncate">{method.label}</span>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <Input
                              type="number"
                              min={-100}
                              max={100}
                              step={0.5}
                              value={value}
                              disabled={!canEditCheckout || savingCheckout}
                              onChange={(e) => {
                                const next = e.target.value === '' ? 0 : Number(e.target.value);
                                setCheckoutForm((prev) => ({
                                  ...prev,
                                  [method.id]: Number.isFinite(next) ? next : 0,
                                }));
                              }}
                              className="w-16 text-right"
                            />
                            <span className="text-xs text-gray-500">%</span>
                          </div>
                        </div>
                          {value > 0 && (
                            <p className="text-[11px] font-medium text-red-500 mt-1">+{value}% Recargo</p>
                          )}
                          {value < 0 && (
                            <p className="text-[11px] font-medium text-green-600 dark:text-green-400 mt-1">{Math.abs(value)}% Descuento</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-xs text-gray-400">
                    Negativo = descuento, positivo = recargo. Se aplican automáticamente al cobrar según el medio utilizado.
                  </p>

                  <Button type="submit" disabled={!canEditCheckout || savingCheckout}>
                    {savingCheckout ? (
                      <><Loader2 className="h-4 w-4 animate-spin mr-1" />Guardando...</>
                    ) : (
                      <><Save className="h-4 w-4 mr-1" /><ShortLabel short="Guardar">Guardar cambios</ShortLabel></>
                    )}
                  </Button>
                </form>
              </Card>

              <Card className="p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Ticket className="h-5 w-5 text-indigo-500" />
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Configuración de ticket</h2>
                </div>

                <form onSubmit={handleSaveTicket} className="space-y-4">
                  <div>
                    <FormLabel className="mb-2">
                      Tamaño de ticket
                    </FormLabel>
                    <Select
                      disabled={!canEditCheckout || savingTicket}
                      value={checkoutPaperSize}
                      onChange={(e) => setCheckoutPaperSize(e.target.value as '58mm' | '80mm')}
                      className="w-full"
                    >
                      <option value="58mm">58mm (térmico)</option>
                      <option value="80mm">80mm</option>
                    </Select>
                  </div>

                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      disabled={!canEditCheckout || savingTicket}
                      checked={checkoutShowReceipt}
                      onChange={(e) => setCheckoutShowReceipt(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">Mostrar ticket al finalizar la venta</span>
                  </label>

                  <Button type="submit" disabled={!canEditCheckout || savingTicket}>
                    {savingTicket ? (
                      <><Loader2 className="h-4 w-4 animate-spin mr-1" />Guardando...</>
                    ) : (
                      <><Save className="h-4 w-4 mr-1" /><ShortLabel short="Guardar">Guardar cambios</ShortLabel></>
                    )}
                  </Button>
                </form>
              </Card>
            </div>
          )}
        </div>
      </TabPanel>

      <TabPanel id="cuenta" activeTab={activeTab}>
        <div className="space-y-6">
          <GoogleDriveConnectionCard />
          <AccountDangerZone />
        </div>
      </TabPanel>

      {confirmation && (
        <ConfirmModal
          open
          title={confirmation.title}
          message={confirmation.message}
          confirmLabel={confirmation.confirmLabel}
          confirmLabelShort={confirmation.confirmLabelShort}
          variant={confirmation.variant}
          loading={confirming}
          onConfirm={handleConfirm}
          onCancel={() => {
            if (!confirming) setConfirmation(null);
          }}
        />
      )}

      <EditCollaboratorModal
        key={editingCollab?.user_id || 'closed'}
        open={editModalOpen}
        fullName={editingCollab?.full_name}
        email={editingCollab?.email || ''}
        role={editingCollab?.role || 'member'}
        tenants={manageableTenants.map((t) => ({ id: t.id, name: t.name }))}
        allowedRoles={assignableForMe}
        memberships={(editingCollab?.memberships || []).map((m) => ({
          tenant_id: m.tenant_id,
          role: m.role,
        }))}
        onCancel={() => {
          setEditModalOpen(false);
          setEditingCollab(null);
        }}
        onSave={(payload) => {
          if (!editingCollab) return Promise.resolve();
          return handleUpdateCollab(editingCollab, payload);
        }}
      />
    </div>
  );
}