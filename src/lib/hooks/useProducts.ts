import useSWR from 'swr';
import type { Product } from '@/lib/types/product';
import { fetchWithTenant } from '@/lib/fetchWithTenant';

const fetcher = (url: string) => fetchWithTenant(url).then((r) => { if (!r.ok) throw new Error('Failed to fetch'); return r.json(); });

export function useProducts(tenantId: string | null | undefined) {
  const { data, error, isLoading, mutate } = useSWR<Product[]>(
    tenantId ? ['/api/products', tenantId] : null,
    ([url]: [string]) => fetcher(url)
  );
  return {
    products: data,
    isLoading: isLoading || (!data && !error),
    isError: error,
    mutate,
  };
}
