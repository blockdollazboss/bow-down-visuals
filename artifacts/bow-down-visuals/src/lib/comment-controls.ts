/* Creator comment controls (#27) — client for the creator-owned half of
   comment moderation: pin / hide / held-for-review / keyword blocklist.
   Endpoints (api-server routes/comment-controls + creator-platform):
     GET  /api/creator-profiles/:id/comments        (wall; pinned first,
          held/hidden only for owner + author; carries viewer_is_owner)
     GET  /api/media/:kind/:id/comments             (same, media)
     GET  /api/creator-profiles/me/comment-settings
     PUT  /api/creator-profiles/me/comment-settings
     GET  /api/creator-profiles/me/held-comments
     POST /api/creator-comments/:commentId/action   { surface, action }
   All controls are OFF by default and creator-chosen. Free — no charges.
   A held comment is a DELAY, never a silent deletion. */

export type CommentStatus = "public" | "held" | "hidden";
export type CommentHoldMode = "off" | "all" | "first_time";
export type CommentControlAction = "pin" | "unpin" | "hide" | "unhide" | "approve" | "reject";
export type CommentSurface = "wall" | "media";

export interface ControlledComment {
  id: string;
  body: string;
  status?: CommentStatus;
  is_held?: boolean;
  is_hidden?: boolean;
  held_reason?: string | null;
  held_copy?: string | null;
  pinned?: boolean;
  is_pinned?: boolean;
  created_at?: string;
  [key: string]: unknown;
}

export interface HeldComment extends ControlledComment {
  surface: CommentSurface;
  author_user_id?: string;
  media_id?: string | null;
  media_kind?: string | null;
  media_title?: string | null;
}

export interface CommentSettings {
  hold_mode: CommentHoldMode;
  blocked_words: string[];
  defaults_off?: boolean;
  held_copy?: string;
}

export const HELD_COPY =
  "Held for review by the creator — this is a delay, not a deletion. It goes public if the creator approves it.";
export const HIDDEN_COPY = "Hidden by the creator — only you and the creator can see this comment.";

async function authHeaders(token: string | null | undefined): Promise<Record<string, string>> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function fetchCommentSettings(token: string | null): Promise<CommentSettings> {
  const res = await fetch(`/api/creator-profiles/me/comment-settings`, {
    headers: { ...(await authHeaders(token)) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Comment settings wouldn't load");
  return (data as { settings: CommentSettings }).settings;
}

export async function saveCommentSettings(
  token: string | null,
  patch: { hold_mode?: CommentHoldMode; blocked_words?: string[] },
): Promise<CommentSettings> {
  const res = await fetch(`/api/creator-profiles/me/comment-settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...(await authHeaders(token)) },
    body: JSON.stringify(patch),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Comment settings didn't save");
  return (data as { settings: CommentSettings }).settings;
}

export async function fetchHeldComments(token: string | null): Promise<{ comments: HeldComment[]; heldCopy: string | null }> {
  const res = await fetch(`/api/creator-profiles/me/held-comments`, {
    headers: { ...(await authHeaders(token)) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "The held queue wouldn't load");
  const d = data as { comments?: HeldComment[]; held_copy?: string };
  return { comments: d.comments ?? [], heldCopy: d.held_copy ?? null };
}

export async function runCommentAction(
  token: string | null,
  surface: CommentSurface,
  commentId: string,
  action: CommentControlAction,
): Promise<ControlledComment> {
  const res = await fetch(`/api/creator-comments/${encodeURIComponent(commentId)}/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders(token)) },
    body: JSON.stringify({ surface, action }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const d = data as { error?: string; message?: string };
    throw new Error(d.message ?? d.error ?? "That comment action didn't stick");
  }
  return (data as { comment: ControlledComment }).comment;
}

/** Thread reads that also report whether the viewer owns the content —
    the flag that unlocks the inline pin/hide/approve controls. */
export async function fetchWallThread(
  slugOrId: string,
  token: string | null,
): Promise<{ comments: Array<ControlledComment & Record<string, unknown>>; viewerIsOwner: boolean }> {
  const res = await fetch(`/api/creator-profiles/${encodeURIComponent(slugOrId)}/comments`, {
    headers: { ...(await authHeaders(token)) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error("Comments wouldn't load");
  const d = data as { comments?: Array<ControlledComment & Record<string, unknown>>; viewer_is_owner?: boolean };
  return { comments: d.comments ?? [], viewerIsOwner: d.viewer_is_owner === true };
}

export async function fetchMediaThread(
  kind: "track" | "video",
  id: string,
  token: string | null,
): Promise<{ comments: Array<ControlledComment & Record<string, unknown>>; viewerIsOwner: boolean }> {
  const res = await fetch(`/api/media/${kind}/${encodeURIComponent(id)}/comments`, {
    headers: { ...(await authHeaders(token)) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error("Comments wouldn't load");
  const d = data as { comments?: Array<ControlledComment & Record<string, unknown>>; viewer_is_owner?: boolean };
  return { comments: d.comments ?? [], viewerIsOwner: d.viewer_is_owner === true };
}

/** Inline controls available to the owner for a comment's current state. */
export function ownerActionsFor(c: ControlledComment): CommentControlAction[] {
  const status = c.status ?? "public";
  if (status === "held") return ["approve", "reject"];
  if (status === "hidden") return ["unhide"];
  return c.pinned || c.is_pinned ? ["unpin", "hide"] : ["pin", "hide"];
}
