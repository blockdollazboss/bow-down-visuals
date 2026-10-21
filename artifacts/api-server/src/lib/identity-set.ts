/* ─── Identity Sets — labeled multi-photo character identity ─────────────
   Higgsfield G4's honest near-term form (NO training anywhere in this
   file): a vault character holds a SET of photos of the same character,
   each labeled by angle / expression / wardrobe. For each shot, this
   module picks the best-matching photo from the set and says WHY in
   plain language — the pick is shown to the creator and can be
   overridden; it is never silent.

   The selection is explainable label-fit scoring over the creator's
   own labels (the dossier's "disciplined reference selection"), not a
   vision model: nothing here claims to see inside a photo. If a vision
   rail is ever approved, the scorer is the seam it replaces.

   Pure functions only — routes wire DB rows in and responses out. */

/** Angle vocabulary for identity photos (stored as text; enforced at
 *  the route by zod). */
export const IDENTITY_ANGLES = [
  "front",
  "three_quarter_left",
  "three_quarter_right",
  "left_profile",
  "right_profile",
  "back",
  "full_body",
  "close_up",
] as const;
export type IdentityAngle = (typeof IDENTITY_ANGLES)[number];

/** Expression vocabulary for identity photos. */
export const IDENTITY_EXPRESSIONS = [
  "neutral",
  "smile",
  "laughing",
  "serious",
  "intense",
  "singing",
  "sad",
  "surprised",
] as const;
export type IdentityExpression = (typeof IDENTITY_EXPRESSIONS)[number];

/** Where a set photo came from. 'generated' photos are admitted only
 *  with the label on and are badged everywhere they appear. */
export const IDENTITY_PHOTO_SOURCES = ["upload", "generated"] as const;
export type IdentityPhotoSource = (typeof IDENTITY_PHOTO_SOURCES)[number];

/** Max identity photos per character (the set view + selection stay
 *  usable; the route enforces it, the UI shows the count). */
export const MAX_IDENTITY_PHOTOS_PER_VAULT = 12;

/** One photo in the selection pool. The vault's existing main photo
 *  joins the pool as a candidate (id "main") so a set of one behaves
 *  exactly like the old single-photo flow. */
export interface IdentityCandidate {
  /** Set-photo row id, or "main" for the vault's main reference photo. */
  id: string;
  imageUrl: string;
  angle: string;
  expression: string;
  wardrobe: string | null;
  source: string;
  isMain: boolean;
}

/** What a shot needs, derived from its scene context. Angle/expression
 *  are ACCEPTABLE-EXACT sets (an orbit shot is equally happy with
 *  either profile), in preference order. */
export interface ShotNeeds {
  angles: IdentityAngle[];
  expression: IdentityExpression | null;
  wardrobe: string | null;
}

export const ANGLE_LABELS: Record<string, string> = {
  front: "front",
  three_quarter_left: "three-quarter (left)",
  three_quarter_right: "three-quarter (right)",
  left_profile: "left profile",
  right_profile: "right profile",
  back: "back",
  full_body: "full-body",
  close_up: "close-up",
};

export const EXPRESSION_LABELS: Record<string, string> = {
  neutral: "neutral",
  smile: "smiling",
  laughing: "laughing",
  serious: "serious",
  intense: "intense",
  singing: "singing",
  sad: "sad",
  surprised: "surprised",
};

export function angleLabel(angle: string): string {
  return ANGLE_LABELS[angle] ?? angle.replace(/_/g, " ");
}

export function expressionLabel(expression: string): string {
  return EXPRESSION_LABELS[expression] ?? expression.replace(/_/g, " ");
}

/** Angles that partially satisfy a need for a given angle (same family:
 *  a three-quarter shot can stand in for a front or its side's profile;
 *  a front can stand in for a close-up). */
const ANGLE_NEIGHBORS: Record<string, string[]> = {
  front: ["three_quarter_left", "three_quarter_right", "close_up"],
  close_up: ["front", "three_quarter_left", "three_quarter_right"],
  three_quarter_left: ["front", "left_profile", "close_up"],
  three_quarter_right: ["front", "right_profile", "close_up"],
  left_profile: ["three_quarter_left"],
  right_profile: ["three_quarter_right"],
  back: ["three_quarter_left", "three_quarter_right"],
  full_body: [],
};

const EXPRESSION_FAMILIES: string[][] = [
  ["smile", "laughing"],
  ["serious", "intense"],
  ["singing"],
  ["sad"],
  ["surprised"],
  ["neutral"],
];

function sameExpressionFamily(a: string, b: string): boolean {
  return EXPRESSION_FAMILIES.some((f) => f.includes(a) && f.includes(b));
}

