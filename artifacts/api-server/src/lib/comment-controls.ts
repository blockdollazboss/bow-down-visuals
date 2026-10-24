/**
 * comment-controls.ts — creator comment controls (Stack-100 #3, #27). Pure.
 *
 * Platform moderation (AI flagging) decides what the PLATFORM removes.
 * This module is the CREATOR's own controls over comments on their own
 * content (Shout Wall + track/video media comments):
 *
 *   PIN    — one pinned comment per wall / media item, shown first, badged.
 *   HIDE   — creator hides a comment: gone for the public, still visible
 *            to the creator and to its author (badged "hidden"), reversible.
 *   HELD   — per-creator setting: comments matching the creator's rules
 *            land in a held queue only the creator sees. A held comment
 *            is a DELAY, never a silent deletion. Approve → public,
 *            reject → hidden.
 *   KEYWORD BLOCKLIST — per-creator word/phrase list; matching comments
 *            are auto-held (not deleted). Matching semantics deliberately
 *            mirror the live-chat automod rail (lib/automod.ts
 *            `blocked_word`: case-insensitive substring) so a creator's
 *            blocked word means the same thing in chat and in comments.
 *
 * Defaults are OFF / creator-chosen: holdMode 'off' + empty blocklist =
 * comments behave exactly as before this feature existed. Free: no
 * credits, no charges, anywhere in this module.
 */

export type CommentStatus = "public" | "held" | "hidden";
export type CommentHoldMode = "off" | "all" | "first_time";

export interface CreatorCommentSettings {
  holdMode: CommentHoldMode;
  blockedWords: string[];
}

export const DEFAULT_COMMENT_SETTINGS: CreatorCommentSettings = {
  holdMode: "off",
  blockedWords: [],
};

export const COMMENT_STATUSES: readonly CommentStatus[] = ["public", "held", "hidden"];
export const COMMENT_HOLD_MODES: readonly CommentHoldMode[] = ["off", "all", "first_time"];

export function normalizeCommentStatus(v: unknown): CommentStatus {
  return v === "held" || v === "hidden" ? v : "public";
}

export function normalizeHoldMode(v: unknown): CommentHoldMode {
  return v === "all" || v === "first_time" ? v : "off";
}

export function normalizeBlockedWords(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const w of v) {
    if (typeof w !== "string") continue;
    const t = w.trim().toLowerCase();
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= 50) break;
  }
  return out;
}

export function normalizeSettings(row: { holdMode?: unknown; blockedWords?: unknown } | null | undefined): CreatorCommentSettings {
  if (!row) return { ...DEFAULT_COMMENT_SETTINGS };
  return {
    holdMode: normalizeHoldMode(row.holdMode),
    blockedWords: normalizeBlockedWords(row.blockedWords),
  };
}

/** First blocked word/phrase found in the body (automod parity), or null. */
export function findBlockedWord(body: string, blockedWords: string[]): string | null {
  const lower = body.toLowerCase();
  for (const w of blockedWords) {
    const word = w.trim().toLowerCase();
    if (word && lower.includes(word)) return word;
  }
  return null;
}

export type HeldReason = "blocked_word" | "hold_all" | "first_time_commenter";

export interface HoldDecision {
  status: "public" | "held";
  /** Why the comment was held — null when public. Shown to creator + author. */
  reason: HeldReason | null;
  /** The blocked word that matched, when reason === 'blocked_word'. */
  matchedWord: string | null;
}

/**
 * Decide a NEW comment's initial state under the content owner's settings.
 * The creator commenting on their own content is never held (their rules
 * govern their audience, not themselves). Keyword matches hold even when
 * holdMode is 'off' — the blocklist is itself an opt-in rule.
 */
export function decideInitialStatus(input: {
  body: string;
  settings: CreatorCommentSettings;
  authorUserId: string;
  ownerUserId: string;
  isFirstTimeCommenter: boolean;
}): HoldDecision {
  if (input.authorUserId === input.ownerUserId) {
    return { status: "public", reason: null, matchedWord: null };
  }
  const matched = findBlockedWord(input.body, input.settings.blockedWords);
  if (matched) return { status: "held", reason: "blocked_word", matchedWord: matched };
  if (input.settings.holdMode === "all") {
    return { status: "held", reason: "hold_all", matchedWord: null };
  }
  if (input.settings.holdMode === "first_time" && input.isFirstTimeCommenter) {
    return { status: "held", reason: "first_time_commenter", matchedWord: null };
  }
  return { status: "public", reason: null, matchedWord: null };
}

