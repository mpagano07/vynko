'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { BrowserMultiFormatReader } from '@zxing/library';
import { cn } from '@/lib/utils/cn';

interface BarcodeScannerProps {
  onResult: (text: string) => void;
  onError?: (error: string) => void;
  className?: string;
}

export function BarcodeScanner({ onResult, onError, className }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const onResultRef = useRef(onResult);
  const onErrorRef = useRef(onError);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<string>('');
  const [status, setStatus] = useState<'initializing' | 'scanning' | 'error' | 'idle'>('initializing');
  const [statusMessage, setStatusMessage] = useState('Inicializando cámara...');

  useEffect(() => {
    onResultRef.current = onResult;
    onErrorRef.current = onError;
  }, [onResult, onError]);

  const stopScanning = useCallback(() => {
    if (readerRef.current) {
      try {
        readerRef.current.reset();
      } catch {
        // ignore cleanup errors
      }
    }
  }, []);

  const startCamera = useCallback(async (deviceId?: string) => {
    if (!readerRef.current || !videoRef.current) return;

    try {
      setStatus('initializing');
      setStatusMessage('Iniciando cámara...');
      stopScanning();

      await readerRef.current.decodeFromVideoDevice(
        deviceId || null,
        videoRef.current,
        (result) => {
          if (result) {
            const text = result.getText();
            if (text) {
              onResultRef.current(text);
            }
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
  }, [stopScanning]);

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      try {
        const reader = new BrowserMultiFormatReader();
        readerRef.current = reader;

        const devices = await reader.listVideoInputDevices();
        if (cancelled) return;

        if (devices.length === 0) {
          setStatus('error');
          setStatusMessage('No se detectó ninguna cámara');
          return;
        }

        setCameras(devices);
        const backCamera = devices.find(
          (d) => d.label.toLowerCase().includes('back') || d.label.toLowerCase().includes('trasera')
        );
        const defaultDevice = backCamera?.deviceId || devices[0].deviceId;
        setSelectedCamera(defaultDevice);

        await startCamera(defaultDevice);
      } catch (err: unknown) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : 'Error al acceder a la cámara';
        setStatus('error');
        setStatusMessage(msg);
        onError?.(msg);
      }
    };

    init();

    return () => {
      cancelled = true;
      stopScanning();
      readerRef.current = null;
    };
  }, [startCamera, stopScanning, onError]);

  const switchCamera = async (deviceId: string) => {
    setSelectedCamera(deviceId);
    await startCamera(deviceId);
  };

  return (
    <div className={cn('relative overflow-hidden rounded-lg bg-black', className)}>
      <video
        ref={videoRef}
        className="h-full w-full object-cover"
        playsInline
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
              onClick={() => startCamera(selectedCamera || undefined)}
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

      {cameras.length > 1 && (
        <div className="absolute bottom-3 left-3 right-3 flex justify-center gap-2">
          {cameras.map((cam) => (
            <button
              key={cam.deviceId}
              onClick={() => switchCamera(cam.deviceId)}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                selectedCamera === cam.deviceId
                  ? 'bg-white text-black'
                  : 'bg-white/20 text-white hover:bg-white/30'
              )}
            >
              {cam.label || `Cámara ${cameras.indexOf(cam) + 1}`}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
