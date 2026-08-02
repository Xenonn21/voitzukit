// app/api/sync-pdf-merge-split/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';

const BUCKET_NAME = process.env.SUPABASE_BUCKET_PDF_MERGE_SPLIT!;
const MAX_SIZE = 1 * 1024 * 1024; // 1MB

const RATE_LIMIT = 10; // requests
const RATE_WINDOW_MS = 60_000; // per 60s
const hits = new Map<string, number[]>();

// NOTE on production limits: this map is per-instance/per-region memory —
// on Vercel each concurrent invocation/region can have its own copy, and it
// resets on cold start. That means it's a soft deterrent against a single
// runaway client, not a hard global rate limit. If real abuse protection
// across all instances matters, move this to a shared store (Upstash Redis
// or Vercel KV) — happy to wire that up if you add the dependency.
function isRateLimited(ip: string) {
  const now = Date.now();
  const timestamps = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  timestamps.push(now);
  hits.set(ip, timestamps);

  // Opportunistic sweep so `hits` doesn't grow unbounded across a
  // long-lived warm instance — cheap since it only runs occasionally, and
  // correctness doesn't depend on exactly when it fires.
  if (Math.random() < 0.02) {
    for (const [key, times] of hits) {
      if (!times.length || now - times[times.length - 1] > RATE_WINDOW_MS) hits.delete(key);
    }
  }

  return timestamps.length > RATE_LIMIT;
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('cf-connecting-ip') || 'unknown';

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

    const rawName = (formData.get('filename') as string) || file.name || `pdf-merge-split-${Date.now()}`;
    const lower = rawName.toLowerCase();
    const isZip = lower.endsWith('.zip');
    const isPdfFile = lower.endsWith('.pdf');

    if (!isZip && !isPdfFile) {
      return NextResponse.json({ success: false, error: 'Tipe file tidak didukung.' }, { status: 415 });
    }

    // Browsers report inconsistent MIME types for zip blobs generated client-side
    // (application/zip, application/x-zip-compressed, or even empty), so the
    // content-type is derived from the filename extension instead of trusting
    // the client-supplied file.type — that mismatch was causing false 415s.
    const contentType = isZip ? 'application/zip' : 'application/pdf';

    const safeName = rawName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${safeName}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const { error } = await supabaseAdmin.storage.from(BUCKET_NAME).upload(path, buffer, {
      contentType,
      upsert: false,
    });

    if (error) {
      console.error('Sync pdf-merge-split error:', error.message);
      return NextResponse.json({ success: false, error: 'Sync failed.' }, { status: 500 });
    }

    return NextResponse.json({ success: true, path });
  } catch (err) {
    console.error('Sync pdf-merge-split route error:', err);
    return NextResponse.json({ success: false, error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}