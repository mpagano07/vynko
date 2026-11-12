'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FileText,
  Loader2,
  Package,
  ScanBarcode,
  Shirt,
  ShoppingBasket,
  Sparkles,
  Store,
  Truck,
  Upload,
  UtensilsCrossed,
  Wrench,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { FormLabel } from '@/components/ui/form-label';
import { useAuth } from '@/lib/hooks/useAuth';
import { cn } from '@/lib/utils/cn';
import toast from 'react-hot-toast';

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms)),
  ]);
}

type BusinessType = 'kiosco' | 'bazar' | 'indumentaria' | 'distribuidora' | 'gastronomia' | 'otro';
type SalesMode = 'mostrador' | 'mayorista' | 'mixto';
type FirstAction = 'import' | 'manual' | 'explore';

const BUSINESS_TYPES: { id: BusinessType; label: string; description: string; icon: typeof Store }[] = [
  { id: 'kiosco', label: 'Almacén / Kiosco', description: 'Venta rápida de consumo diario', icon: Store },
  { id: 'bazar', label: 'Bazar / Ferretería', description: 'Catálogo amplio y stock variado', icon: Wrench },
  { id: 'indumentaria', label: 'Indumentaria', description: 'Talles, colores y temporadas', icon: Shirt },
  { id: 'distribuidora', label: 'Distribuidora', description: 'Venta mayorista y remitos', icon: Truck },
  { id: 'gastronomia', label: 'Gastronomía', description: 'Insumos y productos perecederos', icon: UtensilsCrossed },
  { id: 'otro', label: 'Otro rubro', description: 'Arrancá con un catálogo libre', icon: Package },
];

const SALES_MODES: { id: SalesMode; label: string; description: string; icon: typeof ScanBarcode }[] = [
  {
    id: 'mostrador',
    label: 'Mostrador con código de barras',
    description: 'Cobrás rápido en caja y controlás el stock por unidad.',
    icon: ScanBarcode,
  },
  {
    id: 'mayorista',
    label: 'Venta mayorista con remitos',
    description: 'Presupuestos, remitos y cuenta corriente de clientes.',
    icon: FileText,
  },
  {
    id: 'mixto',
    label: 'Mostrador y mayorista',
    description: 'Combinás ventas minoristas y pedidos mayoristas.',
    icon: Sparkles,
  },
];

const FIRST_ACTIONS: { id: FirstAction; label: string; description: string; icon: typeof Upload }[] = [
  {
    id: 'import',
    label: 'Subir mi lista de Excel',
    description: 'Importá tu catálogo desde una planilla.',
    icon: Upload,
  },
  {
    id: 'manual',
    label: 'Cargar mi primer producto',
    description: 'Empezá con un producto cargado a mano.',
    icon: ShoppingBasket,
  },
  {
    id: 'explore',
    label: 'Recorrer el sistema',
    description: 'Conocé el panel y cargá productos cuando quieras.',
    icon: Sparkles,
  },
];

const STEPS = ['Tu negocio', 'Modo de venta', 'Primer paso'];

