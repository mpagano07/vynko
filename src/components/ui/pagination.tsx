import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';

export interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  resultInfo?: string;
  className?: string;
}

export function Pagination({ currentPage, totalPages, onPageChange, resultInfo, className }: PaginationProps) {
  if (totalPages <= 1) return null;

  const goToPage = (page: number) => {
    onPageChange(Math.min(Math.max(page, 1), totalPages));
  };

  const pageNumbers = Array.from({ length: totalPages }, (_, i) => i + 1)
    .filter((p) => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
    .reduce<(number | '...')[]>((acc, p, i, arr) => {
      if (i > 0 && p - (arr[i - 1] as number) > 1) acc.push('...');
      acc.push(p);
      return acc;
    }, []);

  return (
    <div className={cn('flex items-center justify-between border-t border-gray-100 dark:border-gray-800 px-6 py-4', className)}>
      <div className="flex items-center gap-4 mr-4">
        {resultInfo && <span className="text-xs text-gray-500">{resultInfo}</span>}
        <span className="text-xs text-gray-500">
          Página <strong>{currentPage}</strong> de <strong>{totalPages}</strong>
        </span>
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          disabled={currentPage === 1}
          onClick={() => goToPage(currentPage - 1)}
        >
          Anterior
        </Button>
        {pageNumbers.map((p, i) =>
          p === '...' ? (
            <span key={`dots-${i}`} className="px-1 text-gray-400 text-xs">…</span>
          ) : (
            <Button
              key={p}
              variant={currentPage === p ? 'primary' : 'outline'}
              size="sm"
              onClick={() => goToPage(p)}
              className="min-w-[28px] px-1"
            >
              {p}
            </Button>
          )
        )}
        <Button
          variant="outline"
          size="sm"
          disabled={currentPage === totalPages}
          onClick={() => goToPage(currentPage + 1)}
        >
          Siguiente
        </Button>
      </div>
    </div>
  );
}