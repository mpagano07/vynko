import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  /** Muestra un spinner y bloquea el botón mientras dura la acción. */
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', loading = false, disabled, children, ...props }, ref) => {
    const baseStyles =
      'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none';
    const variantStyles = {
      primary: 'bg-indigo-600 text-white hover:bg-indigo-700 focus-visible:ring-indigo-500 dark:bg-indigo-500 dark:hover:bg-indigo-600',
      secondary: 'bg-gray-200 text-gray-900 hover:bg-gray-300 focus-visible:ring-gray-400 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600 dark:focus-visible:ring-gray-500',
      outline: 'border border-gray-300 text-gray-900 hover:bg-gray-100 focus-visible:ring-gray-400 dark:border-gray-600 dark:text-gray-100 dark:hover:bg-gray-800 dark:focus-visible:ring-gray-500',
      ghost: 'text-gray-700 hover:bg-gray-100 focus-visible:ring-gray-400 dark:text-gray-300 dark:hover:bg-gray-800 dark:focus-visible:ring-gray-500',
      danger: 'bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-500 dark:bg-rose-500 dark:hover:bg-rose-600',
    }[variant];
    const sizeStyles = {
      sm: 'min-h-8 px-3 py-1.5 text-sm',
      md: 'min-h-10 px-4 py-2 text-base',
      lg: 'min-h-12 px-6 py-2.5 text-lg',
    }[size];
    return (
      <button
        className={cn(baseStyles, variantStyles, sizeStyles, className)}
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
        {children}
      </button>
    );
  }
);
Button.displayName = 'Button';
