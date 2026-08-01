// app/components/BackgroundFX.tsx
// animations for the background
'use client';

import { useEffect, useRef } from 'react';
import type { Accent } from '../lib/theme-context';

export type BgEffect = 'off' | 'boxes' | 'particles' | 'network' | 'bubbles' | 'comets';

interface Size {
  width: number;
  height: number;
}

export const ACCENT_COLORS: Record<Accent, [primary: string, secondary: string]> = {
  purple: ['#6366f1', '#a855f7'],
  green: ['#10b981', '#84cc16'],
  yellow: ['#eab308', '#f59e0b'],
  blue: ['#3b82f6', '#06b6d4'],
  orange: ['#f97316', '#f43f5e'],
  pink: ['#ec4899', '#d946ef'],
  teal: ['#14b8a6', '#0d9488'],
  red: ['#ef4444', '#b91c1c'],
};

function runBoxes(ctx: CanvasRenderingContext2D, getSize: () => Size, color: string) {
  type Box = { x: number; y: number; size: number; speed: number; rot: number; rotSpeed: number; opacity: number };
  const COUNT = 20;

  function spawn(initial: boolean): Box {
    const { width, height } = getSize();
    return {
      x: Math.random() * width,
      y: initial ? Math.random() * height : -24,
      size: 8 + Math.random() * 18,
      speed: 14 + Math.random() * 24,
      rot: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.6,
      opacity: 0.08 + Math.random() * 0.16,
    };
  }

  let boxes: Box[] = Array.from({ length: COUNT }, () => spawn(true));
  let raf = 0;
  let last = performance.now();

  function frame(now: number) {
    if (document.hidden) {
      raf = requestAnimationFrame(frame);
      return;
    }
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    const { width, height } = getSize();
    ctx.clearRect(0, 0, width, height);

    for (const b of boxes) {
      b.y += b.speed * dt;
      b.rot += b.rotSpeed * dt;
      if (b.y - b.size > height) Object.assign(b, spawn(false));

      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.rot);
      ctx.strokeStyle = color;
      ctx.globalAlpha = b.opacity;
      ctx.lineWidth = 1.2;
      ctx.strokeRect(-b.size / 2, -b.size / 2, b.size, b.size);
      ctx.restore();
    }
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}