export default function OnboardingPage() {
  const router = useRouter();
  const { setActiveTenant } = useAuth();
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [step, setStep] = useState(0);
  const [success, setSuccess] = useState(false);
  const [formData, setFormData] = useState<{
    companyName: string;
    ownerName: string;
    businessType: BusinessType | '';
    salesMode: SalesMode | '';
    firstAction: FirstAction;
  }>({
    companyName: '',
    ownerName: '',
    businessType: '',
    salesMode: '',
    firstAction: 'explore',
  });

  const createCompany = useCallback(
    async (
      companyName: string,
      ownerName: string,
      options?: { businessType?: string; salesMode?: string }
    ) => {
      // La sesion viaja en la cookie HttpOnly: no se manda ningun token. La ruta
      // resuelve al usuario desde la cookie del servidor.
      const response = await fetch('/api/onboarding', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          companyName: companyName.trim(),
          ownerName: ownerName.trim(),
          businessType: options?.businessType || undefined,
          salesMode: options?.salesMode || undefined,
        }),
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Error al crear empresa');
      return result as { tenantId: string };
    },
    []
  );

  // Guard definitivo: si el usuario ya pertenece a una empresa, no mostramos el
  // formulario. Se verifica contra /api/session (service role) en lugar de
  // confiar en el estado cacheado del contexto, para que ningún fallo previo
  // pueda dejar a un cliente con cuenta frente al onboarding.
  useEffect(() => {
    let cancelled = false;

    async function checkExistingCompany() {
      try {
        const response = await withTimeout(
          fetch('/api/session', { credentials: 'include' }),
          10_000
        );
        if (cancelled) return;

        // Solo una respuesta OK y con JSON válido nos permite afirmar si el
        // usuario tiene empresa. Cualquier otra cosa (404/500/timeout/network)
        // es un resultado indeterminado: no debemos exponer el formulario a
        // alguien que quizá ya tiene cuenta. Se va al dashboard, cuyos guardas
        // redirigen acá solo si la membresía está definitivamente vacía.
        if (!response.ok) {
          if (!cancelled) {
            // Navegación dura: evita el loop de router.push + reload
            // sobre la misma ruta /onboarding. El proxy re-verifica el estado.
            window.location.replace('/dashboard');
          }
          return;
        }

        const data: {
          user?: { user_metadata?: Record<string, unknown> } | null;
          tenants?: unknown[];
          tenant?: unknown;
          onboarding_pending?: boolean;
        } | null = await response.json().catch(() => null);
        if (cancelled) return;

        // Sin sesion no se muestra el formulario: se manda al login. La cookie es
        // HttpOnly, asi que la unica forma de saberlo es la respuesta del servidor.
        if (!data?.user) {
          if (!cancelled) router.replace('/login');
          return;
        }

        const hasCompany = (data?.tenants?.length ?? 0) > 0 || !!data?.tenant;
        // Flag directo de la DB (onboarding_pending): FALSE = el usuario ya
        // completó el onboarding y NUNCA debe ver este formulario, aunque el
        // listado de sucursales llegue vacío.
        const onboardingPending = data?.onboarding_pending ?? true;

        if (data === null || hasCompany || onboardingPending === false) {
          if (!cancelled) window.location.replace('/dashboard');
        } else {
          // El usuario se registró cargando nombre/empresa, pero la empresa no
          // llegó a crearse (confirmación de email que no pasó por
          // /auth/callback, code verifier perdido, registro sin confirmación).
          // Esos datos viajan en user_metadata: creá la empresa automáticamente
          // para no pedir dos veces lo mismo.
          const meta = (data.user?.user_metadata ?? {}) as Record<string, unknown>;
          const metaCompany = typeof meta.company_name === 'string' ? meta.company_name.trim() : '';
          const metaOwner = typeof meta.full_name === 'string' ? meta.full_name.trim() : '';

          if (metaCompany && metaOwner) {
            try {
              const { tenantId } = await createCompany(metaCompany, metaOwner);
              if (cancelled) return;
              setSuccess(true);
              // Navegación dura, igual que las otras tres salidas de esta pagina
              // (lineas 75, 102 y 135). `router.push` desde /onboarding es la
              // unica navegacion de cliente del archivo: si el router resuelve la
              // transicion sin desmontar (por ejemplo, si el destino se redirige
              // de vuelta a la ruta actual), el componente queda montado con
              // `step === 'success'` y el usuario se queda mirando un cartel que
              // promete un redireccion que no ocurre. Sin errores en consola, que
              // es lo que hace el fallo silencioso.
              //
              // Con `location.replace` el proxy reevalua el estado real: la
              // membresia recien creada y `onboarding_pending` en false, asi que
              // /dashboard esta permitido y entra.
              setActiveTenant(tenantId);
              window.location.replace('/dashboard');
            } catch (error) {
              console.error('Onboarding auto-create error:', error);
              if (!cancelled) {
                // Si no se pudo, mostramos el formulario con los datos ya cargados.
                setFormData((prev) => ({ ...prev, companyName: metaCompany, ownerName: metaOwner }));
                setChecking(false);
              }
            }
          } else {
            setChecking(false);
          }
        }
      } catch (error) {
        console.error('Onboarding check error:', error);
        if (!cancelled) {
          window.location.replace('/dashboard');
        }
      }
    }

    checkExistingCompany();
    return () => {
      cancelled = true;
    };
  }, [router]); // eslint-disable-line react-hooks/exhaustive-deps

  const canContinue =
    step === 0
      ? Boolean(formData.companyName.trim() && formData.ownerName.trim() && formData.businessType)
      : step === 1
        ? Boolean(formData.salesMode)
        : true;

  const handleNext = () => {
    if (!canContinue) return;
    setStep((prev) => Math.min(prev + 1, STEPS.length - 1));
  };

  const handleBack = () => {
    setStep((prev) => Math.max(prev - 1, 0));
  };

  const handleCreateCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);

    try {
      const { tenantId } = await createCompany(formData.companyName, formData.ownerName, {
        businessType: formData.businessType,
        salesMode: formData.salesMode,
      });

      toast.success('Negocio creado exitosamente');
      setSuccess(true);

      // Mismo criterio que en el auto-alta de arriba: la eleccion de empresa
      // activa se persiste al instante y se navega. Esperar al refetch de
      // `/api/session` solo hacia que el usuario mire el cartel de "redirigiendo"
      // durante los segundos que tarda el request, para que la recarga tires
      // todo ese trabajo a la basura.
      setActiveTenant(tenantId);
      const destination =
        formData.firstAction === 'import'
          ? '/products?import=1'
          : formData.firstAction === 'manual'
            ? '/products?create=1'
            : '/dashboard';
      window.location.replace(destination);
    } catch (error: unknown) {
      console.error('Onboarding error:', error, JSON.stringify(error, null, 2));
      const message = error instanceof Error ? error.message : 'Error al crear empresa';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <Card className="w-full max-w-md p-8 bg-gray-800 border border-gray-700 text-center">
          <div className="mb-4">
            <div className="w-16 h-16 bg-green-900/30 border border-green-800/50 rounded-full flex items-center justify-center mx-auto mb-4">
              <Check className="w-8 h-8 text-green-400" />
            </div>
          </div>
          <h2 className="text-2xl font-bold mb-2 text-white">¡Bienvenido!</h2>
          <p className="text-gray-400">
            Tu empresa {formData.companyName} ha sido creada. Redirigiendo...
          </p>
        </Card>
      </div>
    );
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <Card className="w-full max-w-md p-8 bg-gray-800 border border-gray-700 text-center">
          <Image src="/icons/vynkoLogout.png?v=3" alt="Vynko" width={1530} height={590} sizes="128px" className="h-10 w-auto object-contain mx-auto mb-4" />
          <div className="flex justify-center">
            <svg className="h-6 w-6 text-gray-400 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
          </div>
          <p className="mt-3 text-sm text-gray-400">Verificando tu cuenta...</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 px-4 py-8">
      <Card className="w-full max-w-2xl p-6 sm:p-8 bg-gray-800 border border-gray-700">
        <div className="mb-6 text-center">
          <Image src="/icons/vynkoLogout.png?v=3" alt="Vynko" width={1530} height={590} sizes="128px" className="h-10 w-auto object-contain mx-auto mb-2" />
          <h1 className="text-lg font-semibold text-white">Configurá tu negocio</h1>
          <p className="mt-1 text-sm text-gray-400">Son 3 pasos rápidos, menos de 60 segundos.</p>
        </div>

        {/* Stepper */}
        <ol className="mb-6 flex items-center justify-center gap-2 sm:gap-3" aria-label="Pasos de configuración">
          {STEPS.map((label, index) => {
            const isActive = index === step;
            const isDone = index < step;
            return (
              <li key={label} className="flex items-center gap-2 sm:gap-3" aria-current={isActive ? 'step' : undefined}>
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold transition-colors',
                      isDone && 'bg-indigo-600 text-white',
                      isActive && !isDone && 'bg-indigo-500 text-white ring-4 ring-indigo-500/20',
                      !isActive && !isDone && 'bg-gray-700 text-gray-400'
                    )}
                  >
                    {isDone ? <Check className="h-3.5 w-3.5" /> : index + 1}
                  </span>
                  <span className={cn('hidden text-xs font-medium sm:block', isActive ? 'text-white' : 'text-gray-400')}>
                    {label}
                  </span>
                </div>
                {index < STEPS.length - 1 && <span className="h-px w-5 bg-gray-600 sm:w-8" aria-hidden="true" />}
              </li>
            );
          })}
        </ol>

        <form onSubmit={handleCreateCompany} className="space-y-5">
          {step === 0 && (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <FormLabel variant="default" htmlFor="company-name" className="text-gray-300 mb-2">
                    Nombre del negocio
                  </FormLabel>
                  <Input
                    type="text"
                    id="company-name"
                    placeholder="Mi Tienda"
                    value={formData.companyName}
                    onChange={(e) => setFormData((prev) => ({ ...prev, companyName: e.target.value }))}
                    autoFocus
                    required
                    className="bg-gray-700 border-gray-600 text-white placeholder:text-gray-400"
                  />
                </div>
                <div>
                  <FormLabel variant="default" htmlFor="owner-name" className="text-gray-300 mb-2">
                    Tu nombre
                  </FormLabel>
                  <Input
                    type="text"
                    id="owner-name"
                    placeholder="Juan Pérez"
                    value={formData.ownerName}
                    onChange={(e) => setFormData((prev) => ({ ...prev, ownerName: e.target.value }))}
                    required
                    className="bg-gray-700 border-gray-600 text-white placeholder:text-gray-400"
                  />
                </div>
              </div>

              <fieldset>
                <legend className="mb-2 text-sm font-medium text-gray-300">¿Qué tipo de negocio tenés?</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {BUSINESS_TYPES.map((option) => {
                    const Icon = option.icon;
                    const selected = formData.businessType === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setFormData((prev) => ({ ...prev, businessType: option.id }))}
                        className={cn(
                          'flex items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                          selected
                            ? 'border-indigo-500 bg-indigo-500/10'
                            : 'border-gray-600 bg-gray-900/40 hover:border-gray-500 hover:bg-gray-900/70'
                        )}
                      >
                        <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', selected ? 'text-indigo-400' : 'text-gray-400')} />
                        <span>
                          <span className="block text-sm font-semibold text-white">{option.label}</span>
                          <span className="block text-xs text-gray-400">{option.description}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            </div>
          )}

          {step === 1 && (
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-gray-300">¿Cómo vendés principalmente?</legend>
              <div className="space-y-2">
                {SALES_MODES.map((option) => {
                  const Icon = option.icon;
                  const selected = formData.salesMode === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setFormData((prev) => ({ ...prev, salesMode: option.id }))}
                      className={cn(
                        'flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                        selected
                          ? 'border-indigo-500 bg-indigo-500/10'
                          : 'border-gray-600 bg-gray-900/40 hover:border-gray-500 hover:bg-gray-900/70'
                      )}
                    >
                      <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', selected ? 'text-indigo-400' : 'text-gray-400')} />
                      <span>
                        <span className="block text-sm font-semibold text-white">{option.label}</span>
                        <span className="block text-xs text-gray-400">{option.description}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </fieldset>
          )}

          {step === 2 && (
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-gray-300">¿Con qué querés arrancar?</legend>
              <div className="space-y-2">
                {FIRST_ACTIONS.map((option) => {
                  const Icon = option.icon;
                  const selected = formData.firstAction === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setFormData((prev) => ({ ...prev, firstAction: option.id }))}
                      className={cn(
                        'flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                        selected
                          ? 'border-indigo-500 bg-indigo-500/10'
                          : 'border-gray-600 bg-gray-900/40 hover:border-gray-500 hover:bg-gray-900/70'
                      )}
                    >
                      <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', selected ? 'text-indigo-400' : 'text-gray-400')} />
                      <span>
                        <span className="block text-sm font-semibold text-white">{option.label}</span>
                        <span className="block text-xs text-gray-400">{option.description}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </fieldset>
          )}

          <div className="flex items-center justify-between gap-3 pt-2">
            {step > 0 ? (
              <Button type="button" variant="outline" onClick={handleBack} className="flex items-center gap-2">
                <ArrowLeft className="h-4 w-4" /> Atrás
              </Button>
            ) : (
              <span />
            )}

            {step < STEPS.length - 1 ? (
              <Button type="button" onClick={handleNext} disabled={!canContinue} className="flex items-center gap-2">
                Continuar <ArrowRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button type="submit" disabled={loading || !canContinue} className="flex items-center gap-2">
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Creando negocio...
                  </>
                ) : (
                  <>
                    Crear negocio <Check className="h-4 w-4" />
                  </>
                )}
              </Button>
            )}
          </div>
        </form>

        <p className="text-xs text-gray-400 text-center mt-4">
          Podés sumar a tu equipo más adelante.
        </p>
      </Card>
    </div>
  );
}
