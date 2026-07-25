// app/api/cleanup/route.ts
// Scheduled job (see vercel.json) that deletes synced files older than
// RETENTION_DAYS, so storage usage stays bounded instead of growing forever.
// This is NOT a public endpoint — it checks a secret header before running.
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, BUCKET_NAME } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';

const RETENTION_DAYS = 7; // adjust to taste — shorter = less storage used
const BATCH_LIST_LIMIT = 1000; // Supabase list() page size

// Files are named `${Date.now()}-${uuid}-${safeName}` in the sync route,
// so the leading timestamp lets us figure out age without needing extra
// metadata or a database table.
function extractTimestamp(filename: string): number | null {
  const match = filename.match(/^(\d+)-/);
  return match ? parseInt(match[1], 10) : null;
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const toDelete: string[] = [];
    let offset = 0;

    // Paginate through the bucket so this still works once it has thousands
    // of files, not just the first page.
    while (true) {
      const { data, error } = await supabaseAdmin.storage
        .from(BUCKET_NAME)
        .list('', { limit: BATCH_LIST_LIMIT, offset, sortBy: { column: 'name', order: 'asc' } });

      if (error) {
        console.error('Cleanup list error:', error.message);
        return NextResponse.json({ success: false, error: 'List failed.' }, { status: 500 });
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

    if (!toDelete.length) {
      return NextResponse.json({ success: true, deleted: 0 });
    }

    // Supabase remove() accepts a batch of paths in one call.
    const { error: deleteError } = await supabaseAdmin.storage.from(BUCKET_NAME).remove(toDelete);
    if (deleteError) {
      console.error('Cleanup delete error:', deleteError.message);
      return NextResponse.json({ success: false, error: 'Delete failed.' }, { status: 500 });
    }

    return NextResponse.json({ success: true, deleted: toDelete.length });
  } catch (err) {
    console.error('Cleanup route error:', err);
    return NextResponse.json({ success: false, error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}