/* ─── Synced Lyrics Export (LRC) ──────────────────────────────────────────
   DistroKid "synced lyrics to Apple Music" parity.
   Pure helpers for LRC generation + validation. Kept in lib/ so they are
   unit-testable without rendering a page.
   LRC standard: every lyric line carries an [mm:ss.xx] tag (centiseconds,
   two digits each), plus header tags [ti:] [ar:] [al:] [length:] [by:]. */

export interface TimedLyricLine {
  text: string;
  /** Line start in seconds. LRC is line-based — only starts are exported. */
  startSec: number;
}

export interface LrcMeta {
  title?: string;
  artist?: string;
  album?: string;
  /** Song length in seconds — exported as [length:mm:ss]. */
  lengthSec?: number | null;
  /** File-creator tag. Defaults to the Bow Down Visuals credit line. */
  by?: string;
}

/** Endpoint + price for the AI alignment path (the lyric-video aligner —
    Whisper word-level alignment; it deducts its own credits server-side). */
export const LRC_AI_ALIGN_ENDPOINT = "/api/lyric-video/align";
export const LRC_AI_ALIGN_CREDITS = 200;
/** Manual tap-to-sync costs nothing — no AI runs. */
export const LRC_TAP_MODE_CREDITS = 0;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Format seconds as an LRC timestamp tag: [mm:ss.xx] (centiseconds). */
export function formatLrcTime(totalSeconds: number): string {
  const t = Math.max(0, Number.isFinite(totalSeconds) ? totalSeconds : 0);
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const cs = Math.floor((t - Math.floor(t)) * 100 + 1e-6);
  return `[${pad2(m)}:${pad2(s)}.${pad2(cs)}]`;
}

const LRC_TAG_RE = /\[(\d{2}):(\d{2})\.(\d{2})\]/;

/** Parse the first [mm:ss.xx] tag found in a line. Returns seconds or null. */
export function parseLrcTag(line: string): number | null {
  const m = LRC_TAG_RE.exec(line);
  if (!m) return null;
  const secs = Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 100;
  return Number.isFinite(secs) && secs >= 0 ? secs : null;
}

/** Structural section headers (Verse, Chorus, [Hook]…) are lyric cues, not
    singable lines — drop them from the export, mirroring the site's other
    LRC helpers. */
export function isLyricSectionHeader(line: string): boolean {
  const t = line.trim();
  return (
    /^\[.*\]$/.test(t) ||
    /^(verse|chorus|hook|bridge|outro|intro|pre[\s-]?chorus|interlude|tag|breakdown|refrain|vamp)(\s+\d+)?\s*:?\s*$/i.test(
      t
    )
  );
}

/** Split raw lyrics into exportable singable lines (blanks + section
    headers removed). */
export function splitLrcLines(lyrics: string): string[] {
  return lyrics
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !isLyricSectionHeader(l));
}

function formatLrcLength(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${pad2(m)}:${pad2(s)}`;
}

/** Build a complete .lrc file from timed lines. */
export function buildLrc(lines: TimedLyricLine[], meta: LrcMeta = {}): string {
  const head: string[] = [];
  if (meta.title?.trim()) head.push(`[ti:${meta.title.trim()}]`);
  if (meta.artist?.trim()) head.push(`[ar:${meta.artist.trim()}]`);
  if (meta.album?.trim()) head.push(`[al:${meta.album.trim()}]`);
  if (meta.lengthSec != null && Number.isFinite(meta.lengthSec) && meta.lengthSec > 0) {
    head.push(`[length:${formatLrcLength(meta.lengthSec)}]`);
  }
  head.push(`[by:${meta.by?.trim() || "Bow Down Visuals"}]`);
  const body = lines
    .filter((l) => l.text.trim().length > 0 && !isLyricSectionHeader(l.text))
    .map((l) => `${formatLrcTime(l.startSec)}${l.text.trim()}`);
  return [...head, ...body].join("\n") + "\n";
}

export interface LrcValidation {
  ok: boolean;
  errors: string[];
  timedLineCount: number;
}

/** Validate an LRC document: every lyric line needs a valid [mm:ss.xx] tag,
    timestamps must not run backwards, and at least one timed line must exist.
    Header tags ([ti:], [ar:], [al:], [length:], [by:], …) are allowed. */
export function validateLrc(lrc: string): LrcValidation {
  const errors: string[] = [];
  const headerRe = /^\[(ti|ar|au|al|by|length|offset|re|ve):/i;
  let timed = 0;
  let prev = -1;
  let counted = 0;
  for (const raw of lrc.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    counted += 1;
    if (headerRe.test(line)) continue;
    const tag = parseLrcTag(line);
    if (tag == null) {
      errors.push(
        `Line ${counted}: needs a valid [mm:ss.xx] timestamp — "${line.slice(0, 42)}${line.length > 42 ? "…" : ""}"`
      );
      continue;
    }
    timed += 1;
    if (tag < prev) {
      errors.push(`Line ${counted}: timestamp ${formatLrcTime(tag)} runs backwards.`);
    }
    prev = tag;
  }
  if (timed === 0) {
    errors.push("No timed lines found — every lyric line needs a [mm:ss.xx] timestamp.");
  }
  return { ok: errors.length === 0, errors, timedLineCount: timed };
}

/** Convert aligned lines (e.g. from the lyric-video flow) to LRC lines.
    Structural on purpose: callers can pass their own line shape. */
export function fromAlignedLines(
  lines: Array<{ text: string; startSec: number }>
): TimedLyricLine[] {
  return lines
    .filter((l) => l.text.trim().length > 0)
    .map((l) => ({ text: l.text.trim(), startSec: Math.max(0, l.startSec) }));
}

/** Filename-safe: strip OS-illegal characters, cap length. */
export function sanitizeLrcFilename(name: string): string {
  const clean = (name || "synced-lyrics").replace(/[\\/:*?"<>|]/g, "").trim().slice(0, 80);
  return clean || "synced-lyrics";
}
