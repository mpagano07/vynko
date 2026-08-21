'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/lib/hooks/useAuth';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Camera, Upload, Loader2, ScanLine, CheckCircle2, AlertTriangle, X, Zap, ImageIcon } from 'lucide-react';

interface EstimatedProduct {
  productName: string;
  estimatedQuantity: number;
  confidence: string;
}

interface AnalysisResult {
  description: string;
  estimatedStock: EstimatedProduct[];
  observations: string[];
  suggestedActions: string[];
}

interface MatchedProduct {
  productName: string;
  estimatedQuantity: number;
  confidence: string;
  matchFound?: boolean;
  actualProduct?: { stock: number; minStock: number };
}

export default function ShelfVisionPage() {
  const router = useRouter();
  const { tenant, loading: authLoading } = useAuth();
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<{
    analysis: AnalysisResult;
    matchedProducts: MatchedProduct[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [showCamera, setShowCamera] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!authLoading && tenant && !['business', 'enterprise'].includes(tenant.subscription_plan || '')) {
      router.push('/billing');
    }
  }, [authLoading, tenant, router]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    setImageUrl(URL.createObjectURL(file));
    setResult(null);
    setError(null);
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setShowCamera(true);
    } catch {
      setError('No se pudo acceder a la cámara');
    }
  };

  const capturePhoto = () => {
    if (!videoRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    canvas.getContext('2d')?.drawImage(videoRef.current, 0, 0);
    canvas.toBlob((blob) => {
      if (blob) {
        const file = new File([blob], 'shelf-photo.jpg', { type: 'image/jpeg' });
        setImageFile(file);
        setImageUrl(URL.createObjectURL(file));
        setResult(null);
        setError(null);
      }
    }, 'image/jpeg');
    stopCamera();
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setShowCamera(false);
  };

  const uploadAndAnalyze = async () => {
    if (!imageFile) return;
    setAnalyzing(true);
    setError(null);

    try {
      // Upload image first
      const formData = new FormData();
      formData.append('file', imageFile);
      const { data: { session } } = await supabase.auth.getSession();
      const uploadRes = await fetch('/api/upload', {
        method: 'POST',
        headers: session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {},
        body: formData,
      });
      const uploadData = await uploadRes.json();
      if (!uploadRes.ok) throw new Error(uploadData.error || 'Error al subir imagen');

      // Analyze with vision API
      const analyzeRes = await fetch('/api/ai/vision', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ imageUrl: uploadData.url }),
      });
      const analyzeData = await analyzeRes.json();
      if (!analyzeRes.ok) throw new Error(analyzeData.error || 'Error al analizar');

      setResult(analyzeData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setAnalyzing(false);
    }
  };

  const reset = () => {
    setImageUrl(null);
    setImageFile(null);
    setResult(null);
    setError(null);
  };

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-600">
          <ScanLine className="h-6 w-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Visión de Góndolas</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Analizá fotos de tus estantes con IA para estimar stock</p>
        </div>
      </div>

      {!imageUrl ? (
        <Card className="p-8">
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <ImageIcon className="h-16 w-16 text-gray-300 dark:text-gray-600 mb-4" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Capturá o subí una foto de la góndola</h2>
            <p className="text-sm text-gray-500 mb-6 max-w-md">La IA analizará los productos visibles y estimará cantidades para comparar con tu inventario.</p>
            <div className="flex gap-3">
              <Button onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-4 w-4 mr-2" /> Subir foto
              </Button>
              <Button variant="outline" onClick={startCamera}>
                <Camera className="h-4 w-4 mr-2" /> Usar cámara
              </Button>
            </div>
            <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleFileSelect} />
          </div>
        </Card>
      ) : (
        <Card className="p-6">
          {showCamera ? (
            <div className="relative">
              <video ref={videoRef} autoPlay playsInline className="w-full rounded-lg" />
              <div className="flex gap-2 mt-4">
                <Button onClick={capturePhoto}><Camera className="h-4 w-4 mr-2" /> Capturar</Button>
                <Button variant="outline" onClick={stopCamera}><X className="h-4 w-4 mr-2" /> Cancelar</Button>
              </div>
            </div>
          ) : (
            <div>
              <div className="relative w-full max-h-80 overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800 mb-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl} alt="Shelf" className="w-full object-contain max-h-80" />
                <button onClick={reset} className="absolute top-2 right-2 p-1.5 bg-black/50 rounded-full text-white hover:bg-black/70">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex gap-2">
                <Button onClick={uploadAndAnalyze} disabled={analyzing}>
                  {analyzing ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Analizando...<Zap className="h-4 w-4 ml-2" /></> : <><Zap className="h-4 w-4 mr-2" /> Analizar con IA</>}
                </Button>
                <Button variant="outline" onClick={() => fileInputRef.current?.click()}>Cambiar foto</Button>
                <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleFileSelect} />
              </div>
            </div>
          )}
        </Card>
      )}

      {analyzing && (
        <Card className="p-8 text-center">
          <Loader2 className="h-10 w-10 animate-spin text-indigo-500 mx-auto mb-3" />
          <p className="text-sm text-gray-500">La IA está analizando la imagen de la góndola...</p>
        </Card>
      )}

      {error && (
        <Card className="p-4 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/30">
          <div className="flex items-center gap-2 text-sm text-rose-700 dark:text-rose-400">
            <AlertTriangle className="h-4 w-4" />
            {error}
          </div>
        </Card>
      )}

      {result && (
        <>
          <Card className="p-6">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-3">Análisis de la imagen</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">{result.analysis.description}</p>

            {result.analysis.observations.length > 0 && (
              <div className="mt-4 space-y-1">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Observaciones</p>
                {result.analysis.observations.map((obs: string) => (
                  <p key={obs} className="text-sm text-gray-600 dark:text-gray-400 flex items-start gap-2">
                    <span className="text-blue-500 mt-0.5">•</span> {obs}
                  </p>
                ))}
              </div>
            )}

            {result.analysis.suggestedActions.length > 0 && (
              <div className="mt-4 space-y-1">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Acciones sugeridas</p>
                {result.analysis.suggestedActions.map((a: string) => (
                  <p key={a} className="text-sm text-amber-700 dark:text-amber-400 flex items-start gap-2">
                    <span className="mt-0.5">→</span> {a}
                  </p>
                ))}
              </div>
            )}
          </Card>

          {result.matchedProducts.length > 0 && (
            <Card className="overflow-hidden border border-gray-100 dark:border-gray-800 p-0">
              <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800">
                <h2 className="text-lg font-bold text-gray-900 dark:text-white">Productos detectados vs. inventario</h2>
              </div>
              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                {result.matchedProducts.map((item) => (
                  <div key={item.productName} className="flex items-center gap-4 px-6 py-3.5 text-sm">
                    {item.matchFound ? (
                      <CheckCircle2 className="h-5 w-5 text-emerald-500 flex-shrink-0" />
                    ) : (
                      <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0" />
                    )}
                    <div className="flex-1">
                      <p className="font-semibold text-gray-900 dark:text-gray-100">{item.productName}</p>
                      <p className="text-xs text-gray-500">
                        IA estima: <strong>{item.estimatedQuantity}</strong> unidades (confianza: {item.confidence})
                      </p>
                      {item.actualProduct && (
                        <p className="text-xs text-gray-500">
                          En sistema: <strong>{item.actualProduct.stock}</strong> unidades
                          {item.actualProduct.stock < item.actualProduct.minStock && (
                            <span className="text-rose-500 ml-1">(por debajo del mínimo)</span>
                          )}
                        </p>
                      )}
                    </div>
                    {item.matchFound && item.actualProduct && (
                      <div className={`text-xs font-semibold px-2 py-1 rounded ${
                        Math.abs(item.estimatedQuantity - item.actualProduct.stock) <= 2
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                          : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                      }`}>
                        {Math.abs(item.estimatedQuantity - item.actualProduct.stock) <= 2 ? 'Coincide' : 'Diferencia'}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
