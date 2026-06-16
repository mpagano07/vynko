'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { cn } from '@/lib/utils/cn';
import { Button } from './button';

export function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const { profile, logout, loading } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  const handleLogout = async () => {
    await logout();
    router.push('/login');
  };

  // Hide header on auth pages
  if (pathname?.includes('/login') || pathname?.includes('/auth') || pathname?.includes('/onboarding')) {
    return null;
  }

  if (!isClient || loading) {
    return (
      <header className={cn('flex h-14 items-center justify-between bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-4')}>
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">StockPilot</h1>
      </header>
    );
  }

  return (
    <header className={cn('flex h-14 items-center justify-between bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-4')}>
      <div className="flex items-center space-x-2" />
      <div className="flex items-center space-x-4">
        {profile ? (
          <div className="relative">
            <button
              onClick={() => setIsOpen(!isOpen)}
              className="flex items-center space-x-2 rounded-lg p-2 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <div className="w-8 h-8 bg-blue-500 dark:bg-blue-600 rounded-full flex items-center justify-center text-white text-sm font-bold">
                {profile.full_name?.charAt(0).toUpperCase() || 'U'}
              </div>
              <span className="text-sm font-medium hidden sm:inline text-gray-700 dark:text-gray-300">
                {profile.full_name}
              </span>
            </button>

            {isOpen && (
              <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-50">
                <div className="px-4 py-2 border-b border-gray-200 dark:border-gray-700">
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    {profile.full_name}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {profile.email}
                  </p>
                </div>
                <button
                  onClick={() => {
                    setIsOpen(false);
                    router.push('/settings');
                  }}
                  className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  Configuración
                </button>
                <button
                  onClick={() => {
                    setIsOpen(false);
                    handleLogout();
                  }}
                  className="w-full text-left px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-700 border-t border-gray-200 dark:border-gray-700"
                >
                  Cerrar sesión
                </button>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </header>
  );
}
