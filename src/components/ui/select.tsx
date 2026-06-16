import * as React from 'react';
import { cn } from '@/lib/utils/cn';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  variant?: 'default' | 'outline';
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, variant = 'default', ...props }, ref) => {
    const base =
      'flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100';
    const variantStyles = {
      default: '',
      outline: 'border-2 border-gray-400',
    }[variant];
    return (
      <select
        ref={ref}
        className={cn(base, variantStyles, className)}
        {...props}
      />
    );
  }
);
Select.displayName = 'Select';
