'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { BrowserMultiFormatReader, BarcodeFormat, DecodeHintType } from '@zxing/library';
import { Flashlight, ZoomIn } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

interface BarcodeScannerProps {
  onResult: (text: string) => void;
  onError?: (error: string) => void;
  className?: string;
}

const SCAN_THROTTLE_MS = 2000;

// Zoom que se aplica apenas arranca la cámara (si el dispositivo lo soporta):
// agranda el código dentro del frame y es lo que más ayuda con los códigos de
// barras 1D, cuyas barras finas necesitan muchos píxeles para decodificarse.
const AUTO_ZOOM = 2;

const PERMISSION_HINT =
  'Abrí los ajustes del sitio en tu navegador (el candado o el ícono de ajustes junto a la dirección) y habilitá la cámara. En el celular también podés revisar Ajustes del sistema → tu navegador → Cámara.';

// Formatos que tiene sentido leer en un escáner de productos. Limitar la lista
// hace que cada frame se decodifique más rápido (por defecto ZXing prueba
// TODOS los formatos, incluidos RSS-14/RSS-Expanded que son lentos y generan
// falsos positivos) y por lo tanto haya más intentos por segundo.
const POSSIBLE_FORMATS: BarcodeFormat[] = [
  BarcodeFormat.QR_CODE,
  BarcodeFormat.DATA_MATRIX,
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.ITF,
];

type ZoomTorchCapabilities = MediaTrackCapabilities & {
  zoom?: { min?: number; max?: number };
  torch?: boolean;
};

function describeCameraError(err: unknown): { message: string; hint?: string } {
  const name = err instanceof Error ? err.name : '';

  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return {
      message: 'El acceso a la cámara está bloqueado para este sitio.',
      hint: PERMISSION_HINT,
    };
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return { message: 'No encontramos una cámara disponible en este dispositivo.' };
  }
  if (name === 'NotReadableError' || name === 'AbortError') {
    return {
      message: 'No pudimos iniciar la cámara.',
      hint: 'Puede estar siendo usada por otra aplicación. Cerrala y volvé a intentar.',
    };
  }

  const message = err instanceof Error && err.message ? err.message : 'Error al acceder a la cámara';
  return { message, hint: 'Revisá que el navegador tenga permiso para usar la cámara en este sitio.' };
}

function createReader(): BrowserMultiFormatReader {
  const hints = new Map<DecodeHintType, unknown>();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, POSSIBLE_FORMATS);
  // TRY_HARDER hace que el lector 1D recorra todas las filas del frame (en
  // vez de saltearse la mitad) y pruebe estrategias extra: es clave para que
  // un código de barras "normal" se tome al primer intento y no después de
  // varios.
  hints.set(DecodeHintType.TRY_HARDER, true);
  return new BrowserMultiFormatReader(hints);
}

async function openCamera(): Promise<MediaStream> {
  const constraints: MediaStreamConstraints = {
    audio: false,
    // Sin una resolución explícita el navegador suele entregar 640x480, donde
    // las barras finas de un EAN/CODE_128 quedan en 1-2 píxeles y ZXing no
    // las resuelve. Pedimos alta resolución; `ideal` nunca falla.
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
  };

  try {
    return await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    // Si la cámara no acepta los constraints ideales, reintentamos sin ellos.
    if (err instanceof DOMException && err.name === 'OverconstrainedError') {
      return navigator.mediaDevices.getUserMedia({ audio: false, video: true });
    }
    throw err;
  }
}

function buildZoomSteps(caps: ZoomTorchCapabilities | undefined): number[] {
  const zoom = caps?.zoom;
  if (!zoom || typeof zoom.min !== 'number' || typeof zoom.max !== 'number') return [];
  const { min, max } = zoom;
  const steps = [1, 2, 3].filter((v) => v >= min && v <= max);
  // Si el máximo cae entre pasos (p. ej. 2.5), lo agregamos como último paso.
  if (max > 3 && !steps.includes(max)) steps.push(max);
  return steps.length > 1 ? steps : [];
}

async function applyTrackConstraint(
  track: MediaStreamTrack | null,
  constraint: Record<string, unknown>,
): Promise<boolean> {
  if (!track || typeof track.applyConstraints !== 'function') return false;
  try {
    await track.applyConstraints({
      advanced: [constraint],
    } as unknown as MediaTrackConstraints);
    return true;
  } catch {
    // Zoom/linterna no soportados o rechazados: seguimos sin ellos.
    return false;
  }
}

