'use client';

import React, { useState } from 'react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';
import { Loader2, Download } from 'lucide-react';
import type { ExportFormat } from '@/lib/excel-export';
import type { PartyExportKind } from '@/lib/party-export';

export interface ExportPartiesModalProps {
  kind: PartyExportKind;
  open: boolean;
  onClose: () => void;
  onExport: (format: ExportFormat) => void | Promise<void>;
  exporting: boolean;
  count: number;
}

const KIND_TEXT: Record<PartyExportKind, { title: string; plural: string }> = {
  customers: { title: 'Exportar clientes', plural: 'cliente(s)' },
  suppliers: { title: 'Exportar proveedores', plural: 'proveedor(es)' },
};

const FORMAT_OPTIONS = [
  { value: 'xls' as const, label: 'XLS', hint: 'Excel binario (.xls)' },
  { value: 'csv' as const, label: 'CSV', hint: 'Texto separado por comas (.csv)' },
];

function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex w-full rounded-lg border border-gray-200 dark:border-gray-700 p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
            value === option.value
              ? 'bg-indigo-600 text-white'
              : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Versión de `ExportProductsModal` para terceros: misma mecánica de formato
 * segmentado, pero sin elección de plataforma (no hay variantes de Tiendanube
 * ni MercadoLibre para clientes/proveedores) ni destino Drive. La descarga es
 * siempre client-side desde la lista filtrada de la página.
 */
export function ExportPartiesModal({
  kind,
  open,
  onClose,
  onExport,
  exporting,
  count,
}: ExportPartiesModalProps) {
  const [format, setFormat] = useState<ExportFormat>('xls');
  const text = KIND_TEXT[kind];

  // Mientras se genera el archivo no cerramos el modal: si el usuario lo
  // cierra, la generación puede terminar igual y se perdería la confirmación.
  const handleClose = () => {
    if (!exporting) onClose();
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={text.title}
      className="max-w-md"
      aria-label={text.title}
    >
      <p className="text-sm text-gray-500 mb-5">
        Descargá los {count} {text.plural} de la lista actual. Si hay un filtro
        activo, el archivo incluye sólo los que coinciden con la búsqueda.
      </p>

      <div>
        <span className="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
          Formato
        </span>
        <SegmentedControl
          ariaLabel="Formato"
          value={format}
          options={FORMAT_OPTIONS.map(({ value, label }) => ({ value, label }))}
          onChange={setFormat}
        />
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          {FORMAT_OPTIONS.find((option) => option.value === format)?.hint}
        </p>
      </div>

      <div className="flex flex-col sm:flex-row sm:justify-end gap-2 mt-6">
        <Button type="button" variant="outline" size="sm" onClick={handleClose} disabled={exporting}>
          Cancelar
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => onExport(format)}
          disabled={exporting}
          className="gap-2"
        >
          {exporting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          {exporting ? 'Exportando...' : 'Descargar'}
        </Button>
      </div>
    </Modal>
  );
}
