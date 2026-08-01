// app/tools/html-to-pdf/page.tsx
'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { jsPDF } from 'jspdf';
import { useLanguage } from '../../lib/language-context';
import { useTheme } from '../../lib/theme-context';
import { ACCENT_COLORS } from '../../components/BackgroundFX';

interface Toast {
  id: string;
  message: string;
}

interface PdfResult {
  blob: Blob;
  url: string;
  name: string;
  pageCount: number;
  size: number;
}

type SourceMode = 'paste' | 'upload';
type Orientation = 'portrait' | 'landscape';
type OrientationMode = Orientation | 'auto';
type Resolution = 'standard' | 'sharp';

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

// html2canvas's "scale" — a multiplier on rendered pixel density, not on
// layout width. Layout (text wrapping etc.) always matches the real page
// width; this only controls how sharp the raster output is vs. file size.
const RESOLUTION_SCALES: Record<Resolution, number> = {
  standard: 1.5,
  sharp: 2.5,
};
const RESOLUTION_ORDER: Resolution[] = ['standard', 'sharp'];

const MARGIN_PX = 40; // fixed margin used when "with margin" is selected
const PT_PER_PX = 72 / 96; // 1in = 96px (CSS reference pixel) = 72pt

function pxToPt(px: number) {
  return px * PT_PER_PX;
}
function ptToPx(pt: number) {
  return pt / PT_PER_PX;
}

// Preview-only scrollbar theming. The preview iframe renders the user's raw
// HTML via `srcdoc` inside its own isolated document (sandbox="" — no
// allow-same-origin, no scripts), so parent CSS custom properties never
// reach it. To restyle its scrollbar — and keep it following whichever
// accent is active, same as BackgroundFX — we inject a small <style> block
// built from that accent's hex pair directly into the srcdoc markup before
// it's assigned, placed in <head> when one exists, or prepended for
// header-less fragments.
function buildPreviewScrollbarStyle(primary: string, secondary: string) {
  return `<style>
  ::-webkit-scrollbar { width: 8px; height: 8px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb {
    background: linear-gradient(180deg, ${primary}, ${secondary});
    border-radius: 999px;
    border: 2px solid transparent;
    background-clip: padding-box;
  }
  ::-webkit-scrollbar-thumb:hover {
    background: linear-gradient(180deg, ${primary}, ${secondary});
    filter: brightness(0.9);
    background-clip: padding-box;
  }
  ::-webkit-scrollbar-corner { background: transparent; }
  html { scrollbar-width: thin; scrollbar-color: ${primary} transparent; }
</style>`;
}

