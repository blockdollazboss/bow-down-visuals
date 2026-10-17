/**
 * social-desk.ts — the Social Desk's pure seam (NATIVE-PLAN §3.4).
 *
 * The two social-pattern stations — the Post Office (Throne Hall)
 * and Community Hall (Courtyard) — are REST-fed instruments: they
 * ride the EXACT rails the website's own pages ride, named here
 * once so the components and the tests read the same table.
 *
 * DM rails (pages/messages.tsx, verbatim):
 *   GET  /api/dm/conversations            → { inbox, requests }
 *   GET  /api/dm/:id/messages             → { messages, status }
 *   POST /api/dm/:id/send                 { body }
 *   POST /api/dm/start                    { user_id }
 *   GET  /api/profiles/resolve?slug=…     → { user_id }
 *   POST /api/dm/:id/accept · /decline · /block
 *
 * Community rails (pages/community.tsx + pages/scheduler.tsx +
 * components/social/PostCard.tsx, verbatim):
 *   POST /api/community/superfans         { comments } → { superfans }
 *   POST /api/community/sentiment         { comments } → { report }
 *   POST /api/generate-community-post     { topic, platform, tone }
 *   GET  /api/community-post-platforms    → { platforms, tones, cost }
 *   GET  /api/feed?mode=chrono&limit=…    → { posts }   (recent posts)
 *   POST /api/posts                       { body }      (pin to board)
 *   POST /api/react                       { target_kind:"post", target_id, emoji }
 *   DELETE /api/react?target_kind=post&target_id=…
 *   GET  /api/posts/:id/replies           → { replies } (short preview)
 *
 * NOTE on methods: superfans/sentiment are POST on the server (they
 * analyse a comments batch and charge for the run) — there is no
 * GET form. The desk derives the batch from the board's own recent
 * posts, so the analysis is about THIS room's conversation, and the
 * run only happens on an explicit tap with its price shown.
 *
 * Moderation (POST /api/community/moderate) is deliberately NOT
 * here: it stays transfer-only in v1 (see SOCIAL_NATIVE_FOLLOW_ONS).
 */
import type { FeedPost } from "@/lib/social-api";

/* ─── DM wire shapes (pages/messages.tsx, mirrored exactly) ──────── */

