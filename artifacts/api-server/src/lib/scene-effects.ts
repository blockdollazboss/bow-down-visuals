/**
 * Viral Effects — generation-time effect recipes for Scene Studio.
 *
 * Higgsfield's acquisition hook is 250+ named VFX presets applied AT
 * GENERATION (dossier: competitor-study/higgsfield.md, G7). Bow Down's
 * rails take direction as prompt craft, so our recipes are exactly that:
 * each recipe is a real, tested prompt construction (plus the reference
 * frames it honestly needs) woven into the scene prompt at generation
 * time — never a label over nothing. Recipes ride the existing clip
 * generation charge; picking an effect adds no charge of its own.
 *
 * Pure + dependency-free (same discipline as clip-pricing.ts) so the
 * library, the camera-conflict rule, and the trend matcher can all be
 * unit-tested without the server.
 */

/* ─── Types ─────────────────────────────────────────────────────────────── */

/** What a recipe honestly needs to land: a reference (start) frame, an
 *  end-frame look to land on, both, or nothing beyond the prompt. */
export type EffectNeeds = "none" | "start-frame" | "end-frame" | "both";

export type EffectEnergy = "calm" | "punchy" | "wild";

export interface EffectRecipe {
  id: string;
  name: string;
  category: string;
  /** Plain-language "best for" line shown on the effect card. */
  bestFor: string;
  /** The actual prompt construction woven into the generation prompt. */
  weave: string;
  needs: EffectNeeds;
  /** Canonical camera moves this effect physically fights (see
   *  CAMERA_MOVE_KEYWORDS). Conservative by design: only pairings where
   *  the two directions contradict each other are listed. */
  conflictsWithMoves: CanonicalMove[];
  /** What the camera must do for the effect to work — used to explain a
   *  conflict in plain language. Required whenever conflictsWithMoves
   *  is non-empty (pinned by tests). */
  cameraNeed?: string;
  /** Format/content tags the trend matcher scores against scene text and
   *  trend-predictor signals. */
  trendTags: string[];
  energy: EffectEnergy;
}

/** Canonical camera moves recognized by the conflict rule. The first five
 *  are the Wave 9D planner's enum; the rest cover the free-text camera
 *  directions creators write on scenes. */
export type CanonicalMove =
  | "dolly-in"
  | "orbit"
  | "crane-up"
  | "handheld"
  | "static-wide"
  | "whip-pan"
  | "tracking"
  | "aerial";

/** Effects stack like Higgsfield's presets, capped at 2 so the woven
 *  prompt stays coherent and inside the models' prompt caps. */
export const MAX_STACKED_EFFECTS = 2;

/* ─── Recipe library (24) ───────────────────────────────────────────────── */

