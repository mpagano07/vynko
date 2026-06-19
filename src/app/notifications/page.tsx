'use client';

import { useState } from 'react';
import { useNotifications } from '@/lib/hooks/useNotifications';
import { supabase } from '@/lib/supabaseClient';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Bell, CheckCheck, Loader2, ArrowLeft, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import type { Notification } from '@/lib/types/notification';

const typeLabels: Record<string, string> = {
  stock_critical: 'Stock Crítico',
  stock_low: 'Stock Bajo',
  po_received: 'OC Recibida',
  po_cancelled: 'OC Cancelada',
  collaborator_joined: 'Colaborador',
  invitation_accepted: 'Invitación',
  system: 'Sistema',
};

const typeColors: Record<string, string> = {
  stock_critical: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400',
  stock_low: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  po_received: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  po_cancelled: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400',
  collaborator_joined: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  invitation_accepted: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
  system: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
};

export default function NotificationsPage() {
  const { notifications, unreadCount, total, isLoading, mutate } = useNotifications();
  const [typeFilter, setTypeFilter] = useState('all');
  const [page, setPage] = useState(1);
  const perPage = 20;

  const filtered = typeFilter === 'all'
    ? notifications
    : notifications.filter((n) => n.type === typeFilter);

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

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Bell className="h-8 w-8 text-indigo-600 dark:text-indigo-400" />
            Notificaciones
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {unreadCount > 0
              ? `Tienes ${unreadCount} notificación(es) sin leer`
              : 'No tienes notificaciones pendientes'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="all">Todos los tipos</option>
            {Object.entries(typeLabels).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </Select>
          {unreadCount > 0 && (
            <Button variant="outline" onClick={handleMarkAllRead} className="flex items-center gap-2">
              <CheckCheck className="h-4 w-4" />
              Leer todas
            </Button>
          )}
        </div>
      </div>

      <Card className="overflow-hidden border border-gray-100 dark:border-gray-800">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 space-y-4">
            <Loader2 className="h-10 w-10 animate-spin text-indigo-500" />
            <p className="text-sm text-gray-500">Cargando notificaciones...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <Bell className="h-12 w-12 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
            <p className="text-lg font-medium text-gray-900 dark:text-gray-100">Sin notificaciones</p>
            <p className="text-sm text-gray-500 mt-1">
              {typeFilter !== 'all' ? 'No hay notificaciones de este tipo.' : 'Aún no hay notificaciones.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {filtered.map((n: Notification) => (
              <div
                key={n.id}
                className={cn(
                  'flex items-start gap-4 px-6 py-4 transition-colors',
                  !n.read && 'bg-indigo-50/30 dark:bg-indigo-950/20'
                )}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full', typeColors[n.type] || typeColors.system)}>
                      {typeLabels[n.type] || n.type}
                    </span>
                    {!n.read && (
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                    )}
                  </div>
                  <p className={cn('text-sm', !n.read ? 'font-semibold text-gray-900 dark:text-white' : 'text-gray-700 dark:text-gray-300')}>
                    {n.title}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{n.message}</p>
                  <p className="text-[10px] text-gray-400 mt-1">
                    {new Date(n.created_at).toLocaleDateString('es-AR', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
                {!n.read && (
                  <button
                    onClick={() => handleMarkAsRead(n.id)}
                    className="flex-shrink-0 p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors"
                    title="Marcar como leída"
                  >
                    <CheckCheck className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {total > perPage && (
          <div className="flex items-center justify-between border-t border-gray-100 dark:border-gray-800 px-6 py-4">
            <span className="text-xs text-gray-500">
              Total: <strong>{total}</strong> notificaciones
            </span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>
                <ArrowLeft className="h-3 w-3 mr-1" />
                Anterior
              </Button>
              <Button variant="outline" size="sm" disabled={page * perPage >= total} onClick={() => setPage(page + 1)}>
                Siguiente
                <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
