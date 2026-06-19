'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { useNotifications } from '@/lib/hooks/useNotifications';
import { cn } from '@/lib/utils/cn';

interface NavItem {
  name: string;
  href: string;
  icon?: React.ReactNode;
}

const navItems: NavItem[] = [
  { name: 'Dashboard', href: '/' },
  { name: 'Ventas', href: '/sales' },
  { name: 'Productos', href: '/products' },
  { name: 'Proveedores', href: '/providers' },
  { name: 'Clientes', href: '/customers' },
  { name: 'Asistente IA', href: '/ai' },
  { name: 'Pronóstico', href: '/forecast' },
  { name: 'Escáner', href: '/scanning' },
  { name: 'Notificaciones', href: '/notifications' },
  { name: 'Configuración', href: '/settings' },
];

export function Sidebar() {
  const pathname = usePathname();
  const { profile, tenant, loading } = useAuth();
  const { unreadCount } = useNotifications();

  // Hide sidebar on login/auth pages
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

  return (
    <aside className="flex flex-col w-64 h-screen bg-gray-900 text-white p-4 border-r border-gray-800">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-blue-400">StockPilot</h1>
        {tenant && <p className="text-xs text-gray-400 mt-1">{tenant.name}</p>}
      </div>

      <nav className="flex-1 space-y-2">
        {navItems.map((item) => (
          <Link
            key={item.name}
            href={item.href}
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
      </nav>

      {profile && (
        <div className="border-t border-gray-700 pt-4">
          <div className="mb-4 rounded-md bg-gray-800 p-3">
            <p className="text-xs text-gray-400">Usuario</p>
            <p className="text-sm font-medium truncate">{profile.full_name}</p>
            <p className="text-xs text-gray-500 truncate">{profile.email}</p>
          </div>
        </div>
      )}
    </aside>
  );
}
