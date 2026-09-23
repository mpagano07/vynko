import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

export function LoadingState({
  label,
  compact = false,
  className = '',
}: {
  label?: string;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center',
        compact ? 'py-16' : 'py-20',
        label && 'space-y-4',
        className
      )}
    >
      <Loader2 className={cn('animate-spin text-indigo-500', compact ? 'h-8 w-8' : 'h-10 w-10')} />
      {label && <p className="text-sm text-gray-500">{label}</p>}
    </div>
  );
}