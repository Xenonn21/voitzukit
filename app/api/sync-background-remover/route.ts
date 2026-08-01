// app/api/sync-background-remover/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';

const BUCKET_NAME = process.env.SUPABASE_BUCKET_BACKGROUND_REMOVER!;
const MAX_SIZE = 1 * 1024 * 1024; // 1MB
const ALLOWED_TYPES = ['image/png', 'image/webp'];

const RATE_LIMIT = 10; // requests
const RATE_WINDOW_MS = 60_000; // per 60s

// Safety cap jumlah IP yang ditrack sekaligus, biar map nggak bisa digrow
// tanpa batas oleh client yang spoof X-Forwarded-For beda-beda tiap request.
const HITS_MAP_MAX_ENTRIES = 5000;
const hits = new Map<string, number[]>();

function getClientIp(req: NextRequest): string {
  // cf-connecting-ip diset Cloudflare sendiri & nggak bisa dispoof client,
  // jadi diprioritaskan dibanding X-Forwarded-For.
  return (
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

function isRateLimited(ip: string) {
  const now = Date.now();
  const timestamps = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  timestamps.push(now);

  if (!hits.has(ip) && hits.size >= HITS_MAP_MAX_ENTRIES) {
    for (const key of Array.from(hits.keys()).slice(0, 1000)) {
      hits.delete(key);
    }
  }

  hits.set(ip, timestamps);
  return timestamps.length > RATE_LIMIT;
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);

  if (isRateLimited(ip)) {
    return NextResponse.json(
      { success: false, error: 'Too many requests, coba lagi sebentar.' },
      { status: 429 }
    );
  }

  try {
    const formData = await req.formData();
    const file = formData.get('file');

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ success: false, error: 'Tidak ada file.' }, { status: 400 });
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { success: false, error: `File terlalu besar (maks ${MAX_SIZE / (1024 * 1024)}MB).` },
        { status: 413 }
      );
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ success: false, error: 'Tipe file tidak didukung.' }, { status: 415 });
    }

    const rawName = (formData.get('filename') as string) || `bg-removed-${Date.now()}.png`;
    const safeName = rawName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${safeName}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const { error } = await supabaseAdmin.storage.from(BUCKET_NAME).upload(path, buffer, {
      contentType: file.type,
      upsert: false,
    });

    if (error) {
      console.error('Sync background-remover error:', error.message);
      return NextResponse.json({ success: false, error: 'Sync failed.' }, { status: 500 });
    }

    return NextResponse.json({ success: true, path });
  } catch (err) {
    console.error('Sync background-remover route error:', err);
    return NextResponse.json({ success: false, error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}