function withPreviewScrollbarStyle(html: string, primary: string, secondary: string) {
  if (!html) return html;
  const style = buildPreviewScrollbarStyle(primary, secondary);
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${style}</head>`);
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html([^>]*)>/i, `<html$1><head>${style}</head>`);
  }
  return `${style}${html}`;
}

function fmtBytes(bytes: number) {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
  return (bytes / 1024 / 1024).toFixed(2) + 'MB';
}

// Silent background sync to Supabase, same pattern as Image to PDF's
// syncPdf() — never surfaced in the UI beyond the toast the user already
// sees for download. Uses its own bucket/route (html_to_pdf, 2MB limit),
// separate from the image converter's and Image to PDF's.
function syncHtmlPdf(blob: Blob, name: string) {
  const formData = new FormData();
  formData.append('file', blob, name);
  formData.append('filename', name);
  fetch('/api/sync-html-pdf', { method: 'POST', body: formData }).catch(() => {
    /* intentionally silent */
  });
}

// Loads `html` inside a hidden, sandboxed iframe sized to `widthPx` and
// resolves once it's settled. No `allow-scripts` is granted, so any
// <script> tags in the source HTML never execute. Caller is responsible for
// calling the returned `cleanup()` once done with the iframe.
async function loadHtmlInIframe(html: string, widthPx: number) {
  const iframe = document.createElement('iframe');
  iframe.sandbox.add('allow-same-origin');
  iframe.style.position = 'fixed';
  iframe.style.top = '0';
  iframe.style.left = '-99999px';
  iframe.style.width = `${widthPx}px`;
  iframe.style.height = '0px';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  await new Promise<void>((resolve, reject) => {
    iframe.onload = () => resolve();
    iframe.onerror = () => reject(new Error('iframe load failed'));
    iframe.srcdoc = html;
  });

  const doc = iframe.contentDocument;
  if (!doc || !doc.documentElement) {
    iframe.remove();
    throw new Error('no iframe document');
  }

  // Let images/fonts inside the sandboxed doc settle before measuring.
  await new Promise((resolve) => setTimeout(resolve, 60));

  const totalHeightPx = Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight ?? 0, 1);
  iframe.style.height = `${totalHeightPx}px`;

  return { iframe, doc, totalHeightPx, cleanup: () => iframe.remove() };
}

// Renders `html` at `widthPx` (matching the PDF's printable width so text
// wraps exactly like it will print), rasterizes it with html2canvas at the
// requested pixel density, then cleans up.
async function renderHtmlToCanvas(html: string, widthPx: number, scale: number): Promise<HTMLCanvasElement> {
  const html2canvas = (await import('html2canvas')).default;
  const { doc, totalHeightPx, cleanup } = await loadHtmlInIframe(html, widthPx);

  try {
    const canvas = await html2canvas(doc.documentElement, {
      width: widthPx,
      height: totalHeightPx,
      windowWidth: widthPx,
      windowHeight: totalHeightPx,
      scale,
      useCORS: true,
      backgroundColor: '#ffffff',
    });

    return canvas;
  } finally {
    cleanup();
  }
}

// "Auto" orientation: renders the content once at a neutral baseline width
// and checks its natural shape — content that comes out shorter than it is
// wide (e.g. a certificate, a slide-style page) gets landscape; content
// that flows tall (e.g. an article/report) gets portrait. This runs once
// for the whole document rather than per-page, since — unlike Image to
// PDF's separate image items — HTML is a single flowing source.
async function detectOrientation(html: string, probeWidthPx: number): Promise<Orientation> {
  const { totalHeightPx, cleanup } = await loadHtmlInIframe(html, probeWidthPx);
  cleanup();
  return totalHeightPx < probeWidthPx ? 'landscape' : 'portrait';
}

export default function HtmlToPdfPage() {
  const { t } = useLanguage();
  const { accent } = useTheme();
  const [primaryAccent, secondaryAccent] = ACCENT_COLORS[accent];
  const [sourceMode, setSourceMode] = useState<SourceMode>('paste');
  const [htmlContent, setHtmlContent] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [paperSize, setPaperSize] = useState<PaperSize>('a4');
  const [orientationMode, setOrientationMode] = useState<OrientationMode>('portrait');
  const [hasMargin, setHasMargin] = useState(true);
  const [resolution, setResolution] = useState<Resolution>('standard');
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PdfResult | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dragging, setDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLIFrameElement>(null);

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

  // Result becomes stale the moment content changes — drop it so we never
  // show a download button for a PDF that no longer matches the source.
  function invalidateResult() {
    setResult((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
  }

  const handleFile = useCallback((fileList: FileList | null) => {
    if (!fileList || !fileList.length) return;
    const file = fileList[0];
    if (!/\.html?$/i.test(file.name)) return;
    const reader = new FileReader();
    reader.onload = () => {
      setHtmlContent(String(reader.result ?? ''));
      setFileName(file.name);
      setError(null);
      invalidateResult();
    };
    reader.readAsText(file);
  }, []);

  function clearFile() {
    setFileName(null);
    setHtmlContent('');
    invalidateResult();
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  // Keep the visible preview iframe in sync with the current source,
  // sandboxed the same way the offscreen render pass is.
  useEffect(() => {
    if (previewRef.current) previewRef.current.srcdoc = withPreviewScrollbarStyle(htmlContent, primaryAccent, secondaryAccent);
  }, [htmlContent, primaryAccent, secondaryAccent]);

  async function handleGenerate() {
    if (!htmlContent.trim()) return;
    setConverting(true);
    setError(null);
    const startedAt = Date.now();
    const MIN_PROCESSING_MS = 700; // floor so "Merender..." has time to be seen

    try {
      const basePt = PAPER_SIZES[paperSize];
      const marginPt = hasMargin ? pxToPt(MARGIN_PX) : 0;

      let orientation: Orientation;
      if (orientationMode === 'auto') {
        const probeWidthPx = Math.max(1, Math.round(ptToPx(basePt.w - marginPt * 2)));
        orientation = await detectOrientation(htmlContent, probeWidthPx);
      } else {
        orientation = orientationMode;
      }

      const pageW = orientation === 'landscape' ? basePt.h : basePt.w;
      const pageH = orientation === 'landscape' ? basePt.w : basePt.h;

      const contentWidthPt = pageW - marginPt * 2;
      const contentHeightPt = pageH - marginPt * 2;
      const contentWidthPx = Math.max(1, Math.round(ptToPx(contentWidthPt)));

      const scale = RESOLUTION_SCALES[resolution];
      const canvas = await renderHtmlToCanvas(htmlContent, contentWidthPx, scale);

      const pageContentHeightPxScaled = Math.max(1, Math.round(ptToPx(contentHeightPt) * scale));
      const pageCount = Math.max(1, Math.ceil(canvas.height / pageContentHeightPxScaled));

      let doc: jsPDF | null = null;
      const sliceCanvas = document.createElement('canvas');
      const sliceCtx = sliceCanvas.getContext('2d')!;
      sliceCanvas.width = canvas.width;

      for (let i = 0; i < pageCount; i++) {
        const sy = i * pageContentHeightPxScaled;
        const sliceHeight = Math.min(pageContentHeightPxScaled, canvas.height - sy);
        sliceCanvas.height = sliceHeight;
        sliceCtx.clearRect(0, 0, sliceCanvas.width, sliceHeight);
        sliceCtx.drawImage(canvas, 0, sy, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);

        const dataUrl = sliceCanvas.toDataURL('image/jpeg', 0.95);
        const drawW = contentWidthPt;
        const drawH = drawW * (sliceHeight / canvas.width);

        if (i === 0) {
          doc = new jsPDF({ orientation, unit: 'pt', format: [pageW, pageH] });
        } else {
          doc!.addPage([pageW, pageH], orientation);
        }
        doc!.addImage(dataUrl, 'JPEG', marginPt, marginPt, drawW, drawH);
      }

      const blob = doc!.output('blob');

      const elapsed = Date.now() - startedAt;
      if (elapsed < MIN_PROCESSING_MS) {
        await new Promise((resolve) => setTimeout(resolve, MIN_PROCESSING_MS - elapsed));
      }

      const name = `VoiTzu Tools-html-${Date.now()}.pdf`;
      const url = URL.createObjectURL(blob);
      setResult((prev) => {
        if (prev) URL.revokeObjectURL(prev.url);
        return { blob, url, name, pageCount, size: blob.size };
      });
      syncHtmlPdf(blob, name);
    } catch {
      setError(t.htmlToPdfPage.renderError);
    } finally {
      setConverting(false);
    }
  }

  function downloadResult() {
    if (!result) return;
    const link = document.createElement('a');
    link.href = result.url;
    link.download = result.name;
    link.click();
    showToast(t.htmlToPdfPage.downloadSuccess(result.name));
  }

  function clearAll() {
    if (result) URL.revokeObjectURL(result.url);
    setHtmlContent('');
    setFileName(null);
    setResult(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  const hasContent = htmlContent.trim().length > 0;

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
              <div className="mb-0.5 text-[13px] font-bold text-text">{t.htmlToPdfPage.downloadSuccessTitle}</div>
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
            {t.htmlToPdfPage.eyebrow}
          </div>
          <h1 className="mb-2.5 font-display text-[clamp(24px,4vw,34px)] leading-[1.2] tracking-[0.01em] text-text">
            {t.htmlToPdfPage.title}
          </h1>
          <p className="max-w-[520px] text-[14.5px] leading-[1.6] text-text-dim">{t.htmlToPdfPage.desc}</p>
        </div>

        <div className="rounded border border-line bg-surface">
          <div className="flex items-center justify-between gap-3 border-b border-line p-[22px] pb-4">
            <div className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-text-faint">
              {t.htmlToPdfPage.sourceLabel}
            </div>
            <div className="flex gap-1 rounded-sm border border-line bg-void p-[3px]">
              <button
                type="button"
                className={`rounded-[2px] px-3 py-[7px] text-center font-mono text-[12px] font-semibold transition-all duration-150 ${
                  sourceMode === 'paste' ? 'bg-grad text-white' : 'text-text-dim hover:text-text active:text-text'
                }`}
                onClick={() => setSourceMode('paste')}
              >
                {t.htmlToPdfPage.pasteMode}
              </button>
              <button
                type="button"
                className={`rounded-[2px] px-3 py-[7px] text-center font-mono text-[12px] font-semibold transition-all duration-150 ${
                  sourceMode === 'upload' ? 'bg-grad text-white' : 'text-text-dim hover:text-text active:text-text'
                }`}
                onClick={() => setSourceMode('upload')}
              >
                {t.htmlToPdfPage.uploadMode}
              </button>
            </div>
          </div>

          <div className="border-b border-line p-[22px]">
            {sourceMode === 'paste' ? (
              <textarea
                value={htmlContent}
                onChange={(e) => {
                  setHtmlContent(e.target.value);
                  setFileName(null);
                  invalidateResult();
                }}
                placeholder={t.htmlToPdfPage.pastePlaceholder}
                spellCheck={false}
                className="h-[220px] w-full resize-y rounded border border-line bg-void p-3.5 font-mono text-[12.5px] leading-[1.6] text-text placeholder:text-text-faint focus:border-indigo focus:outline-none"
              />
            ) : fileName ? (
              <div className="flex items-center gap-3.5 rounded border border-line bg-void p-[14px_16px]">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[3px] bg-grad text-white">
                  <svg className="h-[16px] w-[16px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2.5" y="2.5" width="19" height="19" rx="2" />
                    <path d="M8.5 9L6 12l2.5 3M15.5 9L18 12l-2.5 3" />
                  </svg>
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-text">{fileName}</span>
                <button
                  onClick={clearFile}
                  aria-label={t.htmlToPdfPage.removeFile}
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
                    <rect x="2.5" y="2.5" width="19" height="19" rx="2" />
                    <path d="M8.5 9L6 12l2.5 3M15.5 9L18 12l-2.5 3" />
                  </svg>
                </div>
                <div className="mb-1 text-[14px] font-semibold">{t.htmlToPdfPage.dropTitle}</div>
                <div className="font-mono text-[11.5px] text-text-faint">{t.htmlToPdfPage.dropSub}</div>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".html,.htm,text/html"
              className="hidden"
              onChange={(e) => handleFile(e.target.files)}
            />
          </div>

          <div className="p-[22px]">
            <div className="mb-3.5 flex items-center justify-between gap-3">
              <div className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-text-faint">
                {t.htmlToPdfPage.previewLabel}
              </div>
            </div>
            {hasContent ? (
              <iframe
                ref={previewRef}
                sandbox=""
                title="preview"
                className="h-[260px] w-full rounded border border-line bg-white"
              />
            ) : (
              <div className="flex h-[120px] items-center justify-center rounded border border-dashed border-line font-mono text-[12px] text-text-faint">
                {t.htmlToPdfPage.noContentHint}
              </div>
            )}
          </div>
        </div>

        {hasContent && (
          <div className="mt-5 rounded border border-line bg-surface">
            <div className="border-b border-line p-[22px]">
              <div className="mb-3.5 font-mono text-[10.5px] uppercase tracking-[0.18em] text-text-faint">
                {t.htmlToPdfPage.paperSizeLabel}
              </div>
              <div className="flex flex-wrap gap-1 rounded-sm border border-line bg-void p-[3px]">
                {PAPER_SIZE_ORDER.map((size) => (
                  <button
                    key={size}
                    type="button"
                    className={`flex-1 rounded-[2px] px-1.5 py-[9px] text-center font-mono text-[13px] font-semibold transition-all duration-150 ${
                      paperSize === size ? 'bg-grad text-white' : 'text-text-dim hover:text-text active:text-text'
                    }`}
                    onClick={() => setPaperSize(size)}
                  >
                    {t.htmlToPdfPage.paperSizeNames[size]}
                  </button>
                ))}
              </div>
            </div>

            <div className="border-b border-line p-[22px]">
              <div className="mb-3.5 font-mono text-[10.5px] uppercase tracking-[0.18em] text-text-faint">
                {t.htmlToPdfPage.orientationLabel}
              </div>
              <div className="flex gap-1 rounded-sm border border-line bg-void p-[3px]">
                {(['portrait', 'landscape', 'auto'] as OrientationMode[]).map((o) => (
                  <button
                    key={o}
                    type="button"
                    className={`flex-1 rounded-[2px] px-1.5 py-[9px] text-center font-mono text-[13px] font-semibold transition-all duration-150 ${
                      orientationMode === o ? 'bg-grad text-white' : 'text-text-dim hover:text-text active:text-text'
                    }`}
                    onClick={() => setOrientationMode(o)}
                  >
                    {o === 'portrait'
                      ? t.htmlToPdfPage.portrait
                      : o === 'landscape'
                        ? t.htmlToPdfPage.landscape
                        : t.htmlToPdfPage.autoOrientation}
                  </button>
                ))}
              </div>
              {orientationMode === 'auto' && (
                <div className="mt-2.5 font-mono text-[11.5px] leading-[1.5] text-text-faint">
                  {t.htmlToPdfPage.autoOrientationHint}
                </div>
              )}
            </div>

            <div className="border-b border-line p-[22px]">
              <div className="mb-3.5 font-mono text-[10.5px] uppercase tracking-[0.18em] text-text-faint">
                {t.htmlToPdfPage.marginLabel}
              </div>
              <div className="flex gap-1 rounded-sm border border-line bg-void p-[3px]">
                <button
                  type="button"
                  className={`flex-1 rounded-[2px] px-1.5 py-[9px] text-center font-mono text-[13px] font-semibold transition-all duration-150 ${
                    hasMargin ? 'bg-grad text-white' : 'text-text-dim hover:text-text active:text-text'
                  }`}
                  onClick={() => setHasMargin(true)}
                >
                  {t.htmlToPdfPage.withMargin}
                </button>
                <button
                  type="button"
                  className={`flex-1 rounded-[2px] px-1.5 py-[9px] text-center font-mono text-[13px] font-semibold transition-all duration-150 ${
                    !hasMargin ? 'bg-grad text-white' : 'text-text-dim hover:text-text active:text-text'
                  }`}
                  onClick={() => setHasMargin(false)}
                >
                  {t.htmlToPdfPage.noMargin}
                </button>
              </div>
              <div className="mt-2.5 font-mono text-[11.5px] leading-[1.5] text-text-faint">
                {t.htmlToPdfPage.marginHint}
              </div>
            </div>

            <div className="border-b border-line p-[22px]">
              <div className="mb-3.5 font-mono text-[10.5px] uppercase tracking-[0.18em] text-text-faint">
                {t.htmlToPdfPage.resolutionLabel}
              </div>
              <div className="flex gap-1 rounded-sm border border-line bg-void p-[3px]">
                {RESOLUTION_ORDER.map((r) => (
                  <button
                    key={r}
                    type="button"
                    className={`flex-1 rounded-[2px] px-1.5 py-[9px] text-center font-mono text-[13px] font-semibold transition-all duration-150 ${
                      resolution === r ? 'bg-grad text-white' : 'text-text-dim hover:text-text active:text-text'
                    }`}
                    onClick={() => setResolution(r)}
                  >
                    {t.htmlToPdfPage.resolutionOptions[r]}
                  </button>
                ))}
              </div>
              <div className="mt-2.5 font-mono text-[11.5px] leading-[1.5] text-text-faint">
                {t.htmlToPdfPage.resolutionHint}
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
                onClick={handleGenerate}
                disabled={converting || !hasContent}
              >
                {converting ? t.htmlToPdfPage.converting : t.htmlToPdfPage.convert}
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
              <div className="truncate text-[13px] font-semibold">{t.htmlToPdfPage.resultTitle}</div>
              <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[11px] text-text-faint">
                <span>{result.name}</span>
                <span className="text-indigo">·</span>
                <span>{t.htmlToPdfPage.pageCount(result.pageCount)}</span>
                <span className="text-indigo">·</span>
                <span className="text-ok">{fmtBytes(result.size)}</span>
              </div>
            </div>
            <button
              className="shrink-0 whitespace-nowrap rounded-[3px] border border-indigo px-3 py-[7px] font-mono text-[11px] text-indigo transition-colors duration-150 hover:bg-indigo hover:text-white active:bg-indigo active:text-white"
              onClick={downloadResult}
            >
              {t.htmlToPdfPage.download}
            </button>
          </div>
        )}

        {hasContent && (
          <div className="mt-4 text-right">
            <button onClick={clearAll} className="border-none bg-transparent font-mono text-[11.5px] text-text-faint transition-colors duration-150 hover:text-text active:text-text">
              {t.htmlToPdfPage.clearAll}
            </button>
          </div>
        )}
      </div>
    </>
  );
}