export const EFFECT_RECIPES: EffectRecipe[] = [
  /* ── Reveal & Scale ── */
  {
    id: "earth-zoom-out",
    name: "Earth Zoom Out",
    category: "Reveal & Scale",
    bestFor: "Opening a location or an act — starts on you, ends showing the whole world around you.",
    weave:
      "One impossible continuous pull-back: the camera starts tight on the subject, then zooms out seamlessly — the street, the block, the neighborhood, the whole city falls away below — ending on a sweeping aerial view. Smooth accelerating retreat, no cuts, the subject stays centered and in focus the whole way out.",
    needs: "start-frame",
    conflictsWithMoves: ["dolly-in", "static-wide"],
    cameraNeed: "the camera to pull back continuously, farther and farther",
    trendTags: ["zoom out", "reveal", "location", "travel", "epic", "scale", "drone", "aerial", "opening"],
    energy: "punchy",
  },
  {
    id: "dollhouse-miniature",
    name: "Dollhouse Miniature",
    category: "Reveal & Scale",
    bestFor: "A whimsical angle — the set becomes a tiny model world with the performer inside it.",
    weave:
      "A tilt-shift miniature effect: the scene reads as a tiny handcrafted dollhouse set — shallow focus bands at the top and bottom of frame, slightly sped-up toy-like motion in the background, saturated model-paint colors — while the subject performs at the center of the miniature world.",
    needs: "none",
    conflictsWithMoves: [],
    trendTags: ["miniature", "tilt shift", "cute", "tiny", "dollhouse", "whimsical"],
    energy: "calm",
  },

  /* ── Camera Energy ── */
  {
    id: "bullet-time-freeze",
    name: "Bullet-Time Freeze Arc",
    category: "Camera Energy",
    bestFor: "A big action beat — a jump, a hair flip, a mic drop — frozen while the camera orbits it.",
    weave:
      "At the peak of the action the motion freezes completely — the subject suspended mid-gesture, hair and fabric hanging in the air — while the camera arcs smoothly around the frozen subject in a half-circle. On the final beat the action snaps back to full speed and completes.",
    needs: "start-frame",
    conflictsWithMoves: ["static-wide", "handheld", "whip-pan"],
    cameraNeed: "to arc smoothly around the frozen action",
    trendTags: ["freeze", "bullet time", "matrix", "action", "slow motion", "hero", "suspended"],
    energy: "wild",
  },
  {
    id: "crash-zoom-snap",
    name: "Crash Zoom Snap",
    category: "Camera Energy",
    bestFor: "A punchline, a reveal, or a lyric that needs to land right in the viewer's face.",
    weave:
      "A violent crash zoom: from the wide shot the camera rockets straight into an extreme close-up of the subject's face in a fraction of a second, landing with a subtle impact shake, then holds the intense close-up. One snap, exactly on the key word.",
    needs: "none",
    conflictsWithMoves: ["static-wide"],
    cameraNeed: "a fast, aggressive camera move",
    trendTags: ["crash zoom", "punch in", "comedy", "reveal", "reaction", "close-up"],
    energy: "wild",
  },
  {
    id: "speed-ramp-burst",
    name: "Speed-Ramp Burst",
    category: "Camera Energy",
    bestFor: "A signature move — a spin, a strike, a jump — that deserves slow-mo worship, then a burst.",
    weave:
      "Time itself ramps: the action begins in smooth slow motion, then bursts to four-times speed through the middle of the move, then settles back into slow motion for the landing. The ramp follows the move — never random — with motion blur that matches each speed.",
    needs: "none",
    conflictsWithMoves: [],
    trendTags: ["speed ramp", "slow motion", "burst", "dance", "sports", "spin"],
    energy: "punchy",
  },
  {
    id: "hyperlapse-rush",
    name: "Hyperlapse Rush",
    category: "Camera Energy",
    bestFor: "Crossing a location at impossible speed — entrances, travel days, pure city energy.",
    weave:
      "A hyperlapse rush: the camera hurtles forward through the location at impossible speed, the world streaking past in motion blur while the subject stays sharp and centered, time compressing around them — doorways, streets, and crowds flashing by in one continuous surge.",
    needs: "start-frame",
    conflictsWithMoves: ["static-wide", "orbit"],
    cameraNeed: "to travel forward through the location at speed",
    trendTags: ["hyperlapse", "travel", "rush", "city", "journey", "fast"],
    energy: "wild",
  },
  {
    id: "spin-whip-360",
    name: "360 Spin Whip",
    category: "Camera Energy",
    bestFor: "A scene-change inside one shot — the spin hides the cut and lands somewhere new.",
    weave:
      "The camera whips into a full 360-degree spin around the subject, the frame blurring into a circular streak at peak speed — and as the spin settles, the scene has transformed: new backdrop, new light, same subject, same pose, one unbroken rotation.",
    needs: "none",
    conflictsWithMoves: ["static-wide", "handheld"],
    cameraNeed: "a full, clean camera rotation",
    trendTags: ["spin", "whip", "transition", "360", "scene change"],
    energy: "wild",
  },

  /* ── Transformations ── */
  {
    id: "morph-transition",
    name: "Morph Transition",
    category: "Transformations",
    bestFor: "Turning one look, place, or version of you into another inside a single unbroken shot.",
    weave:
      "A seamless morph: mid-motion, the subject's look flows and reshapes into the end-frame state — outfit, styling, and surroundings melt continuously from the start frame into the end frame with no cut. Identity and face stay exactly the same person throughout the transformation.",
    needs: "both",
    conflictsWithMoves: [],
    trendTags: ["morph", "transformation", "before after", "makeover", "evolution"],
    energy: "punchy",
  },
  {
    id: "clone-multiply",
    name: "Clone Multiply",
    category: "Transformations",
    bestFor: "Filling the frame with synchronized copies of the performer — instant dance-team energy.",
    weave:
      "The performer splits into multiple identical clones of themselves, each copy stepping out from the original in sync, until a formation of identical performers fills the frame — all moving in perfect unison, same face, same outfit, same energy.",
    needs: "start-frame",
    conflictsWithMoves: [],
    trendTags: ["clones", "multiply", "dance formation", "twins", "synchronized"],
    energy: "punchy",
  },
  {
    id: "glitch-disintegration",
    name: "Glitch Disintegration",
    category: "Transformations",
    bestFor: "A hard beat drop or a glitchy digital track — the performer breaks apart and snaps back.",
    weave:
      "On the beat, the subject's edges fracture into digital glitch blocks — pixel-sorting streaks, RGB channel splits, and datamosh smears tear across the body — then snap cleanly back together into a sharp, solid image. One hit per musical accent, never random noise between beats.",
    needs: "none",
    conflictsWithMoves: [],
    trendTags: ["glitch", "disintegrate", "digital", "edm", "datamosh", "break apart"],
    energy: "wild",
  },
  {
    id: "particle-dissolve",
    name: "Particle Dissolve",
    category: "Transformations",
    bestFor: "An emotional exit or a dreamy chorus — the performer dissolves into drifting light.",
    weave:
      "The subject's outline softens into thousands of glowing gold particles that lift and drift away on a gentle current of air, the body dissolving from the edges inward — then the particles stream back and reform the subject, whole and solid, in the same pose.",
    needs: "none",
    conflictsWithMoves: [],
    trendTags: ["dissolve", "particles", "gold dust", "emotional", "ballad", "dreamy"],
    energy: "calm",
  },
  {
    id: "outfit-swap-flash",
    name: "Outfit Swap Flash",
    category: "Transformations",
    bestFor: "A fashion switch mid-spin — the end-frame look is the new outfit; the flash hides the change.",
    weave:
      "Mid-spin, a bright flash-frame bursts across the shot and the performer's outfit instantly swaps to the look in the end frame — same spin, same pose, new fit. The change lands exactly on the flash, sharp and clean, like a runway quick-change.",
    needs: "end-frame",
    conflictsWithMoves: [],
    trendTags: ["outfit change", "fashion", "quick change", "transition", "spin", "style"],
    energy: "punchy",
  },

  /* ── Beat Moments ── */
  {
    id: "beat-drop-freeze",
    name: "Beat-Drop Freeze",
    category: "Beat Moments",
    bestFor: "The exact frame the drop hits — everything stops for one breath, then slams back.",
    weave:
      "On the exact frame of the beat drop, the entire scene freezes solid — subject, hair, fabric, background, all motion stopped for one held breath — then everything slams back into full-speed motion together. The freeze is total and the release is instant.",
    needs: "none",
    conflictsWithMoves: [],
    trendTags: ["freeze", "drop", "beat", "impact", "stop motion"],
    energy: "punchy",
  },
  {
    id: "reverse-unfold",
    name: "Reverse Unfold",
    category: "Beat Moments",
    bestFor: "A satisfying build — scattered pieces fly together into the finished look or set.",
    weave:
      "The shot plays in reverse: scattered pieces — props, confetti, set dressing, outfit elements — fly backward through the air and assemble themselves into the finished scene around the subject, ending on the polished final frame as if time ran backward into perfection.",
    needs: "none",
    conflictsWithMoves: [],
    trendTags: ["reverse", "rewind", "satisfying", "assemble", "reveal"],
    energy: "punchy",
  },
  {
    id: "mirror-split-duet",
    name: "Mirror Split Duet",
    category: "Beat Moments",
    bestFor: "Performing with yourself — a call-and-response duet across a mirror line.",
    weave:
      "The frame splits down a clean vertical mirror line: on one side the performer sings the line, on the mirrored side their reflection performs the answer — same person, mirrored movement, choreographed call-and-response across the seam. The seam stays invisible except for the mirrored motion.",
    needs: "start-frame",
    conflictsWithMoves: [],
    trendTags: ["mirror", "duet", "split screen", "symmetry", "call and response"],
    energy: "punchy",
  },
  {
    id: "gravity-flip",
    name: "Gravity Flip",
    category: "Beat Moments",
    bestFor: "A surreal wow moment — the whole world turns upside down mid-shot.",
    weave:
      "Mid-shot, gravity flips: the entire world rotates 180 degrees around the subject — floor becomes ceiling, loose objects and hair fall upward — and the subject lands gracefully on the ceiling, continuing the performance upside down as if nothing unusual happened.",
    needs: "start-frame",
    conflictsWithMoves: [],
    trendTags: ["gravity", "flip", "upside down", "surreal", "wow"],
    energy: "wild",
  },

  /* ── Look & Atmosphere ── */
  {
    id: "kaleidoscope-bloom",
    name: "Kaleidoscope Bloom",
    category: "Look & Atmosphere",
    bestFor: "A psychedelic chorus or a color-drenched hook that should feel like a dream.",
    weave:
      "The frame blooms into a living kaleidoscope: the image mirrors into symmetrical mandala patterns that rotate and pulse with the music, the subject multiplied into geometric symmetry at the center, colors saturated and radiant — then the pattern blooms open back into the normal shot.",
    needs: "none",
    conflictsWithMoves: [],
    trendTags: ["kaleidoscope", "psychedelic", "chorus", "color", "trippy", "mandala"],
    energy: "wild",
  },
  {
    id: "light-trails",
    name: "Light Trails",
    category: "Look & Atmosphere",
    bestFor: "Night scenes — the city smears into ribbons of light around a sharp subject.",
    weave:
      "Long-exposure light trails: every moving light in the scene stretches into flowing ribbons of color that stream past the subject, who stays tack-sharp and normally exposed — traffic, signs, and sparklers painting long glowing streaks through the night air.",
    needs: "none",
    conflictsWithMoves: ["static-wide"],
    cameraNeed: "motion in the frame to stretch the light",
    trendTags: ["light trails", "night", "long exposure", "neon", "city"],
    energy: "calm",
  },
  {
    id: "comic-halftone",
    name: "Comic Halftone Pop",
    category: "Look & Atmosphere",
    bestFor: "A playful, pop-art punch — live action tips into a printed comic panel.",
    weave:
      "The live-action image tips into a printed comic-book look mid-shot: bold ink outlines, Ben-Day halftone dots in the shadows, flat pop-art color, and a subtle paper grain — the subject keeps moving and performing, now living inside a comic panel.",
    needs: "none",
    conflictsWithMoves: [],
    trendTags: ["comic", "halftone", "pop art", "cartoon", "playful"],
    energy: "punchy",
  },
  {
    id: "vhs-rewind",
    name: "VHS Rewind",
    category: "Look & Atmosphere",
    bestFor: "Nostalgia plays — throwback tracks, old-school sections, retro drops.",
    weave:
      "The shot wears a true VHS skin: tracking lines roll through the frame, chromatic fringing smears the edges, a timestamp-style grain and occasional tape stutter hits — and for one beat the image rewinds with classic tape-search distortion before playing on.",
    needs: "none",
    conflictsWithMoves: [],
    trendTags: ["vhs", "retro", "90s", "nostalgia", "throwback", "tape"],
    energy: "punchy",
  },
  {
    id: "underwater-drift",
    name: "Underwater Drift",
    category: "Look & Atmosphere",
    bestFor: "Dreamy, weightless sections — ballads, intros, floating-in-space feelings.",
    weave:
      "The whole scene drifts as if submerged underwater: the subject's movements slow and float, hair and fabric billow in an invisible current, soft blue caustic light ripples across everything, and small bubbles rise past the camera. Weightless, calm, dreamlike.",
    needs: "none",
    conflictsWithMoves: [],
    trendTags: ["underwater", "dreamy", "slow", "ethereal", "floating", "ballad"],
    energy: "calm",
  },
  {
    id: "fire-spark-aura",
    name: "Fire & Spark Aura",
    category: "Look & Atmosphere",
    bestFor: "Anthems and intense verses — the performer carries fire with them.",
    weave:
      "Embers and sparks swirl around the performer in a living aura — glowing particles orbiting with their movement, heat shimmer bending the air at their silhouette, warm orange rim light flickering like nearby flame. The fire energy follows the performance; nothing burns, everything blazes.",
    needs: "none",
    conflictsWithMoves: [],
    trendTags: ["fire", "embers", "sparks", "intense", "anthem", "energy"],
    energy: "wild",
  },
  {
    id: "storm-atmosphere",
    name: "Storm Atmosphere",
    category: "Look & Atmosphere",
    bestFor: "Drama and heartbreak sections — real weather sells real emotion.",
    weave:
      "A cinematic storm rolls in: rain streaks through the light, the subject's hair and clothing grow wet and wind-whipped, distant lightning flickers the exposure for a frame at a time, and puddle reflections shimmer below. Weather as emotion — heavy, beautiful, real.",
    needs: "none",
    conflictsWithMoves: [],
    trendTags: ["rain", "storm", "dramatic", "heartbreak", "weather", "night"],
    energy: "punchy",
  },
  {
    id: "neon-outline",
    name: "Neon Outline",
    category: "Look & Atmosphere",
    bestFor: "Dark club and night looks — the performer traced in living neon.",
    weave:
      "In the dark frame, the subject's silhouette is traced by a living neon outline — a glowing line that hugs their body and movements, pulsing softly with the beat, reflections of the glow spilling onto the floor. Everything else falls to shadow; the outline performs.",
    needs: "none",
    conflictsWithMoves: [],
    trendTags: ["neon", "outline", "glow", "club", "dark", "night"],
    energy: "punchy",
  },
];

