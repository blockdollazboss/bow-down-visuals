/**
 * sound-fit.ts — "Sounds that fit this" discovery + starter-stack builder
 * (pure logic, metadata slice).
 *
 * Fit is computed ONLY from metadata the catalog actually carries:
 *  - beats (the marketplace catalog): bpm + musical_key + genre + mood_tags
 *    as listed by the producer;
 *  - the caller's own songs: bpm + key/Camelot from the DJ analysis rail
 *    (lib/track-analysis.ts via song_dj_analysis), plus the song's genre.
 *
 * METADATA HONESTY (the contract of this module):
 *  - A sound with no BPM or no parseable key is UNANALYSED. It is never
 *    scored, never ranked, and never given an invented key/BPM. Callers
 *    exclude unanalysed items from results and state the coverage.
 *  - Every score ships its breakdown (key / tempo / tag points and the
 *    raw distances), so the UI can explain a fit instead of asserting one.
 *  - This is NOT audio-embedding similarity. Nothing here listens to the
 *    audio; "fit" means key + tempo + tag compatibility, and the UI must
 *    say exactly that.
 *
 * Key compatibility reuses the house Camelot geometry from lib/dj-set.ts
 * (the DJ Set-Prep logic) and the Camelot mapping from
 * lib/track-analysis.ts — one wheel site-wide, never a second copy.
 */
import { bpmDistance, camelotDistance, parseCamelot } from "./dj-set";
import { camelotFor } from "./track-analysis";

/* ── Key parsing ──────────────────────────────────────────────────────── */

export interface ParsedKey {
  /** Pitch class 0–11 (0 = C). */
  root: number;
  mode: "major" | "minor";
  /** Display label, e.g. "A minor". */
  label: string;
  /** Camelot wheel code, e.g. "8A". */
  camelot: string;
}

const NOTE_TO_PC: Record<string, number> = {
  C: 0, "B#": 0, "C#": 1, DB: 1, D: 2, "D#": 3, EB: 3, E: 4, FB: 4,
  "E#": 5, F: 5, "F#": 6, GB: 6, G: 7, "G#": 8, AB: 8, A: 9, "A#": 10,
  BB: 10, B: 11, CB: 11,
};
const PC_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** Camelot code → key, by inverting camelotFor over all 24 keys. */
const CAMELOT_TO_KEY = new Map<string, ParsedKey>();
for (let root = 0; root < 12; root++) {
  for (const mode of ["major", "minor"] as const) {
    const camelot = camelotFor(root, mode);
    CAMELOT_TO_KEY.set(camelot, {
      root,
      mode,
      label: `${PC_NAMES[root]} ${mode}`,
      camelot,
    });
  }
}

export function keyFromCamelot(code: string | null | undefined): ParsedKey | null {
  if (!code) return null;
  return CAMELOT_TO_KEY.get(code.trim().toUpperCase()) ?? null;
}

/**
 * Parse a free-text musical key as producers actually type it on beat
 * listings and sample-pack forms: "C min", "F# maj", "Am", "A minor",
 * "Eb", "8A". Returns null when the text carries no readable key —
 * the caller treats that as unanalysed, never as a guess.
 */
