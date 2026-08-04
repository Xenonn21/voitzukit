// app/api/sync-background-remover/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import sharp from 'sharp';

export const runtime = 'nodejs';

const BUCKET_NAME = process.env.SUPABASE_BUCKET_BACKGROUND_REMOVER!;
const MAX_SIZE = 1 * 1024 * 1024; // 1MB

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file');

    // 1. VALIDASI KEBERADAAN & UKURAN FILE
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ success: false, error: 'File tidak valid atau tidak ditemukan.' }, { status: 400 });
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { success: false, error: `Ukuran file melebihi batas maksimal (${MAX_SIZE / (1024 * 1024)}MB).` },
        { status: 413 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    let safeBuffer: Buffer;

    // 2. IMAGE RE-ENCODING & ABSOLUTE VALIDATION DENGAN SHARP
    // Menggagalkan Polyglot, Decompression Bomb, menghapus EXIF, dan memastikan binary adalah gambar murni.
    try {
      safeBuffer = await sharp(buffer)
        .png({ compressionLevel: 9 }) // Paksa output ke format PNG bersih
        .toBuffer();
    } catch (err) {
      return NextResponse.json(
        { success: false, error: 'File gambar korup, malformed, atau mengandung payload berbahaya.' },
        { status: 415 }
      );
    }

    // 3. SANITASI FILENAME KETAT
    const rawName = (formData.get('filename') as string) || 'image';
    // Ambil nama dasarnya saja (buang titik ekstensi dari client) dan buang karakter aneh
    const baseName = rawName.split('.')[0].replace(/[^a-zA-Z0-9_-]/g, '');
    
    // Hardcode ekstensi .png untuk mengunci Path Traversal & Arbitrary Extension
    const path = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${baseName || 'bg-removed'}.png`;

    // 4. UPLOAD KE BUCKET
    const { error } = await supabaseAdmin.storage.from(BUCKET_NAME).upload(path, safeBuffer, {
      contentType: 'image/png', // Hardcode, jangan pernah gunakan variabel file.type dari client
      upsert: false,
    });

    if (error) {
      console.error('Supabase upload error:', error.message);
      return NextResponse.json({ success: false, error: 'Gagal menyimpan file ke storage.' }, { status: 500 });
    }

    return NextResponse.json({ success: true, path });
  } catch (err) {
    console.error('Critical sync route error:', err);
    return NextResponse.json({ success: false, error: 'Terjadi kesalahan internal server.' }, { status: 500 });
  }
}