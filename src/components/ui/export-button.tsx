import { FileSpreadsheet, Loader2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { useExport } from '@/lib/hooks/useExport';
import { Button, type ButtonProps } from './button';

export function ExportButton({
  onExport,
  icon: Icon = FileSpreadsheet,
  label = 'Exportar',
  exportingLabel = 'Exportando...',
  lockMs,
  iconClassName,
  className,
  disabled,
  onClick,
  ...props
}: ButtonProps & {
  onExport: () => Promise<unknown> | void;
  label?: string;
  exportingLabel?: string;
  lockMs?: number;
  icon?: LucideIcon;
  iconClassName?: string;
}) {
  const { exporting, busy, run } = useExport(lockMs);

  return (
    <Button
      {...props}
      className={className}
      disabled={disabled || busy}
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented) run(onExport);
      }}
    >
      <span className="inline-flex items-center gap-2 min-w-0">
        {exporting ? (
          <Loader2 className={cn('h-4 w-4 animate-spin', iconClassName)} />
        ) : (
          <Icon className={cn('h-4 w-4', iconClassName)} />
        )}
        <span className="truncate">{exporting ? exportingLabel : label}</span>
      </span>
    </Button>
  );
}