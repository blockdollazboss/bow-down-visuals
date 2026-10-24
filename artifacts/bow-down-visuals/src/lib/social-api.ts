/* ─── Worker 8 — Social API client (stories / posts / reactions / saves) ────
   Link-graph rule (standing): every surface links somewhere real.
     @mentions        → /artist/:slug        (Worker 4's profile page)
     avatars          → /artist/:slug
     story viewer     → creator profile (/artist/:slug) in the header
     track attachment → /track/:id           (Worker 2's sound page)
     video attachment → /watch/:id           (Worker 2's video page)
     product attach   → /store/buy/:kind/:id (the drop page — BUY inline)
     event attachment → /shows               (events page; /events/:id TBD)
     #hashtags        → /hashtag/:tag         (this worker's page)
     trending topics  → /hashtag/:tag
   attachmentLink() is the single source of truth — if it can't resolve a
   link for an attachment, that attachment is a bug and must not render. */

export interface SocialAuthor {
  id: string;
  slug: string;
  display_name: string;
  avatar_url: string | null;
  is_verified: boolean;
}

/* `alt` (#29): the accessibility description of the attachment's image
   (video: its cover frame; track/watch: artwork/thumb; product: the
   product shot). Creator-written or AI-suggested, editable before it
   ships; renders as the image's alt / aria description everywhere the
   post travels. Scene/objects/text/mood only — never a person's name. */
export type Attachment =
  | { kind: "image"; url: string; alt?: string }
  | { kind: "video"; url: string; thumb?: string; alt?: string }
  | { kind: "track"; id: string; title?: string; artwork?: string; artistSlug?: string; alt?: string }
  | { kind: "watch"; id: string; title?: string; thumb?: string; artistSlug?: string; alt?: string }
  | { kind: "product"; id: string; kindSlug: string; title?: string; image?: string; storeSlug?: string; alt?: string }
  | { kind: "event"; id: string; title?: string; date?: string; venue?: string }
  | { kind: "poll"; question?: string };

/** Loose shape for anything the API hands back (validated server-side). */
export type LooseAttachment = Attachment | { kind: string; [k: string]: unknown };

