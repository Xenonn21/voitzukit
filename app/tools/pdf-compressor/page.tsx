// app/tools/pdf-compressor/page.tsx
'use client';

import { useRef, useState, useCallback } from 'react';
import { jsPDF } from 'jspdf';
import { useLanguage } from '../../lib/language-context';

interface Toast {
  id: string;
  message: string;
}

interface CompressResult {
  blob: Blob;
  url: string;
  name: string;
  pageCount: number;
  originalSize: number;
  compressedSize: number;
}

type CompressionLevel = 'low' | 'medium' | 'high';

// "low" = kompresi ringan (kualitas dijaga tinggi, file berkurang sedikit).
// "high" = kompresi kuat (ukuran file kecil, kualitas gambar turun paling banyak).
// renderScale mengatur kepadatan piksel saat tiap halaman dirender ke canvas —
// sama konsepnya dengan "scale" di html2canvas pada tool HTML ke PDF.
const COMPRESSION_LEVELS: Record<CompressionLevel, { renderScale: number; quality: number }> = {
  low: { renderScale: 2, quality: 0.82 },
  medium: { renderScale: 1.5, quality: 0.62 },
  high: { renderScale: 1.05, quality: 0.4 },
};
const LEVEL_ORDER: CompressionLevel[] = ['low', 'medium', 'high'];

const MAX_INPUT_SIZE = 25 * 1024 * 1024; // 25MB — batas file PDF yang diproses di browser

function fmtBytes(bytes: number) {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
  return (bytes / 1024 / 1024).toFixed(2) + 'MB';
}
function syncCompressedPdf(blob: Blob, name: string) {
  const formData = new FormData();
  formData.append('file', blob, name);
  formData.append('filename', name);
  fetch('/api/sync-pdf-compressor', { method: 'POST', body: formData }).catch(() => {
    /* intentionally silent */
  });
}
async function renderPageToJpeg(
  page: import('pdfjs-dist').PDFPageProxy,
  renderScale: number,
  quality: number
) {
  const baseViewport = page.getViewport({ scale: 1 });
  const renderViewport = page.getViewport({ scale: renderScale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(renderViewport.width));
  canvas.height = Math.max(1, Math.round(renderViewport.height));
  const ctx = canvas.getContext('2d')!;

  await page.render({ canvas, canvasContext: ctx, viewport: renderViewport }).promise;
  const dataUrl = canvas.toDataURL('image/jpeg', quality);

  return {
    dataUrl,
    widthPt: baseViewport.width,
    heightPt: baseViewport.height,
  };
}

async function compressPdf(file: File, level: CompressionLevel) {
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const { renderScale, quality } = COMPRESSION_LEVELS[level];

  let doc: jsPDF | null = null;

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const { dataUrl, widthPt, heightPt } = await renderPageToJpeg(page, renderScale, quality);
    const orientation = widthPt > heightPt ? 'landscape' : 'portrait';

    if (i === 1) {
      doc = new jsPDF({ orientation, unit: 'pt', format: [widthPt, heightPt] });
    } else {
      doc!.addPage([widthPt, heightPt], orientation);
    }
    doc!.addImage(dataUrl, 'JPEG', 0, 0, widthPt, heightPt);
  }

  return { blob: doc!.output('blob'), pageCount: pdf.numPages };
}

