'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { useSidebar } from '@/lib/contexts/sidebar-context';
import { cn } from '@/lib/utils/cn';
import { X, LogOut, Clock, AlertTriangle, ChevronDown, Settings } from 'lucide-react';
import { checkSubscriptionBlocked } from '@/lib/checkSubscription';

interface NavItem {
  name: string;
  href: string;
  icon?: React.ReactNode;
  requiredPlan?: string[];
  requiredRole?: string[];
  badge?: string;
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
      { name: 'Historial', href: '/activity-logs', requiredPlan: ALL_PLANS, requiredRole: ['owner', 'manager'] },
    ],
  },
  {
    label: 'Sistema',
    items: [
      { name: 'Planes', href: '/billing', requiredPlan: ALL_PLANS, requiredRole: ['owner', 'manager'] },
      { name: 'Configuración', href: '/settings', requiredPlan: ALL_PLANS, requiredRole: ['owner', 'manager'] },
    ],
  },
];

const operacionesItems: NavItem[] = [
  { name: 'QR', href: '/codigos', requiredPlan: ALL_PLANS },
  { name: 'Escáner', href: '/scanning', requiredPlan: ALL_PLANS },
  { name: 'Antipérdidas', href: '/loss-prevention', requiredPlan: ALL_PLANS },
  { name: 'Visión Góndolas', href: '/shelf-vision', requiredPlan: ['business', 'enterprise'], badge: 'Próximamente' },
];

