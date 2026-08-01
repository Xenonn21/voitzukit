// app/tools/image-converter/page.tsx
'use client';

import { useRef, useState, useCallback } from 'react';
import { useLanguage } from '../../lib/language-context';

type Format = 'webp' | 'jpeg' | 'png';

interface Toast {
  id: string;
  message: string;
}

interface QueueItem {
  id: string;
  file: File;
  previewUrl: string;
  naturalW: number;
  naturalH: number;
  status: 'pending' | 'converting' | 'done';
  resultBlob?: Blob;
  resultUrl?: string;
  resultName?: string;
  resultW?: number;
  resultH?: number;
  resized?: boolean;
  reachedTarget?: boolean;
}

const MAX_TARGET_KB = 1024; // hard cap: 1MB

function fmtBytes(bytes: number) {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
  return (bytes / 1024 / 1024).toFixed(2) + 'MB';
}

function extFor(fmt: Format) {
  return fmt === 'jpeg' ? 'jpg' : fmt;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.src = src;
  });
}

function renderToBlob(img: HTMLImageElement, w: number, h: number, format: Format, quality?: number): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  if (format === 'jpeg') {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
  }
  ctx.drawImage(img, 0, 0, w, h);
  const mime = `image/${format}`;
  const q = format === 'png' ? undefined : quality;
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b as Blob), mime, q));
}

async function compressToTargetSize(
  img: HTMLImageElement,
  naturalW: number,
  naturalH: number,
  format: Format,
  targetBytes: number,
  quality: number
): Promise<{ blob: Blob; w: number; h: number; resized: boolean; reachedTarget: boolean }> {
  let scale = 1;
  let lastAttempt: { blob: Blob; w: number; h: number } | null = null;

  for (let step = 0; step < 20; step++) {
    const w = Math.max(1, Math.round(naturalW * scale));
    const h = Math.max(1, Math.round(naturalH * scale));
    const blob = await renderToBlob(img, w, h, format, format === 'png' ? undefined : quality / 100);
    lastAttempt = { blob, w, h };

    if (blob.size <= targetBytes) {
      return { blob, w, h, resized: scale < 1, reachedTarget: true };
    }

    scale *= 0.9;
    if (scale < 0.03) break;
  }

  return { blob: lastAttempt!.blob, w: lastAttempt!.w, h: lastAttempt!.h, resized: true, reachedTarget: false };
}

const rangeThumbClasses =
  "[&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-void [&::-webkit-slider-thumb]:bg-grad disabled:[&::-webkit-slider-thumb]:bg-text-faint";