const RECIPE_BY_ID = new Map(EFFECT_RECIPES.map((r) => [r.id, r]));

export function getEffectRecipe(id: string): EffectRecipe | null {
  return RECIPE_BY_ID.get(id) ?? null;
}

/** Resolve a creator's picked ids to recipes: deduped, capped at
 *  MAX_STACKED_EFFECTS, unknown ids reported (never silently dropped —
 *  the generation route 400s on them). */
export function resolveEffectRecipes(ids: readonly string[] | undefined | null): {
  recipes: EffectRecipe[];
  unknownIds: string[];
} {
  if (!ids || ids.length === 0) return { recipes: [], unknownIds: [] };
  const seen = new Set<string>();
  const recipes: EffectRecipe[] = [];
  const unknownIds: string[] = [];
  for (const raw of ids) {
    const id = String(raw).trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const recipe = RECIPE_BY_ID.get(id);
    if (!recipe) {
      unknownIds.push(id);
      continue;
    }
    if (recipes.length < MAX_STACKED_EFFECTS) recipes.push(recipe);
  }
  return { recipes, unknownIds };
}

/* ─── Prompt weaving ────────────────────────────────────────────────────── */

/** The woven block appended to the scene prompt at generation. Returns ""
 *  for an empty set — the no-effect prompt stays byte-identical to today. */
