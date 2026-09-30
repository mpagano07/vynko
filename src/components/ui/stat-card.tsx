import type { HTMLAttributes, ReactNode } from 'react';
import { ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { Card } from './card';

export type StatColor =
  | 'emerald'
  | 'rose'
  | 'amber'
  | 'indigo'
  | 'blue'
  | 'green'
  | 'orange'
  | 'purple'
  | 'gray'
  | 'cyan'
  | 'teal';

export type StatIconVariant = 'chip' | 'square' | 'small';

type StatColorStyles = { base: string; square: string };

const TONE_CLASSES: Record<StatColor, StatColorStyles> = {
  emerald: { base: 'bg-emerald-50 dark:bg-emerald-950/30', square: 'bg-emerald-100 dark:bg-emerald-500/20' },
  rose: { base: 'bg-rose-50 dark:bg-rose-950/30', square: 'bg-rose-100 dark:bg-rose-500/20' },
  amber: { base: 'bg-amber-50 dark:bg-amber-950/30', square: 'bg-amber-100 dark:bg-amber-500/20' },
  indigo: { base: 'bg-indigo-50 dark:bg-indigo-950/30', square: 'bg-indigo-100 dark:bg-indigo-500/20' },
  blue: { base: 'bg-blue-50 dark:bg-blue-950/30', square: 'bg-blue-100 dark:bg-blue-500/20' },
  green: { base: 'bg-green-50 dark:bg-green-950/30', square: 'bg-green-100 dark:bg-green-500/20' },
  orange: { base: 'bg-orange-50 dark:bg-orange-950/30', square: 'bg-orange-100 dark:bg-orange-500/20' },
  purple: { base: 'bg-purple-50 dark:bg-purple-950/30', square: 'bg-purple-100 dark:bg-purple-500/20' },
  gray: { base: 'bg-gray-100 dark:bg-gray-800', square: 'bg-gray-100 dark:bg-gray-800' },
  cyan: { base: 'bg-cyan-50 dark:bg-cyan-950/30', square: 'bg-cyan-100 dark:bg-cyan-500/20' },
  teal: { base: 'bg-teal-50 dark:bg-teal-950/30', square: 'bg-teal-100 dark:bg-teal-500/20' },
};

const TONE_TEXT: Record<StatColor, string> = {
  emerald: 'text-emerald-600 dark:text-emerald-400',
  rose: 'text-rose-600 dark:text-rose-400',
  amber: 'text-amber-600 dark:text-amber-400',
  indigo: 'text-indigo-600 dark:text-indigo-400',
  blue: 'text-blue-600 dark:text-blue-400',
  green: 'text-green-600 dark:text-green-400',
  orange: 'text-orange-600 dark:text-orange-400',
  purple: 'text-purple-600 dark:text-purple-400',
  gray: 'text-gray-500 dark:text-gray-400',
  cyan: 'text-cyan-600 dark:text-cyan-400',
  teal: 'text-teal-600 dark:text-teal-400',
};

export function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  tone = 'gray',
  iconVariant = 'chip',
  trend = null,
  horizontal = false,
  stretch = false,
  loading = false,
  className,
  titleClassName,
  valueClassName,
  subtitleClassName,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  title: ReactNode;
  value: ReactNode;
  subtitle?: ReactNode;
  icon?: LucideIcon;
  tone?: StatColor;
  iconVariant?: StatIconVariant;
  trend?: number | null;
  horizontal?: boolean;
  stretch?: boolean;
  loading?: boolean;
  titleClassName?: string;
  valueClassName?: string;
  subtitleClassName?: string;
}) {
  if (horizontal) {
    return (
      <Card data-testid="stat-card" className={cn('p-5', className)} {...props}>
        <div className="flex items-center gap-3">
          {Icon && (
            <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0', TONE_CLASSES[tone].square, TONE_TEXT[tone])}>
              <Icon className="h-5 w-5" />
            </div>
          )}
          <div className="min-w-0">
            <p className={cn('text-sm text-gray-500 dark:text-gray-400', titleClassName)}>{title}</p>
            <p data-testid="stat-value" className={cn('text-2xl font-bold text-gray-900 dark:text-white', valueClassName)}>{value}</p>
          </div>
        </div>
      </Card>
    );
  }

  const iconClasses: Record<StatIconVariant, string> = {
    chip: `p-2.5 rounded-lg ${TONE_CLASSES[tone].base} ${TONE_TEXT[tone]}`,
    square: `w-10 h-10 rounded-lg flex items-center justify-center ${TONE_CLASSES[tone].square} ${TONE_TEXT[tone]}`,
    small: `p-1 rounded ${TONE_CLASSES[tone].base} ${TONE_TEXT[tone]}`,
  };

  return (
    <Card data-testid="stat-card" className={cn('p-5', className)} {...props}>
      <div className={cn('flex flex-col', stretch && 'h-full justify-between')}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <p className={cn('text-xs font-medium uppercase tracking-wider text-gray-400 truncate', titleClassName)}>{title}</p>
            {!loading && trend !== null && (
              <span
                className={cn(
                  'flex items-center gap-0.5 text-[11px] font-semibold',
                  trend > 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : trend < 0
                    ? 'text-rose-600 dark:text-rose-400'
                    : 'text-gray-400'
                )}
              >
                {trend > 0 ? (
                  <ArrowUpRight className="h-3 w-3" />
                ) : trend < 0 ? (
                  <ArrowDownRight className="h-3 w-3" />
                ) : (
                  <Minus className="h-3 w-3" />
                )}
                {trend > 0 ? '+' : ''}
                {trend}%
              </span>
            )}
          </div>
          {Icon && !loading && (
            <div className={cn('flex-shrink-0', iconClasses[iconVariant])}>
              <Icon className={iconVariant === 'small' ? 'h-3.5 w-3.5' : 'h-5 w-5'} />
            </div>
          )}
        </div>
        {loading ? (
          <div className="mt-2 h-6 w-24 bg-gray-200 dark:bg-gray-800 animate-pulse rounded" />
        ) : (
          <div>
            <div data-testid="stat-value" className={cn('mt-1 text-2xl font-bold text-gray-900 dark:text-white', valueClassName)}>{value}</div>
            {subtitle && <p className={cn('mt-1 text-xs text-gray-500 dark:text-gray-400', subtitleClassName)}>{subtitle}</p>}
          </div>
        )}
      </div>
    </Card>
  );
}