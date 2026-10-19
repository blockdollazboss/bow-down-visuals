/**
 * social-desk.ts — the Social Desk's pure seam (NATIVE-PLAN §3.4).
 *
 * The two social-pattern stations — the Post Office (Throne Hall)
 * and Community Hall (Courtyard) — are REST-fed instruments: they
 * ride the EXACT rails the website's own pages ride, named here
 * once so the components and the tests read the same table.
 *
 * DM rails (pages/messages.tsx, verbatim; attachments are Ring 2):
 *   GET  /api/dm/conversations            → { inbox, requests }
 *   GET  /api/dm/:id/messages             → { messages, status }
 *   POST /api/dm/:id/send                 { body, attachment? }
 *   POST /api/dm/attachments/upload       multipart "file" → { url, ref, type, name }
 *   POST /api/dm/start                    { user_id }
 *   GET  /api/profiles/resolve?slug=…     → { user_id }
 *   POST /api/dm/:id/accept · /decline · /block
 *   GET  /api/dm/:id/draft                → { draft } (STACK-20 #15: my saved reply)
 *   PUT  /api/dm/:id/draft                { body } (an empty body clears it)
 *   DELETE /api/dm/:id/draft              (clear my saved reply)
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
 *   GET  /api/posts/:id/replies           → { replies } (the FULL thread)
 *   POST /api/posts/:id/reply             { body }      (answer in-world)
 *   POST /api/comment-replies             { comments, tone, voiceNotes } → { replies }
 *   GET  /api/comment-replies/meta        → { cost, tones, maxComments }
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
  last_message: {
    body: string; createdAt: string; senderUserId: string;
    attachment_type?: string | null; attachment_name?: string | null;
  } | null;
  unread: number;
  last_message_at: string | null;
}

/** One piece of work riding with a message (2.17): a beat, a cover,
 *  a clip. `url` is what the client opens (the server mints a fresh
 *  URL from the stored permanent ref on every read); on SEND the
 *  client passes the upload's `ref` — or an external URL to its own
 *  file, which the server mirrors into permanent storage. */
export type DmAttachmentType = "audio" | "image" | "video";
export interface DmAttachment {
  url: string;
  type: DmAttachmentType;
  name: string;
}

export interface DmMessage {
  id: string;
  senderUserId: string;
  body: string;
  created_at: string;
  attachment_url?: string | null;
  attachment_type?: string | null;
  attachment_name?: string | null;
}

/** The attachment a message carries, as one tidy object (or null). */
export function dmMessageAttachment(m: DmMessage): DmAttachment | null {
  if (!m.attachment_url || !m.attachment_type || !m.attachment_name) return null;
  if (m.attachment_type !== "audio" && m.attachment_type !== "image" && m.attachment_type !== "video") return null;
  return { url: m.attachment_url, type: m.attachment_type, name: m.attachment_name };
}

/* ─── DM endpoints ────────────────────────────────────────────────── */

export const DM_CONVERSATIONS_PATH = "/api/dm/conversations";
export const DM_START_PATH = "/api/dm/start";
export const DM_ATTACHMENT_UPLOAD_PATH = "/api/dm/attachments/upload";

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

/* ─── DM reply drafts (STACK-20 #15) ────────────────────────────────
   The composer's in-progress reply, held on the SERVER — one draft
   per member per thread — so a half-written answer survives the
   panel closing, a rejoin, a phone reload, and comes back on any
   device. Before this rail the draft was one shared useState for the
   whole desk: switching threads carried the words across, and any
   unmount lost them. GET reads mine, PUT saves (an empty body
   clears), DELETE clears; a landed send clears server-side too. */

export function dmDraftPath(conversationId: string): string {
  return `/api/dm/${encodeURIComponent(conversationId)}/draft`;
}

export interface DmDraft {
  body: string;
  updatedAt: string | null;
}

/** Guard a draft payload into the one saved reply (or null): anything
 *  that isn't exactly the server's shape reads as "no draft" — never
 *  a crash, and never junk text landing in the composer. A saved draft
 *  is never empty (the server clears instead of storing blanks). */
export function normalizeDmDraft(payload: unknown): DmDraft | null {
  const d = (payload as { draft?: unknown } | null | undefined)?.draft;
  if (!d || typeof d !== "object") return null;
  const body = (d as { body?: unknown }).body;
  if (typeof body !== "string" || body.length === 0) return null;
  const updatedAt = (d as { updated_at?: unknown }).updated_at;
  return { body, updatedAt: typeof updatedAt === "string" ? updatedAt : null };
}

