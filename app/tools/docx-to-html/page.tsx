// app/tools/docx-to-html/page.tsx
//
// Requires `mammoth` (client-side .docx -> HTML conversion, runs entirely in
// the browser — no server round-trip for the actual conversion):
//   npm install mammoth
// mammoth doesn't ship its own TypeScript types; if your tsconfig complains,
// add a `declare module 'mammoth';` in a .d.ts file, or `npm install -D
// @types/mammoth` if a community typing package is available.
'use client';

import { useRef, useState, useCallback } from 'react';
import mammoth from 'mammoth';
import { useLanguage } from '../../lib/language-context';

interface Toast {
  id: string;
  message: string;
}

type ItemStatus = 'waiting' | 'converting' | 'done' | 'error';

interface QueueItem {
  id: string;
  file: File;
  status: ItemStatus;
  resultBlob?: Blob;
  resultUrl?: string;
  resultName?: string;
  hasWarning?: boolean;
}

function fmtBytes(bytes: number) {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
  return (bytes / 1024 / 1024).toFixed(2) + 'MB';
}

function withHtmlExtension(filename: string) {
  return filename.replace(/\.docx$/i, '') + '.html';
}

// Wraps mammoth's converted body markup in a self-contained, actually
// *designed* document instead of bare unstyled markup — a card-style layout
// with the same indigo→purple accent language as the rest of PIXFORGE,
// styled headings/tables/lists/quotes/code, all inlined in one <style> tag
// so the file has nothing external to fetch (works fine opened as a local
// file://, no CDN/font dependency).
function wrapWithBaseStyles(bodyHtml: string, title: string) {
  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>
  :root {
    --accent-1: #6366f1;
    --accent-2: #a855f7;
    --ink: #1c1c24;
    --ink-dim: #5c5c6b;
    --line: #e6e6ef;
    --surface: #f6f6fb;
  }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.7;
    color: var(--ink);
    background: var(--surface);
    margin: 0;
    padding: 48px 20px;
  }
  .doc-card {
    max-width: 780px;
    margin: 0 auto;
    background: #fff;
    border-radius: 14px;
    border: 1px solid var(--line);
    box-shadow: 0 20px 50px rgba(30, 20, 70, 0.08);
    overflow: hidden;
  }
  .doc-card__bar {
    height: 6px;
    background: linear-gradient(90deg, var(--accent-1), var(--accent-2));
  }
  .doc-card__body {
    padding: 48px 56px 60px;
    overflow-wrap: break-word;
    word-break: break-word;
  }
  @media (max-width: 640px) {
    body { padding: 0; }
    .doc-card { border-radius: 0; border: none; }
    .doc-card__body { padding: 36px 22px 48px; }
  }

  h1, h2, h3, h4, h5, h6 {
    font-weight: 700;
    line-height: 1.3;
    color: var(--ink);
    margin-top: 1.6em;
    margin-bottom: 0.6em;
  }
  h1 {
    font-size: 1.9em;
    margin-top: 0;
    padding-bottom: 0.5em;
    border-bottom: 2px solid transparent;
    border-image: linear-gradient(90deg, var(--accent-1), var(--accent-2)) 1;
  }
  h2 {
    font-size: 1.4em;
    padding-left: 12px;
    border-left: 4px solid var(--accent-1);
  }
  h3 { font-size: 1.15em; color: #34324a; }

  p { margin: 0.9em 0; }
  strong { color: var(--ink); }
  em { color: var(--ink-dim); }

  a {
    color: var(--accent-1);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  a:hover { color: var(--accent-2); }

  ul, ol { padding-left: 1.4em; margin: 0.9em 0; }
  li { margin: 0.35em 0; }
  ul li::marker { color: var(--accent-1); }
  ol li::marker { color: var(--accent-1); font-weight: 700; }

  .table-scroll {
    margin: 1.4em 0;
    overflow-x: auto;
    border-radius: 8px;
  }
  table {
    border-collapse: separate;
    border-spacing: 0;
    width: 100%;
    min-width: 420px;
    margin: 0;
    border: 1px solid var(--line);
    border-radius: 8px;
    overflow: hidden;
    font-size: 0.94em;
  }
  th {
    background: linear-gradient(90deg, var(--accent-1), var(--accent-2));
    color: #fff;
    font-weight: 600;
    text-align: left;
    padding: 10px 14px;
  }
  td {
    padding: 10px 14px;
    border-top: 1px solid var(--line);
  }
  tr:nth-child(even) td { background: var(--surface); }

  blockquote {
    margin: 1.2em 0;
    padding: 0.8em 1.2em;
    border-left: 4px solid var(--accent-2);
    background: var(--surface);
    color: var(--ink-dim);
    font-style: italic;
    border-radius: 0 6px 6px 0;
  }

  code {
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 4px;
    padding: 0.15em 0.4em;
    font-size: 0.9em;
    color: #7c3aed;
  }
  pre {
    background: #1c1c24;
    color: #e6e6ef;
    padding: 16px 18px;
    border-radius: 8px;
    overflow-x: auto;
  }
  pre code { background: none; border: none; color: inherit; padding: 0; }

  hr {
    border: none;
    height: 1px;
    background: var(--line);
    margin: 2em 0;
  }

  img {
    max-width: 100%;
    height: auto;
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(30, 20, 70, 0.12);
    display: block;
    margin: 1.2em auto;
  }

  .doc-card__footer {
    padding: 18px 56px;
    border-top: 1px solid var(--line);
    font-size: 11.5px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--ink-dim);
    font-family: "SFMono-Regular", Consolas, Menlo, monospace;
  }
  @media (max-width: 640px) {
    .doc-card__footer { padding: 16px 22px; }
  }
</style>
</head>
<body>
  <div class="doc-card">
    <div class="doc-card__bar"></div>
    <div class="doc-card__body">
${bodyHtml}
    </div>
    <div class="doc-card__footer">Dibuat dengan PIXFORGE &middot; DOCX ke HTML</div>
  </div>
</body>
</html>
`;
}

// Best-effort background backup of the converted HTML — mirrors the other
// tools' sync routes. A failure here is silent and never blocks the user's
// own download; see app/api/sync-docx-to-html/route.ts.
async function syncItem(blob: Blob, filename: string) {
  try {
    const fd = new FormData();
    fd.append('file', blob, filename);
    fd.append('filename', filename);
    await fetch('/api/sync-docx-to-html', { method: 'POST', body: fd });
  } catch {
    // Ignored on purpose — see comment above.
  }
}

export default function DocxToHtmlPage() {
  const { t } = useLanguage();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [includeStyles, setIncludeStyles] = useState(true);
  const [converting, setConverting] = useState(false);
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

  const handleFiles = useCallback((fileList: FileList | null) => {
    if (!fileList) return;
    const files = Array.from(fileList).filter((f) => f.name.toLowerCase().endsWith('.docx'));
    if (!files.length) return;

    const newItems: QueueItem[] = files.map((file) => ({
      id: Math.random().toString(36).slice(2),
      file,
      status: 'waiting',
    }));
    setItems((prev) => [...prev, ...newItems]);
  }, []);

  async function convertItem(item: QueueItem): Promise<QueueItem> {
    try {
      const arrayBuffer = await item.file.arrayBuffer();
      const { value: rawBodyHtml, messages } = await mammoth.convertToHtml({ arrayBuffer });
      // Random source docs can contain wide tables (lots of columns) that
      // would otherwise force the whole card wider than the viewport on
      // mobile. Wrapping every <table> in a scrollable container keeps the
      // card's width fixed while the table itself scrolls independently.
      const bodyHtml = rawBodyHtml
        .replace(/<table>/g, '<div class="table-scroll"><table>')
        .replace(/<\/table>/g, '</table></div>');
      const resultName = withHtmlExtension(item.file.name);
      const finalHtml = includeStyles ? wrapWithBaseStyles(bodyHtml, resultName) : bodyHtml;
      const resultBlob = new Blob([finalHtml], { type: 'text/html' });
      const resultUrl = URL.createObjectURL(resultBlob);

      syncItem(resultBlob, resultName);

      return {
        ...item,
        status: 'done',
        resultBlob,
        resultUrl,
        resultName,
        hasWarning: messages.some((m: { type: string }) => m.type === 'warning'),
      };
    } catch (err) {
      console.error('DOCX convert error:', err);
      return { ...item, status: 'error' };
    }
  }

  async function handleConvertAll() {
    const pending = items.filter((i) => i.status === 'waiting');
    if (!pending.length) return;
    setConverting(true);

    for (const item of pending) {
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: 'converting' } : i)));
      const result = await convertItem(item);
      setItems((prev) => prev.map((i) => (i.id === item.id ? result : i)));
    }

    setConverting(false);
  }

  function downloadItem(item: QueueItem) {
    if (!item.resultUrl || !item.resultName) return;
    const link = document.createElement('a');
    link.href = item.resultUrl;
    link.download = item.resultName;
    link.click();
    showToast(t.docxToHtmlPage.downloadSuccess(item.resultName));
  }

  function downloadAll() {
    const ready = items.filter(
      (i): i is QueueItem & { resultUrl: string; resultName: string } =>
        i.status === 'done' && !!i.resultUrl && !!i.resultName
    );
    if (!ready.length) return;

    // Stagger the clicks — firing many synchronous downloads in one tick
    // makes some browsers silently block everything after the first one.
    ready.forEach((item, idx) => {
      setTimeout(() => {
        const link = document.createElement('a');
        link.href = item.resultUrl;
        link.download = item.resultName;
        link.click();
      }, idx * 180);
    });

    showToast(t.docxToHtmlPage.downloadAllSuccess(ready.length));
  }

  function removeItem(id: string) {
    setItems((prev) => {
      const target = prev.find((i) => i.id === id);
      if (target?.resultUrl) URL.revokeObjectURL(target.resultUrl);
      return prev.filter((i) => i.id !== id);
    });
  }

  function clearAll() {
    items.forEach((i) => {
      if (i.resultUrl) URL.revokeObjectURL(i.resultUrl);
    });
    setItems([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  const hasItems = items.length > 0;
  const hasDoneItems = items.some((i) => i.status === 'done' && i.resultBlob);
  const hasWaitingItems = items.some((i) => i.status === 'waiting');

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
            {t.docxToHtmlPage.eyebrow}
          </div>
          <h1 className="mb-2.5 font-display text-[clamp(24px,4vw,34px)] leading-[1.2] tracking-[0.01em] text-text">
            {t.docxToHtmlPage.title}
          </h1>
          <p className="max-w-[520px] text-[14.5px] leading-[1.6] text-text-dim">{t.docxToHtmlPage.desc}</p>
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
              <path d="M6 2h8l5 5v14a1 1 0 01-1 1H6a1 1 0 01-1-1V3a1 1 0 011-1z" />
              <path d="M13 2v5h5" />
            </svg>
          </div>
          <div className="mb-1.5 text-[15px] font-semibold">{t.docxToHtmlPage.dropTitle}</div>
          <div className="font-mono text-[12.5px] text-text-faint">{t.docxToHtmlPage.dropSub}</div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>

        {hasItems && (
          <div className="mt-5 rounded border border-line bg-surface">
            <div className="border-b border-line p-[22px]">
              <div className="mb-3.5 font-mono text-[10.5px] uppercase tracking-[0.18em] text-text-faint">
                {t.docxToHtmlPage.itemsSelected(items.length)}
              </div>
              <div className="flex flex-col gap-2">
                {items.map((item) => (
                  <div className="group flex items-center gap-3.5 rounded border border-line bg-void p-[12px_14px]" key={item.id}>
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[3px] bg-surface-2 text-text-dim">
                      <svg
                        className="h-[17px] w-[17px]"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={1.6}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M6 2h8l5 5v14a1 1 0 01-1 1H6a1 1 0 01-1-1V3a1 1 0 011-1z" />
                        <path d="M13 2v5h5" />
                      </svg>
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold">{item.file.name}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[11px] text-text-faint">
                        <span>{fmtBytes(item.file.size)}</span>
                        {item.status === 'done' && item.resultBlob && (
                          <>
                            <span className="text-indigo">→</span>
                            <span className="text-ok">{fmtBytes(item.resultBlob.size)}</span>
                            {item.hasWarning && <span className="text-err">{t.docxToHtmlPage.conversionWarning}</span>}
                          </>
                        )}
                        {item.status === 'error' && <span className="text-err">{t.docxToHtmlPage.convertError}</span>}
                      </div>
                    </div>
                    <div className="relative flex h-[31px] w-[148px] shrink-0 items-center justify-end">
                      <span
                        className={`absolute right-0 shrink-0 whitespace-nowrap font-mono text-[11px] text-text-faint transition-opacity duration-300 ${
                          item.status === 'waiting' || item.status === 'converting' ? 'opacity-100' : 'pointer-events-none opacity-0'
                        }`}
                      >
                        {item.status === 'converting' ? t.docxToHtmlPage.converting : t.docxToHtmlPage.waiting}
                      </span>
                      <button
                        className={`absolute right-0 whitespace-nowrap rounded-[3px] border border-indigo px-3 py-[7px] font-mono text-[11px] text-indigo transition-opacity duration-300 hover:bg-indigo hover:text-white ${
                          item.status === 'done' ? 'opacity-100' : 'pointer-events-none opacity-0'
                        }`}
                        onClick={() => downloadItem(item)}
                      >
                        {t.docxToHtmlPage.download}
                      </button>
                    </div>
                    <button
                      onClick={() => removeItem(item.id)}
                      aria-label={t.docxToHtmlPage.removeItem}
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
            </div>

            <div className="border-b border-line p-[22px]">
              <label className="flex cursor-pointer items-start gap-3">
                <span
                  className={`mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[4px] border transition-colors duration-150 ${
                    includeStyles ? 'border-transparent bg-grad' : 'border-line bg-void'
                  }`}
                >
                  {includeStyles && (
                    <svg
                      className="h-[11px] w-[11px] text-white"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={3}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  )}
                </span>
                <input
                  type="checkbox"
                  className="hidden"
                  checked={includeStyles}
                  onChange={(e) => setIncludeStyles(e.target.checked)}
                />
                <span>
                  <span className="block text-[13px] font-semibold">{t.docxToHtmlPage.includeStyles}</span>
                  <span className="mt-1 block font-mono text-[11.5px] leading-[1.5] text-text-faint">
                    {t.docxToHtmlPage.includeStylesHint}
                  </span>
                </span>
              </label>
            </div>

            <div className="p-[22px]">
              <button
                className="w-full rounded-[3px] bg-grad py-[15px] font-mono text-[13px] font-bold uppercase tracking-[0.08em] text-white transition-opacity duration-150 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                onClick={handleConvertAll}
                disabled={converting || !hasWaitingItems}
              >
                {converting ? t.docxToHtmlPage.converting : t.docxToHtmlPage.convert}
              </button>
            </div>
          </div>
        )}

        {hasItems && (
          <div className="mt-4 flex items-center justify-between gap-3">
            <button
              onClick={downloadAll}
              disabled={!hasDoneItems}
              className="rounded-[3px] bg-grad px-4 py-[9px] font-mono text-[11.5px] font-bold uppercase tracking-[0.06em] text-white transition-opacity duration-150 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
            >
              {t.docxToHtmlPage.downloadAll}
            </button>
            <button
              onClick={clearAll}
              className="border-none bg-transparent font-mono text-[11.5px] text-text-faint transition-colors duration-150 hover:text-text"
            >
              {t.docxToHtmlPage.clearAll}
            </button>
          </div>
        )}
      </div>
    </>
  );
}