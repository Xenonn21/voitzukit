// app/tools/pdf-merge-split/types.ts
//
// Shared between page.tsx (main thread) and pdf-worker.ts (worker thread).
// Keep this the single source of truth — duplicating these types in both
// files (as before) means they silently drift the next time either side
// changes without updating the other.

export type Range = { start: number; end: number };

export type WorkerRequest =
  | { type: 'pageCount'; id: string; bytes: ArrayBuffer }
  | { type: 'merge'; id: string; files: ArrayBuffer[] }
  | { type: 'split'; id: string; bytes: ArrayBuffer; ranges: Range[]; baseName: string };

export type WorkerProgressPhase = 'merging' | 'compressing' | 'splitting';

export type WorkerResponse =
  | { type: 'pageCount'; id: string; pageCount: number }
  | { type: 'merge'; id: string; bytes: ArrayBuffer }
  | { type: 'split'; id: string; outputs: { name: string; bytes: ArrayBuffer }[] }
  | { type: 'progress'; id: string; phase: WorkerProgressPhase; current: number; total: number }
  | { type: 'error'; id: string; message: string };

// Plain `Omit<Union, K>` isn't distributive: `keyof WorkerRequest` collapses to the
// keys common to every branch, so variant-specific fields like `files`/`bytes`
// disappear. This distributes Omit over each union member individually so each
// branch keeps its own fields.
export type DistributiveOmit<T, K extends keyof any> = T extends any ? Omit<T, K> : never;