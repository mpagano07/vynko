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

export function BarcodeScanner({ onResult, onError, className }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const onResultRef = useRef(onResult);
  const onErrorRef = useRef(onError);
  const lastScanRef = useRef<{ code: string; time: number } | null>(null);
  const [status, setStatus] = useState<'initializing' | 'scanning' | 'error' | 'idle'>('initializing');
  const [statusMessage, setStatusMessage] = useState('Inicializando cámara...');

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
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.15);
        osc.connect(gain);
        gain.connect(ctx.destination);
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

  const handleError = useCallback((err: any) => {
    // no barcode found in this frame — expected
  }, []);

  const start = useCallback(async () => {
    if (!readerRef.current) return;

    try {
      setStatus('initializing');
      setStatusMessage('Iniciando cámara...');

      lastScanRef.current = null;

      await readerRef.current.decodeFromVideoDevice(
        null,
        videoRef.current,
        (result, err) => {
          if (result) {
            handleDecode(result.getText());
          } else if (err) {
            handleError(err);
          }
        }
      );

      setStatus('scanning');
      setStatusMessage('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al acceder a la cámara';
      setStatus('error');
      setStatusMessage(msg);
      onErrorRef.current?.(msg);
    }
  }, [handleDecode, handleError]);

  useEffect(() => {
    const reader = new BrowserMultiFormatReader();
    readerRef.current = reader;

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
        <div className="absolute inset-0 flex items-center justify-center bg-black/60">
          <div className="text-center text-white px-4">
            <p className="text-sm mb-3">{statusMessage}</p>
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
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-48 w-48 rounded-lg border-2 border-white/60" />
          </div>
          <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent animate-pulse" />
        </>
      )}
    </div>
  );
}
