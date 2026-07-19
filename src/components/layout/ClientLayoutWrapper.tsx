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
      <div className="flex flex-col md:flex-row flex-1 min-h-screen w-full">
        <React.Suspense fallback={<div className="hidden md:flex flex-col w-64 h-screen bg-gray-900 p-4 border-r border-gray-800" />}> 
          <Sidebar />
        </React.Suspense>
        <div className="flex flex-col flex-1 w-full">
          <React.Suspense fallback={<div />}>
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
