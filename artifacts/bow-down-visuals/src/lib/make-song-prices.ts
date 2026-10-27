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
 * entries mirror the server rails (routes/generate/song.ts
 * CREDIT_COST and routes/generate/music-audio.ts SONG_PRICE_TIERS).
 * The audio figure is the DEFAULT-length tier: the result page's
 * Generate Audio sends no length, so the server default (60 seconds)
 * applies — the first SONG_PRICE_TIERS rung. Longer audio is priced
 * by length on the rail (800 up to 3 min / 1,200 up to 5 min) and the
 * up-front note says so; the combined figure quoted up front is the
 * standard journey a first song actually takes.
 *
 * make-song-prices.test.ts pins each figure to the registry AND
 * re-derives the server constants from source, and pins the Make Song
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
