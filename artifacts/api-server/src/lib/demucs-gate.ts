/**
 * demucs-gate.ts — process-wide single-flight gate for Demucs (PyTorch)
 * child processes. (2026-10-12, OOM fix.)
 *
 * One Demucs run RSSes hundreds of MB; two concurrent runs in the
 * 512 MB container OOM-kill the whole service — this was the top
 * suspect in oom-investigation.md. Every Demucs spawn in the process
 * must go through runGatedDemucs(): one run at a time, up to
 * MAX_WAITERS queued, beyond that a retryable busy error instead of
 * a dead container.
 */

export class DemucsBusyError extends Error {
  readonly retryable = true;
  constructor() {
    super(
      "Stem separation is busy — another track is being processed right now. Please retry in a moment.",
    );
    this.name = "DemucsBusyError";
  }
}

const MAX_WAITERS = 2;
let running = false;
const waiters: Array<() => void> = [];

async function acquireDemucsSlot(): Promise<void> {
  if (!running) {
    running = true;
    return;
  }
  if (waiters.length >= MAX_WAITERS) throw new DemucsBusyError();
  // Woken by releaseDemucsSlot(), which transfers slot ownership.
  await new Promise<void>((resolve) => waiters.push(resolve));
}

function releaseDemucsSlot(): void {
  const next = waiters.shift();
  if (next) {
    next(); // ownership transferred; `running` stays true
  } else {
    running = false;
  }
}

export async function runGatedDemucs<T>(fn: () => Promise<T>): Promise<T> {
  await acquireDemucsSlot();
  try {
    return await fn();
  } finally {
    releaseDemucsSlot();
  }
}

/**
 * Thread caps for the Demucs child env. Uncapped, PyTorch spawns a
 * thread per core and thrashes CPU + memory on a small container.
 * Mirrors the export pipeline's `-threads 2` discipline.
 */
export const DEMUCS_THREAD_ENV = {
  OMP_NUM_THREADS: "2",
  MKL_NUM_THREADS: "2",
  TORCH_NUM_THREADS: "2",
} as const;
