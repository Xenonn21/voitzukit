// app/components/ScrollThumb.tsx
// scrollbar component
'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import type { Accent } from '../lib/theme-context';
import { ACCENT_COLORS } from './BackgroundFX';

interface ScrollThumbProps {
  accent: Accent;
  /** The scrollable element to track. Omit to track the whole page/window. */
  target?: RefObject<HTMLElement | null>;
  /** Fixed thumb length in px, regardless of scrollable content length. */
  thumbHeight?: number;
  /** Thumb/track width in px. */
  width?: number;
  /** Gap in px from the top/bottom of the track (used for both unless overridden below). */
  inset?: number;
  /** Overrides `inset` for the top edge — e.g. clearing a sticky header. */
  topInset?: number;
  /** Overrides `inset` for the bottom edge. */
  bottomInset?: number;
  /** Extra classes for positioning (e.g. `right-0` inside a container). */
  className?: string;
  /** Shows click-to-scroll up/down arrow buttons at each end of the track. */
  showArrows?: boolean;
  /** Scroll distance in px per arrow click. */
  arrowStep?: number;
}

const ARROW_SIZE = 14;
const ARROW_GAP = 3;

export default function ScrollThumb({
  accent,
  target,
  thumbHeight = 56,
  width = 6,
  inset = 8,
  topInset,
  bottomInset,
  className = '',
  showArrows = false,
  arrowStep = 120,
}: ScrollThumbProps) {
  const top = topInset ?? inset;
  const bottom = bottomInset ?? inset;
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [offset, setOffset] = useState(0);
  const [canScroll, setCanScroll] = useState(false);
  const [atTop, setAtTop] = useState(true);
  const [atBottom, setAtBottom] = useState(false);

  function metrics() {
    const el = target?.current;
    if (el) return { scrollTop: el.scrollTop, scrollable: el.scrollHeight - el.clientHeight, viewport: el.clientHeight };
    const doc = document.documentElement;
    return { scrollTop: doc.scrollTop, scrollable: doc.scrollHeight - window.innerHeight, viewport: window.innerHeight };
  }

  useEffect(() => {
    function recalc() {
      const { scrollTop, scrollable, viewport } = metrics();
      setCanScroll(scrollable > 4);
      if (scrollable <= 4) return;
      const arrowSpace = showArrows ? ARROW_SIZE + ARROW_GAP : 0;
      const trackH = viewport - top - bottom - arrowSpace * 2;
      const travel = Math.max(0, trackH - thumbHeight);
      const ratio = Math.min(1, Math.max(0, scrollTop / scrollable));
      setOffset(ratio * travel);
      setAtTop(scrollTop <= 0.5);
      setAtBottom(scrollTop >= scrollable - 0.5);
    }
    recalc();

    const scrollEl: HTMLElement | Window = target?.current ?? window;
    scrollEl.addEventListener('scroll', recalc, { passive: true } as AddEventListenerOptions);
    window.addEventListener('resize', recalc);

    const ro = new ResizeObserver(recalc);
    ro.observe(target?.current ?? document.body);

    return () => {
      scrollEl.removeEventListener('scroll', recalc);
      window.removeEventListener('resize', recalc);
      ro.disconnect();
    };
  }, [target, thumbHeight, top, bottom, showArrows]);

  function scrollToPointer(clientY: number) {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const travel = Math.max(1, rect.height - thumbHeight);
    const ratio = Math.min(1, Math.max(0, (clientY - rect.top - thumbHeight / 2) / travel));
    const el = target?.current;
    if (el) {
      el.scrollTo({ top: ratio * (el.scrollHeight - el.clientHeight) });
    } else {
      const doc = document.documentElement;
      window.scrollTo({ top: ratio * (doc.scrollHeight - window.innerHeight) });
    }
  }

  function scrollByStep(direction: 1 | -1) {
    const amount = direction * arrowStep;
    const el = target?.current;
    if (el) {
      el.scrollBy({ top: amount, behavior: 'smooth' });
    } else {
      window.scrollBy({ top: amount, behavior: 'smooth' });
    }
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return;
    scrollToPointer(e.clientY);
  }
  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    draggingRef.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }
  function onTrackPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.target !== trackRef.current) return; 
    scrollToPointer(e.clientY);
  }

  if (!canScroll) return null;

  const [primary, secondary] = ACCENT_COLORS[accent];
  const positioning = target ? 'absolute' : 'fixed';
  const arrowSpace = showArrows ? ARROW_SIZE + ARROW_GAP : 0;

  return (
    <div className={`${positioning} z-10 ${className}`} style={{ top, bottom, width: showArrows ? ARROW_SIZE : width }}>
      {showArrows && (
        <button
          type="button"
          onClick={() => scrollByStep(-1)}
          disabled={atTop}
          aria-label="Scroll up"
          className="absolute left-1/2 top-0 flex h-3.5 w-3.5 -translate-x-1/2 items-center justify-center rounded-sm text-text-faint transition-colors duration-150 hover:text-indigo active:text-indigo disabled:pointer-events-none disabled:opacity-30"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" className="h-full w-full">
            <path d="M6 15l6-6 6 6" />
          </svg>
        </button>
      )}

      <div
        ref={trackRef}
        onPointerDown={onTrackPointerDown}
        aria-hidden="true"
        className="absolute left-1/2 -translate-x-1/2 cursor-pointer"
        style={{ top: arrowSpace, bottom: arrowSpace, width }}
      >
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          className="absolute left-0 w-full rounded-full transition-opacity duration-150 hover:opacity-90"
          style={{
            height: thumbHeight,
            top: offset,
            background: `linear-gradient(180deg, ${primary}, ${secondary})`,
          }}
        />
      </div>

      {showArrows && (
        <button
          type="button"
          onClick={() => scrollByStep(1)}
          disabled={atBottom}
          aria-label="Scroll down"
          className="absolute bottom-0 left-1/2 flex h-3.5 w-3.5 -translate-x-1/2 items-center justify-center rounded-sm text-text-faint transition-colors duration-150 hover:text-indigo active:text-indigo disabled:pointer-events-none disabled:opacity-30"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" className="h-full w-full">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      )}
    </div>
  );
}