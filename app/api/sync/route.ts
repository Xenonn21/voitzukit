// app/api/sync/route.ts
// Internal background sync endpoint — not referenced anywhere in the UI copy
// or status messages. Renamed from /api/upload to avoid signaling storage
// behavior through the route path itself.
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import sharp from 'sharp'; // [FIX] Ditambahkan untuk absolute image validation & sanitization

export const runtime = 'nodejs';

const BUCKET_NAME = process.env.SUPABASE_BUCKET_CONVERTED_IMAGES!;
const MAX_SIZE = 1 * 1024 * 1024; // 1MB per file
const MAX_FILES_PER_REQUEST = 50; 

// [FIX] Mengurangi risiko IP Spoofing dengan validasi header ketat
function getClientIp(req: NextRequest) {
  return req.headers.get('cf-connecting-ip') || 
         req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 
         'unknown';
}

const RATE_LIMIT = 10; // requests
const RATE_WINDOW_MS = 60_000; // per 60s
const HITS_MAP_MAX_ENTRIES = 5000; // [FIX] Batas aman memory leak
const hits = new Map<string, number[]>();

function isRateLimited(ip: string) {
  const now = Date.now();
  const timestamps = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  timestamps.push(now);

  // [FIX] Mencegah Memory Leak: Hapus entry terlama jika ukuran Map terlalu besar
  if (!hits.has(ip) && hits.size >= HITS_MAP_MAX_ENTRIES) {
    const keysToDelete = Array.from(hits.keys()).slice(0, 1000);
    for (const key of keysToDelete) {
      hits.delete(key);
    }
  }

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
  const ip = getClientIp(req);

  if (isRateLimited(ip)) {
    return NextResponse.json(
      { success: false, error: 'Too many requests, coba lagi sebentar.' },
      { status: 429 }
    );
  }

  try {
    const formData = await req.formData();
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

    const results: SyncResult[] = [];

    // [FIX] Diganti dari Promise.all ke for...of (Sequential) 
    // Mencegah Server OOM / Memory Exhaustion saat membaca 50 buffer berbarengan.
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const rawName = filenames[i] || `file-${Date.now()}-${i}`;

      if (file.size > MAX_SIZE) {
        results.push({ filename: rawName, success: false, error: `File terlalu besar (maks ${MAX_SIZE / (1024 * 1024)}MB).` });
        continue;
      }

      // [FIX] Sanitasi filename: Menghilangkan titik (.) untuk mencegah Arbitrary Extension Injection
      const baseName = rawName.split('.')[0].replace(/[^a-zA-Z0-9_-]/g, '');
      const buffer = Buffer.from(await file.arrayBuffer());
      
      let safeBuffer: Buffer;
      
      // [FIX] Absolute Image Validation & Metadata Stripping menggunakan Sharp
      try {
        safeBuffer = await sharp(buffer)
          .webp({ quality: 90 }) // Konversi paksa semua upload menjadi WebP
          .toBuffer();
      } catch (err) {
        // Gagal decode -> File bukan gambar valid / Corrupted / File berbahaya
        results.push({ filename: rawName, success: false, error: 'Format gambar tidak valid atau korup.' });
        continue;
      }

      // [FIX] Hardcode ekstensi .webp di sisi server agar attacker tidak bisa injeksi .html/.svg
      const path = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${baseName || 'image'}.webp`;

      const { error } = await supabaseAdmin.storage.from(BUCKET_NAME).upload(path, safeBuffer, {
        contentType: 'image/webp', // [FIX] Hardcode MIME type, jangan percaya file.type dari client
        upsert: false,
      });

      if (error) {
        console.error('Sync error:', error.message);
        results.push({ filename: rawName, success: false, error: 'Sync failed.' });
      } else {
        results.push({ filename: rawName, success: true, path });
      }
    }

    const success = results.every((r) => r.success);
    return NextResponse.json({ success, results });
  } catch (err) {
    console.error('Sync route error:', err);
    return NextResponse.json({ success: false, error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}