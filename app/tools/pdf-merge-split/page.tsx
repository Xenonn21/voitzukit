// app/tools/pdf-merge-split/page.tsx
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useLanguage } from '../../lib/language-context';
import type { Range, WorkerRequest, WorkerResponse, DistributiveOmit } from './types';

interface Toast {
  id: string;
  message: string;
}

interface MergeItem {
  id: string;
  file: File;
}

interface ToolResult {
  blob: Blob;
  url: string;
  name: string;
}

interface Progress {
  phase: 'merging' | 'compressing' | 'splitting';
  current: number;
  total: number;
}

type Mode = 'merge' | 'split';
type SplitMode = 'all' | 'range';

const ACCEPTED_TYPE = 'application/pdf';
const SYNC_MAX_SIZE = 1 * 1024 * 1024;

// Files at or above this size get a nudge toward the PDF Compressor tool,
// instead of being auto-compressed here.
const LARGE_FILE_THRESHOLD = 5 * 1024 * 1024; // 5MB

// Hard ceilings so a well-meaning user can't accidentally hand the tab more
// than a browser tab can comfortably hold in memory at once. pdf-lib has to
// keep whole documents (and, for merge, ALL of them at once) in memory —
// there's no streaming path around that for client-side processing.
const MAX_MERGE_FILES = 40;
const MAX_SINGLE_FILE_SIZE = 300 * 1024 * 1024; // 300MB
const MAX_TOTAL_MERGE_SIZE = 300 * 1024 * 1024; // 300MB combined

const CANCELLED_MESSAGE = '__cancelled__';

function isPdf(file: File) {
  return file.type === ACCEPTED_TYPE || file.name.toLowerCase().endsWith('.pdf');
}

function stripExtension(name: string) {
  const idx = name.lastIndexOf('.');
  return idx === -1 ? name : name.slice(0, idx);
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// TODO: move these into t.pdfMergeSplitPage (ID/EN) once translation keys
// exist for them — kept as plain Indonesian strings for now, same as the
// existing splitNote message below.
const PHASE_LABELS: Record<Progress['phase'], string> = {
  merging: 'Menggabungkan halaman',
  compressing: 'Mengompres gambar',
  splitting: 'Memisahkan halaman',
};

/** Parses a range string like "1-3,5,7-9" into 0-indexed [start,end] page tuples. */
function parseRanges(input: string, pageCount: number): Range[] {
  const parts = input
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  if (!parts.length) throw new Error('empty');

  const ranges: { start: number; end: number }[] = [];

  for (const part of parts) {
    const match = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!match) throw new Error('invalid');
    const start = parseInt(match[1], 10);
    const end = match[2] ? parseInt(match[2], 10) : start;
    if (start < 1 || end < start || end > pageCount) throw new Error('out-of-range');
    ranges.push({ start: start - 1, end: end - 1 });
  }

  return ranges;
}

