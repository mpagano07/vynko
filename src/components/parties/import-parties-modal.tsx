'use client';

import React, { useState } from 'react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { Thead, Th } from '@/components/ui/table-header';
import { Tooltip } from '@/components/ui/tooltip';
import { Loader2, Upload, FileSpreadsheet } from 'lucide-react';
import toast from 'react-hot-toast';
import { authFetch } from '@/lib/fetchWithTenant';
import { readImportStream, type ImportProgressState } from '@/lib/import-stream';
import { IMPORT_FILE_ERROR } from '@/lib/excel-import-errors';
import type { PartyImportKind } from '@/lib/party-import';

export interface ImportPartiesModalProps {
  kind: PartyImportKind;
  open: boolean;
  onClose: () => void;
  /** Refresca la lista de la página cuando el import termina (con o sin omitidos). */
  onImported: () => void;
}

const KIND_TEXT: Record<PartyImportKind, {
  title: string;
  singular: string;
  plural: string;
  endpoint: string;
  bodyKey: string;
  columnTooltip: string;
  columns: { label: string; detail: string }[];
  footer: string;
}> = {
  customers: {
    title: 'Importar clientes desde Excel o CSV',
    singular: 'cliente',
    plural: 'cliente(s)',
    endpoint: '/api/customers/import',
    bodyKey: 'customers',
    columnTooltip: "Solo 'Nombre' es obligatorio. Las demás columnas son opcionales y podés usar nombres en español o inglés.",
    columns: [
      { label: 'Nombre *', detail: 'obligatorio. Ej: Juan Pérez' },
      { label: 'CUIT', detail: 'con o sin guiones. Ej: 20-12345678-9' },
      { label: 'Condición IVA', detail: 'Responsable Inscripto, Monotributista, etc.' },
      { label: 'Tipo de documento', detail: 'DNI, CUIT, Pasaporte, etc.' },
      { label: 'Número de documento', detail: 'Ej: 12345678' },
      { label: 'Email', detail: 'Ej: juan@ejemplo.com' },
      { label: 'Teléfono', detail: 'Ej: 11 1234-5678' },
      { label: 'Dirección', detail: 'domicilio del cliente' },
    ],
    footer: 'Un cliente existente con el mismo CUIT (o nombre) se actualiza en vez de duplicarse.',
  },
  suppliers: {
    title: 'Importar proveedores desde Excel o CSV',
    singular: 'proveedor',
    plural: 'proveedor(es)',
    endpoint: '/api/suppliers/import',
    bodyKey: 'suppliers',
    columnTooltip: "Solo 'Nombre' es obligatorio. Las demás columnas son opcionales y podés usar nombres en español o inglés.",
    columns: [
      { label: 'Nombre *', detail: 'obligatorio. Ej: Distribuidora SA' },
      { label: 'Contacto', detail: 'persona de contacto. Ej: María Gómez' },
      { label: 'CUIT', detail: 'con o sin guiones. Ej: 30-12345678-9' },
      { label: 'Condición IVA', detail: 'Responsable Inscripto, Monotributista, etc.' },
      { label: 'Tipo de documento', detail: 'CUIT, DNI, Pasaporte, etc.' },
      { label: 'Número de documento', detail: 'Ej: 12345678' },
      { label: 'Email', detail: 'Ej: ventas@distribuidora.com' },
      { label: 'Teléfono', detail: 'Ej: 11 1234-5678' },
      { label: 'Dirección', detail: 'domicilio del proveedor' },
      { label: 'Notas', detail: 'observaciones' },
    ],
    footer: 'Un proveedor existente con el mismo CUIT (o nombre) se actualiza en vez de duplicarse.',
  },
};

/**
 * Modal de importación de clientes y proveedores: mismo flujo que el de
 * productos (elegir archivo → preview → importar con progreso → reporte por
 * fila) pero parametrizado por `kind`, porque la única diferencia entre las
 * dos páginas es la tabla destino, el permiso y las columnas.
 */
