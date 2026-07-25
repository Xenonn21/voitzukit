// app/api/upload/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, BUCKET_NAME } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';

const MAX_SIZE = 20 * 1024 * 1024; // 20MB per file
const ALLOWED_TYPES = new Set(['image/webp', 'image/png', 'image/jpeg']);

// Very simple in-memory rate limiter (per server instance).
// Good enough for a small public tool; swap for Redis/Upstash if you scale.
const RATE_LIMIT = 30; // requests
const RATE_WINDOW_MS = 60_000; // per 60s
const hits = new Map<string, number[]>();

function isRateLimited(ip: string) {
  const now = Date.now();
  const timestamps = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  timestamps.push(now);
  hits.set(ip, timestamps);
  return timestamps.length > RATE_LIMIT;
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';

  if (isRateLimited(ip)) {
    return NextResponse.json(
      { success: false, error: 'Too many requests, coba lagi sebentar.' },
      { status: 429 }
    );
  }

  try {
    const formData = await req.formData();
    const file = formData.get('image');

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json({ success: false, error: 'File tidak ditemukan.' }, { status: 400 });
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json({ success: false, error: 'File terlalu besar (maks 20MB).' }, { status: 413 });
    }

    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json({ success: false, error: 'Tipe file tidak didukung.' }, { status: 415 });
    }

    const rawName = (formData.get('filename') as string) || `file-${Date.now()}`;
    const safeName = rawName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${safeName}`;

    const buffer = Buffer.from(await file.arrayBuffer());

    const { error } = await supabaseAdmin.storage.from(BUCKET_NAME).upload(path, buffer, {
      contentType: file.type,
      upsert: false,
    });

    if (error) {
      console.error('Supabase upload error:', error.message);
      return NextResponse.json({ success: false, error: 'Gagal menyimpan ke server.' }, { status: 500 });
    }

    return NextResponse.json({ success: true, path });
  } catch (err) {
    console.error('Upload route error:', err);
    return NextResponse.json({ success: false, error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}