import * as React from 'react';
import { cn } from '@/lib/utils/cn';

export type TooltipSide = 'top' | 'bottom';
export type TooltipAlign = 'start' | 'center' | 'end';

const SIDE_CLASSES: Record<TooltipSide, string> = {
  top: 'bottom-full mb-2',
  bottom: 'top-full mt-2',
};

const ALIGN_CLASSES: Record<TooltipAlign, string> = {
  start: 'left-0',
  center: 'left-1/2 -translate-x-1/2',
  end: 'right-0',
};

export interface TooltipProps {
  content: React.ReactNode;
  side?: TooltipSide;
  align?: TooltipAlign;
  className?: string;
  contentClassName?: string;
  children: React.ReactElement<Record<string, unknown>>;
}

export function Tooltip({
  content,
  side = 'top',
  align = 'center',
  className,
  contentClassName,
  children,
}: TooltipProps) {
  const [open, setOpen] = React.useState(false);
  const id = React.useId();

  const show = () => setOpen(true);
  const hide = () => setOpen(false);

  return (
    <span
      className={cn('relative inline-flex', className)}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {React.cloneElement(children, { 'aria-describedby': open ? id : undefined })}
      <span
        id={id}
        role="tooltip"
        className={cn(
          'pointer-events-none absolute z-50 w-max max-w-[16rem] rounded-md bg-gray-900 px-2.5 py-1.5 text-xs font-medium leading-snug text-white shadow-lg dark:bg-gray-100 dark:text-gray-900',
          SIDE_CLASSES[side],
          ALIGN_CLASSES[align],
          'transition-all duration-150',
          open ? 'visible translate-y-0 opacity-100' : 'invisible translate-y-0.5 opacity-0',
          contentClassName
        )}
      >
        {content}
      </span>
    </span>
  );
}