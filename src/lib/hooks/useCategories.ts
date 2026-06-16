import useSWR from 'swr';
import type { Category } from '@/lib/types/category';

function makeFetcher(tenantId: string) {
  return (url: string) =>
    fetch(url, {
      headers: { 'x-tenant-id': tenantId },
    }).then((res) => {
      if (!res.ok) throw new Error('Failed to fetch categories');
      return res.json();
    });
}

export function useCategories(tenantId: string | null | undefined) {
  const { data, error, isLoading, mutate } = useSWR<Category[]>(
    tenantId ? ['/api/categories', tenantId] : null,
    ([url]: [string]) => makeFetcher(tenantId!)(url)
  );
  return {
    categories: data || [],
    isLoading: isLoading || (!data && !error),
    isError: error,
    mutate,
  };
}