/** What the desk owes the server for the composer's current text:
 *  "skip" — the server already holds exactly this text; "clear" —
 *  the composer went blank over a saved draft, so retire it (a PUT
 *  with an empty body); "save" — new words to persist. */
export type DmDraftSaveDecision = "skip" | "clear" | "save";
export function dmDraftSaveDecision(text: string, savedText: string): DmDraftSaveDecision {
  if (text === savedText) return "skip";
  return text.trim().length === 0 ? "clear" : "save";
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

/** A draft can be sent only into a chattable thread, non-empty —
 *  unless a piece of work rides along: an attachment-only hand-off
 *  (a beat with no words) is a complete message on the server.
 *  The 2,000-char cap is the composer input's own (messages.tsx). */
export const DM_DRAFT_MAX = 2000;
export function dmCanSendDraft(draft: string, canChat: boolean, hasAttachment = false): boolean {
  return canChat && (draft.trim().length > 0 || hasAttachment);
}

/* ─── DM attachment helpers ───────────────────────────────────────── */

/** Classify a picked file by MIME, the way the server's upload filter
 *  does (audio/*, video/*, image/* — anything else can't ride). */
export function dmAttachmentKindForMime(mime: string): DmAttachmentType | null {
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("image/")) return "image";
  return null;
}

const DM_EXT_KIND: Record<string, DmAttachmentType> = {
  mp3: "audio", wav: "audio", ogg: "audio", m4a: "audio", flac: "audio", aac: "audio",
  mp4: "video", mov: "video", webm: "video", m4v: "video",
  jpg: "image", jpeg: "image", png: "image", gif: "image", webp: "image", avif: "image",
};

/** Classify a by-URL attachment from its file extension; a URL whose
 *  kind can't be told can't be attached (the server validates too). */
