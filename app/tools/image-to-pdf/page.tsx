// app/tools/image-to-pdf/page.tsx
'use client';

import { useRef, useState, useCallback } from 'react';
import { jsPDF } from 'jspdf';
import { useLanguage } from '../../lib/language-context';

interface Toast {
  id: string;
  message: string;
}

interface ImageItem {
  id: string;
  file: File;
  previewUrl: string;
  naturalW: number;
  naturalH: number;
}

interface PdfResult {
  blob: Blob;
  url: string;
  name: string;
  pageCount: number;
  size: number;
}

type OrientationMode = 'portrait' | 'landscape' | 'auto';

// The trick: instead of lowering JPEG quality (which is visible), we cap
// each image's PIXEL RESOLUTION to what the page can actually show at a
// given print DPI. A phone photo is often 4000x3000px, but on an A4 page
// that's printed/viewed at ~150dpi, only ~1240x930px of that is ever
// visible — the rest is wasted bytes. JPEG quality stays high in every
// preset, so the size drop comes from removing pixels nobody can see, not
// from compression artifacts.
type CompressionLevel = 'high' | 'balanced' | 'small';
const COMPRESSION_PRESETS: Record<CompressionLevel, { dpi: number; quality: number }> = {
  high: { dpi: 200, quality: 0.92 },
  balanced: { dpi: 150, quality: 0.85 },
  small: { dpi: 110, quality: 0.75 },
};
const COMPRESSION_ORDER: CompressionLevel[] = ['high', 'balanced', 'small'];

// w = short (portrait-upright) edge, h = long edge — both in points (1pt = 1/72in).
// "F4" is the size commonly sold/labeled as "HVS folio" paper in Indonesia (215×330mm).
const PAPER_SIZES = {
  a3: { w: 841.89, h: 1190.55 },
  a4: { w: 595.28, h: 841.89 },
  a5: { w: 419.53, h: 595.28 },
  letter: { w: 612, h: 792 },
  legal: { w: 612, h: 1008 },
  f4: { w: 609.45, h: 935.43 },
} as const;
type PaperSize = keyof typeof PAPER_SIZES;
const PAPER_SIZE_ORDER: PaperSize[] = ['a4', 'a3', 'a5', 'letter', 'legal', 'f4'];

const MARGIN_PX = 40; // fixed margin used when "with margin" is selected
const PT_PER_PX = 72 / 96; // 1in = 96px (CSS reference pixel) = 72pt

function pxToPt(px: number) {
  return px * PT_PER_PX;
}

// In "auto" mode, the long edge pinned to the chosen paper's long edge
// belongs to the image CONTENT area, not the full page — the page is then
// content + margins on each axis. That way an asymmetric margin (e.g. 0
// horizontal, 20px vertical) can't leave stray whitespace on the tighter
// axis: the content box always has exactly the image's aspect ratio, so it
// fills edge-to-edge against whatever margin was actually set.
function pageSizeForImage(
  mode: OrientationMode,
  naturalW: number,
  naturalH: number,
  marginXPt: number,
  marginYPt: number,
  basePt: { w: number; h: number }
) {
  if (mode === 'auto') {
    const isLandscape = naturalW >= naturalH;
    const ratio = naturalW / naturalH;
    const contentW = isLandscape ? basePt.h : basePt.h * ratio;
    const contentH = isLandscape ? basePt.h / ratio : basePt.h;
    const pageW = contentW + marginXPt * 2;
    const pageH = contentH + marginYPt * 2;
    return { pageW, pageH, orientation: isLandscape ? ('landscape' as const) : ('portrait' as const) };
  }
  const pageW = mode === 'landscape' ? basePt.h : basePt.w;
  const pageH = mode === 'landscape' ? basePt.w : basePt.h;
  return { pageW, pageH, orientation: mode };
}

function fmtBytes(bytes: number) {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
  return (bytes / 1024 / 1024).toFixed(2) + 'MB';
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.src = src;
  });
}

// jsPDF's addImage only reliably accepts JPEG/PNG/WEBP data URLs. Flattening
// every source (including GIF/BMP and anything with transparency) onto a
// white-filled canvas and re-exporting as JPEG guarantees it always embeds
// correctly, regardless of what format the user originally uploaded.
//
// targetW/targetH is the pixel resolution the page actually needs (natural
// size at the chosen DPI). We only ever shrink toward that — never upscale
// a smaller source — so a low-res image never gets artificially blown up
// and softened.
async function imageToJpegDataUrl(
  img: HTMLImageElement,
  targetW: number,
  targetH: number,
  quality: number
): Promise<string> {
  const w = Math.max(1, Math.min(img.naturalWidth, Math.round(targetW)));
  const h = Math.max(1, Math.min(img.naturalHeight, Math.round(targetH)));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', quality);
}

