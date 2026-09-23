'use client';

import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { IconAction } from '@/components/ui/icon-action';

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
  searchable?: boolean;
};

type OptionData = { value: string; disabled: boolean; label: string };

const LAYOUT_RE =
  /^(?:(sm|md|lg|xl|2xl):)?(flex(-|$)|w-|min-w-|max-w-|h-|min-h-|max-h-|basis-|grow(-|$)|shrink(-|$)|order-|self-|m-|mx-|my-|ml-|mr-|mt-|mb-)/;

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

function extractText(node: React.ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (React.isValidElement(node)) return extractText((node.props as { children?: React.ReactNode }).children);
  return '';
}

function collectOptions(children: React.ReactNode): OptionData[] {
  const out: OptionData[] = [];
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child) || child.type !== 'option') return;
    const props = child.props as React.OptionHTMLAttributes<HTMLOptionElement>;
    out.push({ value: String(props.value ?? ''), disabled: Boolean(props.disabled), label: extractText(props.children) });
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
      searchable,
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
    const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
    const [query, setQuery] = useState('');
    const triggerRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);
    const { layout, visual } = splitLayout(className);

    const current = controlled ? String(value ?? '') : internal;
    const selected = options.find((o) => o.value === current);
    const label = selected?.label || current || 'Seleccionar...';

    const computePos = () => {
      const btn = triggerRef.current;
      if (!btn) return null;
      const rect = btn.getBoundingClientRect();
      const panelHeight =
        Math.min(options.length * 36 + 8, 224) + (searchable ? 52 : 0);
      const top =
        window.innerHeight - rect.bottom >= panelHeight + 12
          ? rect.bottom + 4
          : Math.max(8, rect.top - panelHeight - 4);
      return { top, left: rect.left, width: rect.width };
    };

    const toggleOpen = () => {
      setOpen((o) => {
        const next = !o;
        if (next) {
          setPos(computePos());
          setQuery('');
        }
        return next;
      });
    };

    useEffect(() => {
      if (!open) return;
      const close = (e: Event) => {
        if (e.target instanceof Node && panelRef.current?.contains(e.target)) return;
        setOpen(false);
      };
      window.addEventListener('scroll', close, true);
      window.addEventListener('resize', close);
      return () => {
        window.removeEventListener('scroll', close, true);
        window.removeEventListener('resize', close);
      };
    }, [open]);

    useEffect(() => {
      if (open && searchable) searchRef.current?.focus({ preventScroll: true });
    }, [open, searchable]);

    const trimmedQuery = query.trim().toLowerCase();
    const visibleOptions =
      searchable && trimmedQuery
        ? options.filter((o) => o.label.toLowerCase().includes(trimmedQuery))
        : options;

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
          ref={triggerRef}
          type="button"
          id={id}
          name={name}
          disabled={disabled}
          data-testid={dataTestId}
          aria-label={ariaLabel}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={toggleOpen}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
            if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !open) {
              e.preventDefault();
              setPos(computePos());
              setOpen(true);
              return;
            }
            if (searchable && !open && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
              e.preventDefault();
              setQuery(e.key);
              setPos(computePos());
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

        {open && pos && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <div
              ref={panelRef}
              role="listbox"
              style={{ top: pos.top, left: pos.left, width: pos.width }}
              className={cn(
                'fixed z-20 max-h-56 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-xl dark:border-gray-700 dark:bg-gray-800',
                darkPanel && 'border-gray-700 bg-gray-800',
                panelClassName
              )}
            >
              {searchable && (
                <div
                  className={cn(
                    'sticky top-0 flex items-center gap-2 border-b border-gray-100 px-2 py-1.5 bg-white dark:border-gray-700 dark:bg-gray-800',
                    darkPanel && 'border-gray-700 bg-gray-800 dark:bg-gray-800'
                  )}
                >
                  <Search className="h-4 w-4 flex-shrink-0 text-gray-400" />
                  <input
                    ref={searchRef}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') setOpen(false);
                    }}
                    placeholder="Buscar..."
                    data-testid="select-search"
                    className="h-8 w-full bg-transparent text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none dark:text-gray-100"
                  />
                  {query && (
                    <IconAction
                      icon={X}
                      label="Limpiar búsqueda"
                      size="xs"
                      className="p-0.5 rounded hover:text-gray-600 dark:hover:text-gray-300"
                      onClick={() => setQuery('')}
                    />
                  )}
                </div>
              )}
              {searchable && trimmedQuery && visibleOptions.length === 0 && (
                <div className="px-3 py-2 text-sm text-gray-500">Sin resultados</div>
              )}
              {!searchable && options.length === 0 && (
                <div className="px-3 py-2 text-sm text-gray-500">Sin opciones</div>
              )}
              {visibleOptions.map((o) => (
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