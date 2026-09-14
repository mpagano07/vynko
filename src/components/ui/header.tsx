'use client';

import { useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { cn } from '@/lib/utils/cn';
import { Menu } from 'lucide-react';
import { useSidebar } from '@/lib/contexts/sidebar-context';
import { TenantSwitcher } from '@/components/ui/tenant-switcher';

export function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const { profile, tenants, user, logout } = useAuth();
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const { toggle: toggleSidebar } = useSidebar();

  const handleLogout = async () => {
    await logout();
    router.push('/login');
  };

  if (pathname?.includes('/login') || pathname?.includes('/auth') || pathname?.includes('/onboarding')) {
    return null;
  }

  return (
    <header className={cn('flex h-14 items-center justify-between bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-4')}>
      <div className="flex items-center space-x-2">
        <button
          onClick={toggleSidebar}
          aria-label="Abrir menú de navegación"
          className="md:hidden p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          <Menu className="h-5 w-5 text-gray-500 dark:text-gray-400" />
        </button>
        {tenants && tenants.length > 0 && (
          <div className="ml-1 min-w-0">
            <TenantSwitcher />
          </div>
        )}
      </div>

      <div className="flex items-center space-x-2">
        {(profile || user) ? (
          <div className="relative">
            <button
              onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
              aria-label="Menú de usuario"
              className={cn('flex items-center space-x-2 rounded-lg p-2 hover:bg-gray-100 dark:hover:bg-gray-800', isUserMenuOpen && 'relative z-50')}
            >
              <div className="w-8 h-8 bg-blue-500 dark:bg-blue-600 rounded-full flex items-center justify-center text-white text-sm font-bold">
                {(profile?.full_name || user?.email || 'U').charAt(0).toUpperCase()}
              </div>
              <span className="text-sm font-medium hidden sm:inline text-gray-700 dark:text-gray-300">
                {profile?.full_name || user?.email || 'Usuario'}
              </span>
            </button>

            {isUserMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setIsUserMenuOpen(false)} />
                <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-50">
                <div className="px-4 py-2 border-b border-gray-200 dark:border-gray-700">
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    {profile?.full_name || 'Sin nombre'}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {profile?.email || user?.email}
                  </p>
                </div>
                <button
                  onClick={() => {
                    setIsUserMenuOpen(false);
                    router.push('/billing');
                  }}
                  className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  Planes
                </button>
                <button
                  onClick={() => {
                    setIsUserMenuOpen(false);
                    router.push('/settings');
                  }}
                  className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  Configuración
                </button>
                <button
                  onClick={() => {
                    setIsUserMenuOpen(false);
                    handleLogout();
                  }}
                  className="w-full text-left px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-700 border-t border-gray-200 dark:border-gray-700"
                >
                  Cerrar sesión
                </button>
                </div>
              </>
            )}
          </div>
        ) : null}
      </div>
    </header>
  );
}