export function asAttachment(a: LooseAttachment): Attachment | null {
  switch (a.kind) {
    case "image":
      return typeof a.url === "string" ? { kind: "image", url: a.url, alt: altStr(a.alt) } : null;
    case "video":
      return typeof a.url === "string"
        ? { kind: "video", url: a.url, thumb: typeof a.thumb === "string" ? a.thumb : undefined, alt: altStr(a.alt) }
        : null;
    case "track":
      return typeof a.id === "string"
        ? { kind: "track", id: a.id, title: str(a.title), artwork: str(a.artwork), artistSlug: str(a.artistSlug), alt: altStr(a.alt) }
        : null;
    case "watch":
      return typeof a.id === "string"
        ? { kind: "watch", id: a.id, title: str(a.title), thumb: str(a.thumb), artistSlug: str(a.artistSlug), alt: altStr(a.alt) }
        : null;
    case "product":
      return typeof a.id === "string" && typeof a.kindSlug === "string"
        ? { kind: "product", id: a.id, kindSlug: a.kindSlug, title: str(a.title), image: str(a.image), storeSlug: str(a.storeSlug), alt: altStr(a.alt) }
        : null;
    case "event":
      return typeof a.id === "string"
        ? { kind: "event", id: a.id, title: str(a.title), date: str(a.date), venue: str(a.venue) }
        : null;
    case "poll":
      return { kind: "poll", question: str(a.question) };
    default:
      return null;
  }
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/** Alt text passthrough: non-empty strings only, capped at the server's
 *  400-char limit so a hand-crafted payload can't resurrect a wall of
 *  text as an "alt". */
function altStr(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim().slice(0, 400);
  return t ? t : undefined;
}

export interface PollData {
  options: Array<{ id: string; option_text: string; vote_count: number }>;
  viewer_option_id: string | null;
}

export interface FeedPost {
  id: string;
  profile_id: string;
  body: string;
  media_urls: LooseAttachment[];
  kind: string;
  reply_to: string | null;
  quote_of: string | null;
  repost_of: string | null;
  group_id: string | null;
  scheduled_for: string | null;
  audience: string;
  like_count: number;
  repost_count: number;
  reply_count: number;
  created_at: string;
  /* Moderation state (Stack-4): the server only ever serves a
     removed post to its own author, with these attached — the card
     renders the "Removed by moderation" tombstone from them. The
     reason is the recorded CATEGORY only. */
  moderation_removed?: boolean;
  removal_reason?: string | null;
  author: SocialAuthor | null;
  viewer_emoji: string | null;
  viewer_saved: boolean;
  reaction_counts: Record<string, number>;
  quoted: FeedPost | null;
  poll: PollData | null;
  /** For-You v1 (Stack 9 #4): the honest reason this post is in your
     For You feed — derived from the actual ranking signal. */
  why?: { kind: string; label: string } | null;
}

export interface Story {
  id: string;
  profile_id: string;
  media_url: string;
  media_kind: string;
  caption: string;
  audience?: string;
  view_count: number;
  expires_at: string;
  created_at: string;
  author: SocialAuthor | null;
}

export interface StoryHighlight {
  id: string;
  profile_id: string;
  title: string;
  cover_url: string | null;
  story_ids: string[];
  created_at: string;
}

export interface TrendingTopic {
  tag: string;
  posts: number;
  videos: number;
  velocity: number;
}

/** Resolve an attachment to its destination. null = unlinked = do not render. */
export function attachmentLink(a: Attachment): { href: string; label: string } | null {
  switch (a.kind) {
    case "track":
      return a.id ? { href: `/track/${a.id}`, label: a.title || "Listen" } : null;
    case "watch":
      return a.id ? { href: `/watch/${a.id}`, label: a.title || "Watch" } : null;
    case "product": {
      if (a.storeSlug) return { href: `/shop/${a.storeSlug}`, label: a.title || "Shop" };
      if (a.id && a.kindSlug) return { href: `/store/buy/${a.kindSlug}/${a.id}`, label: a.title || "Buy now" };
      return null;
    }
    case "event":
      return a.id ? { href: "/shows", label: a.title || "Event" } : null;
    default:
      return null;
  }
}

export function profileHref(author: SocialAuthor | null | undefined): string {
  return author?.slug ? `/artist/${author.slug}` : "/home";
}

/* ── Shared fetch timeout (Stack-28 #28 / A3-F6) ─────────────────────
   Following the in-codebase model in lib/earnings-data.ts (per-attempt
   AbortController timeout): a connection that opens and then STALLS
   used to leave every consumer's loading state pending forever — no
   error, no retry. apiFetch now aborts a stalled request after
   API_FETCH_TIMEOUT_MS so the caller's per-section error state can
   render instead.

   OPT-OUT (documented): a legitimately long call — media generation,
   a large upload, an export/render submission — passes
   `{ timeoutMs: null }` (or 0) as apiFetch/apiJson's 4th argument to
   disable the timeout for that call only. A caller-supplied
   init.signal always still applies and aborts the request itself. */
export const API_FETCH_TIMEOUT_MS = 15_000;

export interface ApiFetchOptions {
  /** Milliseconds before a stalled request aborts. `null`/`0` = no
   *  timeout (the documented opt-out for long legitimate calls). */
  timeoutMs?: number | null;
}

/** Merge a caller signal with a timeout into one AbortSignal.
 *  Returns the signal plus a cancel() that disarms the timer once the
 *  request has settled (so a completed request is never aborted
 *  after the fact). */
export function signalWithTimeout(
  callerSignal: AbortSignal | null | undefined,
  timeoutMs: number | null | undefined,
): { signal: AbortSignal | undefined; cancel: () => void } {
  if (timeoutMs === null || timeoutMs === undefined || timeoutMs <= 0) {
    return { signal: callerSignal ?? undefined, cancel: () => undefined };
  }
  const controller = new AbortController();
  const onCallerAbort = () => controller.abort(callerSignal?.reason);
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort(callerSignal.reason);
    else callerSignal.addEventListener("abort", onCallerAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cancel: () => {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", onCallerAbort);
    },
  };
}

export async function apiFetch(
  getAccessToken: () => Promise<string | null>,
  path: string,
  init?: RequestInit,
  options?: ApiFetchOptions,
): Promise<Response> {
  const token = await getAccessToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const timeoutMs = options && "timeoutMs" in options ? options.timeoutMs : API_FETCH_TIMEOUT_MS;
  const { signal, cancel } = signalWithTimeout(init?.signal, timeoutMs);
  try {
    return await fetch(path, { ...init, signal, headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) } });
  } finally {
    cancel();
  }
}

export async function apiJson<T>(
  getAccessToken: () => Promise<string | null>,
  path: string,
  init?: RequestInit,
  options?: ApiFetchOptions,
): Promise<T> {
  const res = await apiFetch(getAccessToken, path, init, options);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { message?: string }).message || `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

/* Stories viewed state lives client-side (localStorage) — the server only
   counts views. Gold ring = unviewed. */
const SEEN_KEY = "bdv_seen_stories_v1";
export function getSeenStories(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}
export function markStorySeen(id: string) {
  try {
    const seen = getSeenStories();
    seen.add(id);
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-500)));
  } catch { /* ignore */ }
}