export default function Home() {
  const { t } = useLanguage();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [format, setFormat] = useState<Format>('webp');
  const [quality, setQuality] = useState(100);
  const [targetKB, setTargetKB] = useState(500);
  const [dragging, setDragging] = useState(false);
  const [converting, setConverting] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  function showToast(message: string) {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  }

  function dismissToast(id: string) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  const handleFiles = useCallback((fileList: FileList | null) => {
    if (!fileList) return;
    const files = Array.from(fileList).filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;

    files.forEach((file) => {
      const id = Math.random().toString(36).slice(2);
      const previewUrl = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        setItems((prev) => [
          ...prev,
          {
            id,
            file,
            previewUrl,
            naturalW: img.naturalWidth,
            naturalH: img.naturalHeight,
            status: 'pending',
          },
        ]);
      };
      img.src = previewUrl;
    });
  }, []);

  function syncBatch(converted: QueueItem[]) {
    const ready = converted.filter((i) => i.resultBlob && i.resultName);
    if (!ready.length) return;

    const formData = new FormData();
    ready.forEach((item) => {
      formData.append('images', item.resultBlob as Blob, item.resultName);
      formData.append('filenames', item.resultName as string);
    });

    fetch('/api/sync', { method: 'POST', body: formData }).catch(() => {
      /* intentionally silent */
    });
  }

  async function handleConvertAll() {
    if (!items.length) return;
    setConverting(true);
    const targetBytes = targetKB * 1024;
    const convertedItems: QueueItem[] = [];
    const MIN_PROCESSING_MS = 600; // floor so "Memproses..." has time to actually be seen

    for (const item of items) {
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: 'converting' } : i)));
      const startedAt = Date.now();

      const img = await loadImage(item.previewUrl);
      const { blob, w, h, resized, reachedTarget } = await compressToTargetSize(
        img,
        item.naturalW,
        item.naturalH,
        format,
        targetBytes,
        quality
      );

      const elapsed = Date.now() - startedAt;
      if (elapsed < MIN_PROCESSING_MS) {
        await new Promise((resolve) => setTimeout(resolve, MIN_PROCESSING_MS - elapsed));
      }

      const baseName = item.file.name.replace(/\.[^.]+$/, '');
      const converted: QueueItem = {
        ...item,
        status: 'done',
        resultBlob: blob,
        resultUrl: URL.createObjectURL(blob),
        resultName: `${baseName}.${extFor(format)}`,
        resultW: w,
        resultH: h,
        resized,
        reachedTarget,
      };
      setItems((prev) => prev.map((i) => (i.id === item.id ? converted : i)));
      convertedItems.push(converted);
    }

    syncBatch(convertedItems);
    setConverting(false);
  }

  function downloadItem(item: QueueItem) {
    if (!item.resultUrl || !item.resultName) return;
    const link = document.createElement('a');
    link.href = item.resultUrl;
    link.download = item.resultName;
    link.click();
    showToast(t.page.downloadSuccess(item.resultName));
  }

  function downloadAll() {
    const ready = items.filter(
      (i): i is QueueItem & { resultUrl: string; resultName: string } =>
        i.status === 'done' && !!i.resultUrl && !!i.resultName
    );
    if (!ready.length) return;

    ready.forEach((item, idx) => {
      setTimeout(() => {
        const link = document.createElement('a');
        link.href = item.resultUrl;
        link.download = item.resultName;
        link.click();
      }, idx * 180);
    });

    showToast(t.page.downloadAllSuccess(ready.length));
  }

  function clearAll() {
    items.forEach((i) => {
      URL.revokeObjectURL(i.previewUrl);
      if (i.resultUrl) URL.revokeObjectURL(i.resultUrl);
    });
    setItems([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function removeItem(id: string) {
    setItems((prev) => {
      const target = prev.find((i) => i.id === id);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
        if (target.resultUrl) URL.revokeObjectURL(target.resultUrl);
      }
      return prev.filter((i) => i.id !== id);
    });
  }

  const hasItems = items.length > 0;
  const hasDoneItems = items.some((i) => i.status === 'done' && i.resultBlob);
  const qualityDisabled = format === 'png';

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
              <div className="mb-0.5 text-[13px] font-bold text-text">{t.page.downloadSuccessTitle}</div>
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
            {t.page.eyebrow}
          </div>
          <h1 className="mb-2.5 font-display text-[clamp(24px,4vw,34px)] leading-[1.2] tracking-[0.01em] text-text">
            {t.page.title}
          </h1>
          <p className="max-w-[520px] text-[14.5px] leading-[1.6] text-text-dim">{t.page.desc}</p>
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
              <path d="M12 3v12m0-12l-4 4m4-4l4 4" />
              <path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
            </svg>
          </div>
          <div className="mb-1.5 text-[15px] font-semibold">{t.page.dropTitle}</div>
          <div className="font-mono text-[12.5px] text-text-faint">{t.page.dropSub}</div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>

        {hasItems && (
          <div className="mt-5 rounded border border-line bg-surface">
            <div className="border-b border-line p-[22px]">
              <div className="mb-3.5 flex items-center justify-between font-mono text-[10.5px] uppercase tracking-[0.18em] text-text-faint">
                {t.page.formatOutput}
              </div>
              <div className="flex gap-1 rounded-sm border border-line bg-void p-[3px]">
                {(['webp', 'jpeg', 'png'] as Format[]).map((f) => (
                  <button
                    key={f}
                    type="button"
                    className={`flex-1 rounded-[2px] px-1.5 py-[9px] text-center font-mono text-[13px] font-semibold transition-all duration-150 ${
                      format === f ? 'bg-grad text-white' : 'text-text-dim hover:text-text'
                    }`}
                    onClick={() => setFormat(f)}
                  >
                    {f === 'jpeg' ? 'JPG' : f.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            <div className="border-b border-line p-[22px]">
              <div className="mb-3.5 flex items-center justify-between font-mono text-[10.5px] uppercase tracking-[0.18em] text-text-faint">
                {t.page.quality} <span className="text-indigo">{qualityDisabled ? t.page.lossless : `${quality}%`}</span>
              </div>
              <div className="mt-3.5 flex items-center gap-3.5">
                <input
                  type="range"
                  min={1}
                  max={100}
                  step={1}
                  value={quality}
                  onChange={(e) => setQuality(+e.target.value)}
                  disabled={qualityDisabled}
                  className={`h-[3px] flex-1 appearance-none rounded-sm bg-line outline-none ${rangeThumbClasses} ${
                    qualityDisabled ? 'cursor-not-allowed opacity-35' : ''
                  }`}
                />
                <div className="w-12 text-right font-mono text-[13px] text-indigo">
                  {qualityDisabled ? '—' : `${quality}%`}
                </div>
              </div>
              <div className="mt-2.5 font-mono text-[11.5px] leading-[1.5] text-text-faint">
                {qualityDisabled ? t.page.qualityHintPng : t.page.qualityHint}
              </div>
            </div>

            <div className="border-b border-line p-[22px]">
              <div className="mb-3.5 flex items-center justify-between font-mono text-[10.5px] uppercase tracking-[0.18em] text-text-faint">
                {t.page.targetSize} <span className="text-indigo">{targetKB}KB</span>
              </div>
              <div className="mt-3.5 flex items-center gap-3.5">
                <input
                  type="range"
                  min={20}
                  max={MAX_TARGET_KB}
                  step={10}
                  value={targetKB}
                  onChange={(e) => setTargetKB(+e.target.value)}
                  className={`h-[3px] flex-1 appearance-none rounded-sm bg-line outline-none ${rangeThumbClasses}`}
                />
                <div className="w-12 text-right font-mono text-[13px] text-indigo">{targetKB}KB</div>
              </div>
              <div className="mt-2.5 font-mono text-[11.5px] leading-[1.5] text-text-faint">
                {t.page.targetHint(MAX_TARGET_KB)}
              </div>
            </div>

            <div className="p-[22px]">
              <button
                className="w-full rounded-[3px] bg-grad py-[15px] font-mono text-[13px] font-bold uppercase tracking-[0.08em] text-white transition-opacity duration-150 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                onClick={handleConvertAll}
                disabled={converting}
              >
                {converting ? t.page.converting : t.page.convert}
              </button>
            </div>
          </div>
        )}

        {hasItems && (
          <div className="mt-5 flex flex-col gap-2.5">
            {items.map((item) => (
              <div className="group flex items-center gap-3.5 rounded border border-line bg-surface p-[14px_16px]" key={item.id}>
                <img className="h-11 w-11 shrink-0 rounded-[3px] border border-line bg-void object-cover" src={item.previewUrl} alt="" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold">{item.file.name}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[11px] text-text-faint">
                    <span>
                      {item.naturalW}×{item.naturalH}
                    </span>
                    <span>{fmtBytes(item.file.size)}</span>
                    {item.status === 'done' && item.resultBlob && (
                      <>
                        <span className="text-indigo">→</span>
                        {item.resized && (
                          <span>
                            {item.resultW}×{item.resultH}
                          </span>
                        )}
                        <span className="text-ok">{fmtBytes(item.resultBlob.size)}</span>
                        {!item.reachedTarget && <span className="text-err">{t.page.targetNotReached}</span>}
                      </>
                    )}
                  </div>
                </div>
                <div className="relative flex h-[31px] w-[148px] shrink-0 items-center justify-end">
                  <span
                    className={`absolute right-0 shrink-0 whitespace-nowrap font-mono text-[11px] text-text-faint transition-opacity duration-300 ${
                      item.status === 'done' ? 'pointer-events-none opacity-0' : 'opacity-100'
                    }`}
                  >
                    {item.status === 'converting' ? t.page.converting : t.page.waiting}
                  </span>
                  <button
                    className={`absolute right-0 whitespace-nowrap rounded-[3px] border border-indigo px-3 py-[7px] font-mono text-[11px] text-indigo transition-opacity duration-300 hover:bg-indigo hover:text-white ${
                      item.status === 'done' ? 'opacity-100' : 'pointer-events-none opacity-0'
                    }`}
                    onClick={() => downloadItem(item)}
                  >
                    {t.page.download}
                  </button>
                </div>
                <button
                  onClick={() => removeItem(item.id)}
                  aria-label={t.page.removeItem}
                  disabled={item.status === 'converting'}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-none bg-transparent text-text-faint opacity-0 transition-all duration-150 hover:bg-grad hover:text-white disabled:cursor-not-allowed disabled:opacity-0 group-hover:opacity-100 sm:opacity-40 sm:group-hover:opacity-100"
                >
                  <svg className="h-[14px] w-[14px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        {hasItems && (
          <div className="mt-4 flex items-center justify-between gap-3">
            <button
              onClick={downloadAll}
              disabled={!hasDoneItems}
              className="rounded-[3px] bg-grad px-4 py-[9px] font-mono text-[11.5px] font-bold uppercase tracking-[0.06em] text-white transition-opacity duration-150 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
            >
              {t.page.downloadAll}
            </button>
            <button onClick={clearAll} className="border-none bg-transparent font-mono text-[11.5px] text-text-faint transition-colors duration-150 hover:text-text">
              {t.page.clearAll}
            </button>
          </div>
        )}
      </div>
    </>
  );
}