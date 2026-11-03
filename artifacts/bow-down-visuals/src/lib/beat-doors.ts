/* ─── Beat Studio small doors (W2-L4) ──────────────────────────────────────
   The one-website-feel doors out of the Beat Maker's tabs:
   CREATE → make a song, CREATE → sell on the marketplace — plus the
   sequencer's metronome math. All pure UI / free: no charges anywhere in
   this module, and marketplace listing stays free exactly as before.

   Three pieces live here because they are the testable shapes:
   1. Metronome scheduling math (which scheduled steps tick, which one
      accents, and how the one-bar count-in maps onto negative global
      steps) — the sequencer's single lookahead scheduler consumes it;
      there is no second timer.
   2. The rendered-beat upload: a sequencer render is a local Blob, but
      /make-song's audioUrl param and the marketplace's audio URL field
      both need a HOSTED url. The upload rides the site's existing
      generic rail, POST /api/publish/upload (auth, audio ≤ 80 MB,
      returns { url }) — the same rail useFileUpload wraps. One helper
      serves both doors below so they can never drift apart.
   3. The door routes + the marketplace prefill intake: the sequencer
      (and the AI beat tab, whose beat already has a hosted URL) link to
      /beats with the listing form prefilled; beats.tsx parses the same
      params back through parseBeatSellPrefill. */

/* ── 1. Metronome math ────────────────────────────────────────────────────
   The sequencer grid is 16 steps per bar (one pattern = one bar of
   16ths). A beat is a quarter note = every 4 steps. The tick accents
   step 0 of each bar and ticks plainly on the other beats (4, 8, 12).
   Swing never moves a tick: swing delays odd 16ths only, and every
   beat step is even. */

export const METRONOME_STEPS_PER_BAR = 16;
export const METRONOME_STEPS_PER_BEAT = 4;

export interface MetronomeTick {
  /** True when this step sounds a click. */
  tick: boolean;
  /** True for the downbeat click (step 0 of a bar) — louder + higher. */
  accent: boolean;
  /** True when the click belongs to the count-in bar (before step 0). */
  countIn: boolean;
}

const NO_TICK: MetronomeTick = { tick: false, accent: false, countIn: false };

/** Normalize any step index into its position inside one bar. */
export function stepInBar(step: number, stepsPerBar = METRONOME_STEPS_PER_BAR): number {
  const m = Math.trunc(step) % stepsPerBar;
  return m < 0 ? m + stepsPerBar : m;
}

/** The tick for a step position INSIDE a bar (0..stepsPerBar-1). */
export function metronomeTickForBarStep(barStep: number, stepsPerBar = METRONOME_STEPS_PER_BAR): MetronomeTick {
  const s = stepInBar(barStep, stepsPerBar);
  if (s % METRONOME_STEPS_PER_BEAT !== 0) return NO_TICK;
  return { tick: true, accent: s === 0, countIn: false };
}

/** Where playback starts: with count-in on, one full bar of negative
    global steps (-stepsPerBar .. -1) plays clicks only, then step 0 is
    the arrangement/pattern itself. Without count-in, playback starts
    at step 0 exactly as it always has. */
export function initialGlobalStep(countIn: boolean, stepsPerBar = METRONOME_STEPS_PER_BAR): number {
  return countIn ? -stepsPerBar : 0;
}

export function isCountInStep(globalStep: number): boolean {
  return globalStep < 0;
}

/** The one resolver the scheduler calls for EVERY scheduled step.
    - Count-in steps (globalStep < 0): ticks only — position inside the
      count-in bar is globalStep + stepsPerBar; the first count-in beat
      accents so the player hears where "one" of the count-in is.
    - Normal steps: the tick follows the step's position inside the
      pattern/bar being played (stepInPattern), so song mode accents
      each pattern's downbeat as the chain crosses entries. */
export function resolveMetronomeTick(
  globalStep: number,
  stepInPattern: number,
  stepsPerBar = METRONOME_STEPS_PER_BAR,
): MetronomeTick {
  if (isCountInStep(globalStep)) {
    const pos = stepInBar(globalStep, stepsPerBar);
    if (pos % METRONOME_STEPS_PER_BEAT !== 0) return { ...NO_TICK, countIn: true };
    return { tick: true, accent: pos === 0, countIn: true };
  }
  return metronomeTickForBarStep(stepInPattern, stepsPerBar);
}

/** Which count-in beat (1..4) a negative global step belongs to, or 0
    when the step is not in the count-in bar. For the transport readout. */
