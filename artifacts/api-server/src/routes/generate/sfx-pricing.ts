/* Pure config + helpers for Text-to-SFX (/sfx).
   Kept in a separate module so the pricing contract, category keys, and
   duration clamping are unit-testable without Express. The frontend /sfx
   page must keep its SFX_CATEGORIES list in sync with SFX_CATEGORY_KEYS. */

/** 1 credit per SFX — env-overridable without a deploy. One ElevenLabs
    sound-generation call is a fraction of a cent in provider fees, so
    1 credit holds a deep margin while staying an impulse buy. */
export const SFX_CREDIT_COST =
  Number(process.env["SFX_CREDIT_COST"]) || 1;

/** Duration bounds (seconds) exposed in the UI. */
export const SFX_MIN_DURATION = 1;
export const SFX_MAX_DURATION = 10;
export const SFX_DEFAULT_DURATION = 3;

export const SFX_CATEGORY_KEYS = [
  "impacts",
  "whooshes",
  "risers",
  "ui",
  "ambient",
  "foley",
] as const;
export type SfxCategoryKey = (typeof SFX_CATEGORY_KEYS)[number];

export interface SfxCategory {
  key: SfxCategoryKey;
  label: string;
  blurb: string;
  /** Appended to the user's prompt to steer the model — never shown as a guarantee. */
  direction: string;
}

export const SFX_CATEGORIES: Record<SfxCategoryKey, SfxCategory> = {
  impacts: {
    key: "impacts",
    label: "Impacts",
    blurb: "Booms, hits, slams, cinematic punches",
    direction: "deep, powerful impact sound with a strong transient and natural decay",
  },
  whooshes: {
    key: "whooshes",
    label: "Whooshes",
    blurb: "Swooshes, transitions, fly-bys",
    direction: "smooth whoosh with a clear attack, airy movement, and clean tail",
  },
  risers: {
    key: "risers",
    label: "Risers",
    blurb: "Build-ups, tension sweeps, drops",
    direction: "rising tension sweep that builds steadily toward a climax",
  },
  ui: {
    key: "ui",
    label: "UI Sounds",
    blurb: "Clicks, pops, notifications, hovers",
    direction: "short, crisp, clean digital interface sound, no reverb tail",
  },
  ambient: {
    key: "ambient",
    label: "Ambient Beds",
    blurb: "Room tone, nature, atmosphere loops",
    direction: "seamless ambient bed, even texture throughout, no distinct events",
  },
  foley: {
    key: "foley",
    label: "Foley",
    blurb: "Footsteps, cloth, objects, everyday sounds",
    direction: "realistic foley recording, close-mic'd, natural acoustic character",
  },
};

export function isSfxCategoryKey(value: unknown): value is SfxCategoryKey {
  return (
    typeof value === "string" &&
    (SFX_CATEGORY_KEYS as readonly string[]).includes(value)
  );
}

/** Clamp a requested duration into the 1–10s provider-safe window. */
export function clampSfxDuration(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return SFX_DEFAULT_DURATION;
  return Math.min(
    SFX_MAX_DURATION,
    Math.max(SFX_MIN_DURATION, Math.round(n)),
  );
}

/** Build the provider prompt: user description + category steering. */
export function buildSfxPrompt(
  description: string,
  category: SfxCategoryKey,
): string {
  const dir = SFX_CATEGORIES[category].direction;
  return `Sound effect: ${description.trim()} — ${dir}.`.slice(0, 500);
}

/** Safe filename for downloads: lowercase, dashes, no weird chars. */
export function sfxFilename(prompt: string, ext: "wav" | "mp3"): string {
  const slug =
    prompt
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "sfx";
  return `${slug}.${ext}`;
}
