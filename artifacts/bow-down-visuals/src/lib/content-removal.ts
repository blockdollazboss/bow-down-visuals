/* Content moderation removal — the shared client vocabulary for the
   admin removal rail (Stack-4). The server owns the truth: the
   reason categories mirror POST_REMOVAL_REASONS in
   lib/db/src/schema/creator-stories-posts.ts (enforced there by a
   DB CHECK and by the admin route's zod schema); this module is
   the frontend's copy for labels and for turning what an admin
   pastes into the lookup box (a bare post/comment ID, or a
   /post/:id link) into the ID the rail acts on. */

export const REMOVAL_REASONS = [
  "spam",
  "harassment",
  "hate_speech",
  "violence",
  "sexual_content",
  "copyright",
  "impersonation",
  "other",
] as const;

export type RemovalReason = (typeof REMOVAL_REASONS)[number];

export const REMOVAL_REASON_LABELS: Record<RemovalReason, string> = {
  spam: "Spam",
  harassment: "Harassment",
  hate_speech: "Hate speech",
  violence: "Violence or threats",
  sexual_content: "Sexual content",
  copyright: "Copyright",
  impersonation: "Impersonation",
  other: "Other policy violation",
};

/** Human label for a recorded reason category. Unknown or missing
 *  values fall back to the generic label rather than echoing a raw
 *  code at a member. */
export function removalReasonLabel(reason: string | null | undefined): string {
  if (reason && (REMOVAL_REASONS as readonly string[]).includes(reason)) {
    return REMOVAL_REASON_LABELS[reason as RemovalReason];
  }
  return REMOVAL_REASON_LABELS.other;
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Pull a post/comment ID out of what an admin pastes: a bare UUID,
 *  or any link carrying one (e.g. https://…/post/<uuid>). Returns
 *  null when the input holds no UUID at all — the caller shows an
 *  honest "couldn't look that up" instead of firing a doomed
 *  request. */
export function parseContentId(input: string): string | null {
  const m = UUID_RE.exec(input.trim());
  return m ? m[0].toLowerCase() : null;
}
