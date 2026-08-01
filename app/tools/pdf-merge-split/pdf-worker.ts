// app/tools/pdf-merge-split/pdf-worker.ts
import type { WorkerRequest, WorkerResponse, WorkerProgressPhase } from './types';

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  // pdf-lib's save() can return a view over a larger/shared buffer — slice
  // out exactly the bytes we want before transferring ownership.
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function postProgress(id: string, phase: WorkerProgressPhase, current: number, total: number) {
  const response: WorkerResponse = { type: 'progress', id, phase, current, total };
  (self as unknown as Worker).postMessage(response);
}

/** Cheap sanity check before handing bytes to pdf-lib — catches a renamed
 *  non-PDF file (or a corrupted upload) with a clear message instead of
 *  whatever generic parse error pdf-lib happens to throw. */
function looksLikePdf(bytes: ArrayBuffer): boolean {
  if (bytes.byteLength < 5) return false;
  const header = new Uint8Array(bytes, 0, 5);
  return header[0] === 0x25 && header[1] === 0x50 && header[2] === 0x44 && header[3] === 0x46 && header[4] === 0x2d; // "%PDF-"
}

// ---------------------------------------------------------------------------
// Image compression
//
// pdf-lib gives no built-in "compress" button — most of a PDF's weight is
// almost always its embedded images, so we walk every image XObject in the
// document, downscale + re-encode the ones that are plain JPEGs (DCTDecode),
// and swap the reference in place. Anything we're not fully confident about
// (multi-filter streams, images with an alpha mask, non-JPEG encodings we
// can't safely re-decode in a worker) is left untouched rather than risked.
// ---------------------------------------------------------------------------

interface CompressionSettings {
  maxDimension: number;
  quality: number;
  minImageBytes: number; // images smaller than this aren't worth the CPU
}

/** Picks how hard to compress based on the *original* input size, not the
 *  size of any one output — a 60MB source split into ten 6MB pieces should
 *  still get the aggressive treatment, not the light one. */
function getCompressionSettings(totalInputBytes: number): CompressionSettings {
  const MB = 1024 * 1024;
  if (totalInputBytes <= 1 * MB) {
    // Already small — light touch so we don't visibly hurt quality on
    // something that wasn't heavy to begin with.
    return { maxDimension: 2200, quality: 0.85, minImageBytes: 20 * 1024 };
  }
  if (totalInputBytes <= 10 * MB) {
    return { maxDimension: 1800, quality: 0.75, minImageBytes: 15 * 1024 };
  }
  if (totalInputBytes <= 100 * MB) {
    return { maxDimension: 1500, quality: 0.6, minImageBytes: 10 * 1024 };
  }
  // Beyond 100MB the UI already nudges users toward the dedicated PDF
  // Compressor tool, but if they proceed anyway, compress the hardest.
  return { maxDimension: 1200, quality: 0.5, minImageBytes: 8 * 1024 };
}

/** Reads a stream's /Filter entry (PDFName or PDFArray of PDFName) as a
 *  plain string[], e.g. ['DCTDecode']. Empty array if there's no filter. */
