import useSWR from 'swr';
import type { Category } from '@/lib/types/category';
import { fetchWithTenant } from '@/lib/fetchWithTenant';

const fetcher = (url: string) => fetchWithTenant(url).then((r) => { if (!r.ok) throw new Error('Failed to fetch'); return r.json(); });

export function useCategories(tenantId: string | null | undefined) {
  const { data, error, isLoading, mutate } = useSWR<Category[]>(
    tenantId ? ['/api/categories', tenantId] : null,
    ([url]: [string]) => fetcher(url)
  );
  return {
    categories: data || [],
    isLoading: isLoading || (!data && !error),
    isError: error,
    mutate,
  };
}
