// middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const RATE_LIMIT = 10; // Maksimal 10 request
const RATE_WINDOW_MS = 60_000; // Dalam 60 detik (1 menit)

// In-memory map yang berjalan di Edge Vercel (per-region isolate)
const ipHits = new Map<string, number[]>();

export function middleware(req: NextRequest) {
  // Ambil IP pengunjung melalui header standar (aman dari error TypeScript)
  const ip = 
    req.headers.get('cf-connecting-ip') || 
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 
    'unknown';

  const now = Date.now();
  const timestamps = (ipHits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  timestamps.push(now);

  // Mencegah memory leak di Edge
  if (!ipHits.has(ip) && ipHits.size > 1000) {
    ipHits.clear(); 
  }

  ipHits.set(ip, timestamps);

  // Jika IP mengirim terlalu banyak request, blokir seketika
  if (timestamps.length > RATE_LIMIT) {
    return NextResponse.json(
      { 
        success: false, 
        error: 'Terlalu banyak permintaan, sistem mendeteksi spam. Coba lagi dalam 1 menit.' 
      },
      { 
        status: 429,
        headers: {
          'Retry-After': '60',
          'X-RateLimit-Limit': RATE_LIMIT.toString(),
          'X-RateLimit-Remaining': '0',
        }
      }
    );
  }

  // Jika aman, persilakan masuk ke route.ts
  return NextResponse.next();
}

// Middleware HANYA akan dipicu jika URL yang diakses adalah endpoint ini
export const config = {
  matcher: '/api/sync-background-remover',
};