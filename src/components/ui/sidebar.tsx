'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { useNotifications } from '@/lib/hooks/useNotifications';
import { useSidebar } from '@/lib/contexts/sidebar-context';
import { cn } from '@/lib/utils/cn';
import { motion, AnimatePresence } from 'framer-motion';
import { X, LogOut, Clock } from 'lucide-react';

interface NavItem {
  name: string;
  href: string;
  icon?: React.ReactNode;
  requiredPlan?: string[];
  requiredRole?: string[];
}

const ALL_PLANS = ['starter', 'business', 'enterprise'];

const navItems: NavItem[] = [
  { name: 'Dashboard', href: '/dashboard', requiredPlan: ALL_PLANS },
  { name: 'Ventas', href: '/sales', requiredPlan: ALL_PLANS },
  { name: 'Productos', href: '/products', requiredPlan: ALL_PLANS },
  { name: 'Proveedores', href: '/providers', requiredPlan: ALL_PLANS },
  { name: 'Clientes', href: '/customers', requiredPlan: ALL_PLANS },
  { name: 'Asistente IA', href: '/ai', requiredPlan: ['business', 'enterprise'] },
  { name: 'Pronóstico', href: '/forecast', requiredPlan: ALL_PLANS, requiredRole: ['owner', 'manager'] },
  { name: 'Antipérdidas', href: '/loss-prevention', requiredPlan: ALL_PLANS },
  { name: 'Visión Góndolas', href: '/shelf-vision', requiredPlan: ['business', 'enterprise'] },
  { name: 'Escáner', href: '/scanning', requiredPlan: ALL_PLANS },
  { name: 'Notificaciones', href: '/notifications', requiredPlan: ALL_PLANS },
  { name: 'Planes', href: '/billing', requiredPlan: ALL_PLANS, requiredRole: ['owner', 'manager'] },
  { name: 'Configuración', href: '/settings', requiredPlan: ALL_PLANS, requiredRole: ['owner', 'manager'] },
];

function SidebarNav({ onNavClick, tenantPlan, userRole }: { onNavClick?: () => void; tenantPlan?: string; userRole?: string | null }) {
  const pathname = usePathname();
  const { unreadCount } = useNotifications();

  const effectivePlan = !tenantPlan || tenantPlan === 'free' ? 'starter' : tenantPlan;

  const visibleItems = navItems.filter((item) => {
    if (item.requiredPlan && !item.requiredPlan.includes(effectivePlan)) return false;
    if (item.requiredRole && !item.requiredRole.includes(userRole || '')) return false;
    return true;
  });

  return (
    <>
      {visibleItems.map((item) => (
        <Link
          key={item.name}
          href={item.href}
          onClick={onNavClick}
          className={cn(
            'flex items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition-colors',
            pathname === item.href
              ? 'bg-gray-800 text-white'
              : 'text-gray-300 hover:bg-gray-800 hover:text-white'
          )}
        >
          <span>{item.name}</span>
          {item.name === 'Notificaciones' && unreadCount > 0 && (
            <span className="flex items-center justify-center h-5 min-w-5 px-1.5 text-[10px] font-bold text-white bg-rose-500 rounded-full">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Link>
      ))}
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
      <aside className="flex flex-col w-64 h-screen bg-gray-900 text-white p-4">
        <div className="mb-8 text-2xl font-bold text-blue-400">StockPilot</div>
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-700 rounded" />
          <div className="h-8 bg-gray-700 rounded" />
          <div className="h-8 bg-gray-700 rounded" />
        </div>
      </aside>
    );
  }

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
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={close}
            className="fixed inset-0 bg-black/50 z-40 md:hidden"
          />
        )}
      </AnimatePresence>

      {/* Mobile drawer */}
      <AnimatePresence>
        {isOpen && (
          <motion.aside
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed inset-y-0 left-0 z-50 flex flex-col w-64 bg-gray-900 text-white p-4 border-r border-gray-800 md:hidden"
          >
            <div className="flex items-center justify-between mb-8">
              <h1 className="text-2xl font-bold text-blue-400">StockPilot</h1>
              <button onClick={close} className="p-1 rounded-md hover:bg-gray-800 text-gray-400">
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
              <SidebarNav onNavClick={close} tenantPlan={tenant?.subscription_plan} userRole={role} />
            </nav>
            <TrialCounter tenant={tenant} />
            {userSection}
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-64 h-screen bg-gray-900 text-white p-4 border-r border-gray-800">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-blue-400">StockPilot</h1>
          {tenant && (
            <div className="flex items-center gap-2 mt-2 px-2 py-1.5 rounded-lg bg-gray-800/60 border border-gray-700/50">
              <div className="w-6 h-6 rounded-md bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                <span className="text-xs font-bold text-blue-400">{(tenant.name || 'T')[0].toUpperCase()}</span>
              </div>
              <p className="text-sm font-semibold text-gray-200 truncate">{tenant.name}</p>
            </div>
          )}
        </div>
        <nav className="flex-1 space-y-2 overflow-y-auto mt-4">
          <SidebarNav tenantPlan={tenant?.subscription_plan} userRole={role} />
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

  if (daysLeft < 0) return null;

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
