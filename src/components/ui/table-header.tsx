import type { ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

export function Thead({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <thead>
      <tr
        className={cn(
          'bg-gray-50 dark:bg-gray-900/50 border-b border-gray-100 dark:border-gray-800 text-xs font-semibold uppercase tracking-wider',
          className
        )}
      >
        {children}
      </tr>
    </thead>
  );
}

export function Th({
  children,
  align = 'left',
  dense = false,
  className = '',
}: {
  children?: ReactNode;
  align?: 'left' | 'center' | 'right';
  dense?: boolean;
  className?: string;
}) {
  const alignClass = align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : 'text-left';
  return (
    <th className={cn(dense ? 'py-3 px-4' : 'py-4 px-6', alignClass, 'text-gray-500', className)}>
      {children}
    </th>
  );
}