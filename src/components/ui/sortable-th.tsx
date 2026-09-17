import { ArrowUp, ArrowDown, ChevronsUpDown } from 'lucide-react';

export type SortDir = 'asc' | 'desc';

export function SortableTh<K extends string>({
  label,
  sortFor,
  sortKey,
  sortDir,
  onSort,
  className = '',
  align = 'left',
}: {
  label: string;
  sortFor: K;
  sortKey: K | null;
  sortDir: SortDir;
  onSort: (key: K) => void;
  className?: string;
  align?: 'left' | 'center' | 'right';
}) {
  const active = sortKey === sortFor;
  const justify = align === 'center' ? 'justify-center' : align === 'right' ? 'justify-end' : '';
  return (
    <th className={`py-4 ${align === 'left' ? 'text-left' : align === 'center' ? 'text-center' : 'text-right'} ${className}`}>
      <button
        type="button"
        onClick={() => onSort(sortFor)}
        className={`inline-flex items-center gap-1 uppercase tracking-wider transition-colors ${justify} ${
          active
            ? 'text-gray-900 dark:text-gray-100'
            : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
        }`}
      >
        {label}
        {active
          ? sortDir === 'asc'
            ? <ArrowUp className="h-3 w-3" />
            : <ArrowDown className="h-3 w-3" />
          : <ChevronsUpDown className="h-3 w-3 opacity-50" />}
      </button>
    </th>
  );
}