// app/api/sync-scan-pdf/route.ts
// Background sync endpoint for the Scan to PDF tool — stores the generated
// PDF (not the raw captures/uploads) into its own Supabase bucket, separate
// from image-to-pdf's bucket.
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';

const BUCKET_NAME = process.env.SUPABASE_BUCKET_SCAN_TO_PDF!;
const MAX_SIZE = 3 * 1024 * 1024; // 3MB PER FILE YANG DIKIRIM KE BUCKET
const MAX_FILENAME_LENGTH = 150;

const RATE_LIMIT = 10; // requests
const RATE_WINDOW_MS = 60_000; // per 60s
const hits = new Map<string, number[]>();

const HITS_CLEANUP_THRESHOLD = 500;

function isRateLimited(ip: string) {
  const now = Date.now();

  if (hits.size > HITS_CLEANUP_THRESHOLD) {
    for (const [key, timestamps] of hits) {
      if (timestamps.every((t) => now - t >= RATE_WINDOW_MS)) {
        hits.delete(key);
      }
    }
  }

  const timestamps = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  timestamps.push(now);
  hits.set(ip, timestamps);
  return timestamps.length > RATE_LIMIT;
}

function looksLikePdf(buffer: Buffer) {
  return buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-';
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('cf-connecting-ip') || 'unknown';

  if (origin && origin !== req.nextUrl.origin) {
    return NextResponse.json({ success: false, error: 'Forbidden.' }, { status: 403 });
  }

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

    if (file.size === 0) {
      return NextResponse.json({ success: false, error: 'File kosong.' }, { status: 400 });
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { success: false, error: `File terlalu besar (maks ${MAX_SIZE / (1024 * 1024)}MB).` },
        { status: 413 }
      );
    }

    if (file.type !== 'application/pdf') {
      return NextResponse.json({ success: false, error: 'Tipe file tidak didukung.' }, { status: 415 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Belt-and-suspenders on top of the MIME check above: actually look at
    // the bytes instead of trusting what the client claims.
    if (!looksLikePdf(buffer)) {
      return NextResponse.json({ success: false, error: 'File bukan PDF yang valid.' }, { status: 415 });
    }

    const rawNameInput = (formData.get('filename') as string) || `file-${Date.now()}.pdf`;
    const rawName = rawNameInput.slice(0, MAX_FILENAME_LENGTH);
    const safeName = rawName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${safeName}`;

    const { error } = await supabaseAdmin.storage.from(BUCKET_NAME).upload(path, buffer, {
      contentType: 'application/pdf',
      upsert: false,
    });

    if (error) {
      console.error('Sync Scan PDF error:', error.message);
      return NextResponse.json({ success: false, error: 'Sync failed.' }, { status: 500 });
    }

    return NextResponse.json({ success: true, path });
  } catch (err) {
    console.error('Sync Scan PDF route error:', err);
    return NextResponse.json({ success: false, error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}