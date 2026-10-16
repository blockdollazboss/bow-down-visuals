/* ─── "The profile IS the website" — client (Stack 3) ────────────────────
   Mirrors the API DTOs from routes/profile-website.ts exactly:
   - Spotlight pin (item 5): GET /creator-profiles/:slug/spotlight,
     PUT /creator-profiles/me/spotlight.
   - Fan collections (item 6): GET /collections/:slug, GET /collections/me,
     PUT /collections/me/visibility.
   The pure view-state helpers are unit-tested in profile-website.test.ts;
   the components stay thin shells (the Royal Court pattern). */

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(
      (body as { message?: string; error?: string }).message ||
        (body as { error?: string }).error ||
        `Request failed (${res.status})`,
    ) as Error & { status?: number; code?: string };
    err.status = res.status;
    err.code = (body as { error?: string }).error;
    throw err;
  }
  return res.json() as Promise<T>;
}

/* ── Spotlight pin ─────────────────────────────────────────────────────── */

export interface SpotlightPin {
  kind: "track" | "video";
  itemId: string;
  title: string;
  mediaUrl: string;
  artworkUrl: string | null;
  durationSec: number;
  creatorSlug: string;
  creatorName: string;
  pageUrl: string;
}

export type SpotlightLoadStatus = "loading" | "ready" | "error";
export type SpotlightView = "loading" | "hidden" | "error" | "owner-empty" | "pin";

/** Section render decision: a pin shows for everyone; no pin hides the
    section for visitors but invites the OWNER to pin ("Pin a track or
    video"); a failed load is its own honest error state, never a
    fake-empty. */
export function spotlightViewState(args: {
  status: SpotlightLoadStatus;
  pin: SpotlightPin | null;
  isOwner: boolean;
}): SpotlightView {
  if (args.status === "loading") return "loading";
  if (args.status === "error") return "error";
  if (args.pin) return "pin";
  return args.isOwner ? "owner-empty" : "hidden";
}

export async function fetchPublicSpotlight(slug: string): Promise<SpotlightPin | null> {
  const res = await fetch(`/api/creator-profiles/${encodeURIComponent(slug)}/spotlight`);
  const data = await json<{ pin: SpotlightPin | null }>(res);
  return data.pin ?? null;
}

export async function saveMySpotlight(
  pin: { kind: "track" | "video"; itemId: string } | { kind: null },
): Promise<SpotlightPin | null> {
  const res = await fetch("/api/creator-profiles/me/spotlight", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(pin.kind === null ? { kind: null } : { kind: pin.kind, itemId: pin.itemId }),
  });
  const data = await json<{ pin: SpotlightPin | null }>(res);
  return data.pin ?? null;
}

/** One pinnable item from the owner's own catalog (the profile media
    endpoint's snake_case rows, narrowed to what the picker needs). */
export interface PinnableItem {
  kind: "track" | "video";
  id: string;
  title: string;
  artworkUrl: string | null;
}

export async function fetchMyPinnableItems(slug: string): Promise<PinnableItem[]> {
  const [tracksRes, videosRes] = await Promise.all([
    fetch(`/api/creator-profiles/${encodeURIComponent(slug)}/media?kind=track&limit=50`),
    fetch(`/api/creator-profiles/${encodeURIComponent(slug)}/media?kind=video&limit=50`),
  ]);
  const tracks = await json<{ items: Array<Record<string, unknown>> }>(tracksRes);
  const videos = await json<{ items: Array<Record<string, unknown>> }>(videosRes);
  const out: PinnableItem[] = [];
  for (const t of tracks.items ?? []) {
    out.push({
      kind: "track",
      id: String(t["id"] ?? ""),
      title: String(t["title"] ?? "Untitled"),
      artworkUrl: (t["artwork_url"] as string | null) ?? null,
    });
  }
  for (const v of videos.items ?? []) {
    out.push({
      kind: "video",
      id: String(v["id"] ?? ""),
      title: String(v["title"] ?? "Untitled"),
      artworkUrl: (v["thumbnail_url"] as string | null) ?? null,
    });
  }
  return out.filter((i) => i.id);
}

/* ── Fan collections ───────────────────────────────────────────────────── */

export interface CollectionItem {
  kind: "track" | "video" | "product";
  itemId: string;
  title: string;
  artworkUrl: string | null;
  creatorName: string;
  creatorSlug: string;
  creatorUrl: string;
  amountCents: number;
  purchasedAt: string;
}

export interface FanCollection {
  fan: { slug: string; displayName: string; avatarUrl: string | null; profileUrl: string };
  visibility: "public" | "private";
  isPrivate?: boolean;
  items: CollectionItem[];
}

export type CollectionLoadStatus = "loading" | "ready" | "error" | "not-found";
export type CollectionView = "loading" | "error" | "not-found" | "private" | "empty" | "items";

/** Page render decision: private is an honest state of its own — never
    confused with empty (nothing bought) or missing (no such fan). */
export function collectionViewState(args: {
  status: CollectionLoadStatus;
  collection: FanCollection | null;
}): CollectionView {
  if (args.status === "loading") return "loading";
  if (args.status === "error") return "error";
  if (args.status === "not-found" || !args.collection) return "not-found";
  if (args.collection.isPrivate || args.collection.visibility === "private") return "private";
  return args.collection.items.length > 0 ? "items" : "empty";
}

export async function fetchPublicCollection(slug: string): Promise<FanCollection> {
  const res = await fetch(`/api/collections/${encodeURIComponent(slug)}`);
  return json<FanCollection>(res);
}

export async function fetchMyCollection(): Promise<FanCollection> {
  const res = await fetch("/api/collections/me");
  return json<FanCollection>(res);
}

export async function saveMyCollectionVisibility(
  visibility: "public" | "private",
): Promise<"public" | "private"> {
  const res = await fetch("/api/collections/me/visibility", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ visibility }),
  });
  const data = await json<{ visibility: "public" | "private" }>(res);
  return data.visibility;
}

/** USD display for a collection item's price paid — real money (these
    are store purchases), never Visual Bucs. */
export function collectionMoney(cents: number): string {
  return `$${(Math.max(0, Math.round(cents)) / 100).toFixed(2)}`;
}
