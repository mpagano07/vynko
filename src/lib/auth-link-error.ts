'use client';

export interface AuthLinkErrorParams {
  error: string;
  errorCode: string | null;
  description: string | null;
}

// When an email link (signup confirmation or recovery) is clicked twice or
// past its expiration, supabase-js fails the PKCE exchange and leaves the
// failure in the URL (`error`, `error_code`, `error_description`, plus an
// auth hash with `sb`). Detect those so the caller can clean the address bar
// and tell the user what happened instead of leaving a confusing URL behind.
export function getAuthLinkErrorParams(): AuthLinkErrorParams | null {
  if (typeof window === 'undefined') return null;
  const url = new URL(window.location.href);
  const hash = url.hash ? new URLSearchParams(url.hash.slice(1)) : null;
  const error = url.searchParams.get('error') ?? hash?.get('error') ?? null;
  if (!error) return null;
  const errorCode = url.searchParams.get('error_code') ?? hash?.get('error_code') ?? null;
  const description = url.searchParams.get('error_description') ?? hash?.get('error_description') ?? null;
  if (!errorCode && !description) return null;
  return { error, errorCode, description };
}

export function clearAuthLinkErrorFromUrl() {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  let changed = false;
  for (const key of ['error', 'error_code', 'error_description', 'code', 'state', 'sb']) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      changed = true;
    }
  }
  const hash = url.hash ? new URLSearchParams(url.hash.slice(1)) : null;
  if (hash && ['error', 'error_code', 'error_description', 'code', 'state', 'sb'].some((k) => hash.has(k))) {
    url.hash = '';
    changed = true;
  }
  if (changed) {
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  }
}