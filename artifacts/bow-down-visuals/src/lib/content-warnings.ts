/* Content warnings (Wave 4 #40) — the creator-applied label set and
   the per-session reveal registry.
 *
 * The set mirrors the server contract exactly (lib/db schema +
 * api-server lib/content-warnings): a creator labels their OWN post
 * with any subset; labelled media arrives covered — the server sends
 * no media URL until the viewer taps to reveal THAT item through
 * POST /api/posts/:id/content-warning/reveal.
 *
 * The reveal is per item, per session BY DESIGN: what lives here is a
 * module-level memory that dies with the page session. There is no
 * "show me everything" switch, and nothing is persisted — a reload
 * covers everything again, exactly as the label promises. */

export const CONTENT_WARNING_LABELS = [
  "sensitive",
  "flashing_lights",
  "mature_themes",
  "strong_language",
] as const;

export type ContentWarningLabel = (typeof CONTENT_WARNING_LABELS)[number];

export const CONTENT_WARNING_DISPLAY_NAMES: Record<ContentWarningLabel, string> = {
  sensitive: "Sensitive content",
  flashing_lights: "Flashing lights",
  mature_themes: "Mature themes",
  strong_language: "Strong language",
};

export function contentWarningNames(labels: readonly string[]): string {
  return CONTENT_WARNING_LABELS.filter((l) => labels.includes(l))
    .map((l) => CONTENT_WARNING_DISPLAY_NAMES[l])
    .join(" · ");
}

const revealedMedia = new Map<string, unknown[]>();

/** The media a viewer already revealed this session for this post. */
export function revealedMediaThisSession(postId: string): unknown[] | null {
  return revealedMedia.get(postId) ?? null;
}

export function markRevealedThisSession(postId: string, media: unknown[]) {
  revealedMedia.set(postId, media);
}
