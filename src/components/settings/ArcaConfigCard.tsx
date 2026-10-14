'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { FormLabel } from '@/components/ui/form-label';
import { authFetch } from '@/lib/fetchWithTenant';
import {
  FileText,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  Save,
  HelpCircle,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  ShieldCheck,
  Upload,
  Sparkles,
} from 'lucide-react';
import toast from 'react-hot-toast';
import type { ArcaConfig, ArcaEnvironment, ArcaConcept } from '@/lib/types/arca';

function formatCuit(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 10) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
  return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`;
}

export function ArcaConfigCard() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [savingSandbox, setSavingSandbox] = useState(false);

  const [config, setConfig] = useState<ArcaConfig | null>(null);

  const [form, setForm] = useState<{
    cuit: string;
    punto_venta: number;
    environment: ArcaEnvironment;
    concept: ArcaConcept;
    cert_pem: string;
    key_pem: string;
  }>({
    cuit: '',
    punto_venta: 1,
    environment: 'homologacion',
    concept: 1,
    cert_pem: '',
    key_pem: '',
  });

  const [certFileName, setCertFileName] = useState<string>('');
  const [keyFileName, setKeyFileName] = useState<string>('');

  const fetchConfig = useCallback(async () => {
    try {
      const res = await authFetch('/api/arca/config');
      if (res.ok) {
        const data: ArcaConfig = await res.json();
        setConfig(data);
        setForm((prev) => ({
          ...prev,
          cuit: formatCuit(data.cuit || ''),
          punto_venta: data.punto_venta || 1,
          environment: data.environment || 'homologacion',
          concept: data.concept || 1,
        }));
      }
    } catch (err: unknown) {
      console.warn('Could not load ARCA config on mount:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchConfig();
  }, [fetchConfig]);

  const handleFileUpload = (
    e: React.ChangeEvent<HTMLInputElement>,
    type: 'cert' | 'key'
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (type === 'cert') {
        setForm((prev) => ({ ...prev, cert_pem: content }));
        setCertFileName(file.name);
        toast.success(`Certificado "${file.name}" cargado`);
      } else {
        setForm((prev) => ({ ...prev, key_pem: content }));
        setKeyFileName(file.name);
        toast.success(`Clave privada "${file.name}" cargada`);
      }
    };
    reader.readAsText(file);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await authFetch('/api/arca/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cuit: form.cuit,
          punto_venta: Number(form.punto_venta) || 1,
          environment: form.environment,
          concept: Number(form.concept) || 1,
          cert_pem: form.cert_pem || undefined,
          key_pem: form.key_pem || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al guardar');

      toast.success('Configuración de ARCA guardada exitosamente');
      await fetchConfig();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    try {
      const res = await authFetch('/api/arca/test', { method: 'POST' });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || 'Falló la prueba de conexión');

      toast.success(
        `¡Conexión exitosa con ARCA!\nServidores: OK (App: ${data.serverHealth?.appServer})\nÚltimo comprobante registrado: ${data.lastVoucher}`
      );
      await fetchConfig();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error al conectar con ARCA');
      await fetchConfig();
    } finally {
      setTesting(false);
    }
  };

  const handleEnableSandbox = async () => {
    setSavingSandbox(true);
    try {
      const res = await authFetch('/api/arca/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cuit: '20-40937847-2',
          punto_venta: 1,
          environment: 'homologacion',
          concept: 1,
          is_sandbox: true,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al activar Sandbox');

      await authFetch('/api/arca/test', { method: 'POST' });

      toast.success('¡Modo Sandbox activado! Ya podés emitir facturas de prueba.');
      await fetchConfig();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error al activar Sandbox');
    } finally {
      setSavingSandbox(false);
    }
  };

  const handleDisableSandbox = async () => {
    setSavingSandbox(true);
    try {
      const res = await authFetch('/api/arca/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cuit: form.cuit,
          punto_venta: Number(form.punto_venta) || 1,
          environment: 'homologacion',
          concept: 1,
          is_sandbox: false,
          cert_pem: '',
          key_pem: '',
        }),
      });

      if (!res.ok) throw new Error('Error al desactivar Sandbox');

      toast.success('Modo Sandbox desactivado. Podés cargar tus credenciales reales.');
      await fetchConfig();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error al desactivar Sandbox');
    } finally {
      setSavingSandbox(false);
    }
  };

  if (loading) {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
        </div>
      </Card>
    );
  }

  const isConnected = config?.is_active;

  return (
    <Card className="p-6 space-y-6">
      {/* Encabezado */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-100 dark:border-gray-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-indigo-500" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Facturación Electrónica ARCA (ex-AFIP)
            </h2>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Conectá tu punto de venta Web Services para emitir Facturas A, B y C autorizadas con CAE.
          </p>
        </div>

        {/* Estado actual */}
        <div className="flex items-center gap-2">
          {config?.is_sandbox ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300 border border-purple-300 dark:border-purple-700">
              <Sparkles className="h-3.5 w-3.5 text-purple-600 dark:text-purple-400" />
              Modo Sandbox Activo (Pruebas)
            </span>
          ) : isConnected ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Conectado ({config?.environment === 'produccion' ? 'Producción' : 'Homologación / Test'})
            </span>
          ) : config?.last_error ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400 border border-red-200 dark:border-red-800">
              <XCircle className="h-3.5 w-3.5" />
              Error de conexión
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
              <AlertTriangle className="h-3.5 w-3.5" />
              Pendiente de configurar
            </span>
          )}
        </div>
      </div>

      {/* Banner de Modo Sandbox */}
      {!isConnected && !config?.is_sandbox ? (
        <div className="p-4 rounded-lg bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-950 dark:text-indigo-200">
              <Sparkles className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
              ¿No tenés CUIT o certificados de ARCA todavía?
            </div>
            <p className="text-xs text-indigo-800/80 dark:text-indigo-300/80 mt-0.5">
              Activá el <strong>Modo Sandbox</strong> para probar de inmediato la emisión de Facturas A, B y C con CAE y código QR simulados sin trámites.
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            disabled={savingSandbox}
            onClick={handleEnableSandbox}
            className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs flex items-center gap-1.5 shrink-0"
          >
            {savingSandbox ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Activando...
              </>
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5" />
                Activar Modo Sandbox
              </>
            )}
          </Button>
        </div>
      ) : config?.is_sandbox ? (
        <div className="p-3.5 rounded-lg bg-purple-50/70 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="text-xs text-purple-900 dark:text-purple-200">
            <strong>Modo Sandbox Activo:</strong> Estás probando con el CUIT de test <code>20-40937847-2</code>. Las facturas que emitas se guardan en tu base de datos con CAE y código QR oficial simulado.
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={savingSandbox}
            onClick={handleDisableSandbox}
            className="text-xs border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-300 shrink-0"
          >
            Desactivar Sandbox
          </Button>
        </div>
      ) : null}

      {config?.last_error && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300">
          <strong>Último error reportado por ARCA:</strong> {config.last_error}
        </div>
      )}

      {/* Formulario de Configuración */}
      <form onSubmit={handleSave} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <FormLabel>CUIT Emisor</FormLabel>
            <Input
              type="text"
              required
              placeholder="20-12345678-9"
              value={form.cuit}
              onChange={(e) => setForm({ ...form, cuit: formatCuit(e.target.value) })}
            />
          </div>

          <div>
            <FormLabel>Punto de Venta Web Services</FormLabel>
            <Input
              type="number"
              min={1}
              required
              placeholder="1"
              value={form.punto_venta}
              onChange={(e) => setForm({ ...form, punto_venta: parseInt(e.target.value, 10) || 1 })}
            />
            <p className="text-[11px] text-gray-400 mt-1">
              Debe ser tipo &ldquo;Factura Electrónica - Web Services&rdquo; en ARCA
            </p>
          </div>

          <div>
            <FormLabel>Entorno de Operación</FormLabel>
            <Select
              value={form.environment}
              onChange={(e) => setForm({ ...form, environment: e.target.value as ArcaEnvironment })}
            >
              <option value="homologacion">Homologación (Pruebas sin valor fiscal)</option>
              <option value="produccion">Producción (Comprobantes oficiales reales)</option>
            </Select>
          </div>

          <div>
            <FormLabel>Concepto Predeterminado</FormLabel>
            <Select
              value={String(form.concept)}
              onChange={(e) => setForm({ ...form, concept: Number(e.target.value) as ArcaConcept })}
            >
              <option value="1">1 - Productos / Bienes</option>
              <option value="2">2 - Servicios</option>
              <option value="3">3 - Productos y Servicios</option>
            </Select>
          </div>
        </div>

        {/* Carga de Credenciales */}
        <div className="border border-gray-200 dark:border-gray-800 rounded-lg p-4 bg-gray-50/50 dark:bg-gray-900/30 space-y-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
              Certificados Digitales de ARCA
            </h3>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Tus claves privadas se almacenan en la base de datos cifradas mediante AES-256-GCM y nunca se exponen al navegador.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Certificado X.509 (.crt) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <FormLabel>Certificado Digital (.crt / .pem)</FormLabel>
                {config?.has_cert && (
                  <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Certificado activo
                  </span>
                )}
              </div>
              <label className="flex flex-col items-center justify-center border-2 border-dashed border-gray-300 dark:border-gray-700 hover:border-indigo-400 rounded-lg p-4 cursor-pointer bg-white dark:bg-gray-800/50 transition-colors">
                <Upload className="h-5 w-5 text-gray-400 mb-1" />
                <span className="text-xs text-gray-600 dark:text-gray-300 text-center font-medium">
                  {certFileName || (config?.has_cert ? 'Reemplazar certificado (.crt)' : 'Seleccionar archivo .crt')}
                </span>
                <span className="text-[10px] text-gray-400 mt-0.5">Emitido por ARCA para tu CUIT</span>
                <input
                  type="file"
                  accept=".crt,.pem,.txt"
                  className="hidden"
                  onChange={(e) => handleFileUpload(e, 'cert')}
                />
              </label>
            </div>

            {/* Clave Privada (.key) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <FormLabel>Clave Privada (.key)</FormLabel>
                {config?.has_key && (
                  <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Clave cifrada guardada
                  </span>
                )}
              </div>
              <label className="flex flex-col items-center justify-center border-2 border-dashed border-gray-300 dark:border-gray-700 hover:border-indigo-400 rounded-lg p-4 cursor-pointer bg-white dark:bg-gray-800/50 transition-colors">
                <Upload className="h-5 w-5 text-gray-400 mb-1" />
                <span className="text-xs text-gray-600 dark:text-gray-300 text-center font-medium">
                  {keyFileName || (config?.has_key ? 'Reemplazar clave privada (.key)' : 'Seleccionar archivo .key')}
                </span>
                <span className="text-[10px] text-gray-400 mt-0.5">Clave RSA generada con tu CSR</span>
                <input
                  type="file"
                  accept=".key,.pem,.txt"
                  className="hidden"
                  onChange={(e) => handleFileUpload(e, 'key')}
                />
              </label>
            </div>
          </div>
        </div>

        {/* Acciones */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setShowGuide(!showGuide)}
            className="text-xs flex items-center gap-1.5"
          >
            <HelpCircle className="h-4 w-4 text-indigo-500" />
            {showGuide ? 'Ocultar guía de ARCA' : '¿Cómo obtener estos certificados en ARCA?'}
            {showGuide ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </Button>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={testing || saving || (!config?.has_cert && !form.cert_pem)}
              onClick={handleTestConnection}
              className="flex items-center gap-1.5"
            >
              {testing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />
                  Probando conexión...
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  Probar Conexión con ARCA
                </>
              )}
            </Button>

            <Button type="submit" disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  Guardando...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-1" />
                  Guardar Configuración
                </>
              )}
            </Button>
          </div>
        </div>
      </form>

      {/* Guía Desplegable Paso a Paso */}
      {showGuide && (
        <div className="mt-4 p-4 rounded-lg bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-900/40 text-xs space-y-3">
          <h4 className="font-semibold text-indigo-950 dark:text-indigo-200 flex items-center gap-1.5">
            <ExternalLink className="h-3.5 w-3.5" />
            Paso a paso para conectar tu cuenta en el portal de ARCA (con Clave Fiscal)
          </h4>

          <ol className="list-decimal list-inside space-y-2 text-gray-700 dark:text-gray-300">
            <li>
              <strong>Crear el Punto de Venta:</strong> Entrá a <em>&ldquo;Administración de Puntos de Venta y Domicilios&rdquo;</em>, agregá un nuevo punto de venta y en el campo <em>&ldquo;Sistema&rdquo;</em> elegí obligatoriamente <strong>&ldquo;Facturación Electrónica - Web Services&rdquo;</strong>.
            </li>
            <li>
              <strong>Generar tu Certificado Digital:</strong> En <em>&ldquo;Administración de Certificados Digitales&rdquo;</em>, creá un alias (computador fiscal) y subí tu pedido de certificado (CSR). ARCA te descargará un archivo <code>.crt</code>.
            </li>
            <li>
              <strong>Asociar el Servicio:</strong> En <em>&ldquo;Administrador de Relaciones de Clave Fiscal&rdquo;</em>, vinculá tu computador fiscal recién creado con el servicio <strong>&ldquo;Facturación Electrónica&rdquo; (wsfe)</strong>.
            </li>
            <li>
              <strong>Cargar en Vynko:</strong> Subí acá el archivo <code>.crt</code> y el <code>.key</code>, ingresá el número de punto de venta que diste de alta y hacé click en <strong>&ldquo;Probar Conexión con ARCA&rdquo;</strong>.
            </li>
          </ol>
        </div>
      )}
    </Card>
  );
}
