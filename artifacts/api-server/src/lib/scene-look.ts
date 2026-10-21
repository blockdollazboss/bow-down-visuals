import { z } from "zod";

/* ─── Director's Look Rails — server mirror ────────────────────────────────
   Mirror of the frontend composer in
   artifacts/bow-down-visuals/src/lib/scene-look.ts (vocabularies, phrases,
   tokens, precedence + dedupe rules). The client copy drives Scene
   Studio's prompt composition; this copy drives the improve-prompt
   context, the AI Director route, and locked-pack prompt weaving.
   KEEP THE TWO IN SYNC — both sides pin the exact key lists in tests.

   Rules (identical on both sides):
   - A structured LIGHTING pick is not woven while free-text `lighting`
     says anything; an EMOTION pick is not woven while free-text `mood`
     says anything — the creator's explicit words win.
   - A pick whose signature words already appear in the prompt/free text
     is skipped (conservative dedupe) rather than garbling the prompt.
   - Lens picks are look language for a text prompt, never EXIF claims. */

export type LookRail = "genre" | "era" | "lens" | "lighting" | "emotion";

export const LOOK_RAIL_ORDER: LookRail[] = ["genre", "era", "lens", "lighting", "emotion"];

export interface SceneLookPicks {
  genre?: string;
  era?: string;
  lens?: string;
  lighting?: string;
  emotion?: string;
}

export interface LookOption {
  key: string;
  label: string;
  phrase: string;
  tokens: string[];
}

export const LOOK_GENRE_OPTIONS: LookOption[] = [
  { key: "drama", label: "Drama", phrase: "cinematic drama tone", tokens: ["drama"] },
  { key: "noir", label: "Noir", phrase: "film noir style", tokens: ["noir"] },
  { key: "documentary", label: "Documentary", phrase: "documentary realism", tokens: ["documentary"] },
  { key: "commercial", label: "Commercial", phrase: "polished commercial look", tokens: ["commercial"] },
  { key: "horror", label: "Horror", phrase: "horror atmosphere", tokens: ["horror"] },
  { key: "romance", label: "Romance", phrase: "romantic tone", tokens: ["romantic", "romance"] },
  { key: "action", label: "Action", phrase: "high-energy action feel", tokens: ["action"] },
  { key: "musicVideo", label: "Music Video", phrase: "music-video spectacle", tokens: ["music video", "music-video"] },
];

export const LOOK_ERA_OPTIONS: LookOption[] = [
  { key: "contemporary", label: "Contemporary", phrase: "present-day contemporary styling", tokens: ["contemporary", "present-day", "present day"] },
  { key: "seventies", label: "1970s", phrase: "1970s period styling", tokens: ["1970s"] },
  { key: "eighties", label: "1980s", phrase: "1980s period styling", tokens: ["1980s"] },
  { key: "nineties", label: "1990s", phrase: "1990s period styling", tokens: ["1990s"] },
  { key: "period", label: "Period Piece", phrase: "historical period-piece styling", tokens: ["period piece", "period-piece"] },
  { key: "futuristic", label: "Futuristic", phrase: "near-future futuristic styling", tokens: ["futuristic", "sci-fi"] },
];

export const LOOK_LENS_OPTIONS: LookOption[] = [
  { key: "natural35", label: "35mm Natural", phrase: "35mm lens look with natural perspective", tokens: ["35mm"] },
  { key: "portrait50", label: "50mm Portrait", phrase: "50mm portrait lens look with gentle background separation", tokens: ["50mm"] },
  { key: "tele85", label: "85mm Compression", phrase: "85mm lens look with compressed depth and creamy background blur", tokens: ["85mm"] },
  { key: "wide24", label: "24mm Wide", phrase: "wide 24mm lens look with an expansive frame", tokens: ["24mm"] },
  { key: "anamorphic", label: "Anamorphic", phrase: "anamorphic lens look with horizontal flare and oval bokeh", tokens: ["anamorphic"] },
  { key: "macro", label: "Macro", phrase: "macro lens look with extreme close-up detail", tokens: ["macro"] },
];

export const LOOK_LIGHTING_OPTIONS: LookOption[] = [
  { key: "goldenHour", label: "Golden Hour", phrase: "golden-hour light with warm low sun", tokens: ["golden hour", "golden-hour"] },
  { key: "neonNight", label: "Neon Night", phrase: "neon night light with saturated reflections", tokens: ["neon"] },
  { key: "softWindow", label: "Soft Window", phrase: "soft window light with gentle falloff", tokens: ["window light"] },
  { key: "hardNoon", label: "Hard Noon", phrase: "hard midday sun with crisp shadows", tokens: ["midday", "hard noon"] },
  { key: "candlelit", label: "Candlelit", phrase: "candlelit warmth with flickering low light", tokens: ["candlelit", "candlelight", "candle"] },
  { key: "studioThreePoint", label: "Studio Three-Point", phrase: "studio three-point lighting with clean sculpted light", tokens: ["three-point", "three point", "studio lighting"] },
  { key: "overcast", label: "Overcast", phrase: "overcast daylight with soft even light", tokens: ["overcast"] },
];

export const LOOK_EMOTION_OPTIONS: LookOption[] = [
  { key: "calm", label: "Calm", phrase: "calm, unhurried pacing", tokens: ["calm"] },
  { key: "tense", label: "Tense", phrase: "tense, suspenseful pacing", tokens: ["tense", "suspense"] },
  { key: "euphoric", label: "Euphoric", phrase: "euphoric, joyful energy", tokens: ["euphoric", "joyful"] },
  { key: "melancholic", label: "Melancholic", phrase: "melancholic, wistful mood", tokens: ["melancholic", "melancholy", "wistful"] },
  { key: "urgent", label: "Urgent", phrase: "urgent, driving pace", tokens: ["urgent"] },
];