export function parseMusicalKey(input: string | null | undefined): ParsedKey | null {
  if (!input) return null;
  const raw = input.trim();
  if (!raw) return null;
  const camelot = parseCamelot(raw.toUpperCase());
  if (camelot) return keyFromCamelot(`${camelot.num}${camelot.side}`);
  const m = /^([A-Ga-g])([#b]?)\s*(.*)$/.exec(raw);
  if (!m) return null;
  const note = `${m[1]!.toUpperCase()}${(m[2] ?? "").toUpperCase()}`;
  const root = NOTE_TO_PC[note];
  if (root === undefined) return null;
  const rest = (m[3] ?? "").trim().toLowerCase();
  let mode: "major" | "minor";
  if (rest === "" || rest.startsWith("maj") || rest === "major") mode = "major";
  else if (rest === "m" || rest.startsWith("min") || rest === "minor") mode = "minor";
  else return null; // e.g. "C dorian" — a real mode we do not map; honest null
  return {
    root,
    mode,
    label: `${PC_NAMES[root]} ${mode}`,
    camelot: camelotFor(root, mode),
  };
}

/* ── Fit profiles ─────────────────────────────────────────────────────── */

export interface FitProfile {
  bpm: number | null;
  camelot: string | null;
  keyLabel: string | null;
  genre: string | null;
  tags: string[];
}

/** Analysed = BOTH a tempo and a key the data supports. Anything less
 *  is unanalysed and must be excluded from fit results. */
export function isAnalysed(p: FitProfile): boolean {
  return p.bpm != null && Number.isFinite(p.bpm) && p.camelot != null && parseCamelot(p.camelot) != null;
}

function norm(s: string): string {
  return s.trim().toLowerCase();
}

export interface FitScore {
  /** 0–100 total. */
  score: number;
  keyPoints: number;
  bpmPoints: number;
  tagPoints: number;
  /** Camelot distance 0–3 (house geometry). */
  keyDistance: number;
  /** Effective BPM gap, half/double-time aware. */
  bpmGap: number;
  sharedTags: string[];
  genreMatch: boolean;
  /** Plain-language explanations, ready for the UI. */
  reasons: string[];
}

/**
 * Score how well `candidate` fits `source`. Returns null when either
 * side is unanalysed — there is no honest score without both keys and
 * both tempos, and this function never manufactures one.
 */
export function scoreFit(source: FitProfile, candidate: FitProfile): FitScore | null {
  if (!isAnalysed(source) || !isAnalysed(candidate)) return null;
  const keyDistance = camelotDistance(source.camelot!, candidate.camelot!);
  const keyPoints = keyDistance === 0 ? 50 : keyDistance === 1 ? 40 : keyDistance === 2 ? 18 : 0;

  const bpmGap = Math.round(bpmDistance(source.bpm!, candidate.bpm!) * 10) / 10;
  const bpmPoints =
    bpmGap === 0 ? 30 : bpmGap <= 2 ? 27 : bpmGap <= 4 ? 23 : bpmGap <= 6 ? 19
    : bpmGap <= 10 ? 13 : bpmGap <= 15 ? 7 : bpmGap <= 25 ? 3 : 0;

  const genreMatch =
    source.genre != null && candidate.genre != null && norm(source.genre) === norm(candidate.genre);
  const candTags = new Set(candidate.tags.map(norm));
  const sharedTags = source.tags.map(norm).filter((t) => t && candTags.has(t));
  const tagPoints = (genreMatch ? 10 : 0) + Math.min(10, sharedTags.length * 5);

  const reasons: string[] = [];
  reasons.push(
    keyDistance === 0
      ? `Same key (${candidate.camelot}) — seamless blend`
      : keyDistance === 1
        ? `Harmonic step (${source.camelot} → ${candidate.camelot}) — smooth`
        : keyDistance === 2
          ? `Two keys apart (${source.camelot} → ${candidate.camelot}) — workable with a longer blend`
          : `Key jump (${source.camelot} → ${candidate.camelot}) — plan a transition`,
  );
  reasons.push(
    bpmGap === 0
      ? `Same tempo (${candidate.bpm} BPM)`
      : `Tempo ${bpmGap} BPM apart (${source.bpm} → ${candidate.bpm} BPM, half/double-time aware)`,
  );
  if (genreMatch) reasons.push(`Same genre (${candidate.genre})`);
  if (sharedTags.length > 0) reasons.push(`Shared tags: ${sharedTags.join(", ")}`);

  return {
    score: keyPoints + bpmPoints + tagPoints,
    keyPoints,
    bpmPoints,
    tagPoints,
    keyDistance,
    bpmGap,
    sharedTags,
    genreMatch,
    reasons,
  };
}

/* ── Layer roles (metadata-derived, labelled as such) ─────────────────── */

export type StackRole = "drums" | "bass" | "melodic" | "full";

const ROLE_KEYWORDS: Array<{ role: Exclude<StackRole, "full">; terms: string[] }> = [
  { role: "bass", terms: ["bass", "808", "sub bass", "subbass", "reese"] },
  { role: "drums", terms: ["drum", "kick", "snare", "clap", "hi-hat", "hihat", "hat", "perc", "shaker"] },
  { role: "melodic", terms: ["melod", "piano", "keys", "synth", "pluck", "guitar", "chord", "arp", "lead", "loop"] },
];

export interface RoleGuess {
  role: StackRole;
  /** The listing word that produced the role, or null for "full". The UI
   *  labels roles as read from the listing's own title/tags — never as
   *  something heard in the audio. */
  matchedTerm: string | null;
}

/** Classify a catalog item's layer role from its OWN listing metadata
 *  (title + tags). No keyword → "full" (a complete beat/track, usable as
 *  the stack's foundation). This reads words, not audio. */
export function classifyRole(title: string, tags: string[]): RoleGuess {
  const hay = `${title} ${tags.join(" ")}`.toLowerCase();
  for (const { role, terms } of ROLE_KEYWORDS) {
    for (const term of terms) {
      if (hay.includes(term)) return { role, matchedTerm: term };
    }
  }
  return { role: "full", matchedTerm: null };
}

/* ── Candidates + ranking ─────────────────────────────────────────────── */

export interface FitCandidate extends FitProfile {
  kind: "beat" | "song";
  id: string;
  title: string;
  audioUrl: string;
  /** Beat marketplace prices in cents, exactly as listed (null for songs). */
  basicPriceCents: number | null;
}

export interface RankedFit extends FitCandidate {
  fit: FitScore;
  role: RoleGuess;
}

/** Rank analysed candidates by fit. Unanalysed candidates are dropped
 *  here — by design there is no path that scores one. */
export function rankFits(source: FitProfile, candidates: FitCandidate[], limit = 24): RankedFit[] {
  const ranked: RankedFit[] = [];
  for (const c of candidates) {
    const fit = scoreFit(source, c);
    if (!fit) continue;
    ranked.push({ ...c, fit, role: classifyRole(c.title, c.tags) });
  }
  ranked.sort((a, b) => b.fit.score - a.fit.score || a.title.localeCompare(b.title));
  return ranked.slice(0, Math.max(0, limit));
}

/* ── Starter stack ────────────────────────────────────────────────────── */

/** Two sounds mutually fit when their keys are a smooth Camelot move
 *  (distance ≤ 1) and their tempos sit within 8 BPM (half/double aware). */
export function mutuallyFit(a: FitProfile, b: FitProfile): boolean {
  if (!isAnalysed(a) || !isAnalysed(b)) return false;
  return camelotDistance(a.camelot!, b.camelot!) <= 1 && bpmDistance(a.bpm!, b.bpm!) <= 8;
}

export interface StackSlot {
  role: StackRole;
  item: RankedFit;
}

export interface MissingSlot {
  role: StackRole;
  reason: string;
}

export interface StarterStack {
  slots: StackSlot[];
  missing: MissingSlot[];
  /** Sample-pack generation parameters that would fill the missing
   *  layer slots in the source's own key/tempo/genre, via the existing
   *  Sample Pack Generator rail. Null when the source itself lacks the
   *  metadata to aim that rail (never aimed blind). */
  fillSuggestion: { genre: string | null; bpm: number; musicalKey: string } | null;
}

const LAYER_ROLES: Array<Exclude<StackRole, "full">> = ["drums", "bass", "melodic"];

/**
 * Assemble a starter stack around the source: one drums, one bass and
 * one melodic layer that each fit the source AND each other, plus the
 * best-fitting full beat/track as a foundation when one exists.
 * A slot with no mutually-fitting analysed candidate stays MISSING with
 * the reason stated — a clashing sound is never substituted to fill it.
 */
export function buildStarterStack(source: FitProfile & { keyRootName?: string }, candidates: FitCandidate[]): StarterStack {
  const ranked = rankFits(source, candidates, candidates.length);
  const picked: RankedFit[] = [];
  const slots: StackSlot[] = [];
  const missing: MissingSlot[] = [];

  for (const role of LAYER_ROLES) {
    const inRole = ranked.filter((r) => r.role.role === role);
    if (inRole.length === 0) {
      missing.push({ role, reason: `No analysed ${role} sound in the catalog yet — nothing was substituted.` });
      continue;
    }
    const chosen = inRole.find(
      (r) => mutuallyFit(source, r) && picked.every((p) => mutuallyFit(p, r)),
    );
    if (!chosen) {
      missing.push({
        role,
        reason: `${inRole.length} analysed ${role} sound(s) exist, but none fits the source and the layers already picked — the slot is left empty rather than filled with a clash.`,
      });
      continue;
    }
    picked.push(chosen);
    slots.push({ role, item: chosen });
  }

  const foundation = ranked.find(
    (r) =>
      r.role.role === "full" &&
      mutuallyFit(source, r) &&
      picked.every((p) => mutuallyFit(p, r)),
  );
  if (foundation) slots.push({ role: "full", item: foundation });

  let fillSuggestion: StarterStack["fillSuggestion"] = null;
  if (missing.length > 0 && source.bpm != null && source.camelot) {
    const key = keyFromCamelot(source.camelot);
    if (key) {
      fillSuggestion = {
        genre: source.genre,
        bpm: source.bpm,
        musicalKey: PC_NAMES[key.root]!,
      };
    }
  }
  return { slots, missing, fillSuggestion };
}

/** Coverage accounting for the honesty line: how much of the catalog
 *  actually carries analysable key+BPM metadata. */
export function coverageOf(items: FitProfile[]): { total: number; analysed: number; unanalysed: number } {
  const analysed = items.filter(isAnalysed).length;
  return { total: items.length, analysed, unanalysed: items.length - analysed };
}