export function ImportPartiesModal({ kind, open, onClose, onImported }: ImportPartiesModalProps) {
  const text = KIND_TEXT[kind];

  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState<{ row: number; status: string; name?: string; error?: string }[] | null>(null);
  const [showColumnInfo, setShowColumnInfo] = useState(false);
  const [progress, setProgress] = useState<ImportProgressState | null>(null);

  const close = () => {
    setRows([]);
    setColumns([]);
    setResults(null);
    setShowColumnInfo(false);
    setProgress(null);
    onClose();
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setResults(null);

    try {
      // El parser se carga recién acá: fuera del bundle inicial de la página.
      const { parsePartyWorkbookFile, validateSpreadsheetFile } = await import('@/lib/excel-import-parse');

      // Nombre, peso y tipo se miran antes de `arrayBuffer()`: leer el buffer
      // de un archivo enorme es lo que cuelga la pestaña, y el atributo
      // `accept` del input es solo una sugerencia que se esquiva con "mostrar
      // todos los archivos".
      const check = validateSpreadsheetFile(file);
      if (!check.ok) {
        toast.error(check.error);
        return;
      }

      const buf = await file.arrayBuffer();
      const parsed = await parsePartyWorkbookFile(buf, { fileName: file.name });
      if (!parsed.ok) {
        toast.error(parsed.error);
        return;
      }

      setColumns(parsed.columns);
      setRows(parsed.rows);
      toast.success(`${parsed.rows.length} ${text.plural} leídos del archivo`);
    } catch {
      toast.error(IMPORT_FILE_ERROR);
    }
  };

  const handleImport = async () => {
    if (rows.length === 0) return;
    setImporting(true);
    setResults(null);
    setProgress(null);

    try {
      const res = await authFetch(text.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [text.bodyKey]: rows }),
      });

      // Las guardas (401/403/413/429) siguen llegando como JSON con su status;
      // el stream recién arranca cuando el servidor ya aceptó el archivo.
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Error al importar');
      }

      const data = await readImportStream(res.body, (p) => setProgress(p));

      setResults(data.results);
      const { created, updated, skipped } = data.summary;
      // Un import con filas omitidas no es un import limpio: el toast lo dice,
      // porque el detalle fila por fila queda escondido en la tabla de
      // resultados y un verde sin más parece que las 2000 filas entraron.
      if (skipped > 0) {
        toast.error(
          `Importación terminada con ${skipped} fila(s) omitidas: ${created} creados, ${updated} actualizados. Revisá la tabla de resultados.`,
          { duration: 8000 },
        );
      } else {
        toast.success(`Importación completada: ${created} creados, ${updated} actualizados`);
      }
      onImported();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error');
    } finally {
      setImporting(false);
      setProgress(null);
    }
  };

  return (
    <Modal open={open} onClose={close} className="max-w-3xl flex flex-col max-h-[90vh]" aria-label={text.title}>
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white">{text.title}</h2>
        <Tooltip content={text.columnTooltip}>
          <button
            type="button"
            onClick={() => setShowColumnInfo(!showColumnInfo)}
            aria-expanded={showColumnInfo}
            aria-controls="import-column-info"
            className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-sm font-semibold text-indigo-700 transition-colors hover:bg-indigo-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-indigo-500/40 dark:bg-indigo-500/10 dark:text-indigo-300 dark:hover:bg-indigo-500/20"
          >
            {showColumnInfo ? 'Ocultar columnas' : '¿Qué columnas usar?'}
          </button>
        </Tooltip>
      </div>
      <p className="text-sm text-gray-500 mb-4">
        Subí un archivo <span className="font-medium text-gray-700 dark:text-gray-300">.xlsx, .xls o .csv</span> con los {text.plural} a importar. Revisá{' '}
        <button
          type="button"
          onClick={() => setShowColumnInfo(true)}
          className="font-medium text-indigo-600 underline underline-offset-2 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
        >
          qué columnas usar
        </button>{' '}
        antes de subirlo.
      </p>

      {showColumnInfo && (
        <div id="import-column-info" className="bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4 mb-6 text-xs text-gray-600 dark:text-gray-400 space-y-1.5">
          <p className="font-semibold text-gray-700 dark:text-gray-300 mb-2">Columnas del archivo:</p>
          {text.columns.map((col) => (
            <div key={col.label}>
              <span className="font-medium text-gray-900 dark:text-gray-100">{col.label}</span> — {col.detail}
            </div>
          ))}
          <p className="text-xs text-gray-400 dark:text-gray-500 pt-1">{text.footer}</p>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl">
          <FileSpreadsheet className="h-12 w-12 text-gray-400 mb-4" />
          <p className="text-sm text-gray-500 mb-4">Seleccioná un archivo Excel o CSV para comenzar</p>
          <label className="cursor-pointer">
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFile} />
            <span className="inline-flex items-center gap-2 px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-black font-semibold rounded-lg text-sm transition-colors">
              <Upload className="h-4 w-4" />
              Seleccionar archivo
            </span>
          </label>
        </div>
      ) : results ? (
        <div className="space-y-4">
          <div className="flex items-center gap-3 text-sm">
            <StatusBadge size="md" tone="emerald" className="font-medium">
              {results.filter(r => r.status === 'created').length} creados
            </StatusBadge>
            <StatusBadge size="md" tone="blue" className="font-medium">
              {results.filter(r => r.status === 'updated').length} actualizados
            </StatusBadge>
            <StatusBadge size="md" tone="grayMuted" className="font-medium">
              {results.filter(r => r.status === 'skipped').length} omitidos
            </StatusBadge>
          </div>
          <div className="max-h-64 overflow-x-auto overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg">
            <table className="w-full min-w-[600px] text-sm">
              <Thead>
                <Th>Fila</Th>
                <Th>{text.singular}</Th>
                <Th>Resultado</Th>
                <Th>Error</Th>
              </Thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {results.map(r => (
                  <tr key={r.row} className="text-xs">
                    <td className="py-2 px-4 text-gray-500">{r.row}</td>
                    <td className="py-2 px-4 text-gray-900 dark:text-gray-100">{r.name || '—'}</td>
                    <td className="py-2 px-4">
                      <span className={`font-medium ${r.status === 'created' ? 'text-emerald-600' :
                          r.status === 'updated' ? 'text-blue-600' :
                            'text-red-600'
                        }`}>
                        {r.status === 'created' ? 'Creado' : r.status === 'updated' ? 'Actualizado' : 'Omitido'}
                      </span>
                    </td>
                    <td className="py-2 px-4 text-red-500">{r.error || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end">
            <Button onClick={close}>Cerrar</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-sm text-gray-500">
            <span>{rows.length} {text.plural} detectados</span>
            <label className="cursor-pointer text-cyan-500 hover:text-cyan-400 font-medium flex items-center gap-1">
              <Upload className="h-3.5 w-3.5" />
              <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFile} />
              Cambiar archivo
            </label>
          </div>
          <div className="max-h-64 overflow-x-auto overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg">
            <table className="w-full min-w-[600px] text-sm">
              <Thead>
                <Th>#</Th>
                {columns.map(col => (
                  <Th key={col}>{col}</Th>
                ))}
              </Thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {rows.slice(0, 50).map((row, i) => (
                  <tr key={i} className="text-xs hover:bg-gray-50 dark:hover:bg-gray-800/30">
                    <td className="py-2 px-4 text-gray-400">{i + 1}</td>
                    {columns.map(col => (
                      <td key={col} className="py-2 px-4 text-gray-900 dark:text-gray-100 max-w-[200px] truncate">
                        {String(row[col] ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 50 && (
              <p className="text-xs text-center text-gray-500 py-2 border-t border-gray-100 dark:border-gray-800">
                Mostrando 50 de {rows.length} filas
              </p>
            )}
          </div>
          {importing && progress && (
            <div>
              <div className="flex items-center justify-between text-xs text-gray-500 mb-1.5">
                <span>Procesando {progress.processed} de {progress.total}</span>
                <span>{Math.round((progress.processed / Math.max(1, progress.total)) * 100)}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                <div
                  className="h-full rounded-full bg-cyan-500 transition-all duration-200"
                  style={{ width: `${Math.round((progress.processed / Math.max(1, progress.total)) * 100)}%` }}
                />
              </div>
            </div>
          )}
          <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100 dark:border-gray-800">
            <Button variant="outline" onClick={close}>
              Cancelar
            </Button>
            <Button onClick={handleImport} disabled={importing}>
              {importing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Importando
                  {/* El detalle "437 de 2000" ya está en la barra de arriba: en
                      el botón alcanza con la señal de "esto está trabajando".
                      Los tres puntos laten de a uno, en loop, para que se note
                      que la pantalla no se congeló. */}
                  <span className="inline-flex items-center" aria-hidden="true">
                    {[0, 1, 2].map((i) => (
                      <span
                        key={i}
                        className="animate-pulse text-lg leading-none"
                        style={{ animationDelay: `${i * 200}ms` }}
                      >
                        .
                      </span>
                    ))}
                  </span>
                  <span className="sr-only">en curso</span>
                </>
              ) : (
                <>Importar {rows.length} {text.plural}</>
              )}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