function runParticles(ctx: CanvasRenderingContext2D, getSize: () => Size, color: string) {
  type P = { x: number; y: number; vx: number; vy: number; r: number; phase: number };
  const COUNT = 46;
  const { width: w0, height: h0 } = getSize();
  const particles: P[] = Array.from({ length: COUNT }, () => ({
    x: Math.random() * w0,
    y: Math.random() * h0,
    vx: (Math.random() - 0.5) * 10,
    vy: (Math.random() - 0.5) * 10,
    r: 1 + Math.random() * 1.8,
    phase: Math.random() * Math.PI * 2,
  }));

  let raf = 0;
  let last = performance.now();
  let t = 0;

  function frame(now: number) {
    if (document.hidden) {
      raf = requestAnimationFrame(frame);
      return;
    }
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    t += dt;
    const { width, height } = getSize();
    ctx.clearRect(0, 0, width, height);

    for (const p of particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.x < -5) p.x = width + 5;
      if (p.x > width + 5) p.x = -5;
      if (p.y < -5) p.y = height + 5;
      if (p.y > height + 5) p.y = -5;

      const twinkle = 0.3 + 0.3 * Math.sin(t * 1.5 + p.phase);
      ctx.beginPath();
      ctx.fillStyle = color;
      ctx.globalAlpha = twinkle;
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}

function runNetwork(ctx: CanvasRenderingContext2D, getSize: () => Size, lineColor: string, nodeColor: string) {
  type N = { x: number; y: number; vx: number; vy: number };
  const COUNT = 32;
  const LINK_DIST = 130;
  const { width: w0, height: h0 } = getSize();
  const nodes: N[] = Array.from({ length: COUNT }, () => ({
    x: Math.random() * w0,
    y: Math.random() * h0,
    vx: (Math.random() - 0.5) * 14,
    vy: (Math.random() - 0.5) * 14,
  }));

  let raf = 0;
  let last = performance.now();

  function frame(now: number) {
    if (document.hidden) {
      raf = requestAnimationFrame(frame);
      return;
    }
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    const { width, height } = getSize();
    ctx.clearRect(0, 0, width, height);

    for (const n of nodes) {
      n.x += n.vx * dt;
      n.y += n.vy * dt;
      if (n.x < 0 || n.x > width) n.vx *= -1;
      if (n.y < 0 || n.y > height) n.vy *= -1;
      n.x = Math.max(0, Math.min(width, n.x));
      n.y = Math.max(0, Math.min(height, n.y));
    }

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < LINK_DIST) {
          ctx.beginPath();
          ctx.strokeStyle = lineColor;
          ctx.globalAlpha = (1 - dist / LINK_DIST) * 0.25;
          ctx.lineWidth = 1;
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }

    for (const n of nodes) {
      ctx.beginPath();
      ctx.fillStyle = nodeColor;
      ctx.globalAlpha = 0.55;
      ctx.arc(n.x, n.y, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}

function runBubbles(ctx: CanvasRenderingContext2D, getSize: () => Size, color: string) {
  type Bub = { x: number; y: number; r: number; speed: number; wobbleAmp: number; phase: number; opacity: number };
  const COUNT = 18;

  function spawn(initial: boolean): Bub {
    const { width, height } = getSize();
    return {
      x: Math.random() * width,
      y: initial ? Math.random() * height : height + 24,
      r: 4 + Math.random() * 10,
      speed: 14 + Math.random() * 20,
      wobbleAmp: 8 + Math.random() * 16,
      phase: Math.random() * Math.PI * 2,
      opacity: 0.07 + Math.random() * 0.14,
    };
  }

  let bubbles: Bub[] = Array.from({ length: COUNT }, () => spawn(true));
  let raf = 0;
  let last = performance.now();
  let t = 0;

  function frame(now: number) {
    if (document.hidden) {
      raf = requestAnimationFrame(frame);
      return;
    }
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    t += dt;
    const { width, height } = getSize();
    ctx.clearRect(0, 0, width, height);

    for (const b of bubbles) {
      b.y -= b.speed * dt;
      b.x += Math.sin(t * 1.2 + b.phase) * b.wobbleAmp * dt * 0.6;
      if (b.y + b.r < 0) Object.assign(b, spawn(false));

      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.globalAlpha = b.opacity;
      ctx.lineWidth = 1.4;
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.stroke();
    }
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}

function runComets(ctx: CanvasRenderingContext2D, getSize: () => Size, color: string) {
  type Comet = { x: number; y: number; vx: number; vy: number; len: number; speed: number; opacity: number };
  const COUNT = 10;

  function spawn(initial: boolean): Comet {
    const { width, height } = getSize();
    const angle = (Math.PI / 4) + (Math.random() - 0.5) * 0.4; // roughly diagonal, slight variance
    const speed = 220 + Math.random() * 260;
    const x = initial ? Math.random() * width : Math.random() * width * 0.4 - width * 0.2;
    const y = initial ? Math.random() * height : Math.random() * height * 0.4 - height * 0.2;
    return {
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      len: 60 + Math.random() * 70,
      speed,
      opacity: 0.15 + Math.random() * 0.25,
    };
  }

  let comets: Comet[] = Array.from({ length: COUNT }, () => spawn(true));
  let raf = 0;
  let last = performance.now();

  function frame(now: number) {
    if (document.hidden) {
      raf = requestAnimationFrame(frame);
      return;
    }
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    const { width, height } = getSize();
    ctx.clearRect(0, 0, width, height);

    for (const c of comets) {
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      if (c.x - c.len > width + 40 || c.y - c.len > height + 40) Object.assign(c, spawn(false));

      const dirX = c.vx / c.speed;
      const dirY = c.vy / c.speed;
      const tailX = c.x - dirX * c.len;
      const tailY = c.y - dirY * c.len;

      const gradient = ctx.createLinearGradient(tailX, tailY, c.x, c.y);
      gradient.addColorStop(0, 'rgba(0,0,0,0)');
      gradient.addColorStop(1, color);

      ctx.save();
      ctx.globalAlpha = c.opacity;
      ctx.strokeStyle = gradient;
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(c.x, c.y);
      ctx.stroke();
      ctx.restore();
    }
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}

export default function BackgroundFX({ effect, accent }: { effect: BgEffect; accent: Accent }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (effect === 'off') return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    let width = 0;
    let height = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    function resize() {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas!.width = width * dpr;
      canvas!.height = height * dpr;
      canvas!.style.width = `${width}px`;
      canvas!.style.height = `${height}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener('resize', resize);

    const getSize = () => ({ width, height });
    const [primary, secondary] = ACCENT_COLORS[accent];

    let stop: (() => void) | undefined;
    if (effect === 'boxes') stop = runBoxes(ctx, getSize, primary);
    else if (effect === 'particles') stop = runParticles(ctx, getSize, primary);
    else if (effect === 'network') stop = runNetwork(ctx, getSize, primary, secondary);
    else if (effect === 'bubbles') stop = runBubbles(ctx, getSize, primary);
    else if (effect === 'comets') stop = runComets(ctx, getSize, primary);

    return () => {
      window.removeEventListener('resize', resize);
      stop?.();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [effect, accent]);

  if (effect === 'off') return null;

  return <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none fixed inset-0 z-0" />;
}