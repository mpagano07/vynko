import type { LabelHTMLAttributes } from 'react';
import { cn } from '@/lib/utils/cn';

export function FormLabel({
  children,
  variant = 'uppercase',
  className,
  ...props
}: LabelHTMLAttributes<HTMLLabelElement> & {
  variant?: 'uppercase' | 'default';
}) {
  return (
    <label
      className={cn(
        'block mb-1',
        variant === 'uppercase'
          ? 'text-xs font-semibold text-gray-500 uppercase tracking-wider'
          : 'text-sm font-medium text-gray-700 dark:text-gray-300',
        className
      )}
      {...props}
    >
      {children}
    </label>
  );
}