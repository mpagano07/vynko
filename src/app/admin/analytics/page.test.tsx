import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AdminAnalyticsPage from './page';
import { useAuth } from '@/lib/hooks/useAuth';
import { authFetch } from '@/lib/fetchWithTenant';
import type { AdminAnalytics } from '@/lib/analytics-service';

const { replaceMock } = vi.hoisted(() => ({ replaceMock: vi.fn() }));
const authFetchMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn() }),
}));

vi.mock('@/lib/hooks/useAuth', () => ({ useAuth: vi.fn() }));

vi.mock('@/lib/fetchWithTenant', () => ({ authFetch: authFetchMock }));

vi.mock('recharts', async () => {
  const React = (await import('react')).default;
  const Stub = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children);
  const Null = () => React.createElement('div', null);
  return {
    ResponsiveContainer: Stub,
    BarChart: Stub,
    Bar: Null,
    XAxis: Null,
    YAxis: Null,
    CartesianGrid: Null,
    Tooltip: Null,
    Legend: Null,
  };
});

const authMock = vi.mocked(useAuth);
const fetchMock = vi.mocked(authFetch);

const funnelStep = (step: number, label: string, users: number) => ({
  step,
  eventType: 'signup' as const,
  label,
  users,
  ofTotal: 100,
  ofPrevious: 100,
  dropped: 0,
});

/**
 * `count` eventos con email propio: el email es la unica fila con texto
 * distinto por evento, asi que sirve para preguntar que filas hay en pantalla.
 */
function analyticsWithEvents(count: number): AdminAnalytics {
  return {
    funnel: [funnelStep(1, 'Se registró', count)],
    breakdown: [],
    signupsByMonth: [{ month: '2026-01', count }],
    activatedByMonth: [],
    subscribedByMonth: [],
    recentEvents: Array.from({ length: count }, (_, i) => ({
      id: `e${i + 1}`,
      event_type: 'signup',
      user_email: `user${i + 1}@ejemplo.com`,
      user_name: null,
      tenant_id: null,
      metadata: {},
      created_at: '2026-01-01T00:00:00.000Z',
    })),
  };
}

function mockAnalyticsResponse(data: AdminAnalytics) {
  fetchMock.mockResolvedValue({ ok: true, json: async () => data } as Response);
}

async function renderPage() {
  render(<AdminAnalyticsPage />);
  await screen.findByText('Eventos recientes');
}

describe('AdminAnalyticsPage - paginacion de eventos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockReturnValue({
      user: { id: 'u1', email: 'admin@ejemplo.com' },
      profile: { is_admin: true },
      loading: false,
    } as unknown as ReturnType<typeof useAuth>);
  });

  it('parte los eventos en paginas de 10 en vez de volcar los 50 de una', async () => {
    mockAnalyticsResponse(analyticsWithEvents(50));

    await renderPage();

    await waitFor(() => {
      expect(screen.getByText('user1@ejemplo.com')).toBeInTheDocument();
    });
    expect(screen.getByText('user10@ejemplo.com')).toBeInTheDocument();
    expect(screen.queryByText('user11@ejemplo.com')).not.toBeInTheDocument();
    expect(screen.getByText('Mostrando 1-10 de 50')).toBeInTheDocument();
  });

  it('avanza a la pagina siguiente y recalcula el rango', async () => {
    mockAnalyticsResponse(analyticsWithEvents(50));

    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));

    await waitFor(() => {
      expect(screen.getByText('user11@ejemplo.com')).toBeInTheDocument();
    });
    expect(screen.queryByText('user1@ejemplo.com')).not.toBeInTheDocument();
    expect(screen.getByText('Mostrando 11-20 de 50')).toBeInTheDocument();
  });

  it('la ultima pagina muestra solo los eventos que sobran', async () => {
    mockAnalyticsResponse(analyticsWithEvents(50));

    await renderPage();
    for (let i = 0; i < 4; i += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    }

    await waitFor(() => {
      expect(screen.getByText('user41@ejemplo.com')).toBeInTheDocument();
    });
    expect(screen.queryByText('user40@ejemplo.com')).not.toBeInTheDocument();
    expect(screen.getByText('Mostrando 41-50 de 50')).toBeInTheDocument();
  });

  it('no muestra el paginador cuando todo entra en una sola pagina', async () => {
    mockAnalyticsResponse(analyticsWithEvents(6));

    await renderPage();

    expect(screen.getByText('user6@ejemplo.com')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Siguiente' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Mostrando/)).not.toBeInTheDocument();
  });

  it('sin eventos muestra el estado vacio y no pagina', async () => {
    mockAnalyticsResponse(analyticsWithEvents(0));

    await renderPage();

    expect(screen.getByText('Sin eventos registrados')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Siguiente' })).not.toBeInTheDocument();
  });
});
