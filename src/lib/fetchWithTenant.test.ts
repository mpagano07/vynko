import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fetchWithTenant, getTenantHeaders } from './fetchWithTenant';

describe('fetchWithTenant', () => {
  beforeEach(() => {
    // Clear localStorage
    localStorage.clear();
    // Mock fetch
    global.fetch = vi.fn().mockResolvedValue(new Response('ok'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetchWithTenant', () => {
    it('does not add header when there is no active tenant', async () => {
      await fetchWithTenant('http://api/test');
      
      expect(global.fetch).toHaveBeenCalledWith(
        'http://api/test',
        expect.objectContaining({
          headers: expect.any(Headers),
        })
      );
      
      const callArgs = vi.mocked(global.fetch).mock.calls[0];
      const headers = callArgs[1]?.headers as Headers;
      expect(headers.get('x-active-tenant-id')).toBeNull();
    });

    it('adds x-active-tenant-id header when active tenant exists', async () => {
      localStorage.setItem('vynko_active_tenant_id', 'tenant-123');
      
      await fetchWithTenant('http://api/test');
      
      expect(global.fetch).toHaveBeenCalled();
      const callArgs = vi.mocked(global.fetch).mock.calls[0];
      const headers = callArgs[1]?.headers as Headers;
      expect(headers.get('x-active-tenant-id')).toBe('tenant-123');
    });

    it('preserves other init options like method and body', async () => {
      localStorage.setItem('vynko_active_tenant_id', 'tenant-123');
      
      const customInit = {
        method: 'POST',
        body: JSON.stringify({ name: 'Test' }),
        headers: {
          'Content-Type': 'application/json',
        }
      };
      
      await fetchWithTenant('http://api/test', customInit);
      
      const callArgs = vi.mocked(global.fetch).mock.calls[0];
      expect(callArgs[1]?.method).toBe('POST');
      expect(callArgs[1]?.body).toBe(customInit.body);
      
      const headers = callArgs[1]?.headers as Headers;
      expect(headers.get('x-active-tenant-id')).toBe('tenant-123');
      expect(headers.get('Content-Type')).toBe('application/json');
    });
  });

  describe('getTenantHeaders', () => {
    it('returns empty object when no tenant is active', () => {
      const headers = getTenantHeaders();
      expect(headers).toEqual({});
    });

    it('returns object with x-active-tenant-id when tenant is active', () => {
      localStorage.setItem('vynko_active_tenant_id', 'tenant-456');
      const headers = getTenantHeaders();
      expect(headers).toEqual({ 'x-active-tenant-id': 'tenant-456' });
    });
    
    it('handles localStorage errors gracefully (e.g. cookies disabled)', () => {
      // Mock localStorage to throw error
      const originalGetItem = localStorage.getItem;
      localStorage.getItem = () => { throw new Error('Access Denied'); };
      
      const headers = getTenantHeaders();
      expect(headers).toEqual({});
      
      // Restore
      localStorage.getItem = originalGetItem;
    });
  });
});
