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

export type Attachment =
  | { kind: "image"; url: string }
  | { kind: "video"; url: string; thumb?: string }
  | { kind: "track"; id: string; title?: string; artwork?: string; artistSlug?: string }
  | { kind: "watch"; id: string; title?: string; thumb?: string; artistSlug?: string }
  | { kind: "product"; id: string; kindSlug: string; title?: string; image?: string; storeSlug?: string }
  | { kind: "event"; id: string; title?: string; date?: string; venue?: string }
  | { kind: "poll"; question?: string };

/** Loose shape for anything the API hands back (validated server-side). */
export type LooseAttachment = Attachment | { kind: string; [k: string]: unknown };

export function asAttachment(a: LooseAttachment): Attachment | null {
  switch (a.kind) {
    case "image":
      return typeof a.url === "string" ? { kind: "image", url: a.url } : null;
    case "video":
      return typeof a.url === "string"
        ? { kind: "video", url: a.url, thumb: typeof a.thumb === "string" ? a.thumb : undefined }
        : null;
    case "track":
      return typeof a.id === "string"
        ? { kind: "track", id: a.id, title: str(a.title), artwork: str(a.artwork), artistSlug: str(a.artistSlug) }
        : null;
    case "watch":
      return typeof a.id === "string"
        ? { kind: "watch", id: a.id, title: str(a.title), thumb: str(a.thumb), artistSlug: str(a.artistSlug) }
        : null;
    case "product":
      return typeof a.id === "string" && typeof a.kindSlug === "string"
        ? { kind: "product", id: a.id, kindSlug: a.kindSlug, title: str(a.title), image: str(a.image), storeSlug: str(a.storeSlug) }
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
  author: SocialAuthor | null;
  viewer_emoji: string | null;
  viewer_saved: boolean;
  reaction_counts: Record<string, number>;
  quoted: FeedPost | null;
  poll: PollData | null;
}

export interface Story {
  id: string;
  profile_id: string;
  media_url: string;
  media_kind: string;
  caption: string;
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

export async function apiFetch(
  getAccessToken: () => Promise<string | null>,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const token = await getAccessToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(path, { ...init, headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) } });
  return res;
}

export async function apiJson<T>(
  getAccessToken: () => Promise<string | null>,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await apiFetch(getAccessToken, path, init);
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
