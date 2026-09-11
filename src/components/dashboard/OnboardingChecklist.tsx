'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { Check, ChevronRight, X, Package, ShoppingCart, Bell, Users, EyeOff, ArrowRight } from 'lucide-react';
import Link from 'next/link';

interface OnboardingChecklistProps {
  hasProducts: boolean;
  hasSales: boolean;
  hasAlerts: boolean;
  hasPendingOrders: boolean;
  userId?: string;
}

interface Step {
  id: string;
  title: string;
  desc: string;
  icon: React.ReactNode;
  done: boolean;
  href: string;
}

const DISMISS_KEY = 'vynko_onboarding_dismissed';

export default function OnboardingChecklist({ hasProducts, hasSales, hasAlerts, hasPendingOrders, userId }: OnboardingChecklistProps) {
  const dismissKey = userId ? `${DISMISS_KEY}_${userId}` : DISMISS_KEY;
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return localStorage.getItem(dismissKey) === 'true';
    } catch { return false; }
  });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!confirmOpen) return;
    const close = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setConfirmOpen(false);
      }
    };
    const closeOnKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setConfirmOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', closeOnKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', closeOnKey);
    };
  }, [confirmOpen]);

  const steps: Step[] = useMemo(() => [
    {
      id: 'products',
      title: 'Cargá tu primer producto',
      desc: 'Agregá un producto con nombre, precio y stock.',
      icon: <Package className="h-3.5 w-3.5" />,
      done: hasProducts,
      href: '/products',
    },
    {
      id: 'sale',
      title: 'Registrá tu primera venta',
      desc: 'Usá el buscador o escáner para registrar una venta.',
      icon: <ShoppingCart className="h-3.5 w-3.5" />,
      done: hasSales,
      href: '/sales',
    },
    {
      id: 'alerts',
      title: 'Revisá las alertas de stock',
      desc: 'Configurá el stock mínimo para recibir alertas.',
      icon: <Bell className="h-3.5 w-3.5" />,
      done: hasAlerts,
      href: '/products',
    },
    {
      id: 'purchase',
      title: 'Creá una orden de compra',
      desc: 'Pedí mercadería a tus proveedores.',
      icon: <Users className="h-3.5 w-3.5" />,
      done: hasPendingOrders,
      href: '/providers?create_po=1',
    },
  ], [hasProducts, hasSales, hasAlerts, hasPendingOrders]);

  const completedCount = steps.filter((s) => s.done).length;
  const allDone = completedCount === steps.length;
  const progress = Math.round((completedCount / steps.length) * 100);

  if (dismissed || allDone) return null;

  const handleAccept = () => {
    setConfirmOpen(false);
    setDismissed(true);
    try {
      localStorage.setItem(dismissKey, 'true');
    } catch { /* noop */ }
  };

  return (
    <div ref={wrapRef} className="relative bg-gradient-to-br from-cyan-500/5 to-blue-500/5 border border-cyan-500/15 rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <h3 className="text-[13px] font-bold text-gray-900 dark:text-white">
            Primeros pasos
          </h3>
          <span className="text-[11px] text-gray-500 dark:text-gray-400">
            {completedCount}/{steps.length}
          </span>
        </div>
        <button
          onClick={() => setConfirmOpen((v) => !v)}
          className={`p-1 rounded-md transition-colors ${
            confirmOpen
              ? 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300'
              : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
          }`}
          aria-label="Ocultar checklist"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1 mb-2.5">
        <div
          className="bg-cyan-500 h-1 rounded-full transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="space-y-1">
        {steps.map((step) => (
          <Link
            key={step.id}
            href={step.href}
            className={`flex items-center gap-2 px-2 py-1.5 rounded-md transition-all group ${
              step.done
                ? 'bg-green-50/40 dark:bg-green-900/10'
                : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
            }`}
          >
            <div className={`shrink-0 w-6 h-6 rounded-md flex items-center justify-center ${
              step.done
                ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'
                : 'bg-cyan-500/10 text-cyan-500'
            }`}>
              {step.done ? <Check className="h-3 w-3" /> : step.icon}
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-xs font-medium ${step.done ? 'text-gray-500 dark:text-gray-400' : 'text-gray-800 dark:text-gray-200'}`}>
                {step.title}
              </p>
              <p className="text-[10px] text-gray-500 dark:text-gray-500 truncate">{step.desc}</p>
            </div>
            {!step.done && (
              <ChevronRight className="h-3.5 w-3.5 text-gray-400 group-hover:text-cyan-400 shrink-0 transition-colors" />
            )}
          </Link>
        ))}
      </div>

      {confirmOpen && (
        <div className="absolute right-2 top-10 z-30">
          <div className="absolute right-4 top-[-5px] h-2 w-2 rotate-45 border-l border-t border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800" />
          <div className="w-72 rounded-xl border border-amber-300/60 bg-white shadow-2xl shadow-black/10 dark:border-amber-800/40 dark:bg-gray-800 dark:shadow-black/60">
            <div className="p-3.5 pb-3">
              <div className="flex items-center gap-1.5">
                <EyeOff className="h-3.5 w-3.5 text-amber-500 dark:text-amber-400" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-300">Ocultar guía</span>
              </div>
              <p className="mt-1.5 text-xs font-bold text-gray-900 dark:text-white">
                ¿Ocultar los Primeros pasos?
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
                Vas a dejar de ver la guía de configuración de tu negocio. Si no confirmás, seguirá apareciendo.
              </p>
            </div>
            <div className="flex items-center gap-1.5 px-3.5 pb-3.5">
              <button
                onClick={handleAccept}
                className="flex flex-1 items-center justify-center gap-1 rounded-md bg-amber-500 px-2 py-1.5 text-[11px] font-bold text-black transition-colors hover:bg-amber-400"
              >
                Sí, ocultar
                <ArrowRight className="h-3 w-3" />
              </button>
              <button
                onClick={() => setConfirmOpen(false)}
                className="rounded-md border border-gray-200 px-2 py-1.5 text-[11px] font-semibold text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}