function getFilterNames(filterVal: unknown, PDFName: any, PDFArray: any): string[] {
  if (!filterVal) return [];
  if (filterVal instanceof PDFName) {
    return [(filterVal as any).toString().replace(/^\//, '')];
  }
  if (filterVal instanceof PDFArray) {
    const arr = filterVal as any;
    const names: string[] = [];
    for (let i = 0; i < arr.size(); i++) {
      const item = arr.lookup(i);
      if (item instanceof PDFName) names.push((item as any).toString().replace(/^\//, ''));
    }
    return names;
  }
  return [];
}

/** Walks a Resources dict's /XObject entries, swapping any ref found in
 *  refMap for its compressed replacement, and recursing into nested Form
 *  XObjects (a Form can have its own Resources with its own images). */
function swapImageRefsInResources(
  resourcesDict: any,
  context: any,
  refMap: Map<string, any>,
  visitedForms: Set<string>,
  depth: number,
  pdfLib: any
): void {
  if (!resourcesDict || depth > 6) return;
  const { PDFName, PDFDict, PDFRawStream, PDFRef } = pdfLib;

  const xobjectRaw = resourcesDict.get(PDFName.of('XObject'));
  const xobjectDict =
    xobjectRaw instanceof PDFDict
      ? xobjectRaw
      : xobjectRaw instanceof PDFRef
        ? context.lookup(xobjectRaw, PDFDict)
        : undefined;
  if (!xobjectDict) return;

  for (const key of xobjectDict.keys()) {
    const entry = xobjectDict.get(key);
    if (!(entry instanceof PDFRef)) continue;

    const mapped = refMap.get(entry.toString());
    if (mapped) {
      xobjectDict.set(key, mapped);
      continue;
    }

    // Not something we compressed — if it's a Form XObject, recurse into
    // its own Resources in case an image is nested further down.
    const tag = entry.toString();
    if (visitedForms.has(tag)) continue;

    let obj: any;
    try {
      obj = context.lookup(entry);
    } catch {
      continue;
    }
    if (!(obj instanceof PDFRawStream)) continue;

    const subtype = obj.dict.get(PDFName.of('Subtype'));
    if (!(subtype instanceof PDFName) || subtype.toString() !== '/Form') continue;

    visitedForms.add(tag);
    const nestedResourcesRaw = obj.dict.get(PDFName.of('Resources'));
    const nestedResources =
      nestedResourcesRaw instanceof PDFDict
        ? nestedResourcesRaw
        : nestedResourcesRaw instanceof PDFRef
          ? context.lookup(nestedResourcesRaw, PDFDict)
          : undefined;
    swapImageRefsInResources(nestedResources, context, refMap, visitedForms, depth + 1, pdfLib);
  }
}

/** Downscales + re-encodes every plain-JPEG image in `doc`, mutating it in
 *  place. Safe by construction: any image we can't confidently handle, or
 *  that fails to decode/encode, is simply left as-is. `onProgress` (if
 *  given) fires once per image examined, whether or not it was touched. */
async function compressImagesInDoc(
  doc: any,
  settings: CompressionSettings,
  pdfLib: any,
  onProgress?: (current: number, total: number) => void
): Promise<void> {
  const { PDFName, PDFRawStream, PDFArray, PDFRef } = pdfLib;

  const imageEntries: { ref: any; obj: any }[] = [];
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const subtype = obj.dict.get(PDFName.of('Subtype'));
    if (!(subtype instanceof PDFName) || subtype.toString() !== '/Image') continue;
    imageEntries.push({ ref, obj });
  }
  if (!imageEntries.length) return;

  const refMap = new Map<string, any>();
  const total = imageEntries.length;
  let done = 0;

  for (const { ref, obj } of imageEntries) {
    try {
      const filterNames = getFilterNames(obj.dict.get(PDFName.of('Filter')), PDFName, PDFArray);
      // Only plain single-filter JPEGs. Anything layered with another
      // filter, or carrying a soft/stencil mask (alpha), is skipped so we
      // never risk corrupting transparency or a re-encode we can't verify.
      if (filterNames.length !== 1 || filterNames[0] !== 'DCTDecode') continue;
      if (obj.dict.get(PDFName.of('SMask')) || obj.dict.get(PDFName.of('Mask'))) continue;

      const rawBytes: Uint8Array = obj.getContents();
      if (rawBytes.byteLength < settings.minImageBytes) continue;

      // DCTDecode's raw stream contents ARE literal JPEG bytes — no PDF
      // filter decoding needed, we can hand them straight to the browser's
      // image decoder.
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(rawBytes)], { type: 'image/jpeg' }));
      const { width, height } = bitmap;
      if (!width || !height) {
        bitmap.close();
        continue;
      }

      const scale = Math.min(1, settings.maxDimension / Math.max(width, height));
      const targetW = Math.max(1, Math.round(width * scale));
      const targetH = Math.max(1, Math.round(height * scale));

      const canvas = new OffscreenCanvas(targetW, targetH);
      const ctx2d = canvas.getContext('2d');
      if (!ctx2d) {
        bitmap.close();
        continue;
      }
      ctx2d.imageSmoothingEnabled = true;
      (ctx2d as any).imageSmoothingQuality = 'high';
      ctx2d.drawImage(bitmap, 0, 0, targetW, targetH);
      bitmap.close();

      const outBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: settings.quality });
      const newBytes = new Uint8Array(await outBlob.arrayBuffer());

      // Only swap in the new version if it's actually smaller — never make
      // an image bigger than it started.
      if (newBytes.byteLength >= rawBytes.byteLength) continue;

      const embedded = await doc.embedJpg(newBytes);
      refMap.set(ref.toString(), embedded.ref);
    } catch {
      // One bad/unsupported image should never fail the whole merge/split.
      continue;
    } finally {
      done += 1;
      onProgress?.(done, total);
    }
  }

  if (!refMap.size) return;

  const visitedForms = new Set<string>();
  for (const page of doc.getPages()) {
    swapImageRefsInResources(page.node.Resources(), doc.context, refMap, visitedForms, 0, pdfLib);
  }

  // The old image streams are now unreferenced — delete them so save()
  // doesn't write their bytes into the output file too.
  for (const { ref } of imageEntries) {
    if (refMap.has(ref.toString())) doc.context.delete(ref);
  }
}