/**
 * Who can see a comment in a list read:
 *  - public: everyone.
 *  - held / hidden: the content owner (creator) and the comment's author
 *    only — the author always sees their own comment, badged with its
 *    state, so a hold or hide is never a silent disappearance.
 */
export function isVisibleTo(
  comment: { status?: unknown; authorUserId: string },
  viewer: { userId: string | null; isContentOwner: boolean },
): boolean {
  const status = normalizeCommentStatus(comment.status);
  if (status === "public") return true;
  if (viewer.isContentOwner) return true;
  return viewer.userId != null && viewer.userId === comment.authorUserId;
}

/** Pinned first (most recently pinned first), then newest first. Stable, non-mutating. */
export function sortForDisplay<T extends { pinned?: unknown; pinnedAt?: Date | string | null; createdAt: Date | string }>(
  comments: readonly T[],
): T[] {
  const ts = (v: Date | string | null | undefined): number => {
    if (!v) return 0;
    const n = v instanceof Date ? v.getTime() : Date.parse(String(v));
    return Number.isNaN(n) ? 0 : n;
  };
  return [...comments].sort((a, b) => {
    const ap = a.pinned === true ? 1 : 0;
    const bp = b.pinned === true ? 1 : 0;
    if (ap !== bp) return bp - ap;
    if (ap === 1) {
      const byPin = ts(b.pinnedAt) - ts(a.pinnedAt);
      if (byPin !== 0) return byPin;
    }
    return ts(b.createdAt) - ts(a.createdAt);
  });
}

export type CommentControlAction = "pin" | "unpin" | "hide" | "unhide" | "approve" | "reject";
export const COMMENT_CONTROL_ACTIONS: readonly CommentControlAction[] = [
  "pin", "unpin", "hide", "unhide", "approve", "reject",
];

/**
 * State transition for a control action. Pin/unpin only touch the pin
 * flag (a held/hidden comment cannot be pinned — pinning is a public
 * showcase action, so it is rejected for non-public comments).
 * approve: held → public. reject: held → hidden (never a delete).
 * hide: public → hidden. unhide: hidden → public.
 * Returns null when the action does not apply to the current state.
 */
export function transitionFor(
  action: CommentControlAction,
  current: { status?: unknown; pinned?: unknown },
): { status: CommentStatus; pinned: boolean } | null {
  const status = normalizeCommentStatus(current.status);
  const pinned = current.pinned === true;
  switch (action) {
    case "pin":
      return status === "public" ? { status, pinned: true } : null;
    case "unpin":
      return pinned ? { status, pinned: false } : null;
    case "hide":
      return status === "public" ? { status: "hidden", pinned: false } : null;
    case "unhide":
      return status === "hidden" ? { status: "public", pinned: false } : null;
    case "approve":
      return status === "held" ? { status: "public", pinned: false } : null;
    case "reject":
      return status === "held" ? { status: "hidden", pinned: false } : null;
    default:
      return null;
  }
}

/**
 * True when an error means the comment-controls schema (migration in
 * .lane/MIGRATION-NEEDED.md) has not landed yet: undefined table
 * (42P01), undefined column (42703), or a driver message naming the
 * settings table / control columns. Routes degrade gracefully on this
 * instead of 500ing.
 */
export function isMissingCommentControlsSchema(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; message?: unknown; cause?: unknown };
  if (e.code === "42P01" || e.code === "42703") return true;
  const msg = `${typeof e.message === "string" ? e.message : ""} ${e.cause instanceof Error ? e.cause.message : ""}`;
  return /creator_comment_settings/.test(msg)
    || /(column|relation)[^"]*"(status|pinned|pinned_at|held_reason)"/.test(msg)
    || /"(status|pinned|pinned_at|held_reason)"[^"]*(does not exist|column)/.test(msg);
}

/** Copy shown wherever a held comment appears — a delay, never a deletion. */
export const HELD_COPY = "Held for review by the creator — this is a delay, not a deletion. It goes public if the creator approves it.";
export const HIDDEN_COPY = "Hidden by the creator — only you and the creator can see this comment.";
