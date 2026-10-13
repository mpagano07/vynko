import { ImageResponse } from 'next/og';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Card Open Graph 1200x630 generada por codigo (sin asset binario en el repo),
 * para que al compartir Vynko en WhatsApp, LinkedIn, X o Slack se vea una
 * tarjeta de marca en vez del favicon.
 *
 * Usa el logo real de `public/icons/icon-512.png`, leido una sola vez a nivel de
 * modulo (no depende del request). El runtime es Node para poder leer del
 * filesystem.
 *
 * Los textos van en ASCII: el cuerpo se dibuja con la fuente por defecto de
 * satori, asi no dependemos de cargar un .ttf con glifos acentuados.
 */
export const runtime = 'nodejs';

export const alt = 'Vynko — Stock y ventas en tiempo real';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const logoData = await readFile(join(process.cwd(), 'public/icons/icon-512.png'), 'base64');
const logoSrc = `data:image/png;base64,${logoData}`;

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoSrc} width={132} height={132} alt="" style={{ borderRadius: 28 }} />
          <div style={{ display: 'flex', fontSize: 92, fontWeight: 700, letterSpacing: -2 }}>
            Vynko
          </div>
        </div>

        <div style={{ display: 'flex', marginTop: 44, fontSize: 44, color: '#bfdbfe' }}>
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
