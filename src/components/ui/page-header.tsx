import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

export function PageHeader({
  title,
  subtitle,
  icon,
  actions,
  compact = false,
  className,
  subtitleClassName,
  children,
  ...props
}: HTMLAttributes<HTMLElement> & {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  compact?: boolean;
  subtitleClassName?: string;
}) {
  return (
    <header
      className={cn(
        compact
          ? 'flex items-center justify-between'
          : 'flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4',
        className
      )}
      {...props}
    >
      <div className="min-w-0">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          {icon}
          {title}
        </h1>
        {subtitle && (
          <p className={cn('text-sm text-gray-600 dark:text-gray-400 mt-1', subtitleClassName)}>{subtitle}</p>
        )}
        {children}
      </div>
      {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
    </header>
  );
}