function wardrobeMatches(photoWardrobe: string | null, wanted: string | null): boolean {
  if (!photoWardrobe || !wanted) return false;
  const a = photoWardrobe.toLowerCase();
  const b = wanted.toLowerCase();
  if (a.includes(b) || b.includes(a)) return true;
  const tokens = (s: string) => s.split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
  const bt = new Set(tokens(b));
  return tokens(a).some((t) => bt.has(t));
}

export interface ScoredCandidate {
  candidate: IdentityCandidate;
  score: number;
  matchedAngle: boolean;
  nearAngle: boolean;
  matchedExpression: boolean;
  nearExpression: boolean;
  matchedWardrobe: boolean;
}

export function scoreIdentityCandidate(c: IdentityCandidate, needs: ShotNeeds): ScoredCandidate {
  let score = 0;
  let matchedAngle = false;
  let nearAngle = false;
  let matchedExpression = false;
  let nearExpression = false;
  let matchedWardrobe = false;

  if (needs.angles.includes(c.angle as IdentityAngle)) {
    score += 50;
    matchedAngle = true;
  } else if (needs.angles.some((a) => (ANGLE_NEIGHBORS[a] ?? []).includes(c.angle))) {
    score += 20;
    nearAngle = true;
  }

  if (needs.expression) {
    if (c.expression === needs.expression) {
      score += 30;
      matchedExpression = true;
    } else if (sameExpressionFamily(c.expression, needs.expression)) {
      score += 12;
      nearExpression = true;
    }
  }

  if (needs.wardrobe && wardrobeMatches(c.wardrobe, needs.wardrobe)) {
    score += 20;
    matchedWardrobe = true;
  }

  return { candidate: c, score, matchedAngle, nearAngle, matchedExpression, nearExpression, matchedWardrobe };
}

export interface IdentitySelection {
  chosen: IdentityCandidate;
  reason: string;
  overridden: boolean;
  /** Every pool photo with its score, best first — the UI renders the
   *  override picker from this list. */
  scored: ScoredCandidate[];
}

/** Pick the reference photo for a shot. `overrideId` ("main" or a
 *  set-photo id) wins unconditionally when it names a pool photo —
 *  the creator's pick is never second-guessed. Ties break toward the
 *  main photo, then pool order (display order). */
export function selectIdentityPhoto(
  pool: IdentityCandidate[],
  needs: ShotNeeds,
  overrideId?: string | null,
): IdentitySelection | null {
  if (pool.length === 0) return null;

  if (overrideId) {
    const picked = pool.find((c) => c.id === overrideId);
    if (picked) {
      return {
        chosen: picked,
        reason: "Your pick — you chose this photo for this shot.",
        overridden: true,
        scored: pool.map((c) => scoreIdentityCandidate(c, needs)),
      };
    }
  }

  const scored = pool.map((c) => scoreIdentityCandidate(c, needs));
  const ranked = [...scored].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.candidate.isMain !== b.candidate.isMain) return a.candidate.isMain ? -1 : 1;
    return pool.indexOf(a.candidate) - pool.indexOf(b.candidate);
  });
  const best = ranked[0]!;
  const chosen = best.candidate;

  let reason: string;
  if (pool.length === 1) {
    reason = "This character has one identity photo, so it anchors the shot — the same as always.";
  } else if (best.matchedAngle && best.matchedExpression) {
    reason = `Picked the ${angleLabel(chosen.angle)} photo (${expressionLabel(chosen.expression)}) — this shot wants a ${angleLabel(needs.angles[0]!)} angle and that expression.`;
  } else if (best.matchedAngle) {
    reason = `Picked the ${angleLabel(chosen.angle)} photo — the best angle match in the set for this shot.`;
  } else if (best.matchedWardrobe) {
    reason = `Picked the photo labeled “${chosen.wardrobe}” — it matches what this shot is wearing.`;
  } else if (best.matchedExpression) {
    reason = `Picked the ${expressionLabel(chosen.expression)} photo — the expression fits this shot's mood.`;
  } else {
    reason = "Closest match in the identity set for this shot.";
  }

  return { chosen, reason, overridden: false, scored: ranked };
}

/* ─── Shot-needs derivation ──────────────────────────────────────────────
   Reads the scene's own words (camera movement, prompt, action, mood)
   for angle/expression cues. Deliberately simple keyword craft — the
   same honesty class as the camera-move planner: it reads text, it
   does not pretend to see the scene. */

interface ShotContext {
  cameraMovement?: string | null;
  promptText?: string | null;
  actionText?: string | null;
  mood?: string | null;
  wardrobeHint?: string | null;
}

