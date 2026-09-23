'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { FormLabel } from '@/components/ui/form-label';
import { useAuth } from '@/lib/hooks/useAuth';
import toast from 'react-hot-toast';

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms)),
  ]);
}

export default function OnboardingPage() {
  const router = useRouter();
  const { switchTenant } = useAuth();
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [step, setStep] = useState<'company' | 'success'>('company');
  const [formData, setFormData] = useState({
    companyName: '',
    ownerName: '',
  });

  const createCompany = useCallback(async (companyName: string, ownerName: string) => {
    const sessionResult = await supabase.auth.getSession();
    const accessToken = sessionResult.data.session?.access_token;
    const refreshToken = sessionResult.data.session?.refresh_token;

    const response = await fetch('/api/onboarding', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...(refreshToken ? { 'x-refresh-token': refreshToken } : {}),
      },
      body: JSON.stringify({
        companyName: companyName.trim(),
        ownerName: ownerName.trim(),
      }),
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Error al crear empresa');
    return result as { tenantId: string };
  }, []);

  // Guard definitivo: si el usuario ya pertenece a una empresa, no mostramos el
  // formulario. Se verifica contra /api/session (service role) en lugar de
  // confiar en el estado cacheado del contexto, para que ningún fallo previo
  // pueda dejar a un cliente con cuenta frente al onboarding.
  useEffect(() => {
    let cancelled = false;

    async function checkExistingCompany() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          if (!cancelled) router.replace('/login');
          return;
        }

        const response = await withTimeout(
          fetch('/api/session', {
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              'x-refresh-token': session.refresh_token ?? '',
            },
          }),
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
            // Navegación dura única: evita el loop de router.push + reload
            // sobre la misma ruta /onboarding. El proxy re-verifica el estado.
            window.location.replace('/dashboard');
          }
          return;
        }

        const data: { tenants?: unknown[]; tenant?: unknown; onboarding_pending?: boolean } | null =
          await response.json().catch(() => null);
        if (cancelled) return;

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
          const meta = (session.user?.user_metadata ?? {}) as Record<string, unknown>;
          const metaCompany = typeof meta.company_name === 'string' ? meta.company_name.trim() : '';
          const metaOwner = typeof meta.full_name === 'string' ? meta.full_name.trim() : '';

          if (metaCompany && metaOwner) {
            try {
              const { tenantId } = await createCompany(metaCompany, metaOwner);
              if (cancelled) return;
              setStep('success');
              await switchTenant(tenantId);
              router.push('/dashboard');
            } catch (error) {
              console.error('Onboarding auto-create error:', error);
              if (!cancelled) {
                // Si no se pudo, mostramos el formulario con los datos ya cargados.
                setFormData({ companyName: metaCompany, ownerName: metaOwner });
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

  const handleCreateCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { tenantId } = await createCompany(formData.companyName, formData.ownerName);

      toast.success('Empresa creada exitosamente');
      setStep('success');

      await switchTenant(tenantId);
      router.push('/dashboard');
    } catch (error: unknown) {
      console.error('Onboarding error:', error, JSON.stringify(error, null, 2));
      const message = error instanceof Error ? error.message : 'Error al crear empresa';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  if (step === 'success') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <Card className="w-full max-w-md p-8 bg-gray-800 border border-gray-700 text-center">
          <div className="mb-4">
            <div className="w-16 h-16 bg-green-900/30 border border-green-800/50 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg
                className="w-8 h-8 text-green-400"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
          </div>
          <h2 className="text-2xl font-bold mb-2 text-white">¡Bienvenido!</h2>
          <p className="text-gray-400">
            Tu empresa {formData.companyName} ha sido creada. Redirigiendo al dashboard...
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
    <div className="min-h-screen flex items-center justify-center bg-gray-900">
      <Card className="w-full max-w-md p-8 bg-gray-800 border border-gray-700">
        <div className="mb-8 text-center">
          <Image src="/icons/vynkoLogout.png?v=3" alt="Vynko" width={1530} height={590} sizes="128px" className="h-10 w-auto object-contain mx-auto mb-2" />
          <p className="text-gray-400">Configura tu empresa</p>
        </div>

        <form onSubmit={handleCreateCompany} className="space-y-4">
          <div>
            <FormLabel variant="default" htmlFor="company-name" className="text-gray-300 mb-2">
              Nombre de la empresa
            </FormLabel>
            <Input
              type="text"
              id="company-name"
              placeholder="Mi Tienda"
              value={formData.companyName}
              onChange={(e) =>
                setFormData({ ...formData, companyName: e.target.value })
              }
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
              onChange={(e) =>
                setFormData({ ...formData, ownerName: e.target.value })
              }
              required
              className="bg-gray-700 border-gray-600 text-white placeholder:text-gray-400"
            />
          </div>

          <Button
            type="submit"
            disabled={loading || !formData.companyName || !formData.ownerName}
            className="w-full"
          >
            {loading ? 'Creando empresa...' : 'Crear empresa'}
          </Button>
        </form>

        <p className="text-xs text-gray-400 text-center mt-4">
          Podrás invitar más usuarios después
        </p>
      </Card>
    </div>
  );
}
