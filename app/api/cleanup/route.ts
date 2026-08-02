// app/api/cleanup/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';

const RETENTION_MS = 60 * 1000; // TESTING: 1 menit — kembalikan ke 7 * 24 * 60 * 60 * 1000 setelah selesai test
const BATCH_LIST_LIMIT = 1000; // Supabase list() page size

const BUCKETS_TO_CLEAN = [
  process.env.SUPABASE_BUCKET_CONVERTED_IMAGES!,
  process.env.SUPABASE_BUCKET_IMAGE_TO_PDF!,
  process.env.SUPABASE_BUCKET_HTML_TO_PDF!,
  process.env.SUPABASE_BUCKET_DOCX_TO_HTML!,
  process.env.SUPABASE_BUCKET_PDF_COMPRESSOR!,
  process.env.SUPABASE_BUCKET_QR_GENERATOR!,
  process.env.SUPABASE_BUCKET_BACKGROUND_REMOVER!,
  process.env.SUPABASE_BUCKET_PDF_MERGE_SPLIT!,
];

function extractTimestamp(filename: string): number | null {
  const match = filename.match(/^(\d+)-/);
  return match ? parseInt(match[1], 10) : null;
}

async function cleanupBucket(bucket: string, cutoff: number) {
  const toDelete: string[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabaseAdmin.storage
      .from(bucket)
      .list('', { limit: BATCH_LIST_LIMIT, offset, sortBy: { column: 'name', order: 'asc' } });

    if (error) {
      console.error(`Cleanup list error (${bucket}):`, error.message);
      throw new Error('List failed.');
    }
    if (!data || data.length === 0) break;

    for (const file of data) {
      const ts = extractTimestamp(file.name);
      if (ts !== null && ts < cutoff) {
        toDelete.push(file.name);
      }
    }

    if (data.length < BATCH_LIST_LIMIT) break;
    offset += BATCH_LIST_LIMIT;
  }

  if (!toDelete.length) return 0;

  // Supabase remove() accepts a batch of paths in one call.
  const { error: deleteError } = await supabaseAdmin.storage.from(bucket).remove(toDelete);
  if (deleteError) {
    console.error(`Cleanup delete error (${bucket}):`, deleteError.message);
    throw new Error('Delete failed.');
  }

  return toDelete.length;
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const cutoff = Date.now() - RETENTION_MS;
    const deletedByBucket: Record<string, number> = {};

    for (const bucket of BUCKETS_TO_CLEAN) {
      deletedByBucket[bucket] = await cleanupBucket(bucket, cutoff);
    }

    const deleted = Object.values(deletedByBucket).reduce((sum, n) => sum + n, 0);
    return NextResponse.json({ success: true, deleted, deletedByBucket });
  } catch (err) {
    console.error('Cleanup route error:', err);
    return NextResponse.json({ success: false, error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}