export function deriveShotNeeds(ctx: ShotContext): ShotNeeds {
  const text = [ctx.cameraMovement, ctx.promptText, ctx.actionText, ctx.mood]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  let angles: IdentityAngle[] = ["front", "three_quarter_left", "three_quarter_right", "close_up"];
  if (/\b(orbit|360|revolve|arc shot|circle around)\b/.test(text)) {
    angles = ["left_profile", "right_profile", "three_quarter_left", "three_quarter_right"];
  } else if (/\b(from behind|over[- ]the[- ]shoulder|ots|back view|walks away)\b/.test(text)) {
    angles = ["back", "three_quarter_left", "three_quarter_right"];
  } else if (/\b(full body|full-body|wide shot|full length|head to toe)\b/.test(text)) {
    angles = ["full_body", "front"];
  } else if (/\b(close[- ]?up|extreme close|tight shot|face fills)\b/.test(text)) {
    angles = ["close_up", "front"];
  } else if (/\b(profile|side view|side profile)\b/.test(text)) {
    angles = ["left_profile", "right_profile", "three_quarter_left", "three_quarter_right"];
  }

  let expression: IdentityExpression | null = null;
  if (/\b(laugh|laughing|giggle)\b/.test(text)) expression = "laughing";
  else if (/\b(smile|smiling|happy|joyful|grinning)\b/.test(text)) expression = "smile";
  else if (/\b(sing|singing|perform|performing|on stage|concert|mic in hand)\b/.test(text)) expression = "singing";
  else if (/\b(intense|fierce|aggressive)\b/.test(text)) expression = "intense";
  else if (/\b(serious|stern|dramatic|brooding)\b/.test(text)) expression = "serious";
  else if (/\b(sad|melancholy|heartbroken|tears|crying)\b/.test(text)) expression = "sad";
  else if (/\b(surprised|shocked|astonished)\b/.test(text)) expression = "surprised";

  return { angles, expression, wardrobe: ctx.wardrobeHint?.trim() || null };
}

/* ─── Coverage coaching ──────────────────────────────────────────────────
   Tells the creator what the set is missing for reliable consistency,
   in plain language. Guidance, never a gate: an uncovered item never
   blocks a generation. */

export interface CoverageItem {
  key: string;
  label: string;
  covered: boolean;
  /** Plain-language nudge shown when the item is missing. */
  missingMessage: string;
}

export interface IdentityCoverage {
  items: CoverageItem[];
  coveredCount: number;
  totalCount: number;
  /** Every missing item's message, in checklist order. */
  missingMessages: string[];
  summary: string;
}

export function identityCoverage(pool: IdentityCandidate[]): IdentityCoverage {
  const angles = new Set(pool.map((c) => c.angle));
  const expressions = new Set(pool.map((c) => c.expression));

  const items: CoverageItem[] = [
    {
      key: "front",
      label: "Front view",
      covered: angles.has("front"),
      missingMessage: "No front photo yet — a straight-on shot is the anchor every scene builds from.",
    },
    {
      key: "three_quarter",
      label: "Three-quarter angle",
      covered: angles.has("three_quarter_left") || angles.has("three_quarter_right"),
      missingMessage: "No three-quarter angle yet — add one for natural mid-shots.",
    },
    {
      key: "profile",
      label: "Profile (side) angle",
      covered: angles.has("left_profile") || angles.has("right_profile"),
      missingMessage: "No profile angle yet — orbit and side shots hold the face better with one.",
    },
    {
      key: "full_body",
      label: "Full-body shot",
      covered: angles.has("full_body"),
      missingMessage: "No full-body shot yet — wide shots may invent the rest of the outfit.",
    },
    {
      key: "close_up",
      label: "Close-up",
      covered: angles.has("close_up"),
      missingMessage: "No close-up yet — tight shots hold the face better with one.",
    },
    {
      key: "expressions",
      label: "More than one expression",
      covered: expressions.size >= 2,
      missingMessage: "Only one expression so far — add a smile or a serious look so scenes can match the mood.",
    },
  ];

  const coveredCount = items.filter((i) => i.covered).length;
  const missingMessages = items.filter((i) => !i.covered).map((i) => i.missingMessage);
  const summary =
    pool.length === 0
      ? "No identity photos yet — this character still runs on its main photo alone."
      : missingMessages.length === 0
        ? `Full coverage — all ${items.length} identity basics are in the set.`
        : `Identity set covers ${coveredCount} of ${items.length} basics.`;

  return { items, coveredCount, totalCount: items.length, missingMessages, summary };
}
