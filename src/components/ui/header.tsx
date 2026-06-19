'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { useNotifications } from '@/lib/hooks/useNotifications';
import { supabase } from '@/lib/supabaseClient';
import { cn } from '@/lib/utils/cn';
import { Bell, CheckCheck, ArrowRight } from 'lucide-react';

export function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const { profile, logout, loading } = useAuth();
  const { notifications, unreadCount, mutate } = useNotifications();
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [isClient, setIsClient] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setIsNotifOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLogout = async () => {
    await logout();
    router.push('/login');
  };

  const handleMarkAsRead = async (id: string) => {
    const { data: { session } } = await supabase.auth.getSession();
    await fetch(`/api/notifications/${id}`, {
      method: 'PATCH',
      headers: session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {},
    });
    mutate();
  };

  const handleMarkAllRead = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    await fetch('/api/notifications/read-all', {
      method: 'POST',
      headers: session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {},
    });
    mutate();
  };

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

      <div className="flex items-center space-x-1">
        {/* Notification Bell */}
        <div className="relative" ref={notifRef}>
          <button
            onClick={() => setIsNotifOpen(!isNotifOpen)}
            className="relative p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <Bell className="h-5 w-5 text-gray-500 dark:text-gray-400" />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center w-4.5 h-4.5 text-[10px] font-bold text-white bg-rose-500 rounded-full min-w-[18px] min-h-[18px]">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>

          {isNotifOpen && (
            <div className="absolute right-0 mt-2 w-80 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-50">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-200 dark:border-gray-700">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Notificaciones</h3>
                {unreadCount > 0 && (
                  <button
                    onClick={handleMarkAllRead}
                    className="text-xs text-indigo-600 hover:text-indigo-500 font-medium flex items-center gap-1"
                  >
                    <CheckCheck className="h-3 w-3" />
                    Leer todas
                  </button>
                )}
              </div>

              <div className="max-h-72 overflow-y-auto">
                {notifications.length === 0 ? (
                  <div className="py-8 text-center text-sm text-gray-500">
                    <Bell className="h-8 w-8 mx-auto mb-2 text-gray-300 dark:text-gray-600" />
                    No hay notificaciones
                  </div>
                ) : (
                  notifications.slice(0, 8).map((n) => (
                    <div
                      key={n.id}
                      className={cn(
                        'flex items-start gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-700/50 text-sm hover:bg-gray-50 dark:hover:bg-gray-700/30 cursor-pointer transition-colors',
                        !n.read && 'bg-indigo-50/30 dark:bg-indigo-950/20'
                      )}
                      onClick={() => handleMarkAsRead(n.id)}
                    >
                      <div className="flex-1 min-w-0">
                        <p className={cn('text-sm', !n.read ? 'font-semibold text-gray-900 dark:text-white' : 'text-gray-700 dark:text-gray-300')}>
                          {n.title}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">{n.message}</p>
                        <p className="text-[10px] text-gray-400 mt-1">
                          {new Date(n.created_at).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                      {!n.read && (
                        <span className="w-2 h-2 rounded-full bg-indigo-500 mt-1.5 flex-shrink-0" />
                      )}
                    </div>
                  ))
                )}
              </div>

              <button
                onClick={() => {
                  setIsNotifOpen(false);
                  router.push('/notifications');
                }}
                className="w-full flex items-center justify-center gap-1 px-4 py-2.5 text-xs font-medium text-indigo-600 hover:text-indigo-500 hover:bg-gray-50 dark:hover:bg-gray-700/50 border-t border-gray-200 dark:border-gray-700 rounded-b-lg"
              >
                Ver todas las notificaciones
                <ArrowRight className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>

        {/* User Menu */}
        {profile ? (
          <div className="relative">
            <button
              onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
              className="flex items-center space-x-2 rounded-lg p-2 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <div className="w-8 h-8 bg-blue-500 dark:bg-blue-600 rounded-full flex items-center justify-center text-white text-sm font-bold">
                {profile.full_name?.charAt(0).toUpperCase() || 'U'}
              </div>
              <span className="text-sm font-medium hidden sm:inline text-gray-700 dark:text-gray-300">
                {profile.full_name}
              </span>
            </button>

            {isUserMenuOpen && (
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
            )}
          </div>
        ) : null}
      </div>
    </header>
  );
}
