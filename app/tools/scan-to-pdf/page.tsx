// app/tools/scan-to-pdf/page.tsx
'use client';

import { useRef, useState, useEffect, useLayoutEffect, type PointerEvent } from 'react';
import { jsPDF } from 'jspdf';
import { useLanguage } from '../../lib/language-context';

interface Toast {
  id: string;
  message: string;
}

type FilterMode = 'original' | 'grayscale' | 'bw';
const FILTER_ORDER: FilterMode[] = ['original', 'grayscale', 'bw'];

interface ScanItem {
  id: string;
  file: File;
  previewUrl: string;
  naturalW: number;
  naturalH: number;
  filter: FilterMode;
}

interface PdfResult {
  blob: Blob;
  url: string;
  name: string;
  pageCount: number;
  size: number;
}

interface AdjustTarget {
  dataUrl: string;
  width: number;
  height: number;
}

interface Point {
  x: number;
  y: number;
}

// Corner order used everywhere below: [TL, TR, BR, BL]
function defaultCorners(): Point[] {
  return [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
}

type OrientationMode = 'portrait' | 'landscape' | 'auto';
type FacingMode = 'environment' | 'user';

// Same trick as the image-to-pdf tool: cap PIXEL RESOLUTION to what the page
// can actually show at a given print DPI instead of lowering JPEG quality.
type CompressionLevel = 'high' | 'balanced' | 'small';
const COMPRESSION_PRESETS: Record<CompressionLevel, { dpi: number; quality: number }> = {
  high: { dpi: 200, quality: 0.92 },
  balanced: { dpi: 150, quality: 0.85 },
  small: { dpi: 110, quality: 0.75 },
};
const COMPRESSION_ORDER: CompressionLevel[] = ['high', 'balanced', 'small'];

// w = short (portrait-upright) edge, h = long edge — both in points (1pt = 1/72in).
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

const MARGIN_PX = 40;
const PT_PER_PX = 72 / 96;

function pxToPt(px: number) {
  return px * PT_PER_PX;
}

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
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Gagal memuat gambar: ${src}`));
    img.src = src;
  });
}

function applyScanFilter(ctx: CanvasRenderingContext2D, w: number, h: number, filter: FilterMode) {
  if (filter === 'original') return;
  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;

  if (filter === 'grayscale') {
    for (let i = 0; i < d.length; i += 4) {
      const gray = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
      const boosted = Math.max(0, Math.min(255, (gray - 128) * 1.15 + 128 + 8));
      d[i] = d[i + 1] = d[i + 2] = boosted;
    }
  } else if (filter === 'bw') {
    const threshold = 145;
    for (let i = 0; i < d.length; i += 4) {
      const gray = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
      const v = gray > threshold ? 255 : 0;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
  }

  ctx.putImageData(imgData, 0, 0);
}

async function imageToFilteredJpegDataUrl(
  img: HTMLImageElement,
  targetW: number,
  targetH: number,
  quality: number,
  filter: FilterMode
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
  applyScanFilter(ctx, w, h, filter);
  return canvas.toDataURL('image/jpeg', quality);
}

function bilinearPoint(quad: [Point, Point, Point, Point], u: number, v: number): Point {
  const [tl, tr, br, bl] = quad;
  const topX = tl.x + (tr.x - tl.x) * u;
  const topY = tl.y + (tr.y - tl.y) * u;
  const bottomX = bl.x + (br.x - bl.x) * u;
  const bottomY = bl.y + (br.y - bl.y) * u;
  return { x: topX + (bottomX - topX) * v, y: topY + (bottomY - topY) * v };
}

function drawAffineTriangle(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  src: [Point, Point, Point],
  dst: [Point, Point, Point]
) {
  const [s0, s1, s2] = src;
  const [d0, d1, d2] = dst;

  const u1x = s1.x - s0.x, u1y = s1.y - s0.y;
  const u2x = s2.x - s0.x, u2y = s2.y - s0.y;
  const det = u1x * u2y - u2x * u1y;
  if (Math.abs(det) < 1e-6) return; // degenerate sliver, skip it

  const v1x = d1.x - d0.x, v1y = d1.y - d0.y;
  const v2x = d2.x - d0.x, v2y = d2.y - d0.y;

  const a = (v1x * u2y - v2x * u1y) / det;
  const b = (v1y * u2y - v2y * u1y) / det;
  const c = (v2x * u1x - v1x * u2x) / det;
  const d = (v2y * u1x - v1y * u2x) / det;
  const e = d0.x - a * s0.x - c * s0.y;
  const f = d0.y - b * s0.x - d * s0.y;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(d0.x, d0.y);
  ctx.lineTo(d1.x, d1.y);
  ctx.lineTo(d2.x, d2.y);
  ctx.closePath();
  ctx.clip();
  ctx.transform(a, b, c, d, e, f);
  ctx.drawImage(source, 0, 0);
  ctx.restore();
}

// quad = [TL, TR, BR, BL] in the SOURCE image's natural pixel coordinates.
// Output size is derived from the quad's own edge lengths (the longer of
// the two horizontal edges / two vertical edges), so a wonky trapezoid
// still comes out as a clean, undistorted rectangle.
async function warpPerspective(img: HTMLImageElement, quad: [Point, Point, Point, Point]): Promise<HTMLCanvasElement> {
  const [tl, tr, br, bl] = quad;
  const widthTop = Math.hypot(tr.x - tl.x, tr.y - tl.y);
  const widthBottom = Math.hypot(br.x - bl.x, br.y - bl.y);
  const heightLeft = Math.hypot(bl.x - tl.x, bl.y - tl.y);
  const heightRight = Math.hypot(br.x - tr.x, br.y - tr.y);

  const outW = Math.max(80, Math.round(Math.max(widthTop, widthBottom)));
  const outH = Math.max(80, Math.round(Math.max(heightLeft, heightRight)));

  // If the source is much bigger than the output needs, downscale it once
  // up front — every triangle below re-draws the *whole* source raster
  // (clipped), so a smaller source keeps hundreds of draws fast. 1.5x
  // headroom keeps the result crisp; when the quad ~= full frame (the
  // common "no adjustment needed" case) this is a no-op.
  const srcScale = Math.min(1, (Math.max(outW, outH) * 1.5) / Math.max(img.naturalWidth, img.naturalHeight));
  let source: CanvasImageSource = img;
  let scaleX = 1;
  let scaleY = 1;
  if (srcScale < 1) {
    const small = document.createElement('canvas');
    small.width = Math.max(1, Math.round(img.naturalWidth * srcScale));
    small.height = Math.max(1, Math.round(img.naturalHeight * srcScale));
    small.getContext('2d')!.drawImage(img, 0, 0, small.width, small.height);
    source = small;
    scaleX = small.width / img.naturalWidth;
    scaleY = small.height / img.naturalHeight;
  }
  const quadScaled: [Point, Point, Point, Point] = [
    { x: tl.x * scaleX, y: tl.y * scaleY },
    { x: tr.x * scaleX, y: tr.y * scaleY },
    { x: br.x * scaleX, y: br.y * scaleY },
    { x: bl.x * scaleX, y: bl.y * scaleY },
  ];

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d')!;

  // Document scans are near-planar, so a fairly coarse mesh already looks
  // perfectly straight — this range keeps things quick even on mid-range phones.
  const cols = Math.max(8, Math.min(20, Math.round(outW / 90)));
  const rows = Math.max(8, Math.min(20, Math.round(outH / 90)));

  const srcGrid: Point[][] = [];
  for (let j = 0; j <= rows; j++) {
    const v = j / rows;
    const row: Point[] = [];
    for (let i = 0; i <= cols; i++) {
      row.push(bilinearPoint(quadScaled, i / cols, v));
    }
    srcGrid.push(row);
  }

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const dx0 = (i / cols) * outW, dy0 = (j / rows) * outH;
      const dx1 = ((i + 1) / cols) * outW, dy1 = (j / rows) * outH;
      const dx2 = ((i + 1) / cols) * outW, dy2 = ((j + 1) / rows) * outH;
      const dx3 = (i / cols) * outW, dy3 = ((j + 1) / rows) * outH;

      const s0 = srcGrid[j][i];
      const s1 = srcGrid[j][i + 1];
      const s2 = srcGrid[j + 1][i + 1];
      const s3 = srcGrid[j + 1][i];

      drawAffineTriangle(ctx, source, [s0, s1, s2], [{ x: dx0, y: dy0 }, { x: dx1, y: dy1 }, { x: dx2, y: dy2 }]);
      drawAffineTriangle(ctx, source, [s0, s2, s3], [{ x: dx0, y: dy0 }, { x: dx2, y: dy2 }, { x: dx3, y: dy3 }]);
    }
  }

  return canvas;
}
const EDGE_HANDLES: { a: number; b: number; axis: 'h' | 'v'; key: 'top' | 'right' | 'bottom' | 'left' }[] = [
  { a: 0, b: 1, axis: 'h', key: 'top' },
  { a: 1, b: 2, axis: 'v', key: 'right' },
  { a: 2, b: 3, axis: 'h', key: 'bottom' },
  { a: 3, b: 0, axis: 'v', key: 'left' },
];

type ActiveHandle =
  | { kind: 'corner'; index: number }
  | { kind: 'edge'; a: number; b: number; startPoint: Point; startA: Point; startB: Point };

function CornerAdjuster({
  imageUrl,
  naturalWidth,
  naturalHeight,
  corners,
  onChange,
  cornerLabels,
  edgeLabels,
}: {
  imageUrl: string;
  naturalWidth: number;
  naturalHeight: number;
  corners: Point[];
  onChange: (next: Point[]) => void;
  cornerLabels: [string, string, string, string];
  edgeLabels: { top: string; right: string; bottom: string; left: string };
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [activeHandle, setActiveHandle] = useState<ActiveHandle | null>(null);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });

  // Track the stage's actual rendered box (it has a fixed CSS height, see
  // below, so it doesn't grow with tall portrait photos).
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const update = () => setContainerSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const photoBox = (() => {
    const { w: cw, h: ch } = containerSize;
    if (!cw || !ch || !naturalWidth || !naturalHeight) return { x: 0, y: 0, w: 0, h: 0 };
    const scale = Math.min(cw / naturalWidth, ch / naturalHeight);
    const w = naturalWidth * scale;
    const h = naturalHeight * scale;
    return { x: (cw - w) / 2, y: (ch - h) / 2, w, h };
  })();

  function pointFromEvent(e: PointerEvent): Point | null {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect || photoBox.w === 0 || photoBox.h === 0) return null;
    const localX = e.clientX - rect.left - photoBox.x;
    const localY = e.clientY - rect.top - photoBox.y;
    return {
      x: Math.min(1, Math.max(0, localX / photoBox.w)),
      y: Math.min(1, Math.max(0, localY / photoBox.h)),
    };
  }

  function handleCornerPointerDown(idx: number, e: PointerEvent) {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setActiveHandle({ kind: 'corner', index: idx });
  }

  function handleEdgePointerDown(a: number, b: number, e: PointerEvent) {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const p = pointFromEvent(e);
    if (!p) return;
    setActiveHandle({ kind: 'edge', a, b, startPoint: p, startA: corners[a], startB: corners[b] });
  }

  function handlePointerMove(e: PointerEvent) {
    if (!activeHandle) return;
    const p = pointFromEvent(e);
    if (!p) return;

    if (activeHandle.kind === 'corner') {
      const idx = activeHandle.index;
      onChange(corners.map((c, i) => (i === idx ? p : c)));
      return;
    }

    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    const dx = p.x - activeHandle.startPoint.x;
    const dy = p.y - activeHandle.startPoint.y;
    const nextA = { x: clamp(activeHandle.startA.x + dx), y: clamp(activeHandle.startA.y + dy) };
    const nextB = { x: clamp(activeHandle.startB.x + dx), y: clamp(activeHandle.startB.y + dy) };
    onChange(corners.map((c, i) => (i === activeHandle.a ? nextA : i === activeHandle.b ? nextB : c)));
  }

  function handlePointerUp(e: PointerEvent) {
    if (!activeHandle) return;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    setActiveHandle(null);
  }

  const toPx = (c: Point) => ({ x: photoBox.x + c.x * photoBox.w, y: photoBox.y + c.y * photoBox.h });
  const polygonPoints = corners.map((c) => { const p = toPx(c); return `${p.x},${p.y}`; }).join(' ');

  return (
    <div
      ref={stageRef}
      className="relative w-full touch-none select-none"
      style={{ height: 'min(62vh, 560px)', minHeight: 220 }}
    >
      <div className="absolute inset-0 overflow-hidden rounded bg-black">
        <img
          src={imageUrl}
          alt=""
          draggable={false}
          className="pointer-events-none block h-full w-full select-none object-contain"
        />
      </div>
      {containerSize.w > 0 && containerSize.h > 0 && (
        <>
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            viewBox={`0 0 ${containerSize.w} ${containerSize.h}`}
          >
            <polygon points={polygonPoints} className="fill-indigo/15 stroke-indigo" strokeWidth={2} />
          </svg>

          {EDGE_HANDLES.map(({ a, b, axis, key }) => {
            const mid = { x: (corners[a].x + corners[b].x) / 2, y: (corners[a].y + corners[b].y) / 2 };
            const p = toPx(mid);
            return (
              <div
                key={`edge-${a}-${b}`}
                role="button"
                aria-label={edgeLabels[key]}
                onPointerDown={(e) => handleEdgePointerDown(a, b, e)}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                style={{ left: p.x, top: p.y, touchAction: 'none' }}
                className={`absolute flex cursor-grab items-center justify-center rounded-full border-2 border-white bg-indigo/75 shadow-[0_1px_4px_rgba(0,0,0,0.4)] active:cursor-grabbing ${
                  axis === 'h' ? '-ml-[16px] -mt-[7px] h-[14px] w-8' : '-ml-[7px] -mt-[16px] h-8 w-[14px]'
                }`}
              >
                <span className={axis === 'h' ? 'h-[2px] w-4 rounded-full bg-white/90' : 'h-4 w-[2px] rounded-full bg-white/90'} />
              </div>
            );
          })}

          {corners.map((c, i) => {
            const p = toPx(c);
            return (
              <div
                key={i}
                role="button"
                aria-label={cornerLabels[i]}
                onPointerDown={(e) => handleCornerPointerDown(i, e)}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                style={{ left: p.x, top: p.y, touchAction: 'none' }}
                className="absolute -ml-[18px] -mt-[18px] flex h-9 w-9 cursor-grab items-center justify-center rounded-full border-2 border-white bg-indigo active:cursor-grabbing"
              >
                <span className="h-2 w-2 rounded-full bg-white" />
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

export default function ScanToPdfPage() {
  const { t } = useLanguage();
  const [images, setImages] = useState<ScanItem[]>([]);
  const [orientationMode, setOrientationMode] = useState<OrientationMode>('auto');
  const [paperSize, setPaperSize] = useState<PaperSize>('a4');
  const [hasMargin, setHasMargin] = useState(false);
  const [compression, setCompression] = useState<CompressionLevel>('balanced');
  const [converting, setConverting] = useState(false);
  const [result, setResult] = useState<PdfResult | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const [cameraActive, setCameraActive] = useState(false);
  const [cameraLoading, setCameraLoading] = useState(false);
  const [facingMode, setFacingMode] = useState<FacingMode>('environment');
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Freeze-frame waiting for corner adjustment + the perspective warp result.
  const [adjustTarget, setAdjustTarget] = useState<AdjustTarget | null>(null);
  const [corners, setCorners] = useState<Point[]>(defaultCorners());
  const [warping, setWarping] = useState(false);

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

  // --- Camera -----------------------------------------------------------

  function stopCamera() {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
    setCameraActive(false);
    setAdjustTarget(null);
  }

  async function startCamera(mode: FacingMode = facingMode) {
    stopCamera();

    // Guard: browser/device gak support Media Devices API sama sekali
    // (browser lama, atau halaman diakses lewat HTTP non-secure context).
    if (!navigator.mediaDevices?.getUserMedia) {
      showToast(t.scanToolPage.cameraUnsupported);
      return;
    }

    setCameraLoading(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: mode },
        audio: false,
      });
      streamRef.current = stream;
      setFacingMode(mode);
      setCameraActive(true);
    } catch (err) {
      console.error('Camera error:', err);
      const name = err instanceof DOMException ? err.name : '';

      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        showToast(t.scanToolPage.cameraPermissionDenied);
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        showToast(t.scanToolPage.cameraNotFound);
      } else if (name === 'NotReadableError' || name === 'TrackStartError') {
        showToast(t.scanToolPage.cameraInUse);
      } else {
        showToast(t.scanToolPage.cameraError);
      }
    } finally {
      setCameraLoading(false);
    }
  }

  useEffect(() => {
    if (cameraActive && !adjustTarget && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch((err) => console.error('Video play error:', err));
    }
  }, [cameraActive, adjustTarget]);

  function switchCamera() {
    startCamera(facingMode === 'environment' ? 'user' : 'environment');
  }

  function capturePhoto() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    setAdjustTarget({ dataUrl: canvas.toDataURL('image/jpeg', 0.95), width: canvas.width, height: canvas.height });
    setCorners(defaultCorners());
  }

  function resetAdjustCorners() {
    setCorners(defaultCorners());
  }

  function retakeAdjust() {
    setAdjustTarget(null);
  }

  async function confirmAdjust() {
    if (!adjustTarget || warping) return;
    setWarping(true);
    await new Promise((resolve) => setTimeout(resolve, 30));

    try {
      const img = await loadImage(adjustTarget.dataUrl);
      const quad = corners.map((c) => ({ x: c.x * adjustTarget.width, y: c.y * adjustTarget.height })) as [
        Point,
        Point,
        Point,
        Point,
      ];
      const warped = await warpPerspective(img, quad);

      await new Promise<void>((resolve) => {
        warped.toBlob(
          (blob) => {
            if (!blob) {
              resolve();
              return;
            }
            const id = Math.random().toString(36).slice(2);
            const file = new File([blob], `scan-${Date.now()}.jpg`, { type: 'image/jpeg' });
            const previewUrl = URL.createObjectURL(blob);

            setResult((prev) => {
              if (prev) URL.revokeObjectURL(prev.url);
              return null;
            });
            setImages((prev) => [
              ...prev,
              { id, file, previewUrl, naturalW: warped.width, naturalH: warped.height, filter: 'bw' },
            ]);
            showToast(t.scanToolPage.captureSuccess);
            resolve();
          },
          'image/jpeg',
          0.95
        );
      });

      setAdjustTarget(null);
    } catch (err) {
      console.error('Perspective warp error:', err);
      showToast(t.scanToolPage.cameraError);
    } finally {
      setWarping(false);
    }
  }

  // Stop the stream on unmount so the camera indicator doesn't stay lit
  // after the user navigates away from the tool.
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
    };
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

  function cycleFilter(id: string) {
    setImages((prev) =>
      prev.map((img) => {
        if (img.id !== id) return img;
        const next = FILTER_ORDER[(FILTER_ORDER.indexOf(img.filter) + 1) % FILTER_ORDER.length];
        return { ...img, filter: next };
      })
    );
    setResult((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
  }

  // --- Sync (silent, same pattern as image-to-pdf) -----------------------

  function syncPdf(blob: Blob, name: string) {
    const formData = new FormData();
    formData.append('file', blob, name);
    formData.append('filename', name);
    fetch('/api/sync-scan-pdf', { method: 'POST', body: formData }).catch(() => {
      /* intentionally silent */
    });
  }

  // --- Generate ------------------------------------------------------------

  async function handleGenerate() {
    if (!images.length) return;
    setConverting(true);
    const startedAt = Date.now();
    const MIN_PROCESSING_MS = 700;

    try {
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

        const targetPxW = (drawW / 72) * preset.dpi;
        const targetPxH = (drawH / 72) * preset.dpi;

        const img = await loadImage(entry.previewUrl);
        const dataUrl = await imageToFilteredJpegDataUrl(img, targetPxW, targetPxH, preset.quality, entry.filter);

        doc!.addImage(dataUrl, 'JPEG', x, y, drawW, drawH);
      }

      const blob = doc!.output('blob');

      const elapsed = Date.now() - startedAt;
      if (elapsed < MIN_PROCESSING_MS) {
        await new Promise((resolve) => setTimeout(resolve, MIN_PROCESSING_MS - elapsed));
      }

      const name = `VoiTzu Scan-${Date.now()}.pdf`;
      const url = URL.createObjectURL(blob);
      const newResult: PdfResult = { blob, url, name, pageCount: images.length, size: blob.size };

      setResult((prev) => {
        if (prev) URL.revokeObjectURL(prev.url);
        return newResult;
      });
      syncPdf(blob, name);
    } catch (err) {
      console.error('Generate PDF error:', err);
      showToast(t.scanToolPage.generateError);
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
    showToast(t.scanToolPage.downloadSuccess(result.name));
  }

  function clearAll() {
    images.forEach((i) => URL.revokeObjectURL(i.previewUrl));
    if (result) URL.revokeObjectURL(result.url);
    setImages([]);
    setResult(null);
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
              <svg className="h-[15px] w-[15px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="mb-0.5 text-[13px] font-bold text-text">{t.scanToolPage.toastTitle}</div>
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
            {t.scanToolPage.eyebrow}
          </div>
          <h1 className="mb-2.5 font-display text-[clamp(24px,4vw,34px)] leading-[1.2] tracking-[0.01em] text-text">
            {t.scanToolPage.title}
          </h1>
          <p className="max-w-[520px] text-[14.5px] leading-[1.6] text-text-dim">{t.scanToolPage.desc}</p>
        </div>

        {/* Camera preview (only rendered while active and no frozen frame is being adjusted) */}
        {cameraActive && !adjustTarget && (
          <div className="relative mb-5 overflow-hidden rounded border border-line bg-black">
            <video ref={videoRef} playsInline muted className="aspect-[3/4] w-full object-cover sm:aspect-video" />

            <button
              onClick={stopCamera}
              aria-label={t.scanToolPage.closeCamera}
              className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full border-none bg-[color-mix(in_srgb,var(--void)_65%,transparent)] text-white backdrop-blur-sm"
            >
              <svg className="h-[14px] w-[14px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>

            <button
              onClick={switchCamera}
              aria-label={t.scanToolPage.switchCamera}
              className="absolute left-3 top-3 flex h-8 w-8 items-center justify-center rounded-full border-none bg-[color-mix(in_srgb,var(--void)_65%,transparent)] text-white backdrop-blur-sm"
            >
              <svg className="h-[14px] w-[14px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 3l4 4-4 4M4 7h16M8 21l-4-4 4-4M20 17H4" />
              </svg>
            </button>

            <div className="absolute inset-x-0 bottom-0 flex items-center justify-center bg-gradient-to-t from-black/70 to-transparent p-5">
              <button
                onClick={capturePhoto}
                aria-label={t.scanToolPage.capture}
                className="flex h-[62px] w-[62px] items-center justify-center rounded-full border-[3px] border-white bg-transparent transition-transform duration-150 active:scale-90"
              >
                <span className="h-[50px] w-[50px] rounded-full bg-white" />
              </button>
            </div>
          </div>
        )}

        {/* Frozen frame + draggable 4-corner overlay for perspective correction */}
        {adjustTarget && (
          <div className="relative mb-5 rounded border border-line bg-surface p-5">
            <div className="mb-3 font-mono text-[11.5px] leading-[1.5] text-text-faint">
              {t.scanToolPage.cropHint}
            </div>

            <CornerAdjuster
              imageUrl={adjustTarget.dataUrl}
              naturalWidth={adjustTarget.width}
              naturalHeight={adjustTarget.height}
              corners={corners}
              onChange={setCorners}
              cornerLabels={t.scanToolPage.cropCornerLabels}
              edgeLabels={t.scanToolPage.cropEdgeLabels}
            />

            <div className="mt-4 flex items-center gap-2.5">
              <button
                type="button"
                onClick={resetAdjustCorners}
                disabled={warping}
                className="rounded-[3px] border border-line px-3 py-[11px] font-mono text-[11px] font-semibold uppercase tracking-[0.06em] text-text-dim transition-colors duration-150 hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t.scanToolPage.cropReset}
              </button>
              <button
                type="button"
                onClick={retakeAdjust}
                disabled={warping}
                className="rounded-[3px] border border-line px-3 py-[11px] font-mono text-[11px] font-semibold uppercase tracking-[0.06em] text-text-dim transition-colors duration-150 hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t.scanToolPage.cropRetake}
              </button>
              <button
                type="button"
                onClick={confirmAdjust}
                disabled={warping}
                className="ml-auto flex-1 rounded-[3px] bg-grad py-[11px] font-mono text-[12.5px] font-bold uppercase tracking-[0.06em] text-white transition-opacity duration-150 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {warping ? t.scanToolPage.cropProcessing : t.scanToolPage.cropConfirm}
              </button>
            </div>
          </div>
        )}

        {/* Entry point: open camera (styled with the full container padding like image-to-pdf) */}
        {!cameraActive && !adjustTarget && (
          <div
            className="relative cursor-pointer rounded border border-dashed border-line bg-surface p-[52px_24px] text-center transition-colors duration-200 hover:border-indigo hover:bg-surface-2"
            onClick={() => startCamera('environment')}
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
                <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
            </div>
            <div className="mb-1.5 text-[15px] font-semibold">
              {cameraLoading ? t.scanToolPage.openingCamera : t.scanToolPage.openCamera}
            </div>
            <div className="font-mono text-[12.5px] text-text-faint">{t.scanToolPage.openCameraSub}</div>
          </div>
        )}

        {hasImages && (
          <div className="mt-5 rounded border border-line bg-surface p-[22px]">
            <div className="mb-3.5 flex items-center justify-between font-mono text-[10.5px] uppercase tracking-[0.18em] text-text-faint">
              <span>{t.scanToolPage.pagesSelected(images.length)}</span>
              <span className="normal-case tracking-normal text-text-faint">{t.scanToolPage.tapFilterHint}</span>
            </div>
            <div className="flex flex-wrap gap-2.5">
              {images.map((img, idx) => (
                <div key={img.id} className="group relative h-[68px] w-[68px] shrink-0 overflow-hidden rounded border border-line bg-void">
                  <img
                    src={img.previewUrl}
                    alt=""
                    className={`h-full w-full object-cover ${
                      img.filter === 'grayscale' ? 'grayscale' : img.filter === 'bw' ? 'grayscale contrast-[2.2] brightness-110' : ''
                    }`}
                  />
                  <span className="absolute bottom-0 left-0 rounded-tr bg-[color-mix(in_srgb,var(--void)_75%,transparent)] px-1.5 py-0.5 font-mono text-[9px] text-text-dim">
                    {idx + 1}
                  </span>
                  <button
                    onClick={() => cycleFilter(img.id)}
                    className="absolute bottom-0 right-0 rounded-tl bg-grad px-1.5 py-0.5 font-mono text-[9px] font-bold text-white"
                  >
                    {t.scanToolPage.filterShort[img.filter]}
                  </button>
                  <button
                    onClick={() => removeImage(img.id)}
                    aria-label={t.scanToolPage.removeImage}
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
                {t.scanToolPage.paperSizeLabel}
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
                    {t.scanToolPage.paperSizeNames[size]}
                  </button>
                ))}
              </div>
            </div>

            <div className="border-b border-line p-[22px]">
              <div className="mb-3.5 font-mono text-[10.5px] uppercase tracking-[0.18em] text-text-faint">
                {t.scanToolPage.orientationLabel}
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
                    {o === 'portrait' ? t.scanToolPage.portrait : o === 'landscape' ? t.scanToolPage.landscape : t.scanToolPage.autoOrientation}
                  </button>
                ))}
              </div>
              {orientationMode === 'auto' && (
                <div className="mt-2.5 font-mono text-[11.5px] leading-[1.5] text-text-faint">
                  {t.scanToolPage.autoOrientationHint}
                </div>
              )}
            </div>

            <div className="border-b border-line p-[22px]">
              <div className="mb-3.5 font-mono text-[10.5px] uppercase tracking-[0.18em] text-text-faint">
                {t.scanToolPage.marginLabel}
              </div>
              <div className="flex gap-1 rounded-sm border border-line bg-void p-[3px]">
                <button
                  type="button"
                  className={`flex-1 rounded-[2px] px-1.5 py-[9px] text-center font-mono text-[13px] font-semibold transition-all duration-150 ${
                    hasMargin ? 'bg-grad text-white' : 'text-text-dim hover:text-text'
                  }`}
                  onClick={() => setHasMargin(true)}
                >
                  {t.scanToolPage.withMargin}
                </button>
                <button
                  type="button"
                  className={`flex-1 rounded-[2px] px-1.5 py-[9px] text-center font-mono text-[13px] font-semibold transition-all duration-150 ${
                    !hasMargin ? 'bg-grad text-white' : 'text-text-dim hover:text-text'
                  }`}
                  onClick={() => setHasMargin(false)}
                >
                  {t.scanToolPage.noMargin}
                </button>
              </div>
              <div className="mt-2.5 font-mono text-[11.5px] leading-[1.5] text-text-faint">
                {t.scanToolPage.marginHint}
              </div>
            </div>

            <div className="border-b border-line p-[22px]">
              <div className="mb-3.5 font-mono text-[10.5px] uppercase tracking-[0.18em] text-text-faint">
                {t.scanToolPage.compressionLabel}
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
                    {t.scanToolPage.compressionOptions[c]}
                  </button>
                ))}
              </div>
              <div className="mt-2.5 font-mono text-[11.5px] leading-[1.5] text-text-faint">
                {t.scanToolPage.compressionHint}
              </div>
            </div>

            <div className="p-[22px]">
              <button
                className="w-full rounded-[3px] bg-grad py-[15px] font-mono text-[13px] font-bold uppercase tracking-[0.08em] text-white transition-opacity duration-150 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                onClick={handleGenerate}
                disabled={converting}
              >
                {converting ? t.scanToolPage.converting : t.scanToolPage.convert}
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
              <div className="truncate text-[13px] font-semibold">{t.scanToolPage.resultTitle}</div>
              <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[11px] text-text-faint">
                <span>{result.name}</span>
                <span className="text-indigo">·</span>
                <span>{t.scanToolPage.pageCount(result.pageCount)}</span>
                <span className="text-indigo">·</span>
                <span className="text-ok">{fmtBytes(result.size)}</span>
              </div>
            </div>
            <button
              className="shrink-0 whitespace-nowrap rounded-[3px] border border-indigo px-3 py-[7px] font-mono text-[11px] text-indigo transition-colors duration-150 hover:bg-indigo hover:text-white"
              onClick={downloadResult}
            >
              {t.scanToolPage.download}
            </button>
          </div>
        )}

        {hasImages && (
          <div className="mt-4 text-right">
            <button onClick={clearAll} className="border-none bg-transparent font-mono text-[11.5px] text-text-faint transition-colors duration-150 hover:text-text">
              {t.scanToolPage.clearAll}
            </button>
          </div>
        )}
      </div>
    </>
  );
}