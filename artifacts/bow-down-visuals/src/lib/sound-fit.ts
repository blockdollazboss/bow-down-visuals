/* ─── Sound-Fit Discovery — frontend helpers ─────────────────────────────
   Pure parsing/formatting for the SoundFitPanel (docked in the Audio
   Studio Sound Library tab and on the Beats catalog page). The fit math
   lives server-side (lib/sound-fit on the API); these helpers only shape
   what the API returns and build the requests — they never compute or
   invent a key, BPM, or score on the client. */

export interface SoundFitSourceBeat { kind: "beat"; id: string }
export interface SoundFitSourceSong { kind: "song"; id: string }
export interface SoundFitSourceCustom {
  kind: "custom";
  title?: string;
  bpm: number;
  musicalKey: string;
  genre?: string;
  tags?: string[];
}
export type SoundFitSource = SoundFitSourceBeat | SoundFitSourceSong | SoundFitSourceCustom;

export interface SoundFitItem {
  kind: "beat" | "song";
  id: string;
  title: string;
  audioUrl: string;
  bpm: number | null;
  keyLabel: string | null;
  camelot: string | null;
  genre: string | null;
  tags: string[];
  basicPriceCents: number | null;
  role: { role: "drums" | "bass" | "melodic" | "full"; matchedTerm: string | null };
  fit: {
    score: number;
    keyPoints: number;
    bpmPoints: number;
    tagPoints: number;
    keyDistance: number;
    bpmGap: number;
    sharedTags: string[];
    genreMatch: boolean;
    reasons: string[];
  };
}

export interface SoundFitCoverage {
  total: number;
  analysed: number;
  unanalysed: number;
  beats: { total: number; analysed: number; unanalysed: number };
  ownSongs: { total: number; analysed: number; unanalysed: number };
}

export interface SoundFitResponse {
  source: { label: string; bpm: number | null; camelot: string | null; keyLabel: string | null; genre: string | null; tags: string[] };
  method: string;
  coverage: SoundFitCoverage;
  results: SoundFitItem[];
}

export interface SoundFitStackResponse {
  source: SoundFitResponse["source"];
  method: string;
  coverage: SoundFitCoverage;
  stack: {
    slots: Array<{ role: SoundFitItem["role"]["role"]; item: SoundFitItem }>;
    missing: Array<{ role: string; reason: string }>;
    fillSuggestion: { genre: string | null; bpm: number; musicalKey: string } | null;
  };
}

/** Parse an API payload into a SoundFitResponse, or null when the shape
 *  is not what the route promises (never render a half-invented result). */
export function parseFitResponse(payload: unknown): SoundFitResponse | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (!Array.isArray(p["results"]) || !p["coverage"] || typeof p["coverage"] !== "object") return null;
  return payload as SoundFitResponse;
}

export function parseStackResponse(payload: unknown): SoundFitStackResponse | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const stack = p["stack"] as Record<string, unknown> | undefined;
  if (!stack || !Array.isArray(stack["slots"]) || !Array.isArray(stack["missing"])) return null;
  return payload as SoundFitStackResponse;
}

/** The honest coverage line, e.g. "6 of 10 sounds analysed — the rest
 *  are hidden from fit results, not guessed." */
export function coverageLine(c: SoundFitCoverage): string {
  return `${c.analysed} of ${c.total} sounds analysed`;
}

/** Beat price exactly as listed (basic tier, cents) — never recomputed. */
export function listedPrice(item: Pick<SoundFitItem, "kind" | "basicPriceCents">): string | null {
  if (item.kind !== "beat" || item.basicPriceCents == null) return null;
  return `Basic license $${(item.basicPriceCents / 100).toFixed(2)} — as listed`;
}

/** Audio Studio deep-link (the house protocol: ?tab=master&audioUrl=…
 *  pre-loads the master slot, same as GenerationResult uses). */
export function studioUrlFor(item: Pick<SoundFitItem, "audioUrl">): string {
  return `/audio-studio?tab=master&audioUrl=${encodeURIComponent(item.audioUrl)}`;
}

export const ROLE_LABELS: Record<SoundFitItem["role"]["role"], string> = {
  drums: "Drums",
  bass: "Bass",
  melodic: "Melodic",
  full: "Full beat / foundation",
};