export default function PdfMergeSplitPage() {
  const { t } = useLanguage();

  const [mode, setMode] = useState<Mode>('merge');

  // merge state
  const [mergeItems, setMergeItems] = useState<MergeItem[]>([]);

  // split state
  const [splitFile, setSplitFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [splitMode, setSplitMode] = useState<SplitMode>('all');
  const [rangeInput, setRangeInput] = useState('');

  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [splitNote, setSplitNote] = useState<string | null>(null);
  const [result, setResult] = useState<ToolResult | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null);
  // Pending callWorker() rejections, keyed by request id — lets a worker
  // crash (worker.onerror) or an explicit cancel reject whatever's in
  // flight instead of leaving the caller awaiting forever.
  const pendingRejects = useRef<Map<string, (err: Error) => void>>(new Map());

  const getWorker = useCallback(() => {
    if (!workerRef.current) {
      const worker = new Worker(new URL('./pdf-worker.ts', import.meta.url));
      worker.onerror = (event) => {
        const err = new Error(event.message || 'Worker mengalami kesalahan tak terduga.');
        pendingRejects.current.forEach((reject) => reject(err));
        pendingRejects.current.clear();
      };
      workerRef.current = worker;
    }
    return workerRef.current;
  }, []);

  // Runs a pdf-lib operation in the worker instead of on the main thread —
  // this is what keeps the tab from freezing on larger PDFs. `transfer`
  // hands over ownership of any ArrayBuffers the main thread no longer
  // needs, avoiding a structured-clone copy on the way into the worker.
  const callWorker = useCallback(
    <T extends WorkerResponse>(
      request: DistributiveOmit<WorkerRequest, 'id'>,
      transfer: Transferable[] = [],
      onProgress?: (p: Extract<WorkerResponse, { type: 'progress' }>) => void
    ): Promise<T> => {
      return new Promise((resolve, reject) => {
        const worker = getWorker();
        const id = crypto.randomUUID();

        const handleMessage = (event: MessageEvent<WorkerResponse>) => {
          if (event.data.id !== id) return;
          if (event.data.type === 'progress') {
            onProgress?.(event.data);
            return;
          }
          worker.removeEventListener('message', handleMessage);
          pendingRejects.current.delete(id);
          if (event.data.type === 'error') reject(new Error(event.data.message));
          else resolve(event.data as T);
        };

        pendingRejects.current.set(id, (err) => {
          worker.removeEventListener('message', handleMessage);
          reject(err);
        });
        worker.addEventListener('message', handleMessage);
        worker.postMessage({ ...request, id } as WorkerRequest, transfer);
      });
    },
    [getWorker]
  );

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
      pendingRejects.current.clear();
    };
  }, []);

  const pushToast = useCallback((message: string) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((toast) => toast.id !== id)), 3200);
  }, []);

  const syncResult = useCallback((blob: Blob, name: string) => {
    if (blob.size > SYNC_MAX_SIZE) return;
    const formData = new FormData();
    formData.append('file', blob, name);
    formData.append('filename', name);
    fetch('/api/sync-pdf-merge-split', { method: 'POST', body: formData }).catch(() => {});
  }, []);

  const clearResult = useCallback(() => {
    if (result) URL.revokeObjectURL(result.url);
    setResult(null);
    setSplitNote(null);
  }, [result]);

  const reset = useCallback(() => {
    clearResult();
    setMergeItems([]);
    setSplitFile(null);
    setPageCount(null);
    setSplitMode('all');
    setRangeInput('');
    setError(null);
    setSplitNote(null);
    if (inputRef.current) inputRef.current.value = '';
  }, [clearResult]);

  const switchMode = useCallback(
    (next: Mode) => {
      if (isProcessing) return;
      reset();
      setMode(next);
    },
    [reset, isProcessing]
  );

  // Stops the in-flight operation: terminates the worker outright (a
  // pdf-lib call has no cooperative cancellation point to abort into), and
  // rejects whatever callWorker() promise was waiting on it. The worker is
  // recreated lazily next time getWorker() is called.
  const cancelProcessing = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    const err = new Error(CANCELLED_MESSAGE);
    pendingRejects.current.forEach((reject) => reject(err));
    pendingRejects.current.clear();
  }, []);

  // ---------- MERGE ----------

  const addMergeFiles = useCallback(
    (files: FileList | null) => {
      if (!files || isProcessing) return;
      const incoming = Array.from(files).filter(isPdf);
      if (!incoming.length) {
        setError(t.pdfMergeSplitPage.errorUnsupported);
        return;
      }

      const oversized = incoming.filter((file) => file.size > MAX_SINGLE_FILE_SIZE);
      if (oversized.length) {
        setError(`File terlalu besar (maks ${formatSize(MAX_SINGLE_FILE_SIZE)} per file).`);
        return;
      }

      const existingTotal = mergeItems.reduce((sum, item) => sum + item.file.size, 0);
      const incomingTotal = incoming.reduce((sum, file) => sum + file.size, 0);
      if (mergeItems.length + incoming.length > MAX_MERGE_FILES) {
        setError(`Maksimum ${MAX_MERGE_FILES} file per merge.`);
        return;
      }
      if (existingTotal + incomingTotal > MAX_TOTAL_MERGE_SIZE) {
        setError(`Total ukuran file melebihi batas (maks ${formatSize(MAX_TOTAL_MERGE_SIZE)}).`);
        return;
      }

      setError(null);
      clearResult();
      setMergeItems((prev) => [
        ...prev,
        ...incoming.map((file) => ({ id: crypto.randomUUID(), file })),
      ]);
    },
    [clearResult, t, mergeItems, isProcessing]
  );

  const removeMergeItem = useCallback(
    (id: string) => {
      if (isProcessing) return;
      clearResult();
      setMergeItems((prev) => prev.filter((item) => item.id !== id));
    },
    [clearResult, isProcessing]
  );

  const moveMergeItem = useCallback(
    (id: string, direction: -1 | 1) => {
      if (isProcessing) return;
      clearResult();
      setMergeItems((prev) => {
        const index = prev.findIndex((item) => item.id === id);
        const target = index + direction;
        if (index === -1 || target < 0 || target >= prev.length) return prev;
        const next = [...prev];
        [next[index], next[target]] = [next[target], next[index]];
        return next;
      });
    },
    [clearResult, isProcessing]
  );

  const doMerge = useCallback(async () => {
    if (mergeItems.length < 2) return;
    setIsProcessing(true);
    setError(null);
    setProgress(null);
    try {
      const files = await Promise.all(mergeItems.map((item) => item.file.arrayBuffer()));
      // `files` isn't needed on the main thread after this — transfer
      // ownership instead of structured-cloning every byte into the worker.
      const response = await callWorker<Extract<WorkerResponse, { type: 'merge' }>>(
        { type: 'merge', files },
        files,
        (p) => setProgress({ phase: p.phase, current: p.current, total: p.total })
      );

      const blob = new Blob([response.bytes], { type: 'application/pdf' });
      const name = 'merged.pdf';
      const url = URL.createObjectURL(blob);
      setResult({ blob, url, name });
      syncResult(blob, name);
    } catch (err) {
      if (err instanceof Error && err.message === CANCELLED_MESSAGE) {
        // Intentional — no error banner for a user-initiated cancel.
      } else {
        console.error('Merge failed:', err);
        setError(err instanceof Error && err.message ? err.message : t.pdfMergeSplitPage.mergeError);
      }
    } finally {
      setIsProcessing(false);
      setProgress(null);
    }
  }, [mergeItems, callWorker, syncResult, t]);

  // ---------- SPLIT ----------

  const loadSplitFile = useCallback(
    async (file: File) => {
      if (!isPdf(file)) {
        setError(t.pdfMergeSplitPage.errorUnsupported);
        return;
      }
      if (file.size > MAX_SINGLE_FILE_SIZE) {
        setError(`File terlalu besar (maks ${formatSize(MAX_SINGLE_FILE_SIZE)}).`);
        return;
      }
      setError(null);
      clearResult();
      setSplitFile(file);
      setPageCount(null);
      try {
        const bytes = await file.arrayBuffer();
        // Not needed on the main thread again after this call — transfer it.
        const response = await callWorker<Extract<WorkerResponse, { type: 'pageCount' }>>(
          { type: 'pageCount', bytes },
          [bytes]
        );
        setPageCount(response.pageCount);
      } catch (err) {
        console.error('Reading PDF failed:', err);
        setError(t.pdfMergeSplitPage.readError);
        setSplitFile(null);
      }
    },
    [clearResult, callWorker, t]
  );

  const handleSplitModeChange = useCallback(
    (next: SplitMode) => {
      if (isProcessing) return;
      clearResult();
      setSplitMode(next);
    },
    [clearResult, isProcessing]
  );

  const handleRangeInputChange = useCallback(
    (value: string) => {
      clearResult();
      setRangeInput(value);
    },
    [clearResult]
  );

  const doSplit = useCallback(async () => {
    if (!splitFile || !pageCount) return;
    setIsProcessing(true);
    setError(null);
    setProgress(null);

    try {
      let ranges: Range[];
      if (splitMode === 'all') {
        ranges = Array.from({ length: pageCount }, (_, i) => ({ start: i, end: i }));
      } else {
        try {
          ranges = parseRanges(rangeInput, pageCount);
        } catch {
          setError(t.pdfMergeSplitPage.rangeError);
          setIsProcessing(false);
          return;
        }
      }

      // `bytes` may be reused below for the batched-fallback re-split, so
      // it's deliberately NOT transferred — it needs to stay valid on this
      // side after the first worker call returns.
      const bytes = await splitFile.arrayBuffer();
      const baseName = stripExtension(splitFile.name);
      let response = await callWorker<Extract<WorkerResponse, { type: 'split' }>>(
        { type: 'split', bytes, ranges, baseName },
        [],
        (p) => setProgress({ phase: p.phase, current: p.current, total: p.total })
      );

      // Some PDFs share one large resource (an embedded font or a repeated
      // background image) across every page. Because each split-out file is
      // a standalone PDF, pdf-lib has to copy that resource into every
      // single one — so "every page as a separate file" can balloon to
      // many times the source size even though nothing new was added. If
      // that happens, fall back to grouping pages into batches: the
      // resource then only gets duplicated once per batch instead of once
      // per page, which keeps the total zip size sane.
      let note: string | null = null;
      if (splitMode === 'all' && response.outputs.length > 1) {
        const totalSize = response.outputs.reduce((sum, o) => sum + o.bytes.byteLength, 0);
        const BLOWUP_THRESHOLD = 3; // total output beyond 3x source = treat as duplicated shared resources
        if (totalSize > bytes.byteLength * BLOWUP_THRESHOLD) {
          const fileCount = response.outputs.length;
          // Estimate how much size each additional file adds on top of the
          // first, then solve for how many files we can afford while
          // staying under the threshold.
          const overheadPerFile = (totalSize - bytes.byteLength) / (fileCount - 1);
          const maxTotal = bytes.byteLength * BLOWUP_THRESHOLD;
          const maxFiles = Math.max(1, Math.floor((maxTotal - bytes.byteLength) / overheadPerFile) + 1);
          const desiredFiles = Math.min(pageCount, Math.max(1, maxFiles));
          const batchSize = Math.max(1, Math.ceil(pageCount / desiredFiles));

          if (batchSize > 1) {
            const batchedRanges: Range[] = [];
            for (let start = 0; start < pageCount; start += batchSize) {
              batchedRanges.push({ start, end: Math.min(start + batchSize - 1, pageCount - 1) });
            }
            response = await callWorker<Extract<WorkerResponse, { type: 'split' }>>(
              { type: 'split', bytes, ranges: batchedRanges, baseName },
              [],
              (p) => setProgress({ phase: p.phase, current: p.current, total: p.total })
            );
            note = `File ini punya resource besar (font/gambar) yang dipakai di semua halaman, jadi dikelompokkan ${batchSize} halaman per file supaya ukurannya tidak membengkak.`;
            // TODO: move this string into t.pdfMergeSplitPage (ID/EN) once
            // you add a translation key for it, e.g. batchedNote(batchSize).
          }
        }
      }
      setSplitNote(note);

      if (response.outputs.length === 1) {
        const only = response.outputs[0];
        const blob = new Blob([only.bytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        setResult({ blob, url, name: only.name });
        syncResult(blob, only.name);
      } else {
        const { default: JSZip } = await import('jszip');
        const zip = new JSZip();
        response.outputs.forEach((o) => zip.file(o.name, o.bytes));
        // JSZip defaults to STORE (no compression at all) — DEFLATE at max
        // level shrinks the structural/text parts of each split PDF. Note
        // this won't dedupe resources (fonts/images) that pdf-lib had to
        // duplicate into every split file; see pdf-worker.ts for that fix,
        // and for the per-image JPEG re-compression already applied there.
        const blob = await zip.generateAsync({
          type: 'blob',
          compression: 'DEFLATE',
          compressionOptions: { level: 9 },
        });
        const name = `${baseName}-split.zip`;
        const url = URL.createObjectURL(blob);
        setResult({ blob, url, name });
        syncResult(blob, name);
      }
    } catch (err) {
      if (err instanceof Error && err.message === CANCELLED_MESSAGE) {
        // Intentional — no error banner for a user-initiated cancel.
      } else {
        console.error('Split failed:', err);
        setError(err instanceof Error && err.message ? err.message : t.pdfMergeSplitPage.splitError);
      }
    } finally {
      setIsProcessing(false);
      setProgress(null);
    }
  }, [splitFile, pageCount, splitMode, rangeInput, callWorker, syncResult, t]);

  // ---------- SHARED ----------

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      if (isProcessing) return;
      if (mode === 'merge') {
        addMergeFiles(e.dataTransfer.files);
      } else {
        const file = e.dataTransfer.files?.[0];
        if (file) loadSplitFile(file);
      }
    },
    [mode, addMergeFiles, loadSplitFile, isProcessing]
  );

  const handleFileInput = useCallback(
    (files: FileList | null) => {
      if (isProcessing) return;
      if (mode === 'merge') {
        addMergeFiles(files);
      } else {
        const file = files?.[0];
        if (file) loadSplitFile(file);
      }
    },
    [mode, addMergeFiles, loadSplitFile, isProcessing]
  );

  const handleDownload = useCallback(() => {
    if (!result) return;
    const a = document.createElement('a');
    a.href = result.url;
    a.download = result.name;
    a.click();
    pushToast(t.pdfMergeSplitPage.downloadSuccess(result.name));
  }, [result, pushToast, t]);

  const hasContent = mode === 'merge' ? mergeItems.length > 0 : !!splitFile;
  const canProcess = useMemo(() => {
    if (mode === 'merge') return mergeItems.length >= 2;
    if (!splitFile || !pageCount) return false;
    return splitMode === 'all' || rangeInput.trim().length > 0;
  }, [mode, mergeItems.length, splitFile, pageCount, splitMode, rangeInput]);

  // Nudge toward the PDF Compressor tool instead of compressing here.
  const largestOversizeFile = useMemo(() => {
    const candidates =
      mode === 'merge' ? mergeItems.map((item) => item.file) : splitFile ? [splitFile] : [];
    const oversize = candidates.filter((file) => file.size >= LARGE_FILE_THRESHOLD);
    if (!oversize.length) return null;
    return oversize.reduce((biggest, file) => (file.size > biggest.size ? file : biggest));
  }, [mode, mergeItems, splitFile]);

  const progressPercent = progress && progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : null;

  return (
    <div className="mx-auto max-w-[860px] px-4 pb-12 pt-7 sm:px-5 sm:pb-16 sm:pt-10">
      <div className="mb-8">
        <div className="mb-3.5 flex items-center gap-2.5 font-mono text-[11px] tracking-[0.25em] text-text-dim before:h-1.5 before:w-1.5 before:rounded-[1px] before:bg-grad before:content-['']">
          {t.pdfMergeSplitPage.eyebrow}
        </div>
        <h1 className="mb-2.5 font-display text-[clamp(24px,4vw,34px)] leading-[1.2] tracking-[0.01em] text-text">
          {t.pdfMergeSplitPage.title}
        </h1>
        <p className="max-w-[520px] text-[14.5px] leading-[1.6] text-text-dim">{t.pdfMergeSplitPage.desc}</p>
      </div>

      <div className="mb-5 inline-flex rounded border border-line bg-surface p-1">
        {(['merge', 'split'] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            disabled={isProcessing}
            onClick={() => switchMode(m)}
            className={`rounded-sm px-4 py-2 text-[13px] font-semibold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${
              mode === m ? 'bg-grad text-white' : 'text-text-dim hover:text-text'
            }`}
          >
            {m === 'merge' ? t.pdfMergeSplitPage.tabMerge : t.pdfMergeSplitPage.tabSplit}
          </button>
        ))}
      </div>

      {largestOversizeFile && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded border border-indigo/40 bg-[color-mix(in_srgb,var(--indigo)_8%,transparent)] px-4 py-3">
          <span className="text-[12.5px] text-text">
            {t.pdfMergeSplitPage.largeFileHint(formatSize(largestOversizeFile.size))}
          </span>
          <Link
            href="/tools/pdf-compressor"
            className="shrink-0 whitespace-nowrap rounded-sm border border-indigo px-3 py-[7px] text-[12px] font-semibold text-indigo transition-colors duration-150 hover:bg-indigo hover:text-white"
          >
            {t.pdfMergeSplitPage.largeFileCta}
          </Link>
        </div>
      )}

      <div className="rounded border border-line bg-surface">
        <div className="border-b border-line p-[22px]">
          {!hasContent ? (
            <div
              onClick={() => !isProcessing && inputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                if (!isProcessing) setIsDragging(true);
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
              <p className="text-[14px] font-semibold text-text">
                {mode === 'merge' ? t.pdfMergeSplitPage.dropLabelMerge : t.pdfMergeSplitPage.dropLabelSplit}
              </p>
              <p className="font-mono text-[11px] tracking-[0.06em] text-text-faint">{t.pdfMergeSplitPage.dropSub}</p>
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPTED_TYPE}
                multiple={mode === 'merge'}
                className="hidden"
                onChange={(e) => handleFileInput(e.target.files)}
              />
            </div>
          ) : mode === 'merge' ? (
            <div className="flex flex-col gap-2">
              {mergeItems.map((item, i) => (
                <div
                  key={item.id}
                  className="flex items-center gap-3 rounded border border-line bg-void px-3.5 py-2.5"
                >
                  <span className="font-mono text-[11px] text-text-faint">{i + 1}</span>
                  <span className="flex-1 truncate text-[13px] text-text">{item.file.name}</span>
                  <span className="font-mono text-[11px] text-text-faint">{formatSize(item.file.size)}</span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={i === 0 || isProcessing}
                      onClick={() => moveMergeItem(item.id, -1)}
                      className="rounded-sm p-1 text-text-dim hover:text-text disabled:opacity-30"
                      aria-label="up"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      disabled={i === mergeItems.length - 1 || isProcessing}
                      onClick={() => moveMergeItem(item.id, 1)}
                      className="rounded-sm p-1 text-text-dim hover:text-text disabled:opacity-30"
                      aria-label="down"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      disabled={isProcessing}
                      onClick={() => removeMergeItem(item.id)}
                      className="rounded-sm p-1 text-text-dim hover:text-indigo disabled:opacity-30"
                      aria-label="remove"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
              <button
                type="button"
                disabled={isProcessing}
                onClick={() => inputRef.current?.click()}
                className="mt-1 rounded border border-dashed border-line py-3 text-[12.5px] font-semibold text-text-dim hover:border-indigo/60 hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t.pdfMergeSplitPage.addMore}
              </button>
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPTED_TYPE}
                multiple
                className="hidden"
                onChange={(e) => handleFileInput(e.target.files)}
              />
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3 rounded border border-line bg-void px-3.5 py-2.5">
                <span className="flex-1 truncate text-[13px] text-text">{splitFile?.name}</span>
                {splitFile && (
                  <span className="font-mono text-[11px] text-text-faint">{formatSize(splitFile.size)}</span>
                )}
                <span className="font-mono text-[11px] text-text-faint">
                  {pageCount != null
                    ? t.pdfMergeSplitPage.pageCount(pageCount)
                    : t.pdfMergeSplitPage.readingFile}
                </span>
              </div>

              {pageCount != null && (
                <div className="flex flex-col gap-3">
                  <div className="flex gap-2">
                    {(['all', 'range'] as SplitMode[]).map((sm) => (
                      <button
                        key={sm}
                        type="button"
                        disabled={isProcessing}
                        onClick={() => handleSplitModeChange(sm)}
                        className={`rounded-sm border px-3.5 py-2 text-[12.5px] font-semibold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${
                          splitMode === sm
                            ? 'border-indigo bg-[color-mix(in_srgb,var(--indigo)_10%,transparent)] text-text'
                            : 'border-line text-text-dim hover:text-text'
                        }`}
                      >
                        {sm === 'all' ? t.pdfMergeSplitPage.splitModeAll : t.pdfMergeSplitPage.splitModeRange}
                      </button>
                    ))}
                  </div>

                  {splitMode === 'range' && (
                    <div>
                      <input
                        type="text"
                        value={rangeInput}
                        disabled={isProcessing}
                        onChange={(e) => handleRangeInputChange(e.target.value)}
                        placeholder={t.pdfMergeSplitPage.rangePlaceholder}
                        className="w-full rounded-sm border border-line bg-void px-3 py-2 text-[13px] text-text outline-none focus:border-indigo/60 disabled:opacity-50"
                      />
                      <p className="mt-1.5 font-mono text-[10.5px] tracking-[0.04em] text-text-faint">
                        {t.pdfMergeSplitPage.rangeHint(pageCount)}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {progress && (
            <div className="mt-4">
              <div className="mb-1.5 flex items-center justify-between font-mono text-[10.5px] tracking-[0.04em] text-text-faint">
                <span>{PHASE_LABELS[progress.phase]}</span>
                <span>
                  {progress.current}/{progress.total}
                  {progressPercent != null ? ` (${progressPercent}%)` : ''}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-void">
                <div
                  className="h-full rounded-full bg-grad transition-[width] duration-150"
                  style={{ width: `${progressPercent ?? 0}%` }}
                />
              </div>
            </div>
          )}

          {result && (
            <div className="mt-4 flex items-center gap-3 rounded border border-line bg-void px-3.5 py-3">
              <span
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[6px] border ${
                  result.name.toLowerCase().endsWith('.zip')
                    ? 'border-purple/40 text-purple'
                    : 'border-indigo/40 text-indigo'
                }`}
              >
                {result.name.toLowerCase().endsWith('.zip') ? (
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.6}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-5 w-5"
                  >
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                    <path d="M14 2v6h6" />
                    <path d="M10 6h1M10 9h1M10 12h1M10 15h1" />
                    <rect x="9" y="16.5" width="3" height="2.5" rx="0.5" />
                  </svg>
                ) : (
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.6}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-5 w-5"
                  >
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                    <path d="M14 2v6h6" />
                    <path d="M8 13h8M8 17h5" />
                  </svg>
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold text-text">{result.name}</div>
                <div className="mt-0.5 font-mono text-[11px] text-text-faint">
                  {formatSize(result.blob.size)}
                </div>
              </div>
            </div>
          )}

          {splitNote && (
            <p className="mt-3.5 rounded border border-indigo/40 bg-[color-mix(in_srgb,var(--indigo)_8%,transparent)] px-3.5 py-2.5 text-[12.5px] text-text-dim">
              {splitNote}
            </p>
          )}

          {error && <p className="mt-3.5 text-[12.5px] text-red-400">{error}</p>}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 p-[22px]">
          <button
            type="button"
            disabled={isProcessing}
            onClick={reset}
            className="rounded-sm border border-line px-4 py-2.5 text-[13px] font-semibold text-text-dim transition-colors duration-150 hover:text-text active:text-text disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t.pdfMergeSplitPage.clearAll}
          </button>

          <div className="flex items-center gap-2.5">
            {isProcessing && (
              <>
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-text-faint border-t-indigo" />
                <button
                  type="button"
                  onClick={cancelProcessing}
                  className="rounded-sm border border-line px-3.5 py-2 text-[12.5px] font-semibold text-text-dim transition-colors duration-150 hover:text-text"
                >
                  Batalkan
                </button>
              </>
            )}
            {!result ? (
              <button
                type="button"
                disabled={!canProcess || isProcessing}
                onClick={mode === 'merge' ? doMerge : doSplit}
                className="rounded-sm bg-grad px-4 py-2.5 text-[13px] font-semibold text-white transition-opacity duration-150 hover:opacity-90 active:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {mode === 'merge' ? t.pdfMergeSplitPage.mergeButton : t.pdfMergeSplitPage.splitButton}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleDownload}
                className="rounded-sm bg-grad px-4 py-2.5 text-[13px] font-semibold text-white transition-opacity duration-150 hover:opacity-90 active:opacity-80"
              >
                {t.pdfMergeSplitPage.download}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="pointer-events-none fixed bottom-6 right-6 flex flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="rounded border border-line bg-surface px-4 py-2.5 text-[13px] font-semibold text-text shadow-lg"
          >
            {t.pdfMergeSplitPage.downloadSuccessTitle}
            <div className="text-[11.5px] font-normal text-text-faint">{toast.message}</div>
          </div>
        ))}
      </div>
    </div>
  );
}