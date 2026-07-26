'use client';

import { useEffect, type ReactNode } from 'react';

const ACTIVE_TENANT_KEY = 'vynko_active_tenant_id';

export function TenantHeaderProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const originalFetch = window.fetch;

    window.fetch = function(input, init) {
      let tenantId: string | null = null;
      try {
        tenantId = localStorage.getItem(ACTIVE_TENANT_KEY);
      } catch {}

      if (tenantId) {
        const headers = new Headers(init?.headers);
        if (!headers.has('x-active-tenant-id')) {
          headers.set('x-active-tenant-id', tenantId);
        }
        init = { ...init, headers };
      }

      return originalFetch.call(window, input, init);
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  return <>{children}</>;
}
