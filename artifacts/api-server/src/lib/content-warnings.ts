/**
 * Content warnings (Wave 4 #40) — the cover decision shared by every
 * post DTO builder (routes/social.ts enrichPosts and routes/co-posts.ts
 * coPostDto). The label set itself lives in @workspace/db
 * (schema/content-warnings.ts); this module owns the READ-time cover:
 * who is covered, in which mode, and the copy that names the warning.
 *
 * The cover is a server-side withholding, not a visual treatment: a
 * covered post's DTO carries NO media URLs, so the media cannot be
 * fetched — or autoplayed — before the viewer taps to reveal that one
 * item (POST /posts/:id/content-warning/reveal). Labels themselves are
 * metadata and always ride the DTO: the warning must be NAMEABLE
 * without the media it covers.
 */
import {
  CONTENT_WARNING_LABELS,
  normalizeContentWarnings,
  type ContentWarningLabel,
} from "@workspace/db";

export { CONTENT_WARNING_LABELS, normalizeContentWarnings };
export type { ContentWarningLabel };

export const CONTENT_WARNING_DISPLAY_NAMES: Record<ContentWarningLabel, string> = {
  sensitive: "Sensitive content",
  flashing_lights: "Flashing lights",
  mature_themes: "Mature themes",
  strong_language: "Strong language",
};

export function contentWarningNames(labels: readonly string[]): string {
  return normalizeContentWarnings(labels)
    .map((l) => CONTENT_WARNING_DISPLAY_NAMES[l])
    .join(" · ");
}

export interface ContentCover {
  /** The post's labels (canonical order) — the warning, named. */
  labels: ContentWarningLabel[];
  /** "covered" = tap to reveal this item. "hidden" = the viewer's own
   *  preference always hides this label for them; reveal is refused
   *  until they change their own setting. */
  mode: "covered" | "hidden";
  /** How many attachments stay on the server behind the cover. */
  media_count: number;
  message: string;
}

/**
 * The cover decision for one post, one viewer.
 *
 * Returns null (no cover — media rides the DTO) when:
 *  - the post carries no labels, or has no media to cover;
 *  - the viewer is the author (a creator is never covered on their own
 *    post — the members-gate author rule); the co-post builder passes
 *    isAuthor for either standing side.
 *
 * Everyone else is covered. The viewer's own hidden-label preference
 * can only ever make this STRICTER ("hidden" mode) — there is no input
 * here that loosens a creator's label.
 */
export function contentCoverFor(args: {
  labels: readonly string[] | null | undefined;
  mediaCount: number;
  isAuthor: boolean;
  viewerHiddenLabels: readonly string[] | null | undefined;
}): ContentCover | null {
  const labels = normalizeContentWarnings(args.labels ?? []);
  if (labels.length === 0 || args.mediaCount === 0 || args.isAuthor) return null;
  const hidden = new Set(normalizeContentWarnings(args.viewerHiddenLabels ?? []));
  const names = contentWarningNames(labels);
  if (labels.some((l) => hidden.has(l))) {
    return {
      labels,
      mode: "hidden",
      media_count: args.mediaCount,
      message: `You've chosen to always hide posts labelled ${names}. Change it any time in Settings → Content warnings.`,
    };
  }
  return {
    labels,
    mode: "covered",
    media_count: args.mediaCount,
    message: `The creator labelled this post: ${names}. The media stays covered until you tap to reveal it.`,
  };
}