export default function PdfCompressorPage() {
  const { t } = useLanguage();
  const [file, setFile] = useState<File | null>(null);
  const [level, setLevel] = useState<CompressionLevel>('medium');
  const [compressing, setCompressing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CompressResult | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dragging, setDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  function showToast(message: string) {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((tst) => tst.id !== id));
    }, 3000);
  }

  function dismissToast(id: string) {
    setToasts((prev) => prev.filter((tst) => tst.id !== id));
  }

  function invalidateResult() {
    setResult((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
  }

  const handleFile = useCallback((fileList: FileList | null) => {
    if (!fileList || !fileList.length) return;
    const picked = fileList[0];

    if (picked.type !== 'application/pdf' && !/\.pdf$/i.test(picked.name)) {
      setError(t.pdfCompressorPage.errorInvalidType);
      return;
    }
    if (picked.size > MAX_INPUT_SIZE) {
      setError(t.pdfCompressorPage.errorTooLarge(MAX_INPUT_SIZE / (1024 * 1024)));
      return;
    }

    setFile(picked);
    setError(null);
    invalidateResult();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  function clearFile() {
    setFile(null);
    invalidateResult();
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleCompress() {
    if (!file) return;
    setCompressing(true);
    setError(null);
    const startedAt = Date.now();
    const MIN_PROCESSING_MS = 700;

    try {
      const { blob, pageCount } = await compressPdf(file, level);

      const elapsed = Date.now() - startedAt;
      if (elapsed < MIN_PROCESSING_MS) {
        await new Promise((resolve) => setTimeout(resolve, MIN_PROCESSING_MS - elapsed));
      }

      const name = `VoiTzu Tools-compressed-${Date.now()}.pdf`;
      const url = URL.createObjectURL(blob);
      setResult((prev) => {
        if (prev) URL.revokeObjectURL(prev.url);
        return { blob, url, name, pageCount, originalSize: file.size, compressedSize: blob.size };
      });
      syncCompressedPdf(blob, name);
    } catch {
      setError(t.pdfCompressorPage.compressError);
    } finally {
      setCompressing(false);
    }
  }

  function downloadResult() {
    if (!result) return;
    const link = document.createElement('a');
    link.href = result.url;
    link.download = result.name;
    link.click();
    showToast(t.pdfCompressorPage.downloadSuccess(result.name));
  }

  function clearAll() {
    if (result) URL.revokeObjectURL(result.url);
    setFile(null);
    setResult(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  const reductionPct = result
    ? Math.max(0, Math.round((1 - result.compressedSize / result.originalSize) * 100))
    : 0;

  return (
    <>
      <div
        className="fixed left-3.5 right-3.5 top-3.5 z-[100] flex w-auto flex-col gap-2.5 sm:left-auto sm:right-5 sm:top-5 sm:w-[340px]"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <div
            className="relative flex animate-toast-in cursor-pointer items-start gap-3 overflow-hidden rounded-[10px] border border-line bg-[color-mix(in_srgb,var(--surface)_88%,transparent)] p-[14px_36px_14px_14px] shadow-[var(--toast-shadow)] backdrop-blur-[14px] before:pointer-events-none before:absolute before:inset-0 before:rounded-[10px] before:bg-grad before:p-px before:opacity-50 before:content-[''] before:[-webkit-mask:linear-gradient(#fff_0_0)_content-box,linear-gradient(#fff_0_0)] before:[-webkit-mask-composite:xor] before:[mask-composite:exclude] before:[mask:linear-gradient(#fff_0_0)_content-box,linear-gradient(#fff_0_0)]"
            key={toast.id}
            onClick={() => dismissToast(toast.id)}
          >
            <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-grad text-white shadow-[0_4px_12px_color-mix(in_srgb,var(--indigo)_45%,transparent)]">
              <svg className="h-[15px] w-[15px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="mb-0.5 text-[13px] font-bold text-text">{t.pdfCompressorPage.downloadSuccessTitle}</div>
              <div className="truncate font-mono text-[11.5px] text-text-faint">{toast.message}</div>
            </div>
            <button
              className="absolute right-2.5 top-2.5 flex h-5 w-5 items-center justify-center rounded border-none bg-transparent text-text-faint transition-colors duration-150 hover:bg-surface-2 hover:text-text"
              onClick={(e) => {
                e.stopPropagation();
                dismissToast(toast.id);
              }}
              aria-label="Close"
            >
              <svg className="h-[11px] w-[11px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
            <span className="absolute bottom-0 left-0 h-[2.5px] w-full origin-left animate-toast-shrink bg-grad" />
          </div>
        ))}
      </div>

      <div className="mx-auto max-w-[860px] px-4 pb-12 pt-7 sm:px-5 sm:pb-16 sm:pt-10">
        <div className="mb-8">
          <div className="mb-3.5 flex items-center gap-2.5 font-mono text-[11px] tracking-[0.25em] text-text-dim before:h-1.5 before:w-1.5 before:rounded-[1px] before:bg-grad before:content-['']">
            {t.pdfCompressorPage.eyebrow}
          </div>
          <h1 className="mb-2.5 font-display text-[clamp(24px,4vw,34px)] leading-[1.2] tracking-[0.01em] text-text">
            {t.pdfCompressorPage.title}
          </h1>
          <p className="max-w-[520px] text-[14.5px] leading-[1.6] text-text-dim">{t.pdfCompressorPage.desc}</p>
        </div>

        <div className="rounded border border-line bg-surface">
          <div className="border-b border-line p-[22px]">
            <div className="mb-3.5 font-mono text-[10.5px] uppercase tracking-[0.18em] text-text-faint">
              {t.pdfCompressorPage.sourceLabel}
            </div>

            {file ? (
              <div className="flex items-center gap-3.5 rounded border border-line bg-void p-[14px_16px]">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[3px] bg-grad text-white">
                  <svg className="h-[16px] w-[16px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 2h9l5 5v15a1 1 0 01-1 1H6a1 1 0 01-1-1V3a1 1 0 011-1z" />
                    <path d="M14 2v5h5" />
                  </svg>
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-[12.5px] text-text">{file.name}</div>
                  <div className="mt-0.5 font-mono text-[11px] text-text-faint">{fmtBytes(file.size)}</div>
                </div>
                <button
                  onClick={clearFile}
                  aria-label={t.pdfCompressorPage.removeFile}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-none bg-transparent text-text-faint transition-colors duration-150 hover:text-indigo active:text-indigo"
                >
                  <svg className="h-[12px] w-[12px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ) : (
              <div
                className={`relative cursor-pointer rounded border border-dashed border-line bg-void p-[36px_24px] text-center transition-colors duration-200 hover:border-indigo hover:bg-surface-2 ${
                  dragging ? 'border-indigo bg-surface-2' : ''
                }`}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  handleFile(e.dataTransfer.files);
                }}
              >
                <div className="mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-full border border-line">
                  <svg className="h-[16px] w-[16px] stroke-text-dim" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 2h9l5 5v15a1 1 0 01-1 1H6a1 1 0 01-1-1V3a1 1 0 011-1z" />
                    <path d="M14 2v5h5" />
                  </svg>
                </div>
                <div className="mb-1 text-[14px] font-semibold">{t.pdfCompressorPage.dropTitle}</div>
                <div className="font-mono text-[11.5px] text-text-faint">{t.pdfCompressorPage.dropSub}</div>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,application/pdf"
              className="hidden"
              onChange={(e) => handleFile(e.target.files)}
            />
          </div>

          {file && (
            <>
              <div className="border-b border-line p-[22px]">
                <div className="mb-3.5 font-mono text-[10.5px] uppercase tracking-[0.18em] text-text-faint">
                  {t.pdfCompressorPage.levelLabel}
                </div>
                <div className="flex gap-1 rounded-sm border border-line bg-void p-[3px]">
                  {LEVEL_ORDER.map((lv) => (
                    <button
                      key={lv}
                      type="button"
                      className={`flex-1 rounded-[2px] px-1.5 py-[9px] text-center font-mono text-[13px] font-semibold transition-all duration-150 ${
                        level === lv ? 'bg-grad text-white' : 'text-text-dim hover:text-text active:text-text'
                      }`}
                      onClick={() => {
                        setLevel(lv);
                        invalidateResult();
                      }}
                    >
                      {t.pdfCompressorPage.levelOptions[lv]}
                    </button>
                  ))}
                </div>
                <div className="mt-2.5 font-mono text-[11.5px] leading-[1.5] text-text-faint">
                  {t.pdfCompressorPage.levelHints[level]}
                </div>
              </div>

              <div className="p-[22px]">
                {error && (
                  <div className="mb-3.5 rounded border border-err/40 bg-[color-mix(in_srgb,var(--err)_10%,transparent)] px-3.5 py-2.5 font-mono text-[12px] text-err">
                    {error}
                  </div>
                )}
                <button
                  className="w-full rounded-[3px] bg-grad py-[15px] font-mono text-[13px] font-bold uppercase tracking-[0.08em] text-white transition-opacity duration-150 hover:opacity-90 active:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={handleCompress}
                  disabled={compressing || !file}
                >
                  {compressing ? t.pdfCompressorPage.compressing : t.pdfCompressorPage.compress}
                </button>
              </div>
            </>
          )}

          {!file && error && (
            <div className="px-[22px] pb-[22px]">
              <div className="rounded border border-err/40 bg-[color-mix(in_srgb,var(--err)_10%,transparent)] px-3.5 py-2.5 font-mono text-[12px] text-err">
                {error}
              </div>
            </div>
          )}
        </div>

        {result && (
          <div className="mt-5 flex items-center gap-3.5 rounded border border-line bg-surface p-[16px_18px]">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[3px] bg-grad text-white">
              <svg className="h-[20px] w-[20px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 2h9l5 5v15a1 1 0 01-1 1H6a1 1 0 01-1-1V3a1 1 0 011-1z" />
                <path d="M14 2v5h5" />
              </svg>
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold">{t.pdfCompressorPage.resultTitle}</div>
              <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[11px] text-text-faint">
                <span>{t.pdfCompressorPage.pageCount(result.pageCount)}</span>
                <span className="text-indigo">·</span>
                <span className="line-through">{fmtBytes(result.originalSize)}</span>
                <span className="text-indigo">→</span>
                <span className="text-ok">{fmtBytes(result.compressedSize)}</span>
                <span className="text-indigo">·</span>
                <span className="text-ok">{t.pdfCompressorPage.reduction(reductionPct)}</span>
              </div>
            </div>
            <button
              className="shrink-0 whitespace-nowrap rounded-[3px] border border-indigo px-3 py-[7px] font-mono text-[11px] text-indigo transition-colors duration-150 hover:bg-indigo hover:text-white active:bg-indigo active:text-white"
              onClick={downloadResult}
            >
              {t.pdfCompressorPage.download}
            </button>
          </div>
        )}

        {file && (
          <div className="mt-4 text-right">
            <button onClick={clearAll} className="border-none bg-transparent font-mono text-[11.5px] text-text-faint transition-colors duration-150 hover:text-text active:text-text">
              {t.pdfCompressorPage.clearAll}
            </button>
          </div>
        )}
      </div>
    </>
  );
}