'use client';

import { track } from '@vercel/analytics';
import { Analytics, type BeforeSendEvent } from '@vercel/analytics/next';
import { usePathname } from 'next/navigation';
import { useEffect, useSyncExternalStore } from 'react';
import { getCookieConsent, subscribeToConsent } from '@/lib/cookie-consent';
import { isIndexablePath } from '@/lib/marketing/public-routes';

function analyticsConsentSnapshot() {
  return getCookieConsent()?.analytics === true;
}

function analyticsConsentServerSnapshot() {
  return false;
}

function onlyIndexablePages(event: BeforeSendEvent): BeforeSendEvent | null {
  try {
    const pathname = new URL(event.url, window.location.origin).pathname;
    return isIndexablePath(pathname) ? event : null;
  } catch {
    return null;
  }
}

function trackInstagramVisit() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('utm_source') !== 'instagram') return;

  track('instagram_visit', {
    campaign: params.get('utm_campaign') ?? null,
    content: params.get('utm_content') ?? null,
  });
}

export function ConsentAnalytics() {
  const pathname = usePathname();
  const enabled = useSyncExternalStore(
    subscribeToConsent,
    analyticsConsentSnapshot,
    analyticsConsentServerSnapshot
  );

  useEffect(() => {
    if (!enabled || !isIndexablePath(pathname)) return;
    const timer = window.setTimeout(trackInstagramVisit, 0);
    return () => window.clearTimeout(timer);
  }, [enabled, pathname]);

  if (!enabled || !isIndexablePath(pathname)) return null;

  return <Analytics beforeSend={onlyIndexablePages} />;
}