let audioCtxSingleton: AudioContext | null = null;

function getBeepContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;
  if (!audioCtxSingleton) {
    try {
      audioCtxSingleton = new AudioCtx();
    } catch {
      return null;
    }
  }
  return audioCtxSingleton;
}

function playBeep() {
  try {
    const ctx = getBeepContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => undefined);
    }
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.15);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  } catch {
    // ignorar restricciones de audio autoplay
  }
}

function vibrate() {
  if (typeof window !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate([100]);
    } catch {
      // ignorar fallo de vibración
    }
  }
}

export function BarcodeScanner({ onResult, onError, className }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const onResultRef = useRef(onResult);
  const onErrorRef = useRef(onError);
  const lastScanRef = useRef<{ code: string; time: number } | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const [status, setStatus] = useState<'initializing' | 'scanning' | 'error' | 'idle'>('initializing');
  const [statusMessage, setStatusMessage] = useState('Inicializando cámara...');
  const [errorHint, setErrorHint] = useState<string | null>(null);
  const [zoomSteps, setZoomSteps] = useState<number[]>([]);
  const [zoomIndex, setZoomIndex] = useState(0);
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);

  useEffect(() => {
    onResultRef.current = onResult;
    onErrorRef.current = onError;
  }, [onResult, onError]);

  const stop = useCallback(() => {
    if (readerRef.current) {
      try {
        readerRef.current.reset();
      } catch {
        // ignore cleanup errors
      }
    }
    trackRef.current = null;
  }, []);

  const handleDecode = useCallback((text: string) => {
    const now = Date.now();
    const last = lastScanRef.current;
    if (last && last.code === text && now - last.time < SCAN_THROTTLE_MS) return;
    lastScanRef.current = { code: text, time: now };

    // Feedback auditivo (Beep 880Hz por 150ms)
    playBeep();
    // Feedback háptico (Vibración)
    vibrate();

    onResultRef.current(text);
  }, []);

  const start = useCallback(async () => {
    if (!videoRef.current) return;

    setStatus('initializing');
    setStatusMessage('Iniciando cámara...');
    setErrorHint(null);
    setTorchOn(false);
    setTorchSupported(false);
    setZoomSteps([]);
    setZoomIndex(0);
    lastScanRef.current = null;

    // Reader nuevo en cada arranque: deja el stream anterior limpio y evita
    // estados residuales al reintentar.
    stop();
    const reader = createReader();
    readerRef.current = reader;

    try {
      const stream = await openCamera();
      if (readerRef.current !== reader) {
        // El componente se desmontó (o se reinició el escaneo) mientras
        // abríamos la cámara: cortamos el stream para no dejarla encendida.
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const track = stream.getVideoTracks()[0] ?? null;
      trackRef.current = track;

      const caps = typeof track?.getCapabilities === 'function'
        ? (track.getCapabilities() as ZoomTorchCapabilities)
        : undefined;

      if (caps?.torch) {
        setTorchSupported(true);
      }

      // Zoom digital: si la cámara lo soporta arrancamos con AUTO_ZOOM para
      // que el código ocupe más del frame (las cámaras traseras actuales son
      // gran angular y el código queda muy chico).
      const steps = buildZoomSteps(caps);
      if (steps.length > 0) {
        const autoIndex = steps.indexOf(AUTO_ZOOM);
        const startIndex = autoIndex >= 0 ? autoIndex : 0;
        const applied = await applyTrackConstraint(track, { zoom: steps[startIndex] });
        if (applied) {
          setZoomSteps(steps);
          setZoomIndex(startIndex);
        }
      }

      await reader.decodeFromStream(stream, videoRef.current, (result, err) => {
        if (result) {
          handleDecode(result.getText());
        } else if (err) {
          // no barcode found in this frame — expected
        }
      });

      setStatus('scanning');
      setStatusMessage('');
    } catch (err: unknown) {
      const { message, hint } = describeCameraError(err);
      setStatus('error');
      setStatusMessage(message);
      setErrorHint(hint ?? null);
      onErrorRef.current?.(hint ? `${message} ${hint}` : message);
    }
  }, [handleDecode, stop]);

  useEffect(() => {
    // La cámara se inicializa una sola vez al montar el componente; el estado
    // debe aplicarse de forma síncrona para reflejar la UI de inicialización.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    start();

    return () => {
      stop();
      readerRef.current = null;
    };
  }, [start, stop]);

  const toggleZoom = useCallback(async () => {
    const nextIndex = (zoomIndex + 1) % zoomSteps.length;
    const applied = await applyTrackConstraint(trackRef.current, { zoom: zoomSteps[nextIndex] });
    if (applied) setZoomIndex(nextIndex);
  }, [zoomIndex, zoomSteps]);

  const toggleTorch = useCallback(async () => {
    const next = !torchOn;
    const applied = await applyTrackConstraint(trackRef.current, { torch: next });
    if (applied) setTorchOn(next);
  }, [torchOn]);

  const zoomLabel = zoomSteps[zoomIndex] !== undefined ? `${zoomSteps[zoomIndex]}x` : 'Zoom';

  return (
    <div className={cn('relative overflow-hidden rounded-lg bg-black', className)}>
      <video
        ref={videoRef}
        className="h-full w-full object-cover"
        playsInline
        muted
      />

      {status === 'initializing' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60">
          <div className="text-center text-white">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-white border-t-transparent" />
            <p className="text-sm">{statusMessage}</p>
          </div>
        </div>
      )}

      {status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 p-4">
          <div className="max-h-full overflow-y-auto text-center text-white">
            <p className="text-sm font-medium mb-2">{statusMessage}</p>
            {errorHint && <p className="text-xs text-white/80 mb-3">{errorHint}</p>}
            <button
              onClick={start}
              className="rounded-md bg-white px-4 py-2 text-sm font-medium text-black hover:bg-gray-200"
            >
              Reintentar
            </button>
          </div>
        </div>
      )}

      {status === 'scanning' && (
        <>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center p-4">
            {/* Marco ancho: los códigos de barras 1D son rectangulares y
                necesitan más ancho que un QR. */}
            <div className="relative h-40 w-80 max-w-[85vw] rounded-xl border border-cyan-400/30 bg-cyan-950/10 shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]">
              {/* Corner brackets */}
              <div className="absolute -top-0.5 -left-0.5 h-6 w-6 border-t-2 border-l-2 border-cyan-400 rounded-tl-lg" />
              <div className="absolute -top-0.5 -right-0.5 h-6 w-6 border-t-2 border-r-2 border-cyan-400 rounded-tr-lg" />
              <div className="absolute -bottom-0.5 -left-0.5 h-6 w-6 border-b-2 border-l-2 border-cyan-400 rounded-bl-lg" />
              <div className="absolute -bottom-0.5 -right-0.5 h-6 w-6 border-b-2 border-r-2 border-cyan-400 rounded-br-lg" />
              {/* Laser scanning line */}
              <div className="absolute inset-x-2 top-1/2 h-0.5 -translate-y-1/2 bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.9)] animate-pulse" />
            </div>
            <p className="mt-4 px-3 py-1 rounded-full bg-black/75 backdrop-blur-sm text-xs font-medium text-cyan-200 border border-cyan-500/30">
              Alineá el código dentro del marco (QR o código de barras)
            </p>
          </div>

          {/* Controles de cámara: zoom y linterna si el dispositivo los soporta */}
          {(zoomSteps.length > 0 || torchSupported) && (
            <div className="absolute bottom-3 right-3 flex items-center gap-2">
              {zoomSteps.length > 0 && (
                <button
                  type="button"
                  onClick={toggleZoom}
                  aria-label={`Cambiar zoom (actual ${zoomLabel})`}
                  className="flex items-center gap-1 rounded-full bg-black/70 px-3 py-2 text-xs font-semibold text-white backdrop-blur-sm border border-white/20 hover:bg-black/90 transition-colors"
                >
                  <ZoomIn className="h-4 w-4" />
                  {zoomLabel}
                </button>
              )}
              {torchSupported && (
                <button
                  type="button"
                  onClick={toggleTorch}
                  aria-pressed={torchOn}
                  aria-label={torchOn ? 'Apagar linterna' : 'Encender linterna'}
                  className={cn(
                    'flex items-center rounded-full px-3 py-2 text-xs font-semibold backdrop-blur-sm border transition-colors',
                    torchOn
                      ? 'bg-yellow-400 text-black border-yellow-300 hover:bg-yellow-300'
                      : 'bg-black/70 text-white border-white/20 hover:bg-black/90'
                  )}
                >
                  <Flashlight className="h-4 w-4" />
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