export function weaveEffectsBlock(recipes: readonly EffectRecipe[]): string {
  if (recipes.length === 0) return "";
  const parts = recipes.map((r) => `Viral effect — ${r.name}: ${r.weave}`);
  return ` ${parts.join(" ")}`;
}

/* ─── Camera-conflict rule ────────────────────────────────────────────────
   Conservative, stated plainly: an effect "fights" a camera move only
   when the two directions physically contradict (a freeze arc needs a
   moving camera; an earth zoom-out cannot also dolly in). The scene's
   camera direction is free text, so it is normalized to canonical moves
   by keyword before checking. A conflict is a WARNING, never a block —
   the creator's call wins. */

export const CAMERA_MOVE_KEYWORDS: Array<{ move: CanonicalMove; keywords: string[] }> = [
  { move: "whip-pan", keywords: ["whip pan", "whip-pan"] },
  { move: "static-wide", keywords: ["static", "locked-off", "locked off", "tripod", "fixed camera", "no camera movement", "still camera", "locked shot"] },
  { move: "orbit", keywords: ["orbit", "arc around", "circling", "circles around", "360 orbit", "rotating around"] },
  { move: "dolly-in", keywords: ["dolly in", "dolly-in", "dolly toward", "push-in", "push in", "push toward", "moving closer", "zoom in", "zooms in"] },
  { move: "crane-up", keywords: ["crane", "jib", "rising shot", "camera rises", "aerial rise"] },
  { move: "handheld", keywords: ["handheld", "hand-held", "shoulder rig", "shaky", "camera shake"] },
  { move: "tracking", keywords: ["tracking shot", "tracking", "follow shot", "follows the"] },
  { move: "aerial", keywords: ["drone", "fpv", "aerial"] },
];