// ---------------------------------------------------------------------------

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;

  try {
    const pdfLib = await import('pdf-lib');
    const { PDFDocument, ParseSpeeds } = pdfLib;

    // ParseSpeeds.Fastest skips some of pdf-lib's stricter validation on
    // load — a real win on large PDFs and safe here since we're reading
    // files the user picked themselves, not untrusted uploads.
    const loadOpts = { parseSpeed: ParseSpeeds.Fastest, updateMetadata: false } as const;
    const saveOpts = { useObjectStreams: true, updateMetadata: false } as const;

    if (msg.type === 'pageCount') {
      if (!looksLikePdf(msg.bytes)) throw new Error('File bukan PDF yang valid.');
      const doc = await PDFDocument.load(msg.bytes, loadOpts);
      const response: WorkerResponse = { type: 'pageCount', id: msg.id, pageCount: doc.getPageCount() };
      (self as unknown as Worker).postMessage(response);
      return;
    }

    if (msg.type === 'merge') {
      for (const fileBytes of msg.files) {
        if (!looksLikePdf(fileBytes)) throw new Error('Salah satu file bukan PDF yang valid.');
      }

      const totalInputBytes = msg.files.reduce((sum, f) => sum + f.byteLength, 0);
      const settings = getCompressionSettings(totalInputBytes);

      const merged = await PDFDocument.create();
      for (let i = 0; i < msg.files.length; i++) {
        const src = await PDFDocument.load(msg.files[i], loadOpts);
        const pages = await merged.copyPages(src, src.getPageIndices());
        pages.forEach((page) => merged.addPage(page));
        postProgress(msg.id, 'merging', i + 1, msg.files.length);
      }

      await compressImagesInDoc(merged, settings, pdfLib, (current, total) => {
        postProgress(msg.id, 'compressing', current, total);
      });

      const buffer = toArrayBuffer(await merged.save(saveOpts));
      const response: WorkerResponse = { type: 'merge', id: msg.id, bytes: buffer };
      (self as unknown as Worker).postMessage(response, [buffer]);
      return;
    }

    if (msg.type === 'split') {
      if (!looksLikePdf(msg.bytes)) throw new Error('File bukan PDF yang valid.');

      const settings = getCompressionSettings(msg.bytes.byteLength);
      const src = await PDFDocument.load(msg.bytes, loadOpts);
      const outputs: { name: string; bytes: ArrayBuffer }[] = [];
      const transferList: ArrayBuffer[] = [];

      for (let i = 0; i < msg.ranges.length; i++) {
        const range = msg.ranges[i];
        const out = await PDFDocument.create();
        const indices = Array.from(
          { length: range.end - range.start + 1 },
          (_, j) => range.start + j
        );
        const pages = await out.copyPages(src, indices);
        pages.forEach((page) => out.addPage(page));

        await compressImagesInDoc(out, settings, pdfLib);

        const buffer = toArrayBuffer(await out.save(saveOpts));
        const label = range.start === range.end ? `${range.start + 1}` : `${range.start + 1}-${range.end + 1}`;
        outputs.push({ name: `${msg.baseName}-p${label}.pdf`, bytes: buffer });
        transferList.push(buffer);

        postProgress(msg.id, 'splitting', i + 1, msg.ranges.length);
      }

      const response: WorkerResponse = { type: 'split', id: msg.id, outputs };
      (self as unknown as Worker).postMessage(response, transferList);
      return;
    }
  } catch (err) {
    const response: WorkerResponse = {
      type: 'error',
      id: msg.id,
      message: err instanceof Error ? err.message : 'Unknown worker error',
    };
    (self as unknown as Worker).postMessage(response);
  }
};

export {};