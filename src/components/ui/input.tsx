import * as React from 'react';
import { cn } from '@/lib/utils/cn';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  // Allows custom styling variants if needed in future
  variant?: 'default' | 'outline';
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, variant = 'default', ...props }, ref) => {
    const base =
      'flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500';
    const variantStyles = {
      default: '',
      outline: 'border-2 border-gray-400',
    }[variant];
    return (
      <input
        ref={ref}
        className={cn(base, variantStyles, className)}
        {...props}
      />
    );
  }
);
Input.displayName = 'Input';
