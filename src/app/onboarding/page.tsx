'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/lib/hooks/useAuth';
import toast from 'react-hot-toast';

export default function OnboardingPage() {
  const router = useRouter();
  const { switchTenant } = useAuth();
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'company' | 'success'>('company');
  const [formData, setFormData] = useState({
    companyName: '',
    ownerName: '',
  });

  const handleCreateCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
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
          companyName: formData.companyName,
          ownerName: formData.ownerName,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Error al crear empresa');
      }

      toast.success('Empresa creada exitosamente');
      setStep('success');

      await switchTenant(result.tenantId);
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

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900">
      <Card className="w-full max-w-md p-8 bg-gray-800 border border-gray-700">
        <div className="mb-8 text-center">
          <Image src="/icons/vynkoLogout.png?v=2" alt="Vynko" width={1279} height={396} className="h-10 w-auto object-contain mx-auto mb-2" />
          <p className="text-gray-400">Configura tu empresa</p>
        </div>

        <form onSubmit={handleCreateCompany} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2 text-gray-300">
              Nombre de la empresa
            </label>
            <Input
              type="text"
              placeholder="Mi Tienda"
              value={formData.companyName}
              onChange={(e) =>
                setFormData({ ...formData, companyName: e.target.value })
              }
              required
              className="bg-gray-700 border-gray-600 text-white placeholder:text-gray-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2 text-gray-300">
              Tu nombre
            </label>
            <Input
              type="text"
              placeholder="Juan Pérez"
              value={formData.ownerName}
              onChange={(e) =>
                setFormData({ ...formData, ownerName: e.target.value })
              }
              required
              className="bg-gray-700 border-gray-600 text-white placeholder:text-gray-500"
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

        <p className="text-xs text-gray-500 text-center mt-4">
          Podrás invitar más usuarios después
        </p>
      </Card>
    </div>
  );
}
