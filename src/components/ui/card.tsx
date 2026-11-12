import * as React from 'react';
import { cn } from '@/lib/utils/cn';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'outline';
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant = 'default', ...props }, ref) => {
    const base = 'rounded-lg bg-white dark:bg-gray-800 shadow-sm p-4';
    const variantStyles = {
      default: '',
      outline: 'border border-gray-200 dark:border-gray-700',
    }[variant];
    return (
      <div
        ref={ref}
        className={cn(base, variantStyles, className)}
        {...props}
      />
    );
  }
);
Card.displayName = 'Card';
