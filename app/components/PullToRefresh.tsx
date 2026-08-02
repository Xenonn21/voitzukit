'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

const PULL_THRESHOLD = 70; // px tarikan minimum buat trigger refresh
const MAX_PULL = 100; // px batas maksimal tarikan visual
const RING_RADIUS = 15;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function hasScrollableAncestor(el: EventTarget | null): boolean {
  let node = el instanceof HTMLElement ? el : null;
  while (node && node !== document.body) {
    const style = window.getComputedStyle(node);
    const canScrollY = style.overflowY === 'auto' || style.overflowY === 'scroll';
    if (canScrollY && node.scrollHeight > node.clientHeight) {
      return true;
    }
    node = node.parentElement;
  }
  return false;
}

export default function PullToRefresh({ children }: { children: ReactNode }) {
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const startYRef = useRef<number | null>(null);
  const pullingRef = useRef(false);

  useEffect(() => {
    const isTouchDevice = window.matchMedia('(pointer: coarse)').matches;
    if (!isTouchDevice) return;

    // touchmove (passive: false) cuma dipasang SEMENTARA selama aktif menarik,
    // bukan permanen — biar scroll normal di seluruh app tetap dioptimasi browser
    // (non-passive listener yang nempel terus bikin semua scroll jadi berat).
    function onTouchMove(e: TouchEvent) {
      if (!pullingRef.current || startYRef.current === null || refreshing) return;

      const currentY = e.touches[0].clientY;
      const diff = currentY - startYRef.current;

      if (diff > 0 && window.scrollY === 0) {
        e.preventDefault();
        const eased = MAX_PULL * (1 - Math.exp(-diff / 120));
        setPullDistance(eased);
      } else {
        endPull();
      }
    }

    function endPull() {
      pullingRef.current = false;
      startYRef.current = null;
      document.removeEventListener('touchmove', onTouchMove);
    }

    function onTouchStart(e: TouchEvent) {
      if (window.scrollY !== 0 || refreshing || hasScrollableAncestor(e.target)) return;

      startYRef.current = e.touches[0].clientY;
      pullingRef.current = true;
      setReleasing(false);
      document.addEventListener('touchmove', onTouchMove, { passive: false });
    }

    function onTouchEnd() {
      if (!pullingRef.current) return;
      setReleasing(true);

      setPullDistance((current) => {
        if (current >= PULL_THRESHOLD * 0.75) {
          setRefreshing(true);
          setTimeout(() => window.location.reload(), 500);
          return PULL_THRESHOLD * 0.75;
        }
        return 0;
      });
      endPull();
    }

    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchend', onTouchEnd, { passive: true });

    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
    };
  }, [refreshing]);

  const progress = Math.min(pullDistance / (PULL_THRESHOLD * 0.75), 1);
  const ready = progress >= 1;

  return (
    <>
      <div
        aria-hidden="true"
        className={`pointer-events-none fixed left-0 right-0 top-0 z-[90] flex justify-center overflow-hidden ${
          releasing ? 'transition-[height] duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]' : ''
        }`}
        style={{ height: pullDistance }}
      >
        <div
          className="relative mt-3 flex h-10 w-10 items-center justify-center"
          style={{
            transform: `scale(${0.55 + progress * 0.45})`,
            opacity: Math.min(progress * 1.6, 1),
          }}
        >
          <div className="absolute inset-0 rounded-full bg-surface shadow-[0_8px_24px_rgba(0,0,0,0.35)]" />

          <svg viewBox="0 0 36 36" className="absolute h-10 w-10 -rotate-90">
            <circle cx="18" cy="18" r={RING_RADIUS} fill="none" className="stroke-line" strokeWidth="2" />
            <circle
              cx="18"
              cy="18"
              r={RING_RADIUS}
              fill="none"
              className={`stroke-indigo transition-[stroke-dashoffset] duration-100 ${
                ready && !refreshing ? 'animate-pulse' : ''
              }`}
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray={RING_CIRCUMFERENCE}
              strokeDashoffset={RING_CIRCUMFERENCE * (1 - progress)}
            />
          </svg>

          <svg
            viewBox="0 0 120 120"
            className={`relative h-4 w-4 transition-transform duration-150 ${refreshing ? 'animate-spin' : ''}`}
            style={!refreshing ? { transform: `rotate(${progress * 200}deg)` } : undefined}
            fill="none"
          >
            <path d="M20 30 L60 88 L100 30 L82 30 L60 62 L38 30 Z" className="fill-indigo" />
            <circle cx="60" cy="90" r="7" className="fill-indigo" />
          </svg>
        </div>
      </div>
      {children}
    </>
  );
}