// app/api/sync-pdf-compressor/route.ts
// Background sync endpoint for the PDF Compressor tool — stores the
// compressed PDF (not the original upload) into its own Supabase bucket,
// separate from the other tools' buckets. Same shape as sync-html-pdf's
// route: silent, rate-limited, best-effort.
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';

const BUCKET_NAME = process.env.SUPABASE_BUCKET_PDF_COMPRESSOR!;
// Kept in sync with the "pdf_compressor" bucket's file size limit in the
// Supabase dashboard (Storage → pdf_compressor → 8 MB). Compressed output is
// usually much smaller than this, but a large multi-page source at "low"
// compression can still land here — the sync just silently fails in that
// case, it never blocks the user's own download of the compressed PDF.
const MAX_SIZE = 2 * 1024 * 1024; // 2MB PER FILE YANG DIKIRIM KE BUCKET

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

    if (file.type !== 'application/pdf') {
      return NextResponse.json({ success: false, error: 'Tipe file tidak didukung.' }, { status: 415 });
    }

    const rawName = (formData.get('filename') as string) || `file-${Date.now()}.pdf`;
    const safeName = rawName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${safeName}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const { error } = await supabaseAdmin.storage.from(BUCKET_NAME).upload(path, buffer, {
      contentType: 'application/pdf',
      upsert: false,
    });

    if (error) {
      console.error('Sync PDF Compressor error:', error.message);
      return NextResponse.json({ success: false, error: 'Sync failed.' }, { status: 500 });
    }

    return NextResponse.json({ success: true, path });
  } catch (err) {
    console.error('Sync PDF Compressor route error:', err);
    return NextResponse.json({ success: false, error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}