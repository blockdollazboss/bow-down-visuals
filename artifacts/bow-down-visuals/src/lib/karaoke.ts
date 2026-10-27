/* ─── Karaoke Mode (N9) — FE timed-lyrics helpers ─────────────────────────
   Mirrors the api-server rules (lib/karaoke-lyrics.ts): the player lights
   the line whose start time has most recently passed. Parsing accepts the
   same LRC stamps the creator pastes into the song's karaoke settings. */

export interface TimedLyricLine {
  startSec: number;
  text: string;
}

const LRC_LINE = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]\s*(.*)$/;

export function parseLrc(lrc: string): TimedLyricLine[] {
  const out: TimedLyricLine[] = [];
  for (const raw of (lrc ?? "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = LRC_LINE.exec(line);
    if (!m) continue;
    const min = Number(m[1]);
    const sec = Number(m[2]);
    const frac = m[3] ? Number(`0.${m[3]}`) : 0;
    const text = (m[4] ?? "").trim();
    if (!text) continue;
    out.push({ startSec: Math.round((min * 60 + sec + frac) * 100) / 100, text });
  }
  out.sort((a, b) => a.startSec - b.startSec);
  return out;
}

/** The line lit at time t, and its index (−1 before the first line). */
export function activeLyricIndex(lines: TimedLyricLine[], t: number): number {
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.startSec <= t) idx = i;
    else break;
  }
  return idx;
}

export function formatLyricTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
