'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import type { TenantInfo } from '@/lib/hooks/useAuth';
import { useSidebar } from '@/lib/contexts/sidebar-context';
import { cn } from '@/lib/utils/cn';
import { X, Clock, AlertTriangle, ChevronDown, Settings, Lock, Sparkles, ArrowRight } from 'lucide-react';
import { checkSubscriptionBlocked } from '@/lib/checkSubscription';
import { toast } from 'react-hot-toast';

interface NavItem {
  name: string;
  href: string;
  icon?: React.ReactNode;
  requiredPlan?: string[];
  requiredRole?: string[];
  requiredMultiBranch?: boolean;
  badge?: string;
}

interface FilterResult {
  visible: boolean;
  locked: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const ALL_PLANS = ['starter', 'business', 'enterprise'];

const navGroups: NavGroup[] = [
  {
    label: 'Principal',
    items: [
      { name: 'Dashboard', href: '/dashboard', requiredPlan: ALL_PLANS },
      { name: 'Ventas', href: '/sales', requiredPlan: ALL_PLANS },
      { name: 'Caja', href: '/sales/cash-register', requiredPlan: ALL_PLANS },
    ],
  },
  {
    label: 'Gestión',
    items: [
      { name: 'Productos', href: '/products', requiredPlan: ALL_PLANS },
      { name: 'Proveedores', href: '/providers', requiredPlan: ALL_PLANS },
      { name: 'Clientes', href: '/customers', requiredPlan: ALL_PLANS },
      { name: 'Documentos', href: '/documentos', requiredPlan: ALL_PLANS },

    ],
  },
  {
    label: 'Análisis',
    items: [
      { name: 'Pronóstico', href: '/forecast', requiredPlan: ['business', 'enterprise'], requiredRole: ['owner', 'manager'] },
      { name: 'Antipérdidas', href: '/loss-prevention', requiredPlan: ['business', 'enterprise'] },
      { name: 'Historial', href: '/activity-logs', requiredPlan: ['business', 'enterprise'], requiredRole: ['owner', 'manager'] },
    ],
  },
];

const operacionesItems: NavItem[] = [
  { name: 'QR', href: '/codigos', requiredPlan: ALL_PLANS },
  { name: 'Escáner', href: '/scanning', requiredPlan: ALL_PLANS },
];

const ADMIN_EMAIL = 'matias.pagano07@gmail.com';

const LOCKED_ITEM_DESCRIPTIONS: Record<string, string> = {
  '/forecast': 'Pronóstico de demanda, picos de venta y proyecciones para anticiparte a tu negocio.',
  '/loss-prevention': 'Control de mermas y ajustes de inventario para proteger tu stock.',
  '/activity-logs': 'Historial de actividad completo para auditar la operación de tu equipo.',
};

function LockedNavItem({ item, compact = false, onNavClick }: { item: NavItem; compact?: boolean; onNavClick?: () => void }) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();
  const [tooltip, setTooltip] = useState<{ top: number; left: number } | null>(null);

  const clearTimer = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const hide = useCallback(() => {
    clearTimer();
    setTooltip(null);
  }, [clearTimer]);

  const show = useCallback(() => {
    clearTimer();
    const rect = btnRef.current?.getBoundingClientRect();
    if (!rect) return;
    const top = Math.min(Math.max(rect.top + rect.height / 2, 56), window.innerHeight - 56);
    setTooltip({ top, left: rect.right + 12 });
  }, [clearTimer]);

  const scheduleHide = useCallback(() => {
    clearTimer();
    closeTimer.current = setTimeout(hide, 120);
  }, [clearTimer, hide]);

  useEffect(() => () => clearTimer(), [clearTimer]);