export const CAMERA_MOVE_LABELS: Record<CanonicalMove, string> = {
  "dolly-in": "a dolly-in (camera pushing closer)",
  orbit: "an orbiting camera",
  "crane-up": "a crane-up",
  handheld: "handheld camera shake",
  "static-wide": "a locked-off static camera",
  "whip-pan": "a whip pan",
  tracking: "a tracking shot",
  aerial: "an aerial / drone move",
};

export function normalizeCameraMoves(cameraText: string | null | undefined): Set<CanonicalMove> {
  const text = (cameraText ?? "").toLowerCase();
  const found = new Set<CanonicalMove>();
  if (!text.trim()) return found;
  for (const { move, keywords } of CAMERA_MOVE_KEYWORDS) {
    if (keywords.some((k) => text.includes(k))) found.add(move);
  }
  return found;
}

export interface EffectConflict {
  effectId: string;
  effectName: string;
  move: CanonicalMove;
  message: string;
}

export function effectConflictsFor(
  cameraText: string | null | undefined,
  recipes: readonly EffectRecipe[],
): EffectConflict[] {
  const moves = normalizeCameraMoves(cameraText);
  if (moves.size === 0) return [];
  const conflicts: EffectConflict[] = [];
  for (const recipe of recipes) {
    for (const move of recipe.conflictsWithMoves) {
      if (!moves.has(move)) continue;
      conflicts.push({
        effectId: recipe.id,
        effectName: recipe.name,
        move,
        message:
          `"${recipe.name}" needs ${recipe.cameraNeed ?? "a different camera move"} — ` +
          `it fights ${CAMERA_MOVE_LABELS[move]}. One of them will win in the render; ` +
          `pick which before you generate.`,
      });
    }
  }
  return conflicts;
}

