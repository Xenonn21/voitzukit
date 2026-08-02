'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

const PULL_THRESHOLD = 70; // px tarikan minimum buat trigger refresh
const MAX_PULL = 100; // px batas maksimal tarikan visual

export default function PullToRefresh({ children }: { children: ReactNode }) {
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startYRef = useRef<number | null>(null);
  const pullingRef = useRef(false);

  useEffect(() => {
    // Cuma aktif di device dengan touch (mobile/tablet), bukan desktop
    const isTouchDevice = window.matchMedia('(pointer: coarse)').matches;
    if (!isTouchDevice) return;

    function onTouchStart(e: TouchEvent) {
      if (window.scrollY === 0 && !refreshing) {
        startYRef.current = e.touches[0].clientY;
        pullingRef.current = true;
      }
    }

    function onTouchMove(e: TouchEvent) {
      if (!pullingRef.current || startYRef.current === null || refreshing) return;

      const currentY = e.touches[0].clientY;
      const diff = currentY - startYRef.current;

      if (diff > 0 && window.scrollY === 0) {
        e.preventDefault();
        setPullDistance(Math.min(diff * 0.5, MAX_PULL));
      } else {
        pullingRef.current = false;
        setPullDistance(0);
      }
    }

    function onTouchEnd() {
      if (!pullingRef.current) return;
      pullingRef.current = false;

      setPullDistance((current) => {
        if (current >= PULL_THRESHOLD) {
          setRefreshing(true);
          setTimeout(() => window.location.reload(), 400);
          return PULL_THRESHOLD;
        }
        return 0;
      });
      startYRef.current = null;
    }

    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd);

    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
    };
  }, [refreshing]);

  const progress = Math.min(pullDistance / PULL_THRESHOLD, 1);

  return (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none fixed left-0 right-0 top-0 z-[90] flex justify-center overflow-hidden transition-[height] duration-150 ease-out"
        style={{ height: pullDistance }}
      >
        <div
          className="mt-3 flex h-8 w-8 items-center justify-center rounded-full border border-line bg-surface shadow-[0_8px_24px_rgba(0,0,0,0.35)]"
          style={{
            transform: `scale(${0.6 + progress * 0.4}) rotate(${progress * 360}deg)`,
            opacity: progress,
          }}
        >
          <svg
            viewBox="0 0 120 120"
            className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`}
            fill="none"
          >
            <path d="M20 30 L60 88 L100 30 L82 30 L60 62 L38 30 Z" fill="#7c5cfc" />
            <circle cx="60" cy="90" r="7" fill="#7c5cfc" />
          </svg>
        </div>
      </div>
      {children}
    </>
  );
}