/* ─── Director's Look Rails ────────────────────────────────────────────────
   Structured scene-look controls (genre / era / lens / lighting / emotion)
   for Scene Studio, beside the free-text cameraMovement / lighting / mood
   fields. Picks are woven into the generation prompt through ONE shared
   composer (composeScenePrompt / composeSceneSeedPrompt below) — the same
   comma-weave path the free-text fields have always used, extended, never
   a parallel prompt builder.

   Rules the composer guarantees:
   - NO picks (or every pick suppressed) → the prompt is byte-identical to
     what Scene Studio produced before the rails existed.
   - The creator's explicit free text WINS: a structured LIGHTING pick is
     not woven while the free-text `lighting` field says anything, and an
     EMOTION pick is not woven while free-text `mood` says anything.
   - Conservative dedupe: a pick whose signature words already appear in
     the prompt or free text is skipped instead of garbling the prompt
     with a near-duplicate.
   - Lens picks are LOOK language ("85mm lens look…") woven into a text
     prompt — never an EXIF / camera-metadata claim.

   The API server carries a mirror of these vocabularies + composer in
   artifacts/api-server/src/lib/scene-look.ts (improve-prompt context,
   the AI Director route, locked-pack weaving). Keep the two in sync —
   both sides pin the exact key lists in tests. */

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
  /** Prose fragment woven into the generation prompt. */
  phrase: string;
  /** Signature words: if any already appears (word-bounded) in the prompt
   *  or free text, the pick is treated as already expressed and skipped. */
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

export const LOOK_RAIL_TITLES: Record<LookRail, string> = {
  genre: "Genre",
  era: "Era",
  lens: "Lens Look",
  lighting: "Lighting",
  emotion: "Emotion / Tempo",
};

/** The exact option keys per rail — pinned identically in the server mirror's tests. */
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

/** Structural scene shape the composer needs (avoids a scene-parser import cycle). */
export interface SceneLookInput {
  aiVideoPrompt?: string | null;
  action?: string | null;
  location?: string | null;
  cameraMovement?: string | null;
  lighting?: string | null;
  mood?: string | null;
  look?: SceneLookPicks | null;
}

/** The pre-rails base prompt: the scene's own prompt, or the comma-joined
 *  fallback of its detail fields. Exactly what Scene Studio used before. */
export function legacySceneBasePrompt(scene: SceneLookInput): string {
  return (
    (scene.aiVideoPrompt ?? "").trim() ||
    [scene.action, scene.location, scene.cameraMovement, scene.lighting, scene.mood]
      .filter(Boolean)
      .join(", ")
  );
}

export interface LookClause {
  rail: LookRail;
  key: string;
  phrase: string;
}

export interface SuppressedLookPick {
  rail: LookRail;
  key: string;
  reason: "free-text" | "already-in-prompt";
}

function tokenAppears(haystackLower: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(haystackLower);
}

/** Free-text precedence: which rail a scene field overrides, if it says anything. */
const FREE_TEXT_OVERRIDE: Partial<Record<LookRail, "lighting" | "mood">> = {
  lighting: "lighting",
  emotion: "mood",
};

function evaluatePicks(scene: SceneLookInput, base: string): { clauses: LookClause[]; suppressed: SuppressedLookPick[] } {
  const clauses: LookClause[] = [];
  const suppressed: SuppressedLookPick[] = [];
  const look = scene.look ?? undefined;
  if (!look) return { clauses, suppressed };

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
    if (!option) continue; // unknown key from old data — ignored, never woven

    const overrideField = FREE_TEXT_OVERRIDE[rail];
    if (overrideField && (scene[overrideField] ?? "").trim()) {
      suppressed.push({ rail, key, reason: "free-text" });
      continue;
    }
    if (option.tokens.some((t) => tokenAppears(haystack, t))) {
      suppressed.push({ rail, key, reason: "already-in-prompt" });
      continue;
    }
    clauses.push({ rail, key, phrase: option.phrase });
  }
  return { clauses, suppressed };
}

/** The look clauses that will actually be woven for this scene, in rail order.
 *  Evaluated against the same default-filled base composeScenePrompt uses,
 *  so what the UI promises is exactly what generation sends. */
export function applicableLookClauses(scene: SceneLookInput): LookClause[] {
  return evaluatePicks(scene, legacySceneBasePrompt(scene) || DEFAULT_FINAL_PROMPT).clauses;
}

/** Picks that are set but will NOT be woven, with the honest reason. */
export function suppressedLookPicks(scene: SceneLookInput): SuppressedLookPick[] {
  return evaluatePicks(scene, legacySceneBasePrompt(scene) || DEFAULT_FINAL_PROMPT).suppressed;
}

function weaveClauses(base: string, clauses: LookClause[]): string {
  if (clauses.length === 0) return base;
  const text = clauses.map((c) => c.phrase).join(", ");
  if (!base) return text;
  if (/[.!?]$/.test(base)) return `${base} ${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
  return `${base}, ${text}`;
}

const DEFAULT_FINAL_PROMPT = "cinematic music video scene, dramatic lighting, luxury aesthetic";

/**
 * THE shared composer for the prompt actually sent to generation.
 * Byte-identical to the pre-rails buildFinalPrompt when no pick applies.
 */
export function composeScenePrompt(scene: SceneLookInput): string {
  const base = legacySceneBasePrompt(scene) || DEFAULT_FINAL_PROMPT;
  const { clauses } = evaluatePicks(scene, base);
  return weaveClauses(base, clauses);
}

/** The improve-prompt seed: same weave, no default fill (mirrors sceneSeedPrompt). */
export function composeSceneSeedPrompt(scene: SceneLookInput): string {
  const base = legacySceneBasePrompt(scene);
  const { clauses } = evaluatePicks(scene, base);
  return weaveClauses(base, clauses);
}

/**
 * Apply an AI Director proposal to the current picks for the rails the
 * creator explicitly accepted. Pure: never mutates, never applies a rail
 * that wasn't accepted, and an empty acceptance returns the current picks.
 */
export function applyLookProposal(
  current: SceneLookPicks | null | undefined,
  proposal: SceneLookPicks,
  acceptedRails: Iterable<LookRail>,
): SceneLookPicks {
  const next: SceneLookPicks = { ...(current ?? {}) };
  for (const rail of acceptedRails) {
    const key = proposal[rail];
    if (key && isLookPick(rail, key)) next[rail] = key;
  }
  return next;
}