function SidebarNav({ onNavClick, tenantPlan, userRole, isBlocked }: { onNavClick?: () => void; tenantPlan?: string; userRole?: string | null; isBlocked?: boolean }) {
  const pathname = usePathname();
  const [operacionesOpen, setOperacionesOpen] = useState(false);
  const operacionesRef = useRef<HTMLDivElement>(null);

  const effectivePlan = !tenantPlan || tenantPlan === 'free' ? 'starter' : tenantPlan;

  const filterItem = (item: NavItem) => {
    if (item.requiredPlan && !item.requiredPlan.includes(effectivePlan)) return false;
    if (item.requiredRole && !item.requiredRole.includes(userRole || '')) return false;
    return true;
  };

  const visibleOperaciones = operacionesItems.filter(filterItem);
  const isOperacionesActive = visibleOperaciones.some((item) => pathname === item.href);

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
        const visible = group.items.filter(filterItem);
        if (visible.length === 0) return null;
        return (
          <div key={group.label} className="mb-1">
            <p className="px-3 pt-4 pb-1.5 text-[10px] font-bold text-gray-500 dark:text-gray-500 uppercase tracking-widest">
              {group.label}
            </p>
            {visible.map((item) => (
              <Link
                key={item.name}
                href={item.href}
                prefetch={false}
                onClick={onNavClick}
                className={cn(
                  'flex items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  pathname === item.href
                    ? 'bg-gray-800 text-white'
                    : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                )}
              >
                <span>{item.name}</span>
                {item.badge && (
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-900/40 text-amber-400 border border-amber-800/40">
                    {item.badge}
                  </span>
                )}
              </Link>
            ))}
          </div>
        );
      })}

      {visibleOperaciones.length > 0 && (
        <div className="mb-1">
          <p className="px-3 pt-4 pb-1.5 text-[10px] font-bold text-gray-500 dark:text-gray-500 uppercase tracking-widest">
            Operaciones
          </p>
          <button
            onClick={() => setOperacionesOpen(!operacionesOpen)}
            className={cn(
              'flex items-center justify-between w-full rounded-md px-3 py-2 text-sm font-medium transition-colors',
              isOperacionesActive || operacionesOpen
                ? 'bg-gray-800 text-white'
                : 'text-gray-300 hover:bg-gray-800 hover:text-white'
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
            ref={operacionesRef}
            className={cn(
              'overflow-hidden transition-all duration-200',
              operacionesOpen ? 'opacity-100' : 'opacity-0'
            )}
            style={{ maxHeight: operacionesOpen ? `${operacionesRef.current?.scrollHeight ?? 200}px` : '0px' }}
          >
            <div className="ml-4 mt-1 space-y-1 border-l border-gray-700 pl-3">
              {visibleOperaciones.map((item) => (
                <Link
                  key={item.name}
                  href={item.href}
                  prefetch={false}
                  onClick={onNavClick}
                  className={cn(
                    'flex items-center justify-between rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                    pathname === item.href
                      ? 'bg-gray-800 text-white'
                      : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                  )}
                >
                  <span>{item.name}</span>
                  {item.badge && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-900/40 text-amber-400 border border-amber-800/40">
                      {item.badge}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { profile, tenant, role, user, loading, logout } = useAuth();
  const { isOpen, close } = useSidebar();

  if (pathname?.includes('/login') || pathname?.includes('/auth') || pathname?.includes('/onboarding')) {
    return null;
  }

  if (loading) {
    return (
      <aside className="hidden md:flex flex-col w-64 h-screen bg-gray-900 text-white p-4 border-r border-gray-800">
        <div className="mb-8 text-2xl font-bold text-blue-400">Vynko</div>
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-700 rounded" />
          <div className="h-8 bg-gray-700 rounded" />
          <div className="h-8 bg-gray-700 rounded" />
        </div>
      </aside>
    );
  }

  const isBlocked = tenant ? checkSubscriptionBlocked(tenant).blocked : false;

  const userSection = (profile || user) ? (
    <div className="border-t border-gray-700 pt-4 space-y-2">
      <div className="rounded-md bg-gray-800 p-3">
        <p className="text-xs text-gray-400">Usuario</p>
        <p className="text-sm font-medium truncate">{profile?.full_name || 'Sin nombre'}</p>
        <p className="text-xs text-gray-500 truncate">{profile?.email || user?.email}</p>
      </div>
      <button
        onClick={async () => {
          await logout();
          router.push('/login');
        }}
        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-gray-400 hover:text-red-400 hover:bg-gray-800 transition-colors"
      >
        <LogOut className="h-4 w-4" />
        Cerrar sesión
      </button>
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
          'fixed inset-y-0 left-0 z-50 flex flex-col w-64 bg-gray-900 text-white p-4 border-r border-gray-800 md:hidden',
          'transition-transform duration-200 ease-out',
          isOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold text-blue-400">Vynko</h1>
          <button onClick={close} aria-label="Cerrar menú" className="p-1 rounded-md hover:bg-gray-800 text-gray-400">
            <X className="h-5 w-5" />
          </button>
        </div>
        {tenant && (
          <div className="flex items-center gap-2 -mt-6 mb-4 px-2 py-1.5 rounded-lg bg-gray-800/60 border border-gray-700/50">
            <div className="w-6 h-6 rounded-md bg-blue-500/20 flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-bold text-blue-400">{(tenant.name || 'T')[0].toUpperCase()}</span>
            </div>
            <p className="text-sm font-semibold text-gray-200 truncate">{tenant.name}</p>
          </div>
        )}
        <nav className="flex-1 space-y-2 overflow-y-auto">
          <SidebarNav onNavClick={close} tenantPlan={tenant?.subscription_plan} userRole={role} isBlocked={isBlocked} />
        </nav>
        <TrialCounter tenant={tenant} />
        {userSection}
      </aside>

      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-64 h-screen bg-gray-900 text-white p-4 border-r border-gray-800">
        <div className="mb-4">
          <h1 className="text-2xl font-bold text-blue-400">Vynko</h1>
          {tenant && (
            <div className="flex items-center gap-2 mt-2 px-2 py-1.5 rounded-lg bg-gray-800/60 border border-gray-700/50">
              <div className="w-6 h-6 rounded-md bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                <span className="text-xs font-bold text-blue-400">{(tenant.name || 'T')[0].toUpperCase()}</span>
              </div>
              <p className="text-sm font-semibold text-gray-200 truncate">{tenant.name}</p>
            </div>
          )}
        </div>
        <nav className="flex-1 overflow-y-auto">
          <SidebarNav tenantPlan={tenant?.subscription_plan} userRole={role} isBlocked={isBlocked} />
        </nav>
        <TrialCounter tenant={tenant} />
        {userSection}
      </aside>
    </>
  );
}

function TrialCounter({ tenant }: { tenant: any }) {
  if (!tenant || !tenant.created_at) return null;
  const plan = tenant.subscription_plan || 'starter';
  if (plan !== 'starter') return null;

  const TRIAL_DAYS = 30;
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
