import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

export type StatusTone =
  | 'gray'
  | 'grayMuted'
  | 'amber'
  | 'amberSoft'
  | 'blue'
  | 'emerald'
  | 'emeraldSoft'
  | 'green'
  | 'red'
  | 'indigo'
  | 'orange'
  | 'rose'
  | 'yellow';

const TONE_CLASSES: Record<StatusTone, string> = {
  gray: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  grayMuted: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  amberSoft: 'bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400',
  blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  emeraldSoft: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400',
  green: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  red: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  indigo: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
  orange: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  rose: 'bg-rose-50 text-rose-600 dark:bg-rose-950/30 dark:text-rose-400',
  yellow: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
};

const SIZE_CLASSES = {
  xs: 'px-2 py-0.5 text-[11px] font-semibold',
  sm: 'px-2 py-0.5 text-xs font-medium',
  md: 'px-2.5 py-1 text-xs font-semibold',
  lg: 'px-3 py-1 text-sm font-semibold',
} as const;

export function StatusBadge({
  tone = 'gray',
  size = 'sm',
  icon,
  children,
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  tone?: StatusTone;
  size?: keyof typeof SIZE_CLASSES;
  icon?: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full whitespace-nowrap',
        SIZE_CLASSES[size],
        TONE_CLASSES[tone],
        className
      )}
      {...props}
    >
      {icon}
      {children}
    </span>
  );
}