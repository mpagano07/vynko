'use client';

import React, { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Sidebar } from '@/components/ui/sidebar';
import { Header } from '@/components/ui/header';
import { SidebarProvider } from '@/lib/contexts/sidebar-context';
import { useAuth } from '@/lib/hooks/useAuth';
import { checkSubscriptionBlocked } from '@/lib/checkSubscription';

const LazyToaster = dynamic(() => import('@/components/ui/lazy-toaster'), { ssr: false });

// Stable header placeholder - same height as real header (h-14 = 56px) to prevent CLS
const HeaderSkeleton = () => (
  <header className="flex h-14 items-center justify-between bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-4 flex-shrink-0">
    <div className="h-8 w-8 bg-gray-200 dark:bg-gray-800 rounded animate-pulse" />
    <div className="h-8 w-8 bg-gray-200 dark:bg-gray-800 rounded-full animate-pulse" />
  </header>
);

export function ClientLayoutWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { tenant, loading } = useAuth();

  const isPublicRoute = 
    pathname === '/' ||
    pathname?.startsWith('/login') ||
    pathname?.startsWith('/auth') ||
    pathname?.startsWith('/onboarding') ||
    pathname?.startsWith('/accept-invite');

  const isBillingRoute = pathname?.startsWith('/billing');

  useEffect(() => {
    if (!loading && !isPublicRoute && !isBillingRoute && tenant) {
      const result = checkSubscriptionBlocked(tenant);
      if (result.blocked) {
        router.replace(`/billing?blocked=${result.reason}`);
      }
    }
  }, [loading, isPublicRoute, isBillingRoute, tenant, router]);

  if (isPublicRoute) {
    return <>{children}</>;
  }

  return (
    <SidebarProvider>
      <LazyToaster />
      {/* Outer container: flex-row on desktop, flex-col on mobile */}
      <div className="flex flex-row flex-1 min-h-screen w-full">
        {/* Sidebar: on mobile it's an absolutely positioned drawer, on desktop it's in-flow */}
        <React.Suspense fallback={
          <aside className="hidden md:flex flex-col w-64 h-screen bg-gray-900 border-r border-gray-800 flex-shrink-0 p-4">
            <div className="mb-8 h-8 w-20 bg-gray-700 rounded animate-pulse" />
            <div className="space-y-3">
              <div className="h-7 bg-gray-700 rounded animate-pulse" />
              <div className="h-7 bg-gray-700 rounded animate-pulse" />
              <div className="h-7 bg-gray-700 rounded animate-pulse" />
            </div>
          </aside>
        }>
          <Sidebar />
        </React.Suspense>

        {/* Main content column: always takes remaining width, never shifts */}
        <div className="flex flex-col flex-1 min-w-0 w-full">
          <React.Suspense fallback={<HeaderSkeleton />}>
            <Header />
          </React.Suspense>
          <main className="flex-1 w-full overflow-auto bg-gray-50 dark:bg-gray-950">
            <div className="p-4 md:p-6 lg:p-8 max-w-7xl mx-auto w-full">
              {children}
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
