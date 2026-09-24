'use client';

import { useMemo, useState } from 'react';

export function usePagination<T>(
  items: T[] | undefined,
  itemsPerPage: number,
  initialPage = 1
) {
  const [page, setPage] = useState(initialPage);
  const totalItems = items?.length ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage));
  const currentPage = Math.min(Math.max(page, 1), totalPages);

  const pageItems = useMemo(() => {
    if (!items) return [] as T[];
    const start = (currentPage - 1) * itemsPerPage;
    return items.slice(start, start + itemsPerPage);
  }, [items, currentPage, itemsPerPage]);

  return { currentPage, setCurrentPage: setPage, totalPages, pageItems };
}