/* ─── Trend matcher (deterministic core) ──────────────────────────────────
   Scores every recipe against the scene (prompt/action/mood text) and
   the trend predictor's current signals (the trends the creator is
   tracking, TrendItem shape from routes/generate/trend-predictor.ts).
   The route layers a text-model polish on top of this shortlist when AI
   is available; this core is the always-available fallback and never
   invents a trend — a trend reason is only produced from a signal the
   creator actually supplied. */

export interface TrendSignal {
  trend: string;
  confidence: number; // 0-100
  timeframe?: string;
  reasoning?: string;
  earlySignals?: string[];
}

export interface EffectSceneContext {
  promptText?: string;
  action?: string;
  mood?: string;
  section?: string;
  cameraMovement?: string;
}

export interface EffectProposal {
  effectId: string;
  name: string;
  score: number;
  /** Why this effect is likely to travel, citing the actual trend
   *  signal — null when no supplied trend matched. */
  trendReason: string | null;
  /** Why it fits this specific scene. */
  fitReason: string;
  source: "trend" | "scene";
}

export const EFFECT_MATCH_DISCLAIMER =
  "Effect picks are pattern-based suggestions from your scene and the trends you're tracking — not a guarantee. You approve every pick; nothing is applied automatically.";

const CALM_MOODS = ["dreamy", "soft", "sad", "ballad", "chill", "romantic", "ethereal", "calm", "slow"];
const HYPE_MOODS = ["hype", "intense", "explosive", "anthem", "drop", "aggressive", "wild", "epic", "fire"];

