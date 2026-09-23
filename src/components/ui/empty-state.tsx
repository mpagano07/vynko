import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className = '',
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('text-center py-20', className)}>
      <Icon className="h-12 w-12 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
      <p className="text-lg font-medium text-gray-900 dark:text-gray-100">{title}</p>
      {description && <p className="text-sm text-gray-500 mt-1">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}