export function countInBeatNumber(globalStep: number, stepsPerBar = METRONOME_STEPS_PER_BAR): number {
  if (!isCountInStep(globalStep)) return 0;
  return Math.floor(stepInBar(globalStep, stepsPerBar) / METRONOME_STEPS_PER_BEAT) + 1;
}

/* ── 2. Rendered-beat upload (shared by both doors) ───────────────────────
   POST /api/publish/upload, multipart field "file" — the exact rail
   hooks/use-file-upload.ts wraps. Returns the hosted URL, or throws an
   Error carrying the server's message so the caller can show it and
   stay put (a door that cannot hand over a real URL does not open). */

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export async function uploadRenderedBeat(
  blob: Blob,
  bpm: number,
  getAccessToken: () => Promise<string | null>,
  fetchFn: FetchFn = (input, init) => fetch(input, init),
): Promise<string> {
  const token = await getAccessToken().catch(() => null);
  const file = new File([blob], `beat-${Math.round(bpm)}bpm.wav`, { type: "audio/wav" });
  const form = new FormData();
  form.append("file", file);
  const res = await fetchFn("/api/publish/upload", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string; message?: string };
  if (!res.ok || !data.url) {
    throw new Error(data.message || data.error || `Upload failed (${res.status}).`);
  }
  return data.url;
}

/* ── 3a. Sequencer/AI beat → song door ────────────────────────────────────
   /make-song's accepted contract (pages/make-song.tsx): the audioUrl
   query param pre-fills the uploaded-song slot (setUploadedSongUrl).
   The URL must be hosted — make-song ignores blob: URLs when it hands
   the song to the hub project, and a blob: from this session would die
   on navigation anyway — so callers pass the uploadRenderedBeat URL. */

export function makeSongRouteForBeat(audioUrl: string): string {
  return `/make-song?audioUrl=${encodeURIComponent(audioUrl)}`;
}

/* ── 3b. Marketplace prefill ──────────────────────────────────────────────
   The sell door lands on /beats with the listing form prefilled. The
   intake is plain query params (the same deep-link style make-song
   uses): sell=1 opens the Sell tab; audioUrl / title / bpm / genre /
   key prefill the matching form fields. Manual entry stays untouched —
   with no params, parseBeatSellPrefill returns null and the form is
   exactly as it has always been. */

export interface BeatSellPrefill {
  wantsSell: boolean;
  audioUrl?: string;
  title?: string;
  bpm?: number;
  genre?: string;
  musicalKey?: string;
}

export const BEAT_SELL_PREFILL_PARAMS = ["sell", "audioUrl", "title", "bpm", "genre", "key"] as const;

export function beatsSellRoute(prefill: BeatSellPrefill): string {
  const q = new URLSearchParams();
  q.set("sell", "1");
  if (prefill.audioUrl) q.set("audioUrl", prefill.audioUrl);
  if (prefill.title?.trim()) q.set("title", prefill.title.trim());
  if (prefill.bpm != null && Number.isFinite(prefill.bpm)) q.set("bpm", String(Math.round(prefill.bpm)));
  if (prefill.genre?.trim()) q.set("genre", prefill.genre.trim());
  if (prefill.musicalKey?.trim()) q.set("key", prefill.musicalKey.trim());
  return `/beats?${q.toString()}`;
}

/** Parse a /beats location search string into a listing prefill.
    Returns null when no prefill params are present at all. Defensive:
    a blob: audioUrl is refused (it can never play or sell — it belonged
    to another session), titles are length-capped to the form's real
    use, and a bpm outside the form's sane range is dropped, not
    clamped into a wrong listing. */
export function parseBeatSellPrefill(search: string): BeatSellPrefill | null {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return null;
  }
  const hasAny = BEAT_SELL_PREFILL_PARAMS.some((k) => params.has(k));
  if (!hasAny) return null;
  const out: BeatSellPrefill = { wantsSell: params.get("sell") === "1" };
  const audioUrl = params.get("audioUrl")?.trim();
  if (audioUrl && /^https?:\/\//i.test(audioUrl)) out.audioUrl = audioUrl;
  const title = params.get("title")?.trim();
  if (title) out.title = title.slice(0, 200);
  const bpmRaw = params.get("bpm");
  if (bpmRaw != null && bpmRaw.trim() !== "") {
    const bpm = Number(bpmRaw);
    if (Number.isFinite(bpm) && bpm >= 40 && bpm <= 300) out.bpm = Math.round(bpm);
  }
  const genre = params.get("genre")?.trim();
  if (genre) out.genre = genre.slice(0, 40);
  const key = params.get("key")?.trim();
  if (key) out.musicalKey = key.slice(0, 12);
  return out;
}
