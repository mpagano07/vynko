import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { authFetch } from '@/lib/fetchWithTenant';
import OnboardingChecklist from './OnboardingChecklist';

vi.mock('@/lib/fetchWithTenant', () => ({ authFetch: vi.fn(async () => new Response('{}')) }));

const pending = {
  hasProducts: false,
  hasSales: false,
  hasAlerts: false,
  hasPendingOrders: false,
  userId: 'user-1',
};

function hide() {
  fireEvent.click(screen.getByRole('button', { name: 'Ocultar checklist' }));
  fireEvent.click(screen.getByRole('button', { name: /Sí, ocultar/ }));
}

describe('OnboardingChecklist', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(authFetch).mockClear();
    vi.mocked(authFetch).mockResolvedValue(new Response('{}'));
  });

  it('muestra la guia cuando no hay flag ni pasos completados', () => {
    render(<OnboardingChecklist {...pending} fallback={<p>panel</p>} />);
    expect(screen.getByText('Primeros pasos')).toBeTruthy();
    expect(screen.getByText('Cargá tu primer producto')).toBeTruthy();
  });

  it('NO la muestra si el flag del servidor esta puesto', () => {
    render(
      <OnboardingChecklist {...pending} dismissedAt="2026-01-10T10:00:00Z" fallback={<p>panel</p>} />
    );
    expect(screen.queryByText('Primeros pasos')).toBeNull();
    expect(screen.getByText('panel')).toBeTruthy();
  });

  it('tampoco la muestra si el usuario la oculto en ESTE navegador', () => {
    localStorage.setItem('vynko_onboarding_dismissed_user-1', 'true');
    render(<OnboardingChecklist {...pending} fallback={<p>panel</p>} />);
    expect(screen.queryByText('Primeros pasos')).toBeNull();
  });

  // El bug reportado: el flag vivia solo en localStorage, asi que la misma
  // cuenta la veia en el celular y no en la PC. El flag del servidor tiene que
  // ganarle aunque el componente ya haya montado con "todo bien".
  it('se oculta si el flag del servidor llega despues del primer render', () => {
    const { rerender } = render(<OnboardingChecklist {...pending} dismissedAt={null} fallback={<p>panel</p>} />);
    expect(screen.getByText('Primeros pasos')).toBeTruthy();

    rerender(
      <OnboardingChecklist {...pending} dismissedAt="2026-01-10T10:00:00Z" fallback={<p>panel</p>} />
    );
    expect(screen.queryByText('Primeros pasos')).toBeNull();
    expect(screen.getByText('panel')).toBeTruthy();
  });

  it('se oculta cuando estan todos los pasos completos, sin tocar nada', () => {
    render(
      <OnboardingChecklist
        {...pending}
        hasProducts
        hasSales
        hasAlerts
        hasPendingOrders
        fallback={<p>panel</p>}
      />
    );
    expect(screen.queryByText('Primeros pasos')).toBeNull();
  });

  it('guarda la preferencia en la cuenta al confirmar el ocultado', () => {
    render(<OnboardingChecklist {...pending} fallback={<p>panel</p>} />);
    hide();

    expect(screen.queryByText('Primeros pasos')).toBeNull();
    expect(authFetch).toHaveBeenCalledWith(
      '/api/onboarding/checklist',
      expect.objectContaining({ method: 'PATCH' })
    );
    const body = vi.mocked(authFetch).mock.calls[0][1]?.body;
    expect(JSON.parse(String(body))).toEqual({ dismissed: true });
  });

  it('no rompe si el PATCH falla (offline)', () => {
    vi.mocked(authFetch).mockRejectedValue(new Error('offline'));
    render(<OnboardingChecklist {...pending} fallback={<p>panel</p>} />);
    hide();
    expect(screen.queryByText('Primeros pasos')).toBeNull();
  });

  it('la guia reactivada desde settings gana sobre el flag del servidor', () => {
    localStorage.setItem('vynko_onboarding_force_show_user-1', 'true');
    render(
      <OnboardingChecklist {...pending} dismissedAt="2026-01-10T10:00:00Z" fallback={<p>panel</p>} />
    );
    expect(screen.getByText('Primeros pasos')).toBeTruthy();
  });
});