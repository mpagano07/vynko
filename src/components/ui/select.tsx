'use client';

import * as React from 'react';
import { useState } from 'react';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

export type SelectProps = {
  children: React.ReactNode;
  className?: string;
  panelClassName?: string;
  value?: string | number;
  defaultValue?: string | number;
  onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  name?: string;
  'data-testid'?: string;
  'aria-label'?: string;
  darkPanel?: boolean;
};

type OptionData = { value: string; disabled: boolean; label: string };

const LAYOUT_RE =
  /^(flex(-|$)|w-|min-w-|max-w-|h-|min-h-|max-h-|basis-|grow(-|$)|shrink(-|$)|order-|self-|m-|mx-|my-|ml-|mr-|mt-|mb-)/;

function splitLayout(className?: string): { layout: string; visual: string } {
  let layout = '';
  let visual = '';
  (className ?? '').split(/\s+/).forEach((cls) => {
    if (!cls) return;
    if (LAYOUT_RE.test(cls)) layout += ' ' + cls;
    else visual += ' ' + cls;
  });
  return { layout: layout.trim(), visual: visual.trim() };
}

function collectOptions(children: React.ReactNode): OptionData[] {
  const out: OptionData[] = [];
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child) || child.type !== 'option') return;
    const props = child.props as React.OptionHTMLAttributes<HTMLOptionElement>;
    const label =
      typeof props.children === 'string' || typeof props.children === 'number'
        ? String(props.children)
        : '';
    out.push({ value: String(props.value ?? ''), disabled: Boolean(props.disabled), label });
  });
  return out;
}

export const Select = React.forwardRef<HTMLDivElement, SelectProps>(
  (
    {
      children,
      className,
      panelClassName,
      darkPanel,
      value,
      defaultValue,
      onChange,
      disabled,
      'data-testid': dataTestId,
      'aria-label': ariaLabel,
      id,
      name,
    },
    ref
  ) => {
    const options = collectOptions(children);
    const controlled = value !== undefined;
    const [internal, setInternal] = useState<string>(String(defaultValue ?? ''));
    const [open, setOpen] = useState(false);
    const { layout, visual } = splitLayout(className);

    const current = controlled ? String(value ?? '') : internal;
    const selected = options.find((o) => o.value === current);
    const label = selected?.label || current || 'Seleccionar...';

    const handleSelect = (v: string) => {
      if (v === current) {
        setOpen(false);
        return;
      }
      if (!controlled) setInternal(v);
      onChange?.({ target: { value: v } } as React.ChangeEvent<HTMLSelectElement>);
      setOpen(false);
    };

    return (
      <div ref={ref} className={cn('relative', layout)}>
        <button
          type="button"
          id={id}
          name={name}
          disabled={disabled}
          data-testid={dataTestId}
          aria-label={ariaLabel}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
            if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !open) {
              e.preventDefault();
              setOpen(true);
            }
          }}
          className={cn(
            'flex h-10 w-full items-center justify-between gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100',
            darkPanel && 'border-gray-700 bg-gray-800 text-white hover:bg-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:hover:bg-gray-700',
            visual
          )}
        >
          <span className={cn('flex-1 truncate text-left', current === '' && 'text-gray-500 dark:text-gray-400')}>{label}</span>
          {open ? (
            <ChevronUp
              className={cn(
                'h-4 w-4 flex-shrink-0 text-gray-500 dark:text-gray-400',
                darkPanel && 'text-gray-300 dark:text-gray-300'
              )}
            />
          ) : (
            <ChevronDown
              className={cn(
                'h-4 w-4 flex-shrink-0 text-gray-500 dark:text-gray-400',
                darkPanel && 'text-gray-300 dark:text-gray-300'
              )}
            />
          )}
        </button>

        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <div
              role="listbox"
              className={cn(
                'absolute left-0 right-0 mt-1 z-20 overflow-y-auto max-h-56 rounded-lg border border-gray-200 bg-white py-1 shadow-xl dark:border-gray-700 dark:bg-gray-800',
                darkPanel && 'border-gray-700 bg-gray-800',
                panelClassName
              )}
            >
              {options.length === 0 && (
                <div className="px-3 py-2 text-sm text-gray-500">Sin opciones</div>
              )}
              {options.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={o.value === current}
                  disabled={o.disabled}
                  onClick={() => handleSelect(o.value)}
                  className={cn(
                    'flex items-center gap-2 w-full px-3 py-2 text-sm text-left transition-colors',
                    darkPanel
                      ? 'text-gray-200 hover:bg-gray-700/80 dark:text-gray-200 dark:hover:bg-gray-700'
                      : 'text-gray-800 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700',
                    o.value === current && 'font-medium',
                    o.disabled && 'cursor-not-allowed opacity-50'
                  )}
                >
                  <span className="flex-1">{o.label}</span>
                  {o.value === current && (
                    <Check
                      className={cn(
                        'h-4 w-4 flex-shrink-0 text-blue-600 dark:text-blue-400',
                        darkPanel && 'text-blue-400 dark:text-blue-400'
                      )}
                    />
                  )}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }
);
Select.displayName = 'Select';