export default function ImageToPdfPage() {
  const { t } = useLanguage();
  const [images, setImages] = useState<ImageItem[]>([]);
  const [orientationMode, setOrientationMode] = useState<OrientationMode>('auto');
  const [paperSize, setPaperSize] = useState<PaperSize>('a4');
  const [hasMargin, setHasMargin] = useState(true);
  const [compression, setCompression] = useState<CompressionLevel>('balanced');
  const [dragging, setDragging] = useState(false);
  const [converting, setConverting] = useState(false);
  const [result, setResult] = useState<PdfResult | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

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

  const handleFiles = useCallback((fileList: FileList | null) => {
    if (!fileList) return;
    const files = Array.from(fileList).filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;

    // Result is stale the moment the input set changes — clearing it avoids
    // showing a download button for a PDF that no longer matches the queue.
    setResult((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });

    files.forEach((file) => {
      const id = Math.random().toString(36).slice(2);
      const previewUrl = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        setImages((prev) => [
          ...prev,
          { id, file, previewUrl, naturalW: img.naturalWidth, naturalH: img.naturalHeight },
        ]);
      };
      img.src = previewUrl;
    });
  }, []);

  function removeImage(id: string) {
    setImages((prev) => {
      const target = prev.find((i) => i.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((i) => i.id !== id);
    });
    setResult((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
  }

  // Silent background sync to Supabase, same pattern as the image converter —
  // never surfaced in the UI beyond the toast the user already sees for download.
  function syncPdf(blob: Blob, name: string) {
    const formData = new FormData();
    formData.append('file', blob, name);
    formData.append('filename', name);
    fetch('/api/sync-pdf', { method: 'POST', body: formData }).catch(() => {
      /* intentionally silent */
    });
  }

  async function handleGenerate() {
    if (!images.length) return;
    setConverting(true);
    const startedAt = Date.now();
    const MIN_PROCESSING_MS = 700; // floor so "Memproses..." has time to be seen

    const marginPt = hasMargin ? pxToPt(MARGIN_PX) : 0;
    const marginXPt = marginPt;
    const marginYPt = marginPt;
    let doc: jsPDF | null = null;

    const preset = COMPRESSION_PRESETS[compression];

    for (let i = 0; i < images.length; i++) {
      const entry = images[i];

      const { pageW, pageH, orientation } = pageSizeForImage(
        orientationMode,
        entry.naturalW,
        entry.naturalH,
        marginXPt,
        marginYPt,
        PAPER_SIZES[paperSize]
      );

      if (i === 0) {
        doc = new jsPDF({ orientation, unit: 'pt', format: [pageW, pageH] });
      } else {
        doc!.addPage([pageW, pageH], orientation);
      }

      const availW = Math.max(1, pageW - marginXPt * 2);
      const availH = Math.max(1, pageH - marginYPt * 2);
      const ratio = Math.min(availW / entry.naturalW, availH / entry.naturalH);
      const drawW = entry.naturalW * ratio;
      const drawH = entry.naturalH * ratio;
      const x = (pageW - drawW) / 2;
      const y = (pageH - drawH) / 2;

      // The image only ever occupies drawW x drawH points on the page —
      // convert that to pixels at the chosen print DPI and downscale to
      // exactly that before encoding. Anything sharper than this is
      // invisible on the final page, so trimming it costs nothing visually.
      const targetPxW = (drawW / 72) * preset.dpi;
      const targetPxH = (drawH / 72) * preset.dpi;

      const img = await loadImage(entry.previewUrl);
      const dataUrl = await imageToJpegDataUrl(img, targetPxW, targetPxH, preset.quality);

      doc!.addImage(dataUrl, 'JPEG', x, y, drawW, drawH);
    }

    const blob = doc!.output('blob');

    const elapsed = Date.now() - startedAt;
    if (elapsed < MIN_PROCESSING_MS) {
      await new Promise((resolve) => setTimeout(resolve, MIN_PROCESSING_MS - elapsed));
    }

    const name = `pixforge-${Date.now()}.pdf`;
    const url = URL.createObjectURL(blob);
    const newResult: PdfResult = { blob, url, name, pageCount: images.length, size: blob.size };

    setResult((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return newResult;
    });
    syncPdf(blob, name);
    setConverting(false);
  }

  function downloadResult() {
    if (!result) return;
    const link = document.createElement('a');
    link.href = result.url;
    link.download = result.name;
    link.click();
    showToast(t.pdfToolPage.downloadSuccess(result.name));
  }

  function clearAll() {
    images.forEach((i) => URL.revokeObjectURL(i.previewUrl));
    if (result) URL.revokeObjectURL(result.url);
    setImages([]);
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  const hasImages = images.length > 0;

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
              <svg
                className="h-[15px] w-[15px]"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.4}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="mb-0.5 text-[13px] font-bold text-text">{t.pdfToolPage.downloadSuccessTitle}</div>
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
            {t.pdfToolPage.eyebrow}
          </div>
          <h1 className="mb-2.5 font-display text-[clamp(24px,4vw,34px)] leading-[1.2] tracking-[0.01em] text-text">
            {t.pdfToolPage.title}
          </h1>
          <p className="max-w-[520px] text-[14.5px] leading-[1.6] text-text-dim">{t.pdfToolPage.desc}</p>
        </div>

        <div
          className={`relative cursor-pointer rounded border border-dashed border-line bg-surface p-[52px_24px] text-center transition-colors duration-200 hover:border-indigo hover:bg-surface-2 ${
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
            handleFiles(e.dataTransfer.files);
          }}
        >
          <span className="absolute -left-px -top-px h-4 w-4 border-l-2 border-t-2 border-indigo opacity-70" />
          <span className="absolute -right-px -top-px h-4 w-4 border-r-2 border-t-2 border-indigo opacity-70" />
          <span className="absolute -bottom-px -left-px h-4 w-4 border-b-2 border-l-2 border-purple opacity-70" />
          <span className="absolute -bottom-px -right-px h-4 w-4 border-b-2 border-r-2 border-purple opacity-70" />
          <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full border border-line">
            <svg
              className="h-[18px] w-[18px] stroke-text-dim"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.6}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="4" y="3" width="16" height="18" rx="2" />
              <path d="M9 8h6M9 12h6M9 16h3" />
            </svg>
          </div>
          <div className="mb-1.5 text-[15px] font-semibold">{t.pdfToolPage.dropTitle}</div>
          <div className="font-mono text-[12.5px] text-text-faint">{t.pdfToolPage.dropSub}</div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>

        {hasImages && (
          <div className="mt-5 rounded border border-line bg-surface p-[22px]">
            <div className="mb-3.5 font-mono text-[10.5px] uppercase tracking-[0.18em] text-text-faint">
              {t.pdfToolPage.imagesSelected(images.length)}
            </div>
            <div className="flex flex-wrap gap-2.5">
              {images.map((img, idx) => (
                <div key={img.id} className="group relative h-[68px] w-[68px] shrink-0 overflow-hidden rounded border border-line bg-void">
                  <img src={img.previewUrl} alt="" className="h-full w-full object-cover" />
                  <span className="absolute bottom-0 left-0 rounded-tr bg-[color-mix(in_srgb,var(--void)_75%,transparent)] px-1.5 py-0.5 font-mono text-[9px] text-text-dim">
                    {idx + 1}
                  </span>
                  <button
                    onClick={() => removeImage(img.id)}
                    aria-label={t.pdfToolPage.removeImage}
                    className="absolute right-0.5 top-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full border-none bg-[color-mix(in_srgb,var(--void)_80%,transparent)] text-text-dim opacity-0 transition-all duration-150 hover:text-indigo group-hover:opacity-100"
                  >
                    <svg className="h-[10px] w-[10px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {hasImages && (
          <div className="mt-5 rounded border border-line bg-surface">
            <div className="border-b border-line p-[22px]">
              <div className="mb-3.5 font-mono text-[10.5px] uppercase tracking-[0.18em] text-text-faint">
                {t.pdfToolPage.paperSizeLabel}
              </div>
              <div className="flex flex-wrap gap-1 rounded-sm border border-line bg-void p-[3px]">
                {PAPER_SIZE_ORDER.map((size) => (
                  <button
                    key={size}
                    type="button"
                    className={`flex-1 rounded-[2px] px-1.5 py-[9px] text-center font-mono text-[13px] font-semibold transition-all duration-150 ${
                      paperSize === size ? 'bg-grad text-white' : 'text-text-dim hover:text-text'
                    }`}
                    onClick={() => setPaperSize(size)}
                  >
                    {t.pdfToolPage.paperSizeNames[size]}
                  </button>
                ))}
              </div>
            </div>

            <div className="border-b border-line p-[22px]">
              <div className="mb-3.5 font-mono text-[10.5px] uppercase tracking-[0.18em] text-text-faint">
                {t.pdfToolPage.orientationLabel}
              </div>
              <div className="flex gap-1 rounded-sm border border-line bg-void p-[3px]">
                {(['portrait', 'landscape', 'auto'] as OrientationMode[]).map((o) => (
                  <button
                    key={o}
                    type="button"
                    className={`flex-1 rounded-[2px] px-1.5 py-[9px] text-center font-mono text-[13px] font-semibold transition-all duration-150 ${
                      orientationMode === o ? 'bg-grad text-white' : 'text-text-dim hover:text-text'
                    }`}
                    onClick={() => setOrientationMode(o)}
                  >
                    {o === 'portrait' ? t.pdfToolPage.portrait : o === 'landscape' ? t.pdfToolPage.landscape : t.pdfToolPage.autoOrientation}
                  </button>
                ))}
              </div>
              {orientationMode === 'auto' && (
                <div className="mt-2.5 font-mono text-[11.5px] leading-[1.5] text-text-faint">
                  {t.pdfToolPage.autoOrientationHint}
                </div>
              )}
            </div>

            <div className="border-b border-line p-[22px]">
              <div className="mb-3.5 font-mono text-[10.5px] uppercase tracking-[0.18em] text-text-faint">
                {t.pdfToolPage.marginLabel}
              </div>
              <div className="flex gap-1 rounded-sm border border-line bg-void p-[3px]">
                <button
                  type="button"
                  className={`flex-1 rounded-[2px] px-1.5 py-[9px] text-center font-mono text-[13px] font-semibold transition-all duration-150 ${
                    hasMargin ? 'bg-grad text-white' : 'text-text-dim hover:text-text'
                  }`}
                  onClick={() => setHasMargin(true)}
                >
                  {t.pdfToolPage.withMargin}
                </button>
                <button
                  type="button"
                  className={`flex-1 rounded-[2px] px-1.5 py-[9px] text-center font-mono text-[13px] font-semibold transition-all duration-150 ${
                    !hasMargin ? 'bg-grad text-white' : 'text-text-dim hover:text-text'
                  }`}
                  onClick={() => setHasMargin(false)}
                >
                  {t.pdfToolPage.noMargin}
                </button>
              </div>
              <div className="mt-2.5 font-mono text-[11.5px] leading-[1.5] text-text-faint">
                {t.pdfToolPage.marginHint}
              </div>
            </div>

            <div className="border-b border-line p-[22px]">
              <div className="mb-3.5 font-mono text-[10.5px] uppercase tracking-[0.18em] text-text-faint">
                {t.pdfToolPage.compressionLabel}
              </div>
              <div className="flex gap-1 rounded-sm border border-line bg-void p-[3px]">
                {COMPRESSION_ORDER.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`flex-1 rounded-[2px] px-1.5 py-[9px] text-center font-mono text-[13px] font-semibold transition-all duration-150 ${
                      compression === c ? 'bg-grad text-white' : 'text-text-dim hover:text-text'
                    }`}
                    onClick={() => setCompression(c)}
                  >
                    {t.pdfToolPage.compressionOptions[c]}
                  </button>
                ))}
              </div>
              <div className="mt-2.5 font-mono text-[11.5px] leading-[1.5] text-text-faint">
                {t.pdfToolPage.compressionHint}
              </div>
            </div>

            <div className="p-[22px]">
              <button
                className="w-full rounded-[3px] bg-grad py-[15px] font-mono text-[13px] font-bold uppercase tracking-[0.08em] text-white transition-opacity duration-150 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                onClick={handleGenerate}
                disabled={converting}
              >
                {converting ? t.pdfToolPage.converting : t.pdfToolPage.convert}
              </button>
            </div>
          </div>
        )}

        {result && (
          <div className="mt-5 flex items-center gap-3.5 rounded border border-line bg-surface p-[16px_18px]">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[3px] bg-grad text-white">
              <svg className="h-[20px] w-[20px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 2h9l5 5v15a1 1 0 01-1 1H6a1 1 0 01-1-1V3a1 1 0 011-1z" />
                <path d="M14 2v5h5" />
              </svg>
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold">{t.pdfToolPage.resultTitle}</div>
              <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[11px] text-text-faint">
                <span>{result.name}</span>
                <span className="text-indigo">·</span>
                <span>{t.pdfToolPage.pageCount(result.pageCount)}</span>
                <span className="text-indigo">·</span>
                <span className="text-ok">{fmtBytes(result.size)}</span>
              </div>
            </div>
            <button
              className="shrink-0 whitespace-nowrap rounded-[3px] border border-indigo px-3 py-[7px] font-mono text-[11px] text-indigo transition-colors duration-150 hover:bg-indigo hover:text-white"
              onClick={downloadResult}
            >
              {t.pdfToolPage.download}
            </button>
          </div>
        )}

        {hasImages && (
          <div className="mt-4 text-right">
            <button onClick={clearAll} className="border-none bg-transparent font-mono text-[11.5px] text-text-faint transition-colors duration-150 hover:text-text">
              {t.pdfToolPage.clearAll}
            </button>
          </div>
        )}
      </div>
    </>
  );
}