export function dmAttachmentKindForUrl(url: string): DmAttachmentType | null {
  try {
    const m = /\.([a-z0-9]{2,5})(?:\?|#|$)/i.exec(new URL(url.trim()).pathname);
    return m ? (DM_EXT_KIND[m[1]!.toLowerCase()] ?? null) : null;
  } catch {
    return null;
  }
}

/** The file's own name out of a URL (what the work is titled). */
export function dmAttachmentNameForUrl(url: string): string {
  try {
    const last = new URL(url.trim()).pathname.split("/").filter(Boolean).pop() ?? "";
    const name = decodeURIComponent(last).trim();
    return name.length > 0 ? name.slice(0, 200) : "Shared work";
  } catch {
    return "Shared work";
  }
}

/** How a piece of work is introduced in-thread — a creator hand-off
 *  is presented as the work it is, never as a bare file. */
export function dmWorkLabel(type: DmAttachmentType): string {
  return type === "audio" ? "Beat" : type === "video" ? "Clip" : "Artwork";
}

/* ─── DM thread search ────────────────────────────────────────────── */

function dmHaystack(parts: readonly (string | null | undefined)[]): string {
  return parts.filter((p) => typeof p === "string").join(" ").toLowerCase();
}

/** Search inside the open thread: words and work titles both count. */
export function dmMessageMatches(m: DmMessage, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return dmHaystack([m.body, m.attachment_name]).includes(q);
}

export function dmFilterMessages(messages: readonly DmMessage[], query: string): DmMessage[] {
  return messages.filter((m) => dmMessageMatches(m, query));
}

/** Search the conversation list: the creator's name, their slug, the
 *  last words, or the title of the last piece of work sent. */
export function dmConversationMatches(c: DmConversation, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return dmHaystack([
    c.other.profile?.displayName, c.other.profile?.slug,
    c.last_message?.body, c.last_message?.attachment_name,
  ]).includes(q);
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

/** Answer a thread in-world (the social rails' own reply route;
 *  body obeys the same 1–500 gate as a board post). */
export function postReplyPath(postId: string): string {
  return `/api/posts/${encodeURIComponent(postId)}/reply`;
}

/* ─── Reply-drafts bench (2.19) ─────────────────────────────────────
   The community page's drafting bench, docked at the board:
   POST /api/comment-replies drafts one reply per pasted comment in a
   chosen tone. It CHARGES per batch — the price is never hardcoded
   here: the desk reads it from GET /api/comment-replies/meta, which
   reports the server's own charge constant. */
export const COMMENT_REPLIES_PATH = "/api/comment-replies";
export const COMMENT_REPLIES_META_PATH = "/api/comment-replies/meta";

/** Tone keys mirror the server's TONES enum exactly. */
export const REPLY_DRAFT_TONES = [
  { key: "hype", label: "Hype" },
  { key: "grateful", label: "Grateful" },
  { key: "playful", label: "Playful" },
  { key: "professional", label: "Professional" },
] as const;
export type ReplyDraftTone = (typeof REPLY_DRAFT_TONES)[number]["key"];

/** Split the bench's paste box into the batch the route accepts:
 *  one comment per line, at most maxComments (the route's own cap,
 *  reported by its meta). */
export function replyDraftBatch(text: string, maxComments: number): string[] {
  const cap = Math.max(1, Math.floor(maxComments) || 1);
  return text
    .split("\n")
    .map((c) => c.trim())
    .filter((c) => c.length > 0)
    .slice(0, cap);
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

/** The reaction set the board offers — the head of the site's reaction
 *  keys (the two a notice board needs at a glance). Art comes from the
 *  King's set via lib/king-emoji's REACTION_ART. */
export const BOARD_REACTIONS = [
  { emoji: "like", label: "Like" },
  { emoji: "fire", label: "Fire" },
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

/** Full threads (2.18): opening a thread shows the WHOLE conversation
 *  — every reply the replies rail returns (the route caps at 100),
 *  never a 3-reply preview. This helper exists so the count the card
 *  states is the count it renders. */
export function fullThread<T>(replies: readonly T[]): T[] {
  return [...replies];
}

/* ─── Full threads (2.18) — nested + honest ─────────────────────────
   The site's data nests a conversation by reply chains: every reply
   is itself a post carrying its own server reply_count, and its
   children ride the same replies rail. The Hall renders that nesting
   as-is — a node expands to fetch its own children — under two laws:
   a count is the server's count plus the replies this session landed
   (never a client-side guess), and a FAILED load is a failed state
   with a retry, never an empty thread. */

/** Where one node's children stand: not asked, fetching, in hand,
 *  or failed. "failed" renders as a failure — never as "no replies". */
export type ThreadLoadState = "idle" | "loading" | "ready" | "failed";

/** The count a thread toggle states: the server's reply_count for
 *  the post, plus each reply this session landed (the server bumps
 *  its count by exactly one per landed reply — Now Playing honesty,
 *  stack-20 #12's rule). */
export function threadCountOf(serverReplyCount: number, landedReplies: number): number {
  const server = Math.max(0, Math.floor(serverReplyCount) || 0);
  const landed = Math.max(0, Math.floor(landedReplies) || 0);
  return server + landed;
}

/** The toggle's words for a count: zero stays a plain invitation,
 *  and an open thread says what tapping again does. */
export function threadToggleLabel(count: number, open: boolean): string {
  if (count <= 0) return "Replies";
  const noun = count === 1 ? "reply" : "replies";
  return open ? `Hide ${count} ${noun}` : `${count} ${noun}`;
}

/** Merge a fresh fetch of a node's children with the replies this
 *  session landed while the node was collapsed: fetched order first
 *  (the server's order), landed extras appended in landing order,
 *  deduped by id — a reply that lands before the fetch returns is
 *  in the fetch too, and must never render twice. */
export function mergeThreadChildren<T extends { id: string }>(
  fetched: readonly T[],
  landed: readonly T[],
): T[] {
  const seen = new Set(fetched.map((r) => r.id));
  return [...fetched, ...landed.filter((r) => !seen.has(r.id))];
}

/** Guests read the whole thread; the composer is members-only,
 *  here and at every nested node (the reply rail is requireAuth
 *  server-side regardless — this keeps the desk honest, not open). */
export function threadReplyAllowed(isGuest: boolean): boolean {
  return !isGuest;
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
] as const;

/* Ring 2 promotions (UPGRADE-PROGRAM §2.17–2.19), built and no longer
   follow-ons: DM attachments + thread search at the Post Office,
   full post threads in the Community Hall, and the reply-drafts
   bench docked at the board. Named here so the record shows what
   graduated, in the program's own numbering. */
export const SOCIAL_RING2_PROMOTIONS = [
  { id: "dm-attachments", item: "2.17", label: "DM attachments + thread search at the Post Office" },
  { id: "full-comment-threads", item: "2.18", label: "Full post threads in the Community Hall" },
  { id: "reply-drafts-bench", item: "2.19", label: "Reply-drafts bench at the board" },
] as const;