  useEffect(() => {
    if (!tooltip) return;
    const close = () => setTooltip(null);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', close);
    };
  }, [tooltip]);

  return (
    <>
      <button
        ref={btnRef}
        onMouseEnter={show}
        onMouseLeave={scheduleHide}
        onFocus={show}
        onBlur={hide}
        onClick={() => {
          toast('Disponible en el plan Business. Actualizá tu plan para acceder.', { icon: '🔒' });
          onNavClick?.();
          router.push('/billing');
        }}
        className={cn(
          'flex items-center justify-between w-full rounded-md text-sm font-medium text-gray-500 opacity-60 cursor-not-allowed',
          compact ? 'px-3 py-1.5' : 'px-3 py-2'
        )}
      >
        <span>{item.name}</span>
        <Lock className="h-3.5 w-3.5 text-gray-500" />
      </button>
      {tooltip &&
        createPortal(
          <div
            onMouseEnter={show}
            onMouseLeave={hide}
            className="fixed z-[100] -translate-y-1/2"
            style={{ top: tooltip.top, left: tooltip.left }}
          >
            <div className="absolute left-[-5px] top-1/2 h-2 w-2 -translate-y-1/2 rotate-45 border-b border-l border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800" />
            <div className="w-60 rounded-xl border border-amber-300/60 bg-white dark:border-amber-800/40 dark:bg-gray-800 p-3.5 shadow-2xl shadow-black/15 dark:shadow-black/60">
              <div className="flex items-center gap-1.5">
                <Lock className="h-3.5 w-3.5 text-amber-500 dark:text-amber-400" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-300">Business</span>
                <span className="ml-auto flex items-center gap-0.5 text-[9px] font-bold text-amber-500 dark:text-amber-400/90">
                  <Sparkles className="h-3 w-3" />
                  Premium
                </span>
              </div>
              <p className="mt-1.5 text-xs font-bold text-gray-900 dark:text-white">{item.name}</p>
              <p className="mt-1 text-[10px] leading-relaxed text-gray-500 dark:text-gray-400">
                {LOCKED_ITEM_DESCRIPTIONS[item.href] ?? 'Disponible en el plan Business.'}
              </p>
              <button
                onClick={() => router.push('/billing')}
                className="mt-2.5 flex w-full items-center justify-center gap-1 rounded-md bg-amber-500 px-2 py-1.5 text-[11px] font-bold text-black transition-colors hover:bg-amber-400"
              >
                Actualizar plan
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

function SidebarNav({ onNavClick, tenantPlan, userRole, isBlocked, multiBranch, userEmail }: { onNavClick?: () => void; tenantPlan?: string; userRole?: string | null; isBlocked?: boolean; multiBranch?: boolean; userEmail?: string | null }) {
  const pathname = usePathname();
  const [operacionesOpen, setOperacionesOpen] = useState(false);

  const effectivePlan = !tenantPlan || tenantPlan === 'free' ? 'starter' : tenantPlan;

  const filterItem = (item: NavItem): FilterResult => {
    const roleBlocked = item.requiredRole && !item.requiredRole.includes(userRole || '');
    const multiBranchBlocked = item.requiredMultiBranch && !multiBranch;
    const planBlocked = item.requiredPlan && !item.requiredPlan.includes(effectivePlan);

    if (roleBlocked || multiBranchBlocked) return { visible: false, locked: false };
    if (planBlocked) return { visible: true, locked: true };
    return { visible: true, locked: false };
  };

  const visibleOperaciones = operacionesItems.map((item) => ({ item, ...filterItem(item) })).filter((r) => r.visible);
  const isOperacionesActive = visibleOperaciones.some((r) => pathname === r.item.href);

  return (
    <>
      {isBlocked && (
        <div className="mb-3 p-3 rounded-lg bg-red-900/30 border border-red-800/50">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
            <span className="text-xs font-bold text-red-300 uppercase tracking-wider">Suscripción vencida</span>
          </div>
          <p className="text-[10px] text-red-400/80">
            Actualizá tu plan para seguir usando Vynko
          </p>
        </div>
      )}

      {navGroups.map((group) => {
        const visibleItems = group.items.map((item) => ({ item, ...filterItem(item) })).filter((r) => r.visible);
        if (visibleItems.length === 0) return null;
        return (
          <div key={group.label} className="mb-1">
            <p className="px-3 pt-4 pb-1.5 text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest">
              {group.label}
            </p>
            {visibleItems.map(({ item, locked }) =>
              locked ? (
                <LockedNavItem key={item.name} item={item} onNavClick={onNavClick} />
              ) : (
                <Link
                  key={item.name}
                  href={item.href}
                  prefetch={false}
                  onClick={onNavClick}
                  className={cn(
                    'flex items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    pathname === item.href
                      ? 'bg-indigo-50 text-indigo-700 dark:bg-gray-800 dark:text-white font-semibold'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white'
                  )}
                >
                  <span>{item.name}</span>
                  {item.badge && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-900/40 text-amber-400 border border-amber-800/40">
                      {item.badge}
                    </span>
                  )}
                </Link>
              )
            )}
          </div>
        );
      })}

      {userEmail === ADMIN_EMAIL && (
        <div className="mb-1">
          <p className="px-3 pt-4 pb-1.5 text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest">
            Admin
          </p>
          {[{ name: 'Analytics', href: '/admin/analytics' }].map((item) => (
            <Link
              key={item.name}
              href={item.href}
              prefetch={false}
              onClick={onNavClick}
              className={cn(
                'flex items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition-colors',
                pathname === item.href
                  ? 'bg-indigo-50 text-indigo-700 dark:bg-gray-800 dark:text-white font-semibold'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white'
              )}
            >
              <span>{item.name}</span>
            </Link>
          ))}
        </div>
      )}

      {visibleOperaciones.length > 0 && (
        <div className="mb-1">
          <p className="px-3 pt-4 pb-1.5 text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest">
            Operaciones
          </p>
          <button
            onClick={() => setOperacionesOpen(!operacionesOpen)}
            className={cn(
              'flex items-center justify-between w-full rounded-md px-3 py-2 text-sm font-medium transition-colors',
              isOperacionesActive || operacionesOpen
                ? 'bg-indigo-50 text-indigo-700 dark:bg-gray-800 dark:text-white font-semibold'
                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white'
            )}
          >
            <span className="flex items-center gap-2">
              <Settings className="h-4 w-4" />
              Herramientas
            </span>
            <ChevronDown
              className={cn(
                'h-4 w-4 transition-transform duration-200',
                operacionesOpen && 'rotate-180'
              )}
            />
          </button>
          <div
            className={cn(
              'grid transition-all duration-200',
              operacionesOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
            )}
          >
            <div className="overflow-hidden min-h-0">
              <div className="ml-4 mt-1 space-y-1 border-l border-gray-200 dark:border-gray-700 pl-3">
                {visibleOperaciones.map(({ item, locked }) =>
                  locked ? (
                    <LockedNavItem key={item.name} item={item} compact onNavClick={onNavClick} />
                  ) : (
                    <Link
                      key={item.name}
                      href={item.href}
                      prefetch={false}
                      onClick={onNavClick}
                      className={cn(
                        'flex items-center justify-between rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                        pathname === item.href
                          ? 'bg-indigo-50 text-indigo-700 dark:bg-gray-800 dark:text-white font-semibold'
                          : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white'
                      )}
                    >
                      <span>{item.name}</span>
                      {item.badge && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-900/40 text-amber-400 border border-amber-800/40">
                          {item.badge}
                        </span>
                      )}
                    </Link>
                  )
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const { profile, tenant, tenants, role, user, loading } = useAuth();
  const { isOpen, close } = useSidebar();

  if (pathname?.includes('/login') || pathname?.includes('/auth') || pathname?.includes('/onboarding')) {
    return null;
  }

  if (loading) {
    return (
      <aside className="hidden md:flex flex-col w-[207px] h-screen bg-white dark:bg-gray-900 text-gray-900 dark:text-white p-2 border-r border-gray-200 dark:border-gray-800">
        <div className="mb-4 flex justify-center">
          <Image src="/icons/vynkoLogout.png?v=3" alt="Vynko" width={1530} height={590} sizes="96px" className="h-9 w-auto object-contain [filter:drop-shadow(0_0_1px_#000)_drop-shadow(0_0_1px_#000)_drop-shadow(0_0_0.5px_#000)] dark:[filter:none]" />
        </div>
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded" />
          <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded" />
          <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded" />
        </div>
      </aside>
    );
  }

  const isBlocked = tenant ? checkSubscriptionBlocked(tenant).blocked : false;

  const userSection = (profile || user) ? (
    <div className="border-t border-gray-200 dark:border-gray-700 pt-4 space-y-2">
      <div className="rounded-md bg-gray-50 dark:bg-gray-800 p-3 border border-gray-200 dark:border-transparent">
        <p className="text-xs text-gray-500 dark:text-gray-400">Usuario</p>
        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{profile?.full_name || 'Sin nombre'}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{profile?.email || user?.email}</p>
      </div>
    </div>
  ) : null;

  return (
    <>
      {/* Mobile overlay backdrop */}
      <div
        onClick={close}
        className={cn(
          'fixed inset-0 bg-black/50 z-40 md:hidden transition-opacity duration-200',
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
      />

      {/* Mobile drawer */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex flex-col w-[207px] bg-white dark:bg-gray-900 text-gray-900 dark:text-white p-2 border-r border-gray-200 dark:border-gray-800 md:hidden',
          'transition-transform duration-200 ease-out',
          isOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex-1 flex justify-center">
            <Image src="/icons/vynkoLogout.png?v=3" alt="Vynko" width={1530} height={590} sizes="96px" className="h-9 w-auto object-contain [filter:drop-shadow(0_0_1px_#000)_drop-shadow(0_0_1px_#000)_drop-shadow(0_0_0.5px_#000)] dark:[filter:none]" />
          </div>
          <button onClick={close} aria-label="Cerrar menú" className="p-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400">
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav className="flex-1 space-y-2 overflow-y-auto">
          <SidebarNav onNavClick={close} tenantPlan={tenant?.subscription_plan} userRole={role} isBlocked={isBlocked} multiBranch={tenants.length > 1} userEmail={user?.email || profile?.email || null} />
        </nav>
        <TrialCounter tenant={tenant} />
        {userSection}
      </aside>

      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-[207px] h-screen bg-white dark:bg-gray-900 text-gray-900 dark:text-white p-2 border-r border-gray-200 dark:border-gray-800">
        <div className="mb-2">
          <div className="flex justify-center">
            <Image src="/icons/vynkoLogout.png?v=3" alt="Vynko" width={1530} height={590} sizes="96px" className="h-9 w-auto object-contain [filter:drop-shadow(0_0_1px_#000)_drop-shadow(0_0_1px_#000)_drop-shadow(0_0_0.5px_#000)] dark:[filter:none]" />
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto">
          <SidebarNav tenantPlan={tenant?.subscription_plan} userRole={role} isBlocked={isBlocked} multiBranch={tenants.length > 1} userEmail={user?.email || profile?.email || null} />
        </nav>
        <TrialCounter tenant={tenant} />
        {userSection}
      </aside>
    </>
  );
}

function TrialCounter({ tenant }: { tenant: TenantInfo | null }) {
  if (!tenant || !tenant.created_at) return null;
  const plan = tenant.subscription_plan || 'starter';
  if (plan !== 'starter') return null;

  const TRIAL_DAYS = 45;
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const created = new Date(tenant.created_at);
  const createdDay = new Date(created.getFullYear(), created.getMonth(), created.getDate());
  const daysElapsed = Math.floor((todayStart.getTime() - createdDay.getTime()) / (1000 * 60 * 60 * 24));
  const daysLeft = Math.max(0, TRIAL_DAYS - daysElapsed);

  if (daysLeft <= 0) {
    return (
      <div className="mb-4 p-3 rounded-lg bg-red-900/30 border border-red-800/50">
        <div className="flex items-center gap-2 mb-1">
          <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
          <span className="text-xs font-bold text-red-300 uppercase tracking-wider">Prueba finalizada</span>
        </div>
        <p className="text-[10px] text-red-400/80">
          Suscribite a un plan para seguir usando Vynko
        </p>
      </div>
    );
  }

  if (daysLeft > 5) return null;

  return (
    <div className="mb-4 p-3 rounded-lg bg-blue-900/30 border border-blue-800/50">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5 text-blue-300">
          <Clock className="w-3.5 h-3.5" />
          <span className="text-xs font-semibold uppercase tracking-wider">Prueba</span>
        </div>
        <span className="text-xs font-bold text-blue-200">{daysLeft} días</span>
      </div>
      <div className="w-full bg-gray-800 rounded-full h-1.5 mt-2 overflow-hidden">
        <div 
          className="bg-blue-500 h-full rounded-full transition-all duration-500" 
          style={{ width: `${Math.max(0, Math.min(100, (daysLeft / TRIAL_DAYS) * 100))}%` }}
        />
      </div>
      <p className="text-[10px] text-blue-400/80 mt-2">
        {daysLeft === 0 ? 'Tu prueba termina hoy' : `Quedan ${daysLeft} días de prueba gratuita.`}
      </p>
    </div>
  );
}
