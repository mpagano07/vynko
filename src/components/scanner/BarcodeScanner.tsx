'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { BrowserMultiFormatReader, DecodeHintType } from '@zxing/library';
import { cn } from '@/lib/utils/cn';

interface BarcodeScannerProps {
  onResult: (text: string) => void;
  onError?: (error: string) => void;
  className?: string;
}

const SCAN_THROTTLE_MS = 2000;
const SCAN_INTERVAL_MS = 400;

const HINTS = new Map();
HINTS.set(DecodeHintType.TRY_HARDER, true);

export function BarcodeScanner({ onResult, onError, className }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const onResultRef = useRef(onResult);
  const onErrorRef = useRef(onError);
  const lastScanRef = useRef<{ code: string; time: number } | null>(null);
  const scanTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedRef = useRef(false);
  const [status, setStatus] = useState<'initializing' | 'scanning' | 'error' | 'idle'>('initializing');
  const [statusMessage, setStatusMessage] = useState('Inicializando cámara...');

  useEffect(() => {
    onResultRef.current = onResult;
    onErrorRef.current = onError;
  }, [onResult, onError]);

  const stop = useCallback(() => {
    if (scanTimerRef.current) {
      clearInterval(scanTimerRef.current);
      scanTimerRef.current = null;
    }
    if (readerRef.current) {
      try {
        readerRef.current.reset();
      } catch {
        // ignore cleanup errors
      }
    }
    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
  }, []);

  const start = useCallback(async () => {
    if (!readerRef.current || !videoRef.current || startedRef.current) return;
    startedRef.current = true;

    try {
      setStatus('initializing');
      setStatusMessage('Iniciando cámara...');

      lastScanRef.current = null;

      const video = videoRef.current;
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
      });

      video.srcObject = stream;
      await video.play();

      scanTimerRef.current = setInterval(async () => {
        if (!readerRef.current || !videoRef.current) return;
        if (videoRef.current.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;

        try {
          const result = await readerRef.current.decode(videoRef.current);
          if (result) {
            const text = result.getText();
            if (text) {
              const now = Date.now();
              const last = lastScanRef.current;
              if (last && last.code === text && now - last.time < SCAN_THROTTLE_MS) {
                return;
              }
              lastScanRef.current = { code: text, time: now };
              onResultRef.current(text);
            }
          }
        } catch {
          // no barcode found in this frame — expected
        }
      }, SCAN_INTERVAL_MS);

      setStatus('scanning');
      setStatusMessage('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al acceder a la cámara';
      setStatus('error');
      setStatusMessage(msg);
      onErrorRef.current?.(msg);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const reader = new BrowserMultiFormatReader(HINTS);
    readerRef.current = reader;

    start();

    return () => {
      cancelled = true;
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
              onClick={() => { startedRef.current = false; start(); }}
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
