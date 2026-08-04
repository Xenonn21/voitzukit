// app/tools/background-remover/page.tsx
'use client';

import { useCallback, useRef, useState, useEffect } from 'react';
import { useLanguage } from '../../lib/language-context';

interface Toast {
  id: string;
  message: string;
}

interface BgResult {
  blob: Blob;
  url: string;
  name: string;
}

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const SYNC_MAX_SIZE = 1 * 1024 * 1024;
const MAX_LOCAL_FILE_SIZE = 10 * 1024 * 1024; // 10MB limit untuk mencegah DoS/OOM

// Adaptive resize target: file besar biasanya berarti resolusi asli tinggi,
// jadi dipotong lebih agresif tanpa kelihatan bedanya di hasil akhir.
function getAdaptiveMaxDim(fileSize: number): number {
  if (fileSize < 300 * 1024) return 1024;
  if (fileSize < 1 * 1024 * 1024) return 900;
  return 768;
}

// Kualitas WebP untuk hasil akhir. 0.82 = sweet spot ukuran kecil vs kualitas.
const RESULT_WEBP_QUALITY = 0.82;

function stripExtension(name: string) {
  const idx = name.lastIndexOf('.');
  return idx === -1 ? name : name.slice(0, idx);
}

// Sanitasi nama file: hanya izinkan huruf, angka, strip, dan garis bawah
function sanitizeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9-_]/g, '_');
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatEta(seconds: number | null, eta: ReturnType<typeof useLanguage>['t']['bgRemoverPage']) {
  if (seconds === null) return eta.etaCalculating;
  if (seconds < 1.5) return eta.etaAlmostDone;
  if (seconds < 60) return eta.etaSeconds(Math.ceil(seconds));
  return eta.etaMinutes(Math.ceil(seconds / 60));
}

// Resize input sebelum diproses model. File jadi JPEG (intermediate, bukan
// hasil akhir) karena lebih ringan dikirim ke model.
async function resizeIfNeeded(file: File, maxDim: number): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const largestSide = Math.max(bitmap.width, bitmap.height);
    if (largestSide <= maxDim) return file;

    const scale = maxDim / largestSide;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);

    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
        'image/jpeg',
        0.9
      );
    });
  } finally {
    bitmap.close();
  }
}

// Kompres hasil akhir (transparan) ke WebP. Jauh lebih kecil dari PNG dengan
// alpha channel yang sama.
async function compressResult(blob: Blob, quality = RESULT_WEBP_QUALITY): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return blob;
    ctx.drawImage(bitmap, 0, 0);

    return await new Promise<Blob>((resolve) => {
      canvas.toBlob((b) => resolve(b ?? blob), 'image/webp', quality);
    });
  } finally {
    bitmap.close();
  }
}

type ProgressHandler = (key: string, current: number, total: number) => void;

async function removeBackgroundSafely(input: Blob, onProgress?: ProgressHandler): Promise<Blob> {
  const { removeBackground } = await import('@imgly/background-removal');
  const config = { model: 'isnet_quint8' as const, progress: onProgress };

  // Cek dukungan WebGPU dulu sebelum mulai, biar nggak jalan 2x
  // (GPU gagal di tengah proses lalu ulang dari nol di CPU).
  const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator;
  return await removeBackground(input, { ...config, device: hasWebGPU ? 'gpu' : 'cpu' });
}

