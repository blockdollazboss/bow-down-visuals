/**
 * Make Song journey prices — derived, never second literals.
 *
 * Tutorial finding F2 (pilot prep, ~/workspace/tutorials-pilot/NOTES.md):
 * "Make a song" end-to-end is TWO charges — the song package
 * (POST /api/generate-song) and, as a second step inside the result,
 * the real audio (POST /api/generate-music-audio) — yet nothing at the
 * start of the journey said the second charge existed. Owner ruling,
 * Oct 27, 2026 (by delegation): "Tutorial F2: the full combined charge
 * displays UP FRONT."
 *
 * The figures below derive from the credit-costs registry, whose
 * entries mirror the server rails. BOTH song rails price by the
 * same duration tiers (routes/generate/music-audio.ts
 * SONG_PRICE_TIERS, imported by routes/generate/song.ts since the
 * audit-#5 fix — the legacy package rail no longer charges a flat
 * figure): 400 (≤1 min) / 800 (≤3 min) / 1,200 (≤5 min) / 2,400
 * (≤10 min). The registry records the first tier (400) for each
 * endpoint, which is the figure below.
 * The audio figure is the DEFAULT-length tier: the result page's
 * Generate Audio sends no length, so the server default (60 seconds)
 * applies — the first SONG_PRICE_TIERS rung. Longer audio is priced
 * by length on the rail (800 up to 3 min / 1,200 up to 5 min) and the
 * up-front note says so; the combined figure quoted up front is the
 * standard journey a first song actually takes.
 *
 * make-song-prices.test.ts pins each figure to the registry AND
 * re-derives the server tiers from source, and pins the Make Song
 * module rendering the combined figure before its first charge button.
 */
import { getCreditCost } from "./credit-costs";

/** Step 1: the song package (lyrics, hook, directions, prompts). */
export const MAKE_SONG_PACKAGE_COST: number =
  getCreditCost("/api/generate-song")?.cost ?? 400;

/** Step 2: the real audio, at the default (60-second) length tier. */
export const MAKE_SONG_AUDIO_COST: number =
  getCreditCost("/api/generate-music-audio")?.cost ?? 400;

/** The full journey, quoted up front: package + audio = 800. */
export const MAKE_SONG_FULL_JOURNEY_COST: number =
  MAKE_SONG_PACKAGE_COST + MAKE_SONG_AUDIO_COST;

/* ── The package rail's per-length price (audit #5) ───────────────
 * The server (routes/generate/song.ts) parses the descriptive
 * songLength label to milliseconds and prices it through the audio
 * rail's creditCostForLength. This mirror derives the same figure
 * from the registry base (400 = first tier) so the spend-confirm
 * dialog, the toast, and the form's badge quote the tier the rail
 * will actually charge — never the flat base for a longer song.
 * The mapping is the server's, reviewed there: no/unrecognised
 * length → 60s default; "Full song" → 180s (the standard full-song
 * length); tiers at 60 / 180 / 300 / 600 seconds are the base ×
 * 1 / 2 / 3 / 6 (400 / 800 / 1,200 / 2,400). Past 10 minutes the
 * display caps at the top tier — the rail refuses members there in
 * plain words before any charge, so no member is ever charged it
 * for an over-length package. */
export function makeSongPackageLengthMs(
  songLength?: string | null,
  lengthSeconds?: number | null,
): number {
  if (
    typeof lengthSeconds === "number" &&
    Number.isFinite(lengthSeconds) &&
    lengthSeconds > 0
  ) {
    return Math.round(lengthSeconds * 1000);
  }
  const text = (songLength ?? "").trim().toLowerCase();
  if (!text) return 60_000;
  if (text.includes("full song")) return 180_000;
  const clock = text.match(/(\d+):([0-5]\d)/);
  if (clock) return Number(clock[1]) * 60_000 + Number(clock[2]) * 1_000;
  let ms = 0;
  let found = false;
  const minutes = text.match(/(\d+(?:\.\d+)?)\s*(?:minutes?|mins?)\b/);
  if (minutes) {
    ms += Math.round(Number(minutes[1]) * 60_000);
    found = true;
  }
  const seconds = text.match(/(\d+(?:\.\d+)?)\s*(?:seconds?|secs?)\b/);
  if (seconds) {
    ms += Math.round(Number(seconds[1]) * 1_000);
    found = true;
  }
  return found ? ms : 60_000;
}

export function makeSongPackageCostForLength(
  songLength?: string | null,
  lengthSeconds?: number | null,
): number {
  const ms = makeSongPackageLengthMs(songLength, lengthSeconds);
  const base = MAKE_SONG_PACKAGE_COST;
  if (ms <= 60_000) return base;
  if (ms <= 180_000) return base * 2;
  if (ms <= 300_000) return base * 3;
  return base * 6;
}
