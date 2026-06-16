import useSWR from 'swr';
import type { Product } from '@/lib/types/product';

function makeFetcher(tenantId: string) {
  return (url: string) =>
    fetch(url, {
      headers: { 'x-tenant-id': tenantId },
    }).then((res) => {
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    });
}

export function useProducts(tenantId: string | null | undefined) {
  const { data, error, isLoading, mutate } = useSWR<Product[]>(
    tenantId ? ['/api/products', tenantId] : null,
    ([url]: [string]) => makeFetcher(tenantId!)(url)
  );
  return {
    products: data,
    isLoading: isLoading || (!data && !error),
    isError: error,
    mutate,
  };
}