export interface DmProfileCard {
  slug: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface DmConversation {
  id: string;
  status: string;
  requested_by_me: boolean;
  other: { user_id: string; profile: DmProfileCard | null };
  last_message: { body: string; createdAt: string; senderUserId: string } | null;
  unread: number;
  last_message_at: string | null;
}

export interface DmMessage {
  id: string;
  senderUserId: string;
  body: string;
  created_at: string;
}

/* ─── DM endpoints ────────────────────────────────────────────────── */

export const DM_CONVERSATIONS_PATH = "/api/dm/conversations";
export const DM_START_PATH = "/api/dm/start";

export function dmMessagesPath(conversationId: string): string {
  return `/api/dm/${encodeURIComponent(conversationId)}/messages`;
}

export function dmSendPath(conversationId: string): string {
  return `/api/dm/${encodeURIComponent(conversationId)}/send`;
}

export type DmRequestAction = "accept" | "decline" | "block";

export function dmRequestActionPath(conversationId: string, action: DmRequestAction): string {
  return `/api/dm/${encodeURIComponent(conversationId)}/${action}`;
}

export function profileResolvePath(slug: string): string {
  return `/api/profiles/resolve?slug=${encodeURIComponent(slug.trim().toLowerCase())}`;
}

/* ─── DM pure helpers ─────────────────────────────────────────────── */

/** The name a conversation row wears: the other creator's display
 *  name, or the page's own honest fallback. */
export function dmConversationName(conv: DmConversation): string {
  return conv.other.profile?.displayName ?? "Creator";
}

/** May the walker type in this thread? Mirrors messages.tsx exactly:
 *  inbox threads always; a request thread only when *I* sent it. */
export function dmCanChat(status: string, conv: DmConversation | null): boolean {
  if (!conv) return false;
  return status === "inbox" || (status === "request" && conv.requested_by_me);
}

/** Is this thread a request someone ELSE sent me — the case that
 *  shows the accept/decline rail (messages.tsx's banner)? */
export function dmNeedsAnswer(status: string, conv: DmConversation | null): boolean {
  return !!conv && status === "request" && !conv.requested_by_me;
}

/** A draft can be sent only into a chattable thread, non-empty.
 *  The 2,000-char cap is the composer input's own (messages.tsx). */
export const DM_DRAFT_MAX = 2000;
export function dmCanSendDraft(draft: string, canChat: boolean): boolean {
  return canChat && draft.trim().length > 0;
}

/** Total unread across a conversation list (the tab badge math). */
export function dmUnreadTotal(convs: readonly DmConversation[]): number {
  return convs.reduce((n, c) => n + (c.unread > 0 ? c.unread : 0), 0);
}

/** Find the open conversation across both leaves, as the page does. */
export function dmFindConversation(
  inbox: readonly DmConversation[],
  requests: readonly DmConversation[],
  id: string | null,
): DmConversation | null {
  if (!id) return null;
  return [...inbox, ...requests].find((c) => c.id === id) ?? null;
}

/** Guard a conversations payload into its two leaves; anything
 *  malformed reads as two empty leaves, never a crash. */
export function normalizeDmConversations(payload: unknown): {
  inbox: DmConversation[];
  requests: DmConversation[];
} {
  const p = (payload ?? {}) as { inbox?: unknown; requests?: unknown };
  return {
    inbox: Array.isArray(p.inbox) ? (p.inbox as DmConversation[]) : [],
    requests: Array.isArray(p.requests) ? (p.requests as DmConversation[]) : [],
  };
}

/* ─── Community endpoints ─────────────────────────────────────────── */

export const COMMUNITY_SUPERFANS_PATH = "/api/community/superfans";
export const COMMUNITY_SENTIMENT_PATH = "/api/community/sentiment";
export const GENERATE_COMMUNITY_POST_PATH = "/api/generate-community-post";
export const COMMUNITY_POST_PLATFORMS_PATH = "/api/community-post-platforms";
export const POSTS_PATH = "/api/posts";

/** Recent posts for the notice board — the feed page's own rail. */
export function feedPath(limit: number): string {
  const n = Math.min(Math.max(Math.floor(limit) || 1, 1), 30);
  return `/api/feed?mode=chrono&limit=${n}`;
}

export function postRepliesPath(postId: string): string {
  return `/api/posts/${encodeURIComponent(postId)}/replies`;
}

export const REACT_PATH = "/api/react";

export function reactRemovePath(postId: string): string {
  return `/api/react?target_kind=post&target_id=${encodeURIComponent(postId)}`;
}

/* ─── Community wire shapes (pages/community.tsx, mirrored) ──────── */

export interface Superfan {
  author: string;
  score: number;
  why: string;
  commentCount: number;
}

export interface SentimentReport {
  overall: string;
  score: number;
  themes?: { theme: string; sentiment: string; examples?: string[] }[];
  risks?: string[];
  wins?: string[];
}

/** One generated variant from /api/generate-community-post. */
export interface CommunityPostVariant {
  text: string;
  charCount: number;
  limit: number;
  over: boolean;
}

/* ─── Community pure helpers ──────────────────────────────────────── */

/** The comments batch the superfans/sentiment runs analyse: the
 *  board's own recent posts, in the community page's input shape
 *  ({ author, text }). Posts without a body carry nothing to
 *  analyse and are skipped; the batch is capped like the page's
 *  parser caps its paste (200). */
export function commentsBatchFromPosts(
  posts: readonly FeedPost[],
): { author: string; text: string }[] {
  return posts
    .filter((p) => typeof p.body === "string" && p.body.trim().length > 0)
    .slice(0, 200)
    .map((p) => ({
      author: p.author?.slug ?? p.author?.display_name ?? "creator",
      text: p.body.trim().slice(0, 1000),
    }));
}

/** A pin topic is worth a (paid) generation run only at the server's
 *  own minimum: the generate route requires topic ≥ 2 chars. */
export function pinTopicReady(topic: string): boolean {
  return topic.trim().length >= 2;
}

/** A post body can be pinned to the board only inside the posts
 *  route's own limits (1–500 chars, createPostSchema). */
export const POST_BODY_MAX = 500;
export function postBodyReady(body: string): boolean {
  const n = body.trim().length;
  return n >= 1 && n <= POST_BODY_MAX;
}

/** The reaction set the board offers — the head of PostCard's own
 *  REACTIONS table (the two a notice board needs at a glance). */
export const BOARD_REACTIONS = [
  { emoji: "like", icon: "❤️", label: "Like" },
  { emoji: "fire", icon: "🔥", label: "Fire" },
] as const;

/** Optimistic reaction math, mirroring PostCard.react: tapping the
 *  current reaction removes it; tapping another swaps. Counts never
 *  go below zero. Pure — the component applies the result, then
 *  confirms against /api/react and rolls back on failure. */
export function nextReactionState(
  current: string | null,
  counts: Readonly<Record<string, number>>,
  next: string,
): { emoji: string | null; counts: Record<string, number> } {
  const removing = current === next;
  const out: Record<string, number> = { ...counts };
  if (current) out[current] = Math.max(0, (out[current] ?? 1) - 1);
  if (!removing) out[next] = (out[next] ?? 0) + 1;
  return { emoji: removing ? null : next, counts: out };
}

/** Replies preview: the board shows the first few replies read-only;
 *  the full thread is the transfer's job (follow-on log). */
export const REPLIES_PREVIEW_COUNT = 3;
export function repliesPreview<T>(replies: readonly T[]): T[] {
  return replies.slice(0, REPLIES_PREVIEW_COUNT);
}

/* ─── The parity follow-on log (NATIVE-PLAN §3.4, v1 scope line) ───
   Everything behind these two stations that stays TRANSFER-ONLY in
   v1, named so the next lane promotes benches deliberately, never
   by drift. The desk components surface the moderation line to the
   walker; the rest live here as the program's record. */
export const SOCIAL_NATIVE_FOLLOW_ONS = [
  {
    id: "moderation-bench",
    label: "Community moderation bench (POST /api/community/moderate)",
    note: "An admin workbench, not a hangout action — stays on the website via the Community Hall transfer in v1.",
  },
  {
    id: "full-comment-threads",
    label: "Full post comment threads",
    note: "Board post cards read + react in-world and preview the first replies; the full /post/:id thread opens on the website via the station transfer.",
  },
  {
    id: "reply-drafts-bench",
    label: "AI reply-drafts bench (POST /api/comment-replies)",
    note: "The community page's tone/tone-batch drafting bench stays transfer-only; the Hall's pin composer covers quick posting in-world.",
  },
  {
    id: "dm-attachments",
    label: "DM attachments and thread search",
    note: "The Post Office desk is text threads in v1 — the messages page's rails carry no attachment send, so nothing is faked in-world.",
  },
] as const;