export default function BackgroundRemoverPage() {
  const { t } = useLanguage();

  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [result, setResult] = useState<BgResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [etaSeconds, setEtaSeconds] = useState<number | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const startTimeRef = useRef<number | null>(null);

  // Bumped setiap kali processing harus dianggap batal (reset, atau file baru
  // masuk). Setiap in-flight processFile cek ini sebelum ubah state, jadi run
  // basi/batal nggak bisa menghidupkan lagi UI yang sudah direset.
  const processIdRef = useRef(0);

  // Cleanup Object URL saat komponen di-unmount untuk mencegah memory leak
  useEffect(() => {
    return () => {
      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
      if (result) URL.revokeObjectURL(result.url);
    };
  }, [sourceUrl, result]);

  const pushToast = useCallback((message: string) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((toast) => toast.id !== id)), 3200);
  }, []);

  // Derive ETA dari progress event model: ekstrapolasi total durasi dari
  // elapsed / ratio, lalu laporkan sisa waktunya.
  const handleProgress = useCallback((_key: string, current: number, total: number) => {
    if (!startTimeRef.current || total <= 0) return;
    const ratio = Math.min(Math.max(current / total, 0.02), 0.98);
    const elapsedMs = Date.now() - startTimeRef.current;
    const estimatedTotalMs = elapsedMs / ratio;
    const remainingMs = Math.max(estimatedTotalMs - elapsedMs, 0);
    setEtaSeconds(remainingMs / 1000);
  }, []);

  const syncResult = useCallback((blob: Blob, name: string) => {
    if (blob.size > SYNC_MAX_SIZE) return;
    const formData = new FormData();
    formData.append('file', blob, name);
    formData.append('filename', name);
    // Menambahkan penanganan error untuk mencegah silent fail
    fetch('/api/sync-background-remover', { method: 'POST', body: formData }).catch((err) => {
      console.error('Failed to sync result to server:', err);
    });
  }, []);

  const reset = useCallback(() => {
    processIdRef.current += 1;
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    if (result) URL.revokeObjectURL(result.url);
    setSourceFile(null);
    setSourceUrl(null);
    setResult(null);
    setError(null);
    setIsProcessing(false);
    setEtaSeconds(null);
    startTimeRef.current = null;
    if (inputRef.current) inputRef.current.value = '';
  }, [sourceUrl, result]);

  const processFile = useCallback(
    async (file: File) => {
      if (!ACCEPTED_TYPES.includes(file.type)) {
        setError(t.bgRemoverPage.errorUnsupported);
        return;
      }

      // Validasi batas ukuran file (10MB) untuk menghindari Client-Side DoS/OOM
      if (file.size > MAX_LOCAL_FILE_SIZE) {
        setError("Ukuran file terlalu besar. Maksimal 10MB.");
        return;
      }

      const myId = ++processIdRef.current;

      setError(null);
      setResult(null);
      const localUrl = URL.createObjectURL(file);
      setSourceFile(file);
      setSourceUrl(localUrl);
      setIsProcessing(true);
      setEtaSeconds(null);
      startTimeRef.current = Date.now();

      try {
        const maxDim = getAdaptiveMaxDim(file.size);
        const resized = await resizeIfNeeded(file, maxDim);

        const rawResult = await removeBackgroundSafely(resized, (key, current, total) => {
          if (myId === processIdRef.current) handleProgress(key, current, total);
        });

        if (myId !== processIdRef.current) return;

        const compressed = await compressResult(rawResult);
        const finalBlob = compressed.size > 0 ? compressed : rawResult;
        const ext = finalBlob.type === 'image/webp' ? 'webp' : 'png';
        
        // Sanitasi nama dasar file sebelum digabungkan dengan ekstensi
        const safeBaseName = sanitizeFilename(stripExtension(file.name));
        const name = `${safeBaseName}-no-bg.${ext}`;
        
        const url = URL.createObjectURL(finalBlob);

        setResult({ blob: finalBlob, url, name });
        syncResult(finalBlob, name);
      } catch (err) {
        if (myId !== processIdRef.current) return;
        console.error('Background removal failed:', err);
        setError(t.bgRemoverPage.removeError);
      } finally {
        if (myId === processIdRef.current) {
          setIsProcessing(false);
          setEtaSeconds(null);
          startTimeRef.current = null;
        }
      }
    },
    [syncResult, t, handleProgress]
  );

  const handleFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (!file) return;
      processFile(file);
    },
    [processFile]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  const handleDownload = useCallback(() => {
    if (!result) return;
    const a = document.createElement('a');
    a.href = result.url;
    a.download = result.name;
    a.click();
    pushToast(t.bgRemoverPage.downloadSuccess(result.name));
  }, [result, pushToast, t]);

  const hasContent = !!sourceFile || !!result;

  return (
    <div className="mx-auto max-w-[860px] px-4 pb-12 pt-7 sm:px-5 sm:pb-16 sm:pt-10">
      <div className="mb-8">
        <div className="mb-3.5 flex items-center gap-2.5 font-mono text-[11px] tracking-[0.25em] text-text-dim before:h-1.5 before:w-1.5 before:rounded-[1px] before:bg-grad before:content-['']">
          {t.bgRemoverPage.eyebrow}
        </div>
        <h1 className="mb-2.5 font-display text-[clamp(24px,4vw,34px)] leading-[1.2] tracking-[0.01em] text-text">
          {t.bgRemoverPage.title}
        </h1>
        <p className="max-w-[520px] text-[14.5px] leading-[1.6] text-text-dim">{t.bgRemoverPage.desc}</p>
      </div>

      <div className="rounded border border-line bg-surface">
        <div className="border-b border-line p-[22px]">
          {!hasContent ? (
            <div
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded border border-dashed py-16 text-center transition-colors duration-150 ${
                isDragging ? 'border-indigo bg-[color-mix(in_srgb,var(--indigo)_8%,transparent)]' : 'border-line hover:border-indigo/60'
              }`}
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-full border border-line text-text-dim">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                  <path d="M12 16V4M12 4l-4 4M12 4l4 4" />
                  <path d="M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" />
                </svg>
              </span>
              <p className="text-[14px] font-semibold text-text">{t.bgRemoverPage.dropLabel}</p>
              <p className="font-mono text-[11px] tracking-[0.06em] text-text-faint">{t.bgRemoverPage.dropSub}</p>
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPTED_TYPES.join(',')}
                className="hidden"
                onChange={(e) => handleFiles(e.target.files)}
              />
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <div className="mb-2 flex items-center justify-between gap-2 font-mono text-[10.5px] uppercase tracking-[0.18em] text-text-faint">
                  <span className="truncate">{sourceFile?.name}</span>
                  {sourceFile && <span className="shrink-0 text-text-faint/80">{formatBytes(sourceFile.size)}</span>}
                </div>
                <div className="overflow-hidden rounded border border-line bg-void">
                  {sourceUrl && <img src={sourceUrl} alt="Original" className="h-auto w-full object-contain" />}
                </div>
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between gap-2 font-mono text-[10.5px] uppercase tracking-[0.18em] text-text-faint">
                  <span className="truncate">
                    {isProcessing ? t.bgRemoverPage.removing : result ? t.bgRemoverPage.resultTitle : ''}
                  </span>
                  {!isProcessing && result && (
                    <span className="shrink-0 text-text-faint/80">{formatBytes(result.blob.size)}</span>
                  )}
                </div>
                <div
                  className="flex min-h-[140px] items-center justify-center overflow-hidden rounded border border-line"
                  style={{
                    backgroundImage:
                      'repeating-conic-gradient(#2a2a2a 0% 25%, transparent 0% 50%)',
                    backgroundSize: '16px 16px',
                  }}
                >
                  {isProcessing && (
                    <div className="flex flex-col items-center gap-2.5">
                      <div className="h-6 w-6 animate-spin rounded-full border-2 border-text-faint border-t-indigo" />
                      <span className="font-mono text-[10.5px] tracking-[0.06em] text-text-faint">
                        {formatEta(etaSeconds, t.bgRemoverPage)}
                      </span>
                    </div>
                  )}
                  {!isProcessing && result && (
                    <img src={result.url} alt="Background removed" className="h-auto w-full object-contain" />
                  )}
                </div>
              </div>
            </div>
          )}

          {error && <p className="mt-3.5 text-[12.5px] text-red-400">{error}</p>}
        </div>

        {hasContent && (
          <div className="flex flex-wrap items-center justify-between gap-3 p-[22px]">
            <button
              type="button"
              onClick={reset}
              className="rounded-sm border border-line px-4 py-2.5 text-[13px] font-semibold text-text-dim transition-colors duration-150 hover:text-text active:text-text"
            >
              {result ? t.bgRemoverPage.tryAnother : t.bgRemoverPage.clearAll}
            </button>
            {result && (
              <button
                type="button"
                onClick={handleDownload}
                className="rounded-sm bg-grad px-4 py-2.5 text-[13px] font-semibold text-white transition-opacity duration-150 hover:opacity-90 active:opacity-80"
              >
                {t.bgRemoverPage.download}
              </button>
            )}
          </div>
        )}
      </div>

      {result && <p className="mt-3 text-[12.5px] text-text-faint">{t.bgRemoverPage.resultHint}</p>}

      <div className="pointer-events-none fixed bottom-6 right-6 flex flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="rounded border border-line bg-surface px-4 py-2.5 text-[13px] font-semibold text-text shadow-lg"
          >
            {t.bgRemoverPage.downloadSuccessTitle}
            <div className="text-[11.5px] font-normal text-text-faint">{toast.message}</div>
          </div>
        ))}
      </div>
    </div>
  );
}