function textIncludesTag(text: string, tag: string): boolean {
  return text.includes(tag.toLowerCase());
}

export function matchEffects(
  scene: EffectSceneContext,
  trends: readonly TrendSignal[] = [],
  limit = 3,
): EffectProposal[] {
  const sceneText = [scene.promptText ?? "", scene.action ?? "", scene.mood ?? "", scene.section ?? ""]
    .join(" ")
    .toLowerCase();
  const moodText = (scene.mood ?? "").toLowerCase();

  const scored: EffectProposal[] = [];
  for (const recipe of EFFECT_RECIPES) {
    let score = 0;
    const sceneTags: string[] = [];
    for (const tag of recipe.trendTags) {
      if (textIncludesTag(sceneText, tag)) {
        score += 2;
        sceneTags.push(tag);
      }
    }

    let bestTrend: { signal: TrendSignal; tags: string[]; trendScore: number } | null = null;
    for (const signal of trends) {
      const trendText = [signal.trend, signal.reasoning ?? "", ...(signal.earlySignals ?? [])]
        .join(" ")
        .toLowerCase();
      const matched = recipe.trendTags.filter((tag) => textIncludesTag(trendText, tag));
      if (matched.length === 0) continue;
      const trendScore = matched.length * 3 + Math.round(Math.max(0, Math.min(100, signal.confidence)) / 20);
      score += trendScore;
      if (!bestTrend || trendScore > bestTrend.trendScore) {
        bestTrend = { signal, tags: matched, trendScore };
      }
    }

    /* Energy fit against the scene's stated mood. */
    if (recipe.energy === "calm" && CALM_MOODS.some((m) => moodText.includes(m))) score += 2;
    if (recipe.energy !== "calm" && HYPE_MOODS.some((m) => moodText.includes(m))) score += 2;

    if (score <= 0) continue;

    const trendReason = bestTrend
      ? `Riding "${bestTrend.signal.trend}" (${Math.round(bestTrend.signal.confidence)}% confidence` +
        `${bestTrend.signal.timeframe ? `, ${bestTrend.signal.timeframe}` : ""}) — matches on ${bestTrend.tags.join(", ")}.` +
        (bestTrend.signal.reasoning ? ` ${bestTrend.signal.reasoning.trim().slice(0, 200)}` : "")
      : null;
    const fitReason =
      sceneTags.length > 0
        ? `Fits this scene: ${sceneTags.slice(0, 4).join(", ")}.`
        : recipe.energy === "calm"
          ? "Matches the scene's calmer energy."
          : "Matches the scene's high-energy moment.";
    scored.push({
      effectId: recipe.id,
      name: recipe.name,
      score,
      trendReason,
      fitReason,
      source: bestTrend ? "trend" : "scene",
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(1, limit));
}

/** Curated starter trio used only when neither the scene nor any trend
 *  signal scores a single recipe — labelled honestly as library picks. */
export const EFFECT_STARTER_IDS = ["earth-zoom-out", "beat-drop-freeze", "glitch-disintegration"] as const;
