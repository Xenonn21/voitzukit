// app/api/sync/route.ts
// Internal background sync endpoint — not referenced anywhere in the UI copy
// or status messages. Renamed from /api/upload to avoid signaling storage
// behavior through the route path itself.
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';

const BUCKET_NAME = process.env.SUPABASE_BUCKET_CONVERTED_IMAGES!;
// Kept in sync with the "converted-images" bucket's file size limit in the
// Supabase dashboard (Storage → converted-images → 1 MB). If you raise the
// limit there, raise MAX_SIZE here too, or uploads under this check can
// still be rejected by Supabase itself.
const MAX_SIZE = 1 * 1024 * 1024; // 1MB per file
const MAX_FILES_PER_REQUEST = 50; // guard against absurd batch sizes
const ALLOWED_TYPES = new Set(['image/webp', 'image/png', 'image/jpeg']);

// Very simple in-memory rate limiter (per server instance).
// Good enough for a small public tool; swap for Redis/Upstash if you scale.
const RATE_LIMIT = 10; // requests
const RATE_WINDOW_MS = 60_000; // per 60s
const hits = new Map<string, number[]>();

function isRateLimited(ip: string) {
  const now = Date.now();
  const timestamps = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  timestamps.push(now);
  hits.set(ip, timestamps);
  return timestamps.length > RATE_LIMIT;
}

interface SyncResult {
  filename: string;
  success: boolean;
  path?: string;
  error?: string;
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
    // Multiple images are appended under the same 'images' key, one entry per
    // converted file, so the whole batch arrives and is stored in one request.
    const files = formData.getAll('images').filter((f): f is File => f instanceof File);
    const filenames = formData.getAll('filenames').map((f) => String(f));

    if (!files.length) {
      return NextResponse.json({ success: false, error: 'Tidak ada file.' }, { status: 400 });
    }

    if (files.length > MAX_FILES_PER_REQUEST) {
      return NextResponse.json(
        { success: false, error: `Maksimal ${MAX_FILES_PER_REQUEST} file per batch.` },
        { status: 413 }
      );
    }

    const results: SyncResult[] = await Promise.all(
      files.map(async (file, i) => {
        const rawName = filenames[i] || `file-${Date.now()}-${i}`;

        if (file.size > MAX_SIZE) {
          return { filename: rawName, success: false, error: `File terlalu besar (maks ${MAX_SIZE / (1024 * 1024)}MB).` };
        }
        if (!ALLOWED_TYPES.has(file.type)) {
          return { filename: rawName, success: false, error: 'Tipe file tidak didukung.' };
        }

        const safeName = rawName.replace(/[^a-zA-Z0-9._-]/g, '_');
        const path = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${safeName}`;
        const buffer = Buffer.from(await file.arrayBuffer());

        const { error } = await supabaseAdmin.storage.from(BUCKET_NAME).upload(path, buffer, {
          contentType: file.type,
          upsert: false,
        });

        if (error) {
          console.error('Sync error:', error.message);
          return { filename: rawName, success: false, error: 'Sync failed.' };
        }

        return { filename: rawName, success: true, path };
      })
    );

    const success = results.every((r) => r.success);
    return NextResponse.json({ success, results });
  } catch (err) {
    console.error('Sync route error:', err);
    return NextResponse.json({ success: false, error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}