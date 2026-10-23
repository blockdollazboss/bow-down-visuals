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
 *   GET  /api/posts/:id/reply-draft       → { draft } (R2 #8: my saved reply + its tone)
 *   PUT  /api/posts/:id/reply-draft       { body, tone? } (an empty body clears it)
 *   DELETE /api/posts/:id/reply-draft     (clear my saved reply)
 *   POST /api/comment-replies             { comments, tone, voiceNotes } → { replies }
 *   GET  /api/comment-replies/meta        → { cost, tones, maxComments }
 *
 * NOTE on methods: superfans/sentiment are POST on the server (they
 * analyse a comments batch and charge for the run) — there is no
 * GET form. The desk derives the batch from the board's own recent
 * posts, so the analysis is about THIS room's conversation, and the
 * run only happens on an explicit tap with its price shown.
 *
 * Moderation was transfer-only in v1; Social Wave II (stack-100
 * #82) promoted it: the ADMIN bench rides the admin page's own
 * rails (GET /api/admin/status gates it, fail-closed; the queues
 * and the content-removal rail live below). The community page's
 * charged AI scan (POST /api/community/moderate) is a member tool,
 * not the admin bench, and is not part of that promotion.
 *
 * Social Wave II rails (stack-100 #79–#84, verbatim from the 2D
 * pages — feed.tsx, PostCard.tsx, DropsWire, explore.tsx,
 * discovery/search.tsx, admin.tsx, artist-public/artist-setup):
 *   GET  /api/feed?mode=chrono|foryou&limit=20&before=…  → { posts }
 *   GET  /api/discovery/feed?limit=40                    → { items } (New Drops)
 *   POST /api/posts/:id/repost                           (PostCard)
 *   POST /api/saves            { kind:"post", target_id } (PostCard save)
 *   DELETE /api/saves/post/:id                           (PostCard unsave)
 *   DELETE /api/posts/:id                                (author-only, server-gated)
 *   POST /api/posts/:id/poll/vote  { option_id } → { poll }
 *   GET  /api/explore                                    → { shorts, creators, posts, events, groups }
 *   GET  /api/discovery/search?q=…&type=…                → { creators, tracks, videos, playlists }
 *   GET  /api/admin/status                               → { isAdmin }
 *   GET  /api/admin/reports · /api/admin/dmca-reports     → { reports }
 *   PATCH /api/admin/reports/:id · /api/admin/dmca-reports/:id  { status }
 *   GET  /api/admin/content/removed                      → { content }
 *   GET  /api/admin/content/:id                          → { content }
 *   PATCH /api/admin/content/:id  { removed, reason?, note? }
 *   GET  /api/creator-profiles/me                        → owner profile (+ referral_code)
 *   GET  /api/creator-profiles/:slug                     → { profile, counts, top_tracks, top_videos, playlists }
 *   PUT  /api/creator-profiles/me                        { bio, display_name, social_links, … }
 *   GET|PUT /api/creator-profiles/me/layout              { layout }
 *   GET|PUT /api/creator-profiles/me/theme-settings      { colorway, headingFont, bodyFont }
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

/** Split a thread text (a message body, a piece of work's title)
 *  around every case-insensitive match so the desk can light the
 *  match up in place inside the messages it shows — the website
 *  page's own splitter, mirrored (dmHighlightSegments in
 *  lib/dm-attachments). An empty query yields the whole text as
 *  one un-hit segment. */
export function dmThreadHighlightSegments(
  text: string,
  query: string,
): { text: string; hit: boolean }[] {
  const q = query.trim();
  if (!q) return [{ text, hit: false }];
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const out: { text: string; hit: boolean }[] = [];
  let i = 0;
  for (;;) {
    const at = lower.indexOf(needle, i);
    if (at === -1) break;
    if (at > i) out.push({ text: text.slice(i, at), hit: false });
    out.push({ text: text.slice(at, at + needle.length), hit: true });
    i = at + needle.length;
  }
  if (i < text.length) out.push({ text: text.slice(i), hit: false });
  return out.length > 0 ? out : [{ text, hit: false }];
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

/* ─── Post reply drafts (2.19 — the bench the words rest on) ────────
   The per-post composer's in-progress reply, held on the SERVER —
   one draft per member per board post (migration 0160) — so a
   half-written answer survives the thread closing, leaving the Hall,
   a phone reload, and comes back on any device, in the tone it was
   drafted in. The tone rides the draft as metadata (the assistant's
   own set, REPLY_DRAFT_TONES); no generation is wired to it. GET
   reads mine, PUT saves (an empty body clears), DELETE clears; a
   landed reply clears server-side too. Before this rail the composer
   was one useState on the card: any close or unmount lost the words. */

export function postReplyDraftPath(postId: string): string {
  return `/api/posts/${encodeURIComponent(postId)}/reply-draft`;
}

/** The reply route's own cap, and the composer's (replySchema). */
export const REPLY_DRAFT_MAX = 500;

export interface PostReplyDraft {
  body: string;
  tone: ReplyDraftTone;
  updatedAt: string | null;
}

/** Guard a draft payload into the one saved reply (or null): anything
 *  that isn't the server's shape reads as "no draft" — never a crash,
 *  and never junk text landing in the composer. The WORDS are the
 *  valuable part: a tone string the bench doesn't know falls back to
 *  the default tone rather than dropping the draft. A saved draft is
 *  never empty (the server clears instead of storing blanks). */
export function normalizePostReplyDraft(payload: unknown): PostReplyDraft | null {
  const d = (payload as { draft?: unknown } | null | undefined)?.draft;
  if (!d || typeof d !== "object") return null;
  const body = (d as { body?: unknown }).body;
  if (typeof body !== "string" || body.length === 0) return null;
  const toneRaw = (d as { tone?: unknown }).tone;
  const tone: ReplyDraftTone = REPLY_DRAFT_TONES.some((t) => t.key === toneRaw)
    ? (toneRaw as ReplyDraftTone)
    : "hype";
  const updatedAt = (d as { updated_at?: unknown }).updated_at;
  return { body, tone, updatedAt: typeof updatedAt === "string" ? updatedAt : null };
}

/** What the desk owes the server for the composer's current state:
 *  "skip" — the server already holds exactly these words in this
 *  tone (or the composer is blank over nothing saved); "clear" — the
 *  composer went blank over a saved draft, so retire it (a PUT with
 *  an empty body); "save" — new words, or the same words retuned. */
export type PostReplyDraftSaveDecision = "skip" | "clear" | "save";
export function postReplyDraftSaveDecision(
  text: string,
  tone: ReplyDraftTone,
  saved: { body: string; tone: ReplyDraftTone } | null,
): PostReplyDraftSaveDecision {
  if (text.trim().length === 0) return saved ? "clear" : "skip";
  if (saved && saved.body === text && saved.tone === tone) return "skip";
  return "save";
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

/** Guests read a reply's reaction counts; the tap itself is
 *  members-only, here and at every nested node — a reply rides the
 *  post reaction rail (it IS a post row), and that rail is
 *  requireAuth server-side regardless — this keeps the desk honest,
 *  not open. Mirrors threadReplyAllowed for the composer. */
export function threadReactAllowed(isGuest: boolean): boolean {
  return !isGuest;
}

/* ═══ Social Wave II (stack-100 #79–#84) ═══════════════════════════
   The Hall's second social wave: the feed grows its 2D views and
   verbs, Explore + search move in, the ADMIN moderation bench is
   promoted off the website, and the walker's own public profile
   becomes viewable + editable in-world. Every rail below is the
   2D page's own — traced, never invented. */

/* ─── #79 Feed views + pagination ──────────────────────────────────
   feed.tsx's exact contract: mode=chrono|foryou, limit=20, and the
   `before` cursor is the last loaded post's created_at. The Drops
   view is a different rail entirely (DropsWire): the discovery
   releases wire, limit=40, no cursor. */

export const FEED_PAGE_SIZE = 20;

export type FeedMode = "chrono" | "foryou";
export type FeedView = FeedMode | "drops";

export const FEED_VIEWS: { key: FeedView; label: string }[] = [
  { key: "chrono", label: "Latest" },
  { key: "foryou", label: "For You" },
  { key: "drops", label: "New Drops" },
];

export function feedPagePath(mode: FeedMode, before?: string | null): string {
  const q = new URLSearchParams({ mode, limit: String(FEED_PAGE_SIZE) });
  if (before) q.set("before", before);
  return `/api/feed?${q.toString()}`;
}

/** feed.tsx's rule: a full page means there may be more; a short
 *  page is the end of the river. */
export function feedHasMore(pageLength: number): boolean {
  return pageLength === FEED_PAGE_SIZE;
}

/** Append a fetched page to the loaded river, deduped by id — the
 *  cursor is a timestamp, and a post sharing the boundary second
 *  must never render twice. */
export function mergeFeedPage<T extends { id: string }>(
  existing: readonly T[],
  page: readonly T[],
): T[] {
  const seen = new Set(existing.map((p) => p.id));
  return [...existing, ...page.filter((p) => !seen.has(p.id))];
}

export const DROPS_PATH = "/api/discovery/feed?limit=40";

/** One New Drops row (DropsWire's FeedItem over discovery's
 *  TrackLite): a release — track or video — from a followed creator. */
export interface DropItem {
  id: string;
  kind: "track" | "video";
  title: string;
  slug?: string;
  display_name?: string;
  thumb: string | null;
  created_at: string;
  source?: "following" | "discovery";
  why?: { kind: string; label: string } | null;
}

export function normalizeDrops(payload: unknown): DropItem[] {
  const items = (payload as { items?: unknown } | null | undefined)?.items;
  if (!Array.isArray(items)) return [];
  return items.filter(
    (i): i is DropItem =>
      !!i && typeof i === "object" && typeof (i as DropItem).id === "string",
  );
}

/* ─── #80 Feed verbs (PostCard's exact rails) ────────────────────── */

export const SAVES_PATH = "/api/saves";

export function repostPath(postId: string): string {
  return `/api/posts/${encodeURIComponent(postId)}/repost`;
}

export function saveRemovePath(postId: string): string {
  return `/api/saves/post/${encodeURIComponent(postId)}`;
}

export function postDeletePath(postId: string): string {
  return `/api/posts/${encodeURIComponent(postId)}`;
}

export function pollVotePath(postId: string): string {
  return `/api/posts/${encodeURIComponent(postId)}/poll/vote`;
}

/** Member verbs are members-only in-world exactly as on the rails:
 *  guests read the board (and a poll's standing), they never tap.
 *  Mirrors threadReplyAllowed/threadReactAllowed. */
export function feedVerbAllowed(isGuest: boolean): boolean {
  return !isGuest;
}

/** Delete is the author's own verb — PostCard renders it for every
 *  card and the server 403s strangers; in-world we only OFFER it on
 *  the walker's own posts (profile id match), and the server still
 *  enforces regardless of what the client shows. */
export function postIsOwn(
  post: { profile_id: string },
  myProfileId: string | null,
): boolean {
  return !!myProfileId && post.profile_id === myProfileId;
}

export interface PollLike {
  options: Array<{ id: string; option_text: string; vote_count: number }>;
  viewer_option_id: string | null;
}

export function pollTotalVotes(poll: PollLike): number {
  return poll.options.reduce((a, o) => a + (o.vote_count || 0), 0);
}

export function pollPercent(poll: PollLike, optionId: string): number {
  const total = pollTotalVotes(poll);
  if (total <= 0) return 0;
  const opt = poll.options.find((o) => o.id === optionId);
  return opt ? Math.round((opt.vote_count / total) * 100) : 0;
}

/** A poll takes a vote only from a member who hasn't voted — the
 *  card disables on viewer_option_id; one member, one vote, and
 *  the server refuses a second regardless. */
export function pollVotable(poll: PollLike | null, isGuest: boolean): boolean {
  return !!poll && !isGuest && !poll.viewer_option_id;
}

/* ─── #81 Explore + discovery search ─────────────────────────────── */

export const EXPLORE_PATH = "/api/explore";

export type DiscoverySearchType = "all" | "creator" | "track" | "video" | "playlist";

export const DISCOVERY_SEARCH_TYPES: { key: DiscoverySearchType; label: string }[] = [
  { key: "all", label: "Everything" },
  { key: "creator", label: "Creators" },
  { key: "track", label: "Audio" },
  { key: "video", label: "Videos" },
  { key: "playlist", label: "Playlists" },
];

/** discovery/search.tsx's exact query: q + type ride every search;
 *  an empty box never fires the rail (the page renders no results
 *  state until a query commits). */
export function discoverySearchPath(query: string, type: DiscoverySearchType): string | null {
  const q = query.trim();
  if (!q) return null;
  const params = new URLSearchParams({ q, type });
  return `/api/discovery/search?${params.toString()}`;
}

export interface SearchCreatorHit {
  id: string; slug: string; display_name: string;
  avatar_url: string | null; vertical?: string; follower_count?: number;
}
export interface SearchWorkHit {
  id: string; title: string; slug?: string; display_name?: string;
}
export interface DiscoverySearchResults {
  creators: SearchCreatorHit[];
  tracks: SearchWorkHit[];
  videos: SearchWorkHit[];
  playlists: SearchWorkHit[];
}

export function normalizeSearchResults(payload: unknown): DiscoverySearchResults {
  const p = (payload ?? {}) as Record<string, unknown>;
  const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  return {
    creators: arr<SearchCreatorHit>(p["creators"]),
    tracks: arr<SearchWorkHit>(p["tracks"]),
    videos: arr<SearchWorkHit>(p["videos"]),
    playlists: arr<SearchWorkHit>(p["playlists"]),
  };
}

export function searchHasResults(r: DiscoverySearchResults): boolean {
  return r.creators.length + r.tracks.length + r.videos.length + r.playlists.length > 0;
}

/* ─── #82 The admin moderation bench ───────────────────────────────
   admin.tsx's bench, verbatim rails: the member-report queue, the
   DMCA queue, and the content-removal rail. EVERY one is
   requireAuth + requireAdmin server-side (ADMIN_EMAILS allowlist,
   fail-closed when unset) — the bench additionally gates its own
   rendering on GET /api/admin/status, so a non-admin never even
   sees a verb. Peace law: the client showing a button is never
   the enforcement; the server re-checks on every call. */

export const ADMIN_STATUS_PATH = "/api/admin/status";
export const ADMIN_REPORTS_PATH = "/api/admin/reports";
export const ADMIN_DMCA_REPORTS_PATH = "/api/admin/dmca-reports";
export const ADMIN_CONTENT_REMOVED_PATH = "/api/admin/content/removed";

/** The two queues share one workflow vocabulary (the server's
 *  CONTENT_REPORT_STATUSES / DMCA_REPORT_STATUSES — identical). */
export const REPORT_STATUSES = ["new", "reviewing", "actioned", "dismissed"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export type AdminQueueKind = "reports" | "dmca-reports";

export function adminQueuePath(kind: AdminQueueKind): string {
  return kind === "reports" ? ADMIN_REPORTS_PATH : ADMIN_DMCA_REPORTS_PATH;
}

export function adminQueueItemPath(kind: AdminQueueKind, id: string): string {
  return `${adminQueuePath(kind)}/${encodeURIComponent(id)}`;
}

export function adminContentPath(id: string): string {
  return `/api/admin/content/${encodeURIComponent(id)}`;
}

/** The bench renders ONLY on a confirmed admin status. Anything
 *  else — member, guest, a failed status read — renders nothing:
 *  fail-closed, like the server. */
export function moderationBenchVisible(isAdmin: boolean | null): boolean {
  return isAdmin === true;
}

export interface AdminReportRow {
  id: string;
  status: string;
  createdAt: string | null;
  /* member-report fields */
  reporterUserId?: string;
  targetType?: string;
  targetId?: string;
  targetSummary?: string;
  reason?: string;
  note?: string | null;
  /* dmca fields */
  reporterName?: string;
  reporterEmail?: string;
  reporterOrg?: string | null;
  description?: string;
  infringingUrls?: string[];
}

export interface AdminContentState {
  id: string;
  kind: "post" | "comment";
  body: string;
  author: { slug: string; displayName: string } | null;
  removed: boolean;
  removalReason: string | null;
}

export function normalizeAdminReports(payload: unknown): AdminReportRow[] {
  const rows = (payload as { reports?: unknown } | null | undefined)?.reports;
  return Array.isArray(rows) ? (rows as AdminReportRow[]) : [];
}

export function normalizeAdminContent(payload: unknown): AdminContentState | null {
  const c = (payload as { content?: unknown } | null | undefined)?.content;
  if (!c || typeof c !== "object") return null;
  const row = c as AdminContentState;
  return typeof row.id === "string" ? row : null;
}

export function normalizeRemovedContent(payload: unknown): AdminContentState[] {
  const rows = (payload as { content?: unknown } | null | undefined)?.content;
  return Array.isArray(rows) ? (rows as AdminContentState[]) : [];
}

/* ─── #83/#84 Own profile — view as a visitor, edit as the owner ──
   The public read is the artist page's own payload (profile +
   counts + top tracks/videos); the owner read adds referral_code.
   Edits ride the SAME three rails artist-setup + the profile
   editor ride: PUT /creator-profiles/me (bio/name/socials/…),
   PUT …/me/layout (blocks, server-validated), PUT
   …/me/theme-settings (colorway/fonts, server-validated). */

export const MY_PROFILE_PATH = "/api/creator-profiles/me";
export const MY_LAYOUT_PATH = "/api/creator-profiles/me/layout";
export const MY_THEME_SETTINGS_PATH = "/api/creator-profiles/me/theme-settings";

export function publicProfilePath(slug: string): string {
  return `/api/creator-profiles/${encodeURIComponent(slug)}`;
}

export interface OwnProfile {
  id: string;
  slug: string;
  display_name: string;
  bio: string | null;
  avatar_url: string | null;
  banner_url: string | null;
  vertical: string | null;
  is_public: boolean;
  follower_count: number;
  total_plays: number;
  social_links: Record<string, string>;
  referral_code: string | null;
}

export interface PublicProfileView {
  profile: OwnProfile;
  counts: { tracks: number; videos: number; playlists: number };
  topTracks: { id: string; title: string; play_count?: number }[];
  topVideos: { id: string; title: string; view_count?: number }[];
}

function asOwnProfile(raw: unknown): OwnProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  if (typeof p["id"] !== "string" || typeof p["slug"] !== "string") return null;
  return {
    id: p["id"],
    slug: p["slug"],
    display_name: typeof p["display_name"] === "string" ? p["display_name"] : "Creator",
    bio: typeof p["bio"] === "string" ? p["bio"] : null,
    avatar_url: typeof p["avatar_url"] === "string" ? p["avatar_url"] : null,
    banner_url: typeof p["banner_url"] === "string" ? p["banner_url"] : null,
    vertical: typeof p["vertical"] === "string" ? p["vertical"] : null,
    is_public: p["is_public"] !== false,
    follower_count: typeof p["follower_count"] === "number" ? p["follower_count"] : 0,
    total_plays: typeof p["total_plays"] === "number" ? p["total_plays"] : 0,
    social_links:
      p["social_links"] && typeof p["social_links"] === "object"
        ? (p["social_links"] as Record<string, string>)
        : {},
    referral_code: typeof p["referral_code"] === "string" ? p["referral_code"] : null,
  };
}

/** The owner read (GET /me) is the bare profile object. */
export function normalizeOwnProfile(payload: unknown): OwnProfile | null {
  return asOwnProfile(payload);
}

/** The visitor read (GET /:slug) wraps the profile with counts and
 *  the top shelves. A private/missing profile 404s server-side, so
 *  a payload without a profile is honestly "no page to show". */
export function normalizePublicProfile(payload: unknown): PublicProfileView | null {
  const p = (payload ?? {}) as Record<string, unknown>;
  const profile = asOwnProfile(p["profile"]);
  if (!profile) return null;
  const counts = (p["counts"] ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" ? v : 0);
  const rows = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  return {
    profile,
    counts: { tracks: num(counts["tracks"]), videos: num(counts["videos"]), playlists: num(counts["playlists"]) },
    topTracks: rows(p["top_tracks"]),
    topVideos: rows(p["top_videos"]),
  };
}

/** artist-setup.tsx's social platform set, verbatim. */
export const SOCIAL_PLATFORMS = [
  "instagram", "tiktok", "youtube", "x", "twitch", "spotify", "website",
] as const;

/** Editor rows: the platform set first (blank where unset), then
 *  any extra keys the profile already carries — nothing is dropped
 *  by opening the editor. */
export function socialLinkRows(
  links: Record<string, string> | null | undefined,
): { platform: string; url: string }[] {
  const src = links ?? {};
  const rows = SOCIAL_PLATFORMS.map((platform) => ({
    platform: platform as string,
    url: typeof src[platform] === "string" ? src[platform] : "",
  }));
  for (const key of Object.keys(src)) {
    if (!(SOCIAL_PLATFORMS as readonly string[]).includes(key)) {
      rows.push({ platform: key, url: typeof src[key] === "string" ? src[key] : "" });
    }
  }
  return rows;
}

/** Rows back to the wire shape: trimmed, blanks dropped (an emptied
 *  field unlinks the platform — the setup page's own semantics of
 *  saving the record as edited). */
export function socialLinksFromRows(
  rows: readonly { platform: string; url: string }[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) {
    const url = r.url.trim();
    if (url) out[r.platform] = url;
  }
  return out;
}

/** The basics patch gate, mirroring updateMeSchema on the server:
 *  display_name 1–80 trimmed, bio ≤ 2000. The server re-validates;
 *  this keeps the desk from firing a save it knows will 400. */
export function profileBasicsReady(displayName: string, bio: string): boolean {
  const name = displayName.trim();
  return name.length >= 1 && name.length <= 80 && bio.length <= 2000;
}

/** The share link artist-setup/profile-sections build: my public
 *  page, with my referral code riding along (?ref=CODE). Null when
 *  no code has been minted — the desk says so instead of faking
 *  a link. */
export function referralShareUrl(
  origin: string,
  slug: string,
  code: string | null | undefined,
): string | null {
  if (!code) return null;
  return `${origin}/artist/${encodeURIComponent(slug)}?ref=${encodeURIComponent(code)}`;
}

/* ─── The parity follow-on log (NATIVE-PLAN §3.4, v1 scope line) ───
   Everything behind these two stations that stays TRANSFER-ONLY,
   named so the next lane promotes benches deliberately, never
   by drift. Social Wave II (#79–#84) promoted the last entry —
   the log is empty, on purpose, and the test pins it empty. */
export const SOCIAL_NATIVE_FOLLOW_ONS: readonly {
  id: string; label: string; note: string;
}[] = [];

/* Social Wave II promotions (stack-100 #79–#84), built and no
   longer follow-ons — named here so the record shows what
   graduated, in the board's own numbering. */
export const SOCIAL_WAVE2_PROMOTIONS = [
  { id: "feed-views-pagination", item: "79", label: "Feed parity: Latest / For You / New Drops views + cursor pagination in the Hall" },
  { id: "feed-verbs", item: "80", label: "Feed verbs in-world: repost, save, delete own post, poll vote" },
  { id: "explore-search", item: "81", label: "Explore + creator/work search in the Hall" },
  { id: "moderation-bench", item: "82", label: "Admin moderation bench in the Hall (admin-only, fail-closed)" },
  { id: "own-profile-view", item: "83", label: "Own-profile view in-world (my public page as visitors see it)" },
  { id: "profile-editing", item: "84", label: "Profile editing in-world (bio, blocks, theme, socials, referral)" },
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
