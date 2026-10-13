import { ImageResponse } from 'next/og';

/**
 * Card Open Graph 1200x630 generada por codigo (sin asset binario en el repo),
 * para que al compartir Vynko en WhatsApp, LinkedIn, X o Slack se vea una
 * tarjeta de marca en vez del favicon.
 *
 * Solo se usa texto ASCII: ImageResponse (satori) dibuja con la fuente por
 * defecto, y asi no dependemos de cargar un .ttf con los glifos acentuados ni
 * de una ruta de fuente que exista en el build de Linux. El layout raiz sigue
 * exponiendo el favicon para los casos sin imagen.
 */
export const alt = 'Vynko — Stock y ventas en tiempo real';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const PILLS = ['Punto de venta', 'Multi-sucursal', 'Stock en vivo'];

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '80px',
          backgroundImage: 'linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%)',
          color: '#ffffff',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 104,
              height: 104,
              borderRadius: 24,
              backgroundImage: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
              fontSize: 64,
              fontWeight: 700,
            }}
          >
            V
          </div>
          <div style={{ display: 'flex', fontSize: 88, fontWeight: 700, letterSpacing: -2 }}>
            Vynko
          </div>
        </div>

        <div style={{ display: 'flex', marginTop: 40, fontSize: 44, color: '#bfdbfe' }}>
          Stock y ventas en tiempo real
        </div>

        <div style={{ display: 'flex', gap: 20, marginTop: 56 }}>
          {PILLS.map((pill) => (
            <div
              key={pill}
              style={{
                display: 'flex',
                padding: '14px 30px',
                borderRadius: 999,
                border: '2px solid #3b82f6',
                color: '#dbeafe',
                fontSize: 30,
              }}
            >
              {pill}
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size }
  );
}
