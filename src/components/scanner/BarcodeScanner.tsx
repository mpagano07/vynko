'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { BrowserMultiFormatReader } from '@zxing/library';
import { cn } from '@/lib/utils/cn';

interface BarcodeScannerProps {
  onResult: (text: string) => void;
  onError?: (error: string) => void;
  className?: string;
}

const SCAN_THROTTLE_MS = 2000;

const PERMISSION_HINT =
  'Abrí los ajustes del sitio en tu navegador (el candado o el ícono de ajustes junto a la dirección) y habilitá la cámara. En el celular también podés revisar Ajustes del sistema → tu navegador → Cámara.';

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

export function BarcodeScanner({ onResult, onError, className }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const onResultRef = useRef(onResult);
  const onErrorRef = useRef(onError);
  const lastScanRef = useRef<{ code: string; time: number } | null>(null);
  const [status, setStatus] = useState<'initializing' | 'scanning' | 'error' | 'idle'>('initializing');
  const [statusMessage, setStatusMessage] = useState('Inicializando cámara...');
  const [errorHint, setErrorHint] = useState<string | null>(null);

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
  }, []);

  const handleDecode = useCallback((text: string) => {
    const now = Date.now();
    const last = lastScanRef.current;
    if (last && last.code === text && now - last.time < SCAN_THROTTLE_MS) return;
    lastScanRef.current = { code: text, time: now };

    // Feedback auditivo (Beep 880Hz por 150ms)
    try {
      const ctx = getBeepContext();
      if (ctx) {
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
      }
    } catch {
      // ignorar restricciones de audio autoplay
    }

    // Feedback háptico (Vibración)
    if (typeof window !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate([100]);
      } catch {
        // ignorar fallo de vibración
      }
    }

    onResultRef.current(text);
  }, []);

  const handleError = useCallback(() => {
    // no barcode found in this frame — expected
  }, []);

  const start = useCallback(async () => {
    if (!readerRef.current) return;

    try {
      setStatus('initializing');
      setStatusMessage('Iniciando cámara...');
      setErrorHint(null);

      lastScanRef.current = null;

      await readerRef.current.decodeFromVideoDevice(
        null,
        videoRef.current,
        (result, err) => {
          if (result) {
            handleDecode(result.getText());
          } else if (err) {
            handleError();
          }
        }
      );

      setStatus('scanning');
      setStatusMessage('');
    } catch (err: unknown) {
      const { message, hint } = describeCameraError(err);
      setStatus('error');
      setStatusMessage(message);
      setErrorHint(hint ?? null);
      onErrorRef.current?.(hint ? `${message} ${hint}` : message);
    }
  }, [handleDecode, handleError]);

  useEffect(() => {
    const reader = new BrowserMultiFormatReader();
    readerRef.current = reader;

    // La cámara se inicializa una sola vez al montar el componente; el estado
    // debe aplicarse de forma síncrona para reflejar la UI de inicialización.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    start();

    return () => {
      stop();
      readerRef.current = null;
    };
  }, [start, stop]);

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
            <div className="relative h-52 w-64 max-w-[85vw] rounded-xl border border-cyan-400/30 bg-cyan-950/10 shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]">
              {/* Corner brackets */}
              <div className="absolute -top-0.5 -left-0.5 h-6 w-6 border-t-2 border-l-2 border-cyan-400 rounded-tl-lg" />
              <div className="absolute -top-0.5 -right-0.5 h-6 w-6 border-t-2 border-r-2 border-cyan-400 rounded-tr-lg" />
              <div className="absolute -bottom-0.5 -left-0.5 h-6 w-6 border-b-2 border-l-2 border-cyan-400 rounded-bl-lg" />
              <div className="absolute -bottom-0.5 -right-0.5 h-6 w-6 border-b-2 border-r-2 border-cyan-400 rounded-br-lg" />
              {/* Laser scanning line */}
              <div className="absolute inset-x-2 top-1/2 h-0.5 -translate-y-1/2 bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.9)] animate-pulse" />
            </div>
            <p className="mt-4 px-3 py-1 rounded-full bg-black/75 backdrop-blur-sm text-xs font-medium text-cyan-200 border border-cyan-500/30">
              Alineá el código de barras dentro del marco
            </p>
          </div>
        </>
      )}
    </div>
  );
}
