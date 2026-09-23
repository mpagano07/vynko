import type { ButtonHTMLAttributes } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

export type IconActionTone = 'neutral' | 'indigo' | 'red' | 'danger' | 'muted';

const TONE_CLASSES: Record<IconActionTone, string> = {
  neutral:
    'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800',
  indigo:
    'text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-gray-100 dark:hover:bg-gray-800',
  red: 'text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-800',
  danger: 'text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300',
  muted:
    'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800',
};

const SIZE_CLASSES = {
  xs: 'p-1',
  sm: 'p-1.5',
  md: 'p-1.5',
  lg: 'p-2',
} as const;

const ICON_SIZE_CLASSES = {
  xs: 'h-3.5 w-3.5',
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
  lg: 'h-5 w-5',
} as const;

export function IconAction({
  icon: Icon,
  label,
  tone = 'neutral',
  size = 'sm',
  className,
  title,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: LucideIcon;
  label: string;
  tone?: IconActionTone;
  size?: keyof typeof SIZE_CLASSES;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title}
      className={cn(
        'inline-flex items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
        SIZE_CLASSES[size],
        TONE_CLASSES[tone],
        className
      )}
      {...props}
    >
      <Icon className={ICON_SIZE_CLASSES[size]} />
    </button>
  );
}