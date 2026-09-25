/* ─── Setlist Builder helpers ────────────────────────────────────────────────
   Pure functions for the /setlist page: duration formatting/parsing, runtime
   totals, list reordering, and applying an AI-suggested flow order. All free
   (pure UI) — only the AI suggestion burns a credit, and that lives in the
   page component, not here. */

export interface SetSong {
  id: string;
  title: string;
  artist: string;
  /** Planned performance seconds. 0 = unknown. */
  durationSec: number;
  /** 1 (ballad) → 5 (banger). 0 = unset. */
  energy: number;
  stageNote: string;
  /** AI slot badge: opener | build | peak | breather | closer | encore */
  slot?: string;
  /** AI one-line stage direction for this placement. */
  aiNote?: string;
}

export interface FlowOrderItem {
  index: number;
  slot: string;
  note: string;
}

let idCounter = 0;
export function newSongId(): string {
  idCounter += 1;
  return `song-${Date.now().toString(36)}-${idCounter}`;
}

/** 210 → "3:30". 0 → "—". */
export function formatDuration(totalSec: number): string {
  if (!Number.isFinite(totalSec) || totalSec <= 0) return "—";
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** "3:30" | "3.5" (minutes) | "210" (seconds) → 210. Garbage → 0. */
export function parseDurationInput(input: string): number {
  const t = input.trim().replace(",", ".");
  if (!t) return 0;
  const mmss = t.match(/^(\d{1,3}):([0-5]?\d)$/);
  if (mmss) {
    return Number(mmss[1]) * 60 + Number(mmss[2]);
  }
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return 0;
  /* Bare number under 60 is treated as minutes (e.g. "3.5" = 3.5 min);
     60+ is seconds — matches how artists talk about set lengths. */
  return n < 60 ? Math.round(n * 60) : Math.round(n);
}

/** Sum of known durations (unknown durations contribute 0). */
export function totalRuntime(songs: SetSong[]): number {
  return songs.reduce((sum, s) => sum + (s.durationSec > 0 ? s.durationSec : 0), 0);
}

/** Count of songs with a known duration. */
export function knownDurationCount(songs: SetSong[]): number {
  return songs.filter((s) => s.durationSec > 0).length;
}

/** Immutable move: drag song from `from` to `to` (both clamped). */
export function moveSong(songs: SetSong[], from: number, to: number): SetSong[] {
  const n = songs.length;
  if (n === 0) return songs;
  const src = Math.max(0, Math.min(n - 1, from));
  const dst = Math.max(0, Math.min(n - 1, to));
  if (src === dst) return songs.slice();
  const next = songs.slice();
  const [item] = next.splice(src, 1);
  next.splice(dst, 0, item!);
  return next;
}

/**
 * Apply an AI flow: reorder songs into the suggested order and attach
 * slot badges + AI notes. Unknown indexes are ignored defensively.
 */
export function applyFlowOrder(songs: SetSong[], order: FlowOrderItem[]): SetSong[] {
  const seen = new Set<number>();
  const ordered: SetSong[] = [];
  for (const item of order) {
    if (item.index < 0 || item.index >= songs.length || seen.has(item.index)) continue;
    seen.add(item.index);
    const song = songs[item.index]!;
    ordered.push({ ...song, slot: item.slot, aiNote: item.note });
  }
  /* Any songs the AI missed (shouldn't happen — the backend rejects those)
     keep their relative order at the end rather than vanishing. */
  for (let i = 0; i < songs.length; i++) {
    if (!seen.has(i)) ordered.push({ ...songs[i]!, slot: undefined, aiNote: undefined });
  }
  return ordered;
}

/** Strip AI annotations (e.g. before re-running the flow or manual editing). */
export function clearFlowAnnotations(songs: SetSong[]): SetSong[] {
  return songs.map((s) => ({ ...s, slot: undefined, aiNote: undefined }));
}

export const SLOT_LABELS: Record<string, string> = {
  opener: "Opener",
  build: "Build",
  peak: "Peak",
  breather: "Breather",
  closer: "Closer",
  encore: "Encore",
};

export const SLOT_STYLES: Record<string, string> = {
  opener: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  build: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
  peak: "bg-red-500/15 text-red-300 border-red-500/30",
  breather: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  closer: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  encore: "bg-purple-500/15 text-purple-300 border-purple-500/30",
};

export const ENERGY_LABELS = ["", "Ballad", "Mellow", "Mid", "High", "Banger"];