export const LOOK_RAIL_OPTIONS: Record<LookRail, LookOption[]> = {
  genre: LOOK_GENRE_OPTIONS,
  era: LOOK_ERA_OPTIONS,
  lens: LOOK_LENS_OPTIONS,
  lighting: LOOK_LIGHTING_OPTIONS,
  emotion: LOOK_EMOTION_OPTIONS,
};

/** The exact option keys per rail — pinned identically in the frontend tests. */
export const LOOK_RAIL_KEYS: Record<LookRail, string[]> = {
  genre: LOOK_GENRE_OPTIONS.map((o) => o.key),
  era: LOOK_ERA_OPTIONS.map((o) => o.key),
  lens: LOOK_LENS_OPTIONS.map((o) => o.key),
  lighting: LOOK_LIGHTING_OPTIONS.map((o) => o.key),
  emotion: LOOK_EMOTION_OPTIONS.map((o) => o.key),
};

export function lookOption(rail: LookRail, key: string | undefined): LookOption | null {
  if (!key) return null;
  return LOOK_RAIL_OPTIONS[rail].find((o) => o.key === key) ?? null;
}

export function isLookPick(rail: LookRail, key: unknown): key is string {
  return typeof key === "string" && LOOK_RAIL_OPTIONS[rail].some((o) => o.key === key);
}

const railEnum = (rail: LookRail) => z.enum(LOOK_RAIL_KEYS[rail] as [string, ...string[]]);

/** Zod schema for look picks arriving over the wire (unknown keys rejected by omission). */
export const sceneLookPicksSchema = z.object({
  genre: railEnum("genre").optional(),
  era: railEnum("era").optional(),
  lens: railEnum("lens").optional(),
  lighting: railEnum("lighting").optional(),
  emotion: railEnum("emotion").optional(),
});

/** Filter an unknown value (e.g. AI pack-plan output, stored jsonb) down to
 *  valid picks only. Unknown rails/keys are dropped, never trusted. */
export function normalizeLookPicks(input: unknown): SceneLookPicks {
  if (!input || typeof input !== "object") return {};
  const out: SceneLookPicks = {};
  for (const rail of LOOK_RAIL_ORDER) {
    const value = (input as Record<string, unknown>)[rail];
    if (isLookPick(rail, value)) out[rail] = value;
  }
  return out;
}

/** Structural scene shape the composer needs. */
export interface SceneLookInput {
  aiVideoPrompt?: string | null;
  action?: string | null;
  location?: string | null;
  cameraMovement?: string | null;
  lighting?: string | null;
  mood?: string | null;
  look?: SceneLookPicks | null;
}

export interface LookClause {
  rail: LookRail;
  key: string;
  phrase: string;
}

function tokenAppears(haystackLower: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(haystackLower);
}

const FREE_TEXT_OVERRIDE: Partial<Record<LookRail, "lighting" | "mood">> = {
  lighting: "lighting",
  emotion: "mood",
};

/** Clauses that survive precedence + dedupe for this scene/base text. */
export function applicableLookClauses(scene: SceneLookInput, base: string): LookClause[] {
  const clauses: LookClause[] = [];
  const look = scene.look ?? undefined;
  if (!look) return clauses;

  const haystack = [
    base,
    scene.action ?? "",
    scene.location ?? "",
    scene.cameraMovement ?? "",
    scene.lighting ?? "",
    scene.mood ?? "",
  ]
    .join("\n")
    .toLowerCase();

  for (const rail of LOOK_RAIL_ORDER) {
    const key = look[rail];
    if (!key) continue;
    const option = lookOption(rail, key);
    if (!option) continue;

    const overrideField = FREE_TEXT_OVERRIDE[rail];
    if (overrideField && (scene[overrideField] ?? "").trim()) continue;
    if (option.tokens.some((t) => tokenAppears(haystack, t))) continue;
    clauses.push({ rail, key, phrase: option.phrase });
  }
  return clauses;
}

function weaveClauses(base: string, clauses: LookClause[]): string {
  if (clauses.length === 0) return base;
  const text = clauses.map((c) => c.phrase).join(", ");
  if (!base) return text;
  if (/[.!?]$/.test(base)) return `${base} ${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
  return `${base}, ${text}`;
}

/**
 * Weave a scene's look picks into an already-built base prompt (locked-pack
 * path: the pack's locked prompt is the base; no scene free-text fields, so
 * only dedupe applies). Returns the base untouched when nothing applies.
 */
export function weaveLookIntoPrompt(basePrompt: string, input: SceneLookInput): string {
  const base = (basePrompt ?? "").trim();
  const clauses = applicableLookClauses({ ...input, aiVideoPrompt: base }, base);
  return weaveClauses(base, clauses);
}

/**
 * One-line look summary for the improve-prompt scene context, e.g.
 * "film noir style; 1980s period styling; golden-hour light with warm low sun".
 * Empty when no pick applies (overridden picks are covered by the scene's
 * own Lighting/Mood context lines instead).
 */
export function composeLookContextText(scene: SceneLookInput): string {
  const base =
    (scene.aiVideoPrompt ?? "").trim() ||
    [scene.action, scene.location, scene.cameraMovement, scene.lighting, scene.mood]
      .filter(Boolean)
      .join(", ");
  return applicableLookClauses(scene, base)
    .map((c) => c.phrase)
    .join("; ");
}
