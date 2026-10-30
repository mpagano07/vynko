'use client';

import React, { useState } from 'react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';
import {
  Loader2,
  Download,
  Store,
  ShoppingBag,
  FileSpreadsheet,
  Cloud,
  CheckCircle2,
  ExternalLink,
} from 'lucide-react';
import type { ExportFormat, ExportPlatform } from '@/lib/excel-export';

export interface DriveExportResult {
  fileName: string;
  webViewLink?: string;
}

export interface ExportProductsModalProps {
  open: boolean;
  onClose: () => void;
  onExport: (options: { platform: ExportPlatform; format: ExportFormat; destination?: 'download' | 'drive' }) => void | Promise<void>;
  exporting: boolean;
  count: number;
  driveResult?: DriveExportResult | null;
  onExportAnother?: () => void;
}

const PLATFORM_OPTIONS = [
  {
    value: 'generico' as const,
    label: 'Genérico',
    icon: FileSpreadsheet,
    description: 'Planilla de Vynko con todos los campos del producto (uso propio o backup).',
  },
  {
    value: 'tiendanube' as const,
    label: 'Tiendanube',
    icon: Store,
    description: 'Encabezados que acepta la importación de productos de Tiendanube.',
  },
  {
    value: 'mercadolibre' as const,
    label: 'MercadoLibre',
    icon: ShoppingBag,
    description: 'Estructura de la plantilla de publicación masiva de MercadoLibre.',
  },
];

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

export function ExportProductsModal({
  open,
  onClose,
  onExport,
  exporting,
  count,
  driveResult,
  onExportAnother,
}: ExportProductsModalProps) {
  const [platform, setPlatform] = useState<ExportPlatform>('generico');
  const [format, setFormat] = useState<ExportFormat>('xls');

  const selectedPlatform = PLATFORM_OPTIONS.find((option) => option.value === platform)!;

  // Mientras se sube el archivo no cerramos el modal: si el usuario lo cierra,
  // la subida puede terminar igual y se perdería la confirmación.
  const handleClose = () => {
    if (!exporting) onClose();
  };

  if (driveResult) {
    return (
      <Modal
        open={open}
        onClose={handleClose}
        title="Guardado en Google Drive"
        icon={<CheckCircle2 className="h-6 w-6 text-emerald-500" />}
        className="max-w-md"
        aria-label="Archivo guardado en Google Drive"
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          Listo. Guardamos la planilla en tu Google Drive.
        </p>

        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-800/60">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Archivo
          </p>
          <p className="mt-0.5 break-words text-sm font-medium text-gray-900 dark:text-gray-100">
            {driveResult.fileName}
          </p>
        </div>

        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
          Lo vas a encontrar en tu Drive. También podés abrirlo directamente desde acá.
        </p>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
          {onExportAnother && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onExportAnother}
              className="w-full sm:w-auto"
            >
              Exportar otra
            </Button>
          )}
          {driveResult.webViewLink && (
            <a
              href={driveResult.webViewLink}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full sm:w-auto"
            >
              <Button type="button" variant="outline" size="sm" className="w-full gap-2">
                <ExternalLink className="h-4 w-4" />
                Abrir en Drive
              </Button>
            </a>
          )}
          <Button
            type="button"
            size="sm"
            onClick={onClose}
            className="w-full sm:w-auto"
          >
            Listo
          </Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Exportar productos"
      className="max-w-md"
      aria-label="Exportar productos"
    >
      <p className="text-sm text-gray-500 mb-5">
        Descargá los {count} producto(s) de la lista actual o guardalos directamente en Google Drive.
        Si solo querés un Excel, andá directo con
        <span className="font-medium text-gray-700 dark:text-gray-300"> Genérico</span>.
      </p>

      <div className="space-y-5">
        <div>
          <span className="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
            Tipo de planilla
          </span>
          <SegmentedControl
            ariaLabel="Tipo de planilla"
            value={platform}
            options={PLATFORM_OPTIONS.map(({ value, label }) => ({ value, label }))}
            onChange={setPlatform}
          />
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400 flex items-start gap-1.5">
            <selectedPlatform.icon className="h-3.5 w-3.5 shrink-0 mt-0.5 text-indigo-500" />
            <span>{selectedPlatform.description}</span>
          </p>
        </div>

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
      </div>

      <div className="flex flex-col sm:flex-row sm:justify-end gap-2 mt-6">
        <Button type="button" variant="outline" size="sm" onClick={handleClose} disabled={exporting}>
          Cancelar
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onExport({ platform, format, destination: 'drive' })}
          disabled={exporting}
          className="gap-2"
        >
          {exporting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Cloud className="h-4 w-4" />
          )}
          {exporting ? 'Guardando...' : 'Guardar en Drive'}
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => onExport({ platform, format, destination: 'download' })}
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
