/* ─── Karaoke Mode (N9) — timed-lyrics (LRC) parsing + validation ──────────
   Lyrics are the song's OWN: the creator supplies timed lyrics in LRC form
   ([mm:ss.xx] line). A timed line whose words do not appear in the song's
   own lyrics FAILS validation — a wrong lyric line fails the whole set,
   rather than lighting up words the artist never wrote. */

export interface TimedLyricLine {
  startSec: number;
  text: string;
}

const LRC_LINE = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]\s*(.*)$/;

/** Parse LRC text into sorted timed lines. Non-timed lines are ignored. */
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

function normalizeWords(s: string): string[] {
  return (s ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** A timed line "matches" the song's lyrics when its words appear, in order,
    somewhere in the song's own lyric text (normalized). */
export function lyricLineMatches(lineText: string, songLyrics: string): boolean {
  const words = normalizeWords(lineText);
  if (words.length === 0) return false;
  const hay = normalizeWords(songLyrics).join(" ");
  return hay.includes(words.join(" "));
}

export interface TimedLyricsValidation {
  ok: boolean;
  lines: TimedLyricLine[];
  errors: string[];
}

/** Validate artist-supplied timed lyrics against the song's own lyrics.
    When the song has no stored lyrics, the timed set itself becomes the
    record (the creator is the artist supplying them). */
export function validateTimedLyrics(lrc: string, songLyrics: string | null | undefined): TimedLyricsValidation {
  const errors: string[] = [];
  const lines = parseLrc(lrc ?? "");
  if (lines.length < 2) {
    errors.push("Timed lyrics need at least 2 timed lines like [0:12] first line.");
    return { ok: false, lines, errors };
  }
  if (songLyrics && songLyrics.trim()) {
    for (const line of lines) {
      if (!lyricLineMatches(line.text, songLyrics)) {
        errors.push(`Timed line "${line.text.slice(0, 60)}" does not match the song's lyrics — a wrong lyric line fails the set.`);
        if (errors.length >= 5) break;
      }
    }
  }
  return { ok: errors.length === 0, lines, errors };
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
