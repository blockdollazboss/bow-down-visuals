import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { db } from "@workspace/db";
import {
  creatorProfilesTable,
  profileTracksTable,
  profileVideosTable,
  playlistsTable,
  followsTable,
  liveStreamsTable,
  shopsTable,
  shopProductsTable,
} from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { refreshSupabaseStorageUrl } from "../lib/objectStorage";
import { requireAuth } from "../middlewares/require-auth";
import {
  getPublicTipPageByHandleOrSlug,
  getPublicTipPageByUserId,
} from "./generate/tip-jar";

/* ─── Embeddable players/widgets (virality wave) ─────────────────────────────
   Every embed is a billboard: a creator pastes our player on their blog or
   website and every visitor sees Bow Down Visuals branding plus a
   "create your own" CTA carrying the creator's ?ref= code.

   - GET /embed/track/:id, /embed/video/:id, /embed/playlist/:id,
     /embed/profile/:slug  → tiny standalone HTML pages (no SPA bundle,
     no app chrome, no login). Served by embedPageRouter, registered on the
     app BEFORE the SPA fallback in app.ts.
   - GET /api/embed/track/:id (etc.) → compact JSON the pages fetch.
   - GET /api/embed/refcode/:slug → the creator's public referral code.
   - GET /api/oembed?url=… → oEmbed 1.0 for rich pasting into other platforms.

   Stack900 C1 — creator widgets for OTHER people's sites and devices:
   - /embed/latest/:slug   → the creator's newest public video/short.
   - /embed/live/:slug     → LIVE badge (truthful presence + viewer count).
   - /embed/tips/:handle   → tip jar card; the tip itself is paid on our
                             own /tips/:handle page (money never leaves home).
   - /embed/product/:id    → one storefront item; buying happens on our
                             own /shop/:handle storefront.
   - GET /api/embed/mine   → (auth) the signed-in creator's widget
                             inventory for the Widgets Desk in Promote.
   Every page takes ?theme=light|dark (default dark) and is responsive:
   fluid at phone width (no sideways scroll at 320px), roomier on tablet
   and desktop boxes, and every door is a ≥44px touch target.

   Security: embed pages carry NO X-Frame-Options and a relaxed CSP
   (frame-ancestors unrestricted) so any site can frame them. They make no
   authenticated requests and set no cookies — sandbox-friendly. */

export const embedApiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again in a minute." },
});

export const embedApiRouter = Router();
export const embedPageRouter = Router();

/** Refresh a nullable media field (artwork / thumbnail / avatar /
 *  cover) through storage: refs become fresh playable URLs, every
 *  other value passes through unchanged, null stays null. */
async function refreshedUrl(raw: string | null | undefined): Promise<string | null> {
  if (!raw) return raw ?? null;
  return refreshSupabaseStorageUrl(raw);
}

/** Normalize a stored media path to a playable URL (same-origin iframe).
 *  Stored values may be storage refs (r2://… / supabase://…) or expired
 *  signed URLs — resolve those through storage first; prepending "/"
 *  to a ref (the old behavior) produced the unplayable "/r2://…". */
async function mediaUrl(raw: string | null | undefined): Promise<string> {
  if (!raw) return "";
  const s = raw.trim();
  if (/^(blob:|data:)/i.test(s)) return s;
  const refreshed = await refreshSupabaseStorageUrl(s);
  if (/^(https?:|blob:|data:)/i.test(refreshed)) return refreshed;
  // The helper returns the value unchanged when it can't resolve it —
  // never mangle a storage ref into a "/"-prefixed path.
  if (/^(r2|supabase):\/\//i.test(refreshed)) return refreshed;
  return refreshed.startsWith("/") ? refreshed : `/${refreshed}`;
}

/** The creator's public referral code (codes are meant to be shared). */
async function refCodeForUser(userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  try {
    const rows = await db.execute(
      sql`SELECT code FROM referral_codes WHERE user_id = ${userId} LIMIT 1`,
    );
    // db.execute returns a QueryResult object — the rows live on .rows.
    // Indexing the result itself ([0]) was always undefined, so the
    // referral code never survived into the embed payload.
    const code = (rows.rows as unknown as { code?: string }[])[0]?.code;
    return typeof code === "string" && code.length > 0 ? code.toUpperCase() : null;
  } catch {
    return null;
  }
}

async function publicProfileById(id: string) {
  const [row] = await db
    .select()
    .from(creatorProfilesTable)
    .where(eq(creatorProfilesTable.id, id))
    .limit(1);
  return row && row.isPublic ? row : null;
}

async function publicProfileBySlug(slug: string) {
  const [row] = await db
    .select()
    .from(creatorProfilesTable)
    .where(eq(creatorProfilesTable.slug, slug.toLowerCase()))
    .limit(1);
  return row && row.isPublic ? row : null;
}

interface EmbedTrackData {
  kind: "track";
  id: string;
  title: string;
  artist_name: string;
  artist_slug: string | null;
  artwork_url: string | null;
  audio_url: string;
  ref_code: string | null;
}

async function getEmbedTrack(id: string): Promise<EmbedTrackData | null> {
  const [t] = await db.select().from(profileTracksTable).where(eq(profileTracksTable.id, id)).limit(1);
  if (!t || !t.isPublished) return null;
  const profile = await publicProfileById(t.profileId);
  if (!profile) return null;
  return {
    kind: "track",
    id: t.id,
    title: t.title,
    artist_name: profile.displayName,
    artist_slug: profile.slug,
    artwork_url: await refreshedUrl(t.artworkUrl),
    audio_url: await mediaUrl(t.audioUrl),
    ref_code: await refCodeForUser(profile.userId),
  };
}

interface EmbedVideoData {
  kind: "video";
  id: string;
  title: string;
  artist_name: string;
  artist_slug: string | null;
  thumbnail_url: string | null;
  video_url: string;
  ref_code: string | null;
}

async function getEmbedVideo(id: string): Promise<EmbedVideoData | null> {
  const [v] = await db.select().from(profileVideosTable).where(eq(profileVideosTable.id, id)).limit(1);
  if (!v || !v.isPublished) return null;
  const profile = await publicProfileById(v.profileId);
  if (!profile) return null;
  return {
    kind: "video",
    id: v.id,
    title: v.title,
    artist_name: profile.displayName,
    artist_slug: profile.slug,
    thumbnail_url: await refreshedUrl(v.thumbnailUrl),
    video_url: await mediaUrl(v.videoUrl),
    ref_code: await refCodeForUser(profile.userId),
  };
}

interface EmbedPlaylistData {
  kind: "playlist";
  id: string;
  title: string;
  owner_name: string;
  cover_url: string | null;
  item_count: number;
  ref_code: string | null;
  items: Array<{ kind: "track" | "video"; id: string; title: string; thumb: string | null }>;
}

async function getEmbedPlaylist(id: string): Promise<EmbedPlaylistData | null> {
  const [pl] = await db.select().from(playlistsTable).where(eq(playlistsTable.id, id)).limit(1);
  if (!pl || !pl.isPublic) return null;
  const owner = await publicProfileById(pl.ownerProfileId);
  if (!owner) return null;
  const refs = (pl.items ?? []).slice(0, 10);
  const items: EmbedPlaylistData["items"] = [];
  for (const r of refs) {
    try {
      if (r.kind === "track") {
        const [t] = await db.select().from(profileTracksTable).where(eq(profileTracksTable.id, r.id)).limit(1);
        if (t && t.isPublished) items.push({ kind: "track", id: t.id, title: t.title, thumb: await refreshedUrl(t.artworkUrl) });
      } else {
        const [v] = await db.select().from(profileVideosTable).where(eq(profileVideosTable.id, r.id)).limit(1);
        if (v && v.isPublished) items.push({ kind: "video", id: v.id, title: v.title, thumb: await refreshedUrl(v.thumbnailUrl) });
      }
    } catch { /* skip */ }
  }
  return {
    kind: "playlist",
    id: pl.id,
    title: pl.title,
    owner_name: owner.displayName,
    cover_url: (await refreshedUrl(pl.coverUrl)) ?? items[0]?.thumb ?? null,
    item_count: (pl.items ?? []).length,
    ref_code: await refCodeForUser(owner.userId),
    items,
  };
}

interface EmbedProfileData {
  kind: "profile";
  slug: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  follower_count: number;
  ref_code: string | null;
  featured: { kind: "track" | "video"; id: string; title: string; media_url: string; thumb: string | null } | null;
}

/** Real follower count for a public profile (follows rows are the same
 *  truth the site itself renders). Fails soft to 0 — a count hiccup must
 *  never take the creator's billboard down. */
async function followerCountFor(profileId: string): Promise<number> {
  try {
    const rows = await db
      .select({ value: sql<number>`count(*)` })
      .from(followsTable)
      .where(eq(followsTable.profileId, profileId));
    return Number(rows[0]?.value ?? 0) || 0;
  } catch {
    return 0;
  }
}

async function getEmbedProfile(slug: string): Promise<EmbedProfileData | null> {
  const profile = await publicProfileBySlug(slug);
  if (!profile) return null;
  const [topTrack] = await db
    .select()
    .from(profileTracksTable)
    .where(and(eq(profileTracksTable.profileId, profile.id), eq(profileTracksTable.isPublished, true)))
    .orderBy(desc(profileTracksTable.playCount))
    .limit(1);
  let featured: EmbedProfileData["featured"] = null;
  if (topTrack) {
    featured = { kind: "track", id: topTrack.id, title: topTrack.title, media_url: await mediaUrl(topTrack.audioUrl), thumb: await refreshedUrl(topTrack.artworkUrl) };
  } else {
    const [topVideo] = await db
      .select()
      .from(profileVideosTable)
      .where(and(eq(profileVideosTable.profileId, profile.id), eq(profileVideosTable.isPublished, true)))
      .orderBy(desc(profileVideosTable.viewCount))
      .limit(1);
    if (topVideo) {
      featured = { kind: "video", id: topVideo.id, title: topVideo.title, media_url: await mediaUrl(topVideo.videoUrl), thumb: await refreshedUrl(topVideo.thumbnailUrl) };
    }
  }
  return {
    kind: "profile",
    slug: profile.slug,
    display_name: profile.displayName,
    avatar_url: await refreshedUrl(profile.avatarUrl),
    bio: profile.bio ? profile.bio.split("\n")[0]!.slice(0, 160) : null,
    follower_count: await followerCountFor(profile.id),
    ref_code: await refCodeForUser(profile.userId),
    featured,
  };
}

/* ── Stack900 C1 widget data ─────────────────────────────────────────────── */

interface EmbedLatestData {
  kind: "latest";
  artist_name: string;
  artist_slug: string;
  avatar_url: string | null;
  ref_code: string | null;
  /** Null when the creator has no public video yet — the page renders an
   *  honest empty state, never a borrowed clip. */
  video: {
    id: string;
    title: string;
    is_short: boolean;
    thumbnail_url: string | null;
    video_url: string;
    created_at: string;
  } | null;
}

async function getEmbedLatest(slug: string): Promise<EmbedLatestData | null> {
  const profile = await publicProfileBySlug(slug);
  if (!profile) return null;
  const [v] = await db
    .select()
    .from(profileVideosTable)
    .where(and(eq(profileVideosTable.profileId, profile.id), eq(profileVideosTable.isPublished, true)))
    .orderBy(desc(profileVideosTable.createdAt))
    .limit(1);
  const video = v && v.isPublished
    ? {
        id: v.id,
        title: v.title,
        is_short: !!v.isShort,
        thumbnail_url: await refreshedUrl(v.thumbnailUrl),
        video_url: await mediaUrl(v.videoUrl),
        created_at: new Date(v.createdAt).toISOString(),
      }
    : null;
  return {
    kind: "latest",
    artist_name: profile.displayName,
    artist_slug: profile.slug,
    avatar_url: await refreshedUrl(profile.avatarUrl),
    ref_code: await refCodeForUser(profile.userId),
    video,
  };
}

interface EmbedLiveData {
  kind: "live";
  is_live: boolean;
  display_name: string;
  artist_slug: string;
  avatar_url: string | null;
  ref_code: string | null;
  /** Present only while the stream row truly says 'live' — presence is
   *  never dressed up. */
  stream: { id: string; title: string; viewer_count: number; started_at: string } | null;
}

async function getEmbedLive(slug: string): Promise<EmbedLiveData | null> {
  const profile = await publicProfileBySlug(slug);
  if (!profile) return null;
  const [s] = await db
    .select()
    .from(liveStreamsTable)
    .where(and(eq(liveStreamsTable.profile_id, profile.id), eq(liveStreamsTable.status, "live")))
    .orderBy(desc(liveStreamsTable.started_at))
    .limit(1);
  const stream = s && s.status === "live"
    ? {
        id: s.id,
        title: s.title,
        viewer_count: s.viewer_count ?? 0,
        started_at: new Date(s.started_at).toISOString(),
      }
    : null;
  return {
    kind: "live",
    is_live: !!stream,
    display_name: profile.displayName,
    artist_slug: profile.slug,
    avatar_url: await refreshedUrl(profile.avatarUrl),
    ref_code: await refCodeForUser(profile.userId),
    stream,
  };
}

interface EmbedTipsData {
  kind: "tips";
  /** The page's REAL handle — embed links built from a profile slug
   *  still land on the canonical /tips/<handle> address. */
  handle: string;
  display_name: string;
  message: string;
  suggested_amounts: number[];
  goal_amount: number | null;
  goal_label: string;
}

async function getEmbedTips(handleOrSlug: string): Promise<EmbedTipsData | null> {
  const page = await getPublicTipPageByHandleOrSlug(handleOrSlug);
  if (!page) return null;
  return {
    kind: "tips",
    handle: page.handle,
    display_name: page.displayName,
    message: page.message,
    suggested_amounts: page.suggestedAmounts,
    goal_amount: page.goalAmount,
    goal_label: page.goalLabel,
  };
}

interface EmbedProductData {
  kind: "product";
  id: string;
  name: string;
  price_cents: number;
  image_url: string | null;
  description: string | null;
  shop_name: string;
  shop_handle: string;
  ref_code: string | null;
}

async function getEmbedProduct(id: string): Promise<EmbedProductData | null> {
  const [p] = await db.select().from(shopProductsTable).where(eq(shopProductsTable.id, id)).limit(1);
  /* Buyers only ever see 'active' rows — a paused product's billboard
     comes down with the listing. */
  if (!p || p.status !== "active") return null;
  const [shop] = await db.select().from(shopsTable).where(eq(shopsTable.id, p.shop_id)).limit(1);
  if (!shop) return null;
  return {
    kind: "product",
    id: p.id,
    name: p.name,
    price_cents: p.price_cents,
    image_url: (await refreshedUrl(p.image_url)) ?? (await refreshedUrl(p.image_path)),
    description: p.description ? p.description.slice(0, 140) : null,
    shop_name: shop.name,
    shop_handle: shop.handle,
    ref_code: await refCodeForUser(p.user_id),
  };
}

/* ── Compact JSON data endpoints (fetched by the embed pages) ─────────────── */

embedApiRouter.use(embedApiLimiter);

embedApiRouter.get("/embed/track/:id", async (req: Request, res: Response) => {
  const d = await getEmbedTrack(String(req.params["id"]));
  if (!d) { res.status(404).json({ error: "Not found." }); return; }
  res.json(d);
});

embedApiRouter.get("/embed/video/:id", async (req: Request, res: Response) => {
  const d = await getEmbedVideo(String(req.params["id"]));
  if (!d) { res.status(404).json({ error: "Not found." }); return; }
  res.json(d);
});

embedApiRouter.get("/embed/playlist/:id", async (req: Request, res: Response) => {
  const d = await getEmbedPlaylist(String(req.params["id"]));
  if (!d) { res.status(404).json({ error: "Not found." }); return; }
  res.json(d);
});

embedApiRouter.get("/embed/profile/:slug", async (req: Request, res: Response) => {
  const d = await getEmbedProfile(String(req.params["slug"]));
  if (!d) { res.status(404).json({ error: "Not found." }); return; }
  res.json(d);
});

/** GET /api/embed/refcode/:slug — a creator's public referral code for embed CTAs. */
embedApiRouter.get("/embed/refcode/:slug", async (req: Request, res: Response) => {
  const profile = await publicProfileBySlug(String(req.params["slug"]));
  if (!profile) { res.status(404).json({ error: "Not found." }); return; }
  res.json({ code: await refCodeForUser(profile.userId) });
});

/* ── Stack900 C1 widget JSON ─────────────────────────────────────────────── */

embedApiRouter.get("/embed/latest/:slug", async (req: Request, res: Response) => {
  const d = await getEmbedLatest(String(req.params["slug"]));
  if (!d) { res.status(404).json({ error: "Not found." }); return; }
  res.json(d);
});

embedApiRouter.get("/embed/live/:slug", async (req: Request, res: Response) => {
  const d = await getEmbedLive(String(req.params["slug"]));
  if (!d) { res.status(404).json({ error: "Not found." }); return; }
  res.json(d);
});

embedApiRouter.get("/embed/tips/:handle", async (req: Request, res: Response) => {
  const d = await getEmbedTips(String(req.params["handle"]));
  if (!d) { res.status(404).json({ error: "Not found." }); return; }
  res.json(d);
});

embedApiRouter.get("/embed/product/:id", async (req: Request, res: Response) => {
  const d = await getEmbedProduct(String(req.params["id"]));
  if (!d) { res.status(404).json({ error: "Not found." }); return; }
  res.json(d);
});

/** GET /api/embed/mine — the signed-in creator's widget inventory for the
 *  Widgets Desk in Promote: their profile slug, tip handle, live state
 *  and active storefront items. Their OWN data only (requireAuth). */
embedApiRouter.get("/embed/mine", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;
  const [profile] = await db
    .select()
    .from(creatorProfilesTable)
    .where(eq(creatorProfilesTable.userId, userId))
    .limit(1);
  const shops = await db.select().from(shopsTable).where(eq(shopsTable.user_id, userId));
  let products: Array<{ id: string; name: string; price_cents: number; image_url: string | null; shop_handle: string }> = [];
  if (shops.length > 0) {
    const shopHandleById = new Map(shops.map((s) => [s.id, s.handle]));
    const rows = await db
      .select()
      .from(shopProductsTable)
      .where(eq(shopProductsTable.user_id, userId))
      .orderBy(desc(shopProductsTable.created_at))
      .limit(50);
    products = rows
      .filter((p) => p.status === "active" && shopHandleById.has(p.shop_id))
      .slice(0, 20)
      .map((p) => ({
        id: p.id,
        name: p.name,
        price_cents: p.price_cents,
        image_url: p.image_url,
        shop_handle: shopHandleById.get(p.shop_id)!,
      }));
  }
  const tip = getPublicTipPageByUserId(userId);
  const live = profile ? await getEmbedLive(profile.slug) : null;
  res.json({
    profile: profile
      ? { slug: profile.slug, display_name: profile.displayName, is_public: !!profile.isPublic }
      : null,
    tip_handle: tip?.handle ?? null,
    live: live ? { is_live: live.is_live, stream: live.stream } : null,
    products,
  });
});

/* ── oEmbed ───────────────────────────────────────────────────────────────── */

const OEMBED_MATCHERS: Array<{
  re: RegExp;
  embed: (m: RegExpMatchArray) => { kind: string; id: string; width: number; height: number };
}> = [
  { re: /\/track\/([A-Za-z0-9-]+)/, embed: (m) => ({ kind: "track", id: m[1]!, width: 420, height: 200 }) },
  { re: /\/watch\/([A-Za-z0-9-]+)/, embed: (m) => ({ kind: "video", id: m[1]!, width: 560, height: 360 }) },
  { re: /\/playlist\/([A-Za-z0-9-]+)/, embed: (m) => ({ kind: "playlist", id: m[1]!, width: 420, height: 430 }) },
  { re: /\/artist\/([A-Za-z0-9-]+)/, embed: (m) => ({ kind: "profile", id: m[1]!, width: 360, height: 480 }) },
];

embedApiRouter.get("/oembed", async (req: Request, res: Response) => {
  const url = String(req.query["url"] ?? "");
  if (!url) { res.status(400).json({ error: "Missing url parameter." }); return; }
  let parsed: URL;
  try { parsed = new URL(url); } catch { res.status(400).json({ error: "Invalid url." }); return; }
  const match = OEMBED_MATCHERS.map((m) => ({ m, hit: parsed.pathname.match(m.re) }))
    .find((x) => x.hit);
  if (!match || !match.hit) { res.status(404).json({ error: "No embeddable resource at that URL." }); return; }
  const e = match.m.embed(match.hit);
  const base = `${parsed.protocol}//${parsed.host}`;

  let title = "Bow Down Visuals";
  let author = "Bow Down Visuals";
  let thumbnail: string | null = null;
  try {
    if (e.kind === "track") {
      const d = await getEmbedTrack(e.id);
      if (d) { title = d.title; author = d.artist_name; thumbnail = d.artwork_url; }
    } else if (e.kind === "video") {
      const d = await getEmbedVideo(e.id);
      if (d) { title = d.title; author = d.artist_name; thumbnail = d.thumbnail_url; }
    } else if (e.kind === "playlist") {
      const d = await getEmbedPlaylist(e.id);
      if (d) { title = d.title; author = d.owner_name; thumbnail = d.cover_url; }
    } else {
      const d = await getEmbedProfile(e.id);
      if (d) { title = d.display_name; author = d.display_name; thumbnail = d.avatar_url; }
    }
  } catch { /* fall back to defaults */ }

  res.json({
    version: "1.0",
    type: "rich",
    provider_name: "Bow Down Visuals",
    provider_url: base,
    title,
    author_name: author,
    thumbnail_url: thumbnail,
    width: e.width,
    height: e.height,
    html: `<iframe src="${base}/embed/${e.kind}/${encodeURIComponent(e.id)}" width="${e.width}" height="${e.height}" frameborder="0" allow="autoplay; encrypted-media; fullscreen" loading="lazy" title="${title.replace(/"/g, "&quot;")} — Bow Down Visuals"></iframe>`,
  });
});

/* ── Embed HTML pages ───────────────────────────────────────────────────────
   One self-contained document per kind: inline CSS + vanilla JS, ~12KB,
   no SPA bundle, no login. Fetches its compact JSON and renders a gold/black
   luxury player with the "Made with Bow Down Visuals — create your own" CTA.
   The CTA carries ?ref= from the iframe URL (baked in by the Embed button),
   else the creator's code from the API. */

/* One palette, two designed themes (company law: light AND dark for
   everything). ?theme=light flips the variables — the head script in
   embedShell sets the class on <html> before first paint, so a light
   embed never flashes dark. Responsive by construction: fluid width,
   no sideways scroll at 320px, tighter type on phone boxes, roomier on
   tablet/desktop boxes, and every door is a ≥44px touch target. */
const EMBED_CSS = `
:root{
--bg:#0a0805;--ink:#ffffff;--dim:rgba(255,255,255,.55);--faint:rgba(255,255,255,.35);
--gold:#e8c86a;--gold-text:#e8c86a;--gold-ink:#000000;--gold-glow:rgba(232,200,106,.9);
--line:rgba(232,200,106,.25);--thumb-line:rgba(232,200,106,.35);--chip:rgba(255,255,255,.03);
--bar:rgba(0,0,0,.55);--fallback:linear-gradient(135deg,rgba(232,200,106,.3),#000);
}
:root.light{
--bg:#FBF6E9;--ink:#2a1e07;--dim:rgba(42,30,7,.65);--faint:rgba(42,30,7,.42);
--gold:#C9A84C;--gold-text:#7A5A12;--gold-ink:#241a02;--gold-glow:rgba(201,168,76,.9);
--line:rgba(122,90,18,.35);--thumb-line:rgba(122,90,18,.4);--chip:rgba(122,90,18,.07);
--bar:rgba(255,252,244,.92);--fallback:linear-gradient(135deg,rgba(201,168,76,.45),rgba(122,90,18,.12));
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{background:var(--bg);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;display:flex;flex-direction:column;overflow:hidden;overflow-x:hidden}
a{color:inherit;text-decoration:none}
img,video{max-width:100%}
.player{flex:1;display:flex;min-height:0;position:relative}
.brandbar{display:flex;align-items:center;gap:8px;padding:8px 12px;border-top:1px solid var(--line);background:var(--bar);font-size:12px;color:var(--dim)}
.brandbar .dot{width:8px;height:8px;border-radius:50%;background:var(--gold);box-shadow:0 0 10px var(--gold-glow);flex-shrink:0}
.brandbar b{color:var(--gold-text)}
.cta{margin-left:auto;flex-shrink:0;display:inline-flex;align-items:center;min-height:44px;background:var(--gold);color:var(--gold-ink);font-weight:800;font-size:12px;padding:6px 14px;border-radius:999px;white-space:nowrap}
.cta:hover{filter:brightness(1.08)}
.door{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:10px 18px;border-radius:999px;background:var(--gold);color:var(--gold-ink);font-weight:800;font-size:13px;white-space:nowrap}
.door:hover{filter:brightness(1.08)}
.door.ghost{background:transparent;color:var(--gold-text);border:1px solid var(--line)}
.amount{display:inline-flex;align-items:center;min-height:44px;padding:8px 14px;border-radius:999px;border:1px solid var(--line);background:var(--chip);font-weight:800;font-size:13px;color:var(--gold-text)}
.title{font-weight:800;font-size:15px;line-height:1.25;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.artist{font-size:12px;color:var(--dim);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.artist b{color:var(--gold-text);font-weight:600}
audio{width:100%;accent-color:var(--gold);outline:none}
video{width:100%;height:100%;object-fit:contain;background:#000}
.err{margin:auto;text-align:center;color:var(--dim);font-size:13px;padding:20px}
.spin{width:34px;height:34px;border:3px solid var(--line);border-top-color:var(--gold);border-radius:50%;margin:auto;animation:sp 1s linear infinite}
@keyframes sp{to{transform:rotate(360deg)}}
.livedot{width:10px;height:10px;border-radius:50%;background:#e5484d;flex-shrink:0;animation:pulse 1.6s ease-in-out infinite}
@keyframes pulse{0%,100%{box-shadow:0 0 0 0 rgba(229,72,77,.5)}50%{box-shadow:0 0 0 6px rgba(229,72,77,0)}}
@media (max-width:480px){
.title{font-size:14px}
.brandbar{font-size:11px;padding:8px 10px;gap:6px}
.door{font-size:12px;padding:10px 14px}
}
@media (min-width:768px){
.title{font-size:16px}
}
`;

function embedShell(kind: string, id: string, inner: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Bow Down Visuals embed</title><script>try{if(new URLSearchParams(location.search).get("theme")==="light")document.documentElement.classList.add("light");}catch(e){}</script><style>${EMBED_CSS}</style></head>
<body>
<div class="player" id="player"><div class="spin"></div></div>
<div class="brandbar"><span class="dot"></span><span>Made with <b>Bow Down Visuals</b></span><a class="cta" id="cta" href="/signup" target="_blank" rel="noopener">Create your own →</a></div>
<script>
(function(){
var KIND=${JSON.stringify(kind)}, ID=${JSON.stringify(id)};
var ref=null;
try{var q=new URLSearchParams(location.search);var r=q.get("ref");if(r&&/^[A-Za-z0-9]{4,16}$/i.test(r))ref=r.toUpperCase();}catch(e){}
function setCta(apiRef){
  var code=ref||apiRef;
  var a=document.getElementById("cta");
  a.href=code?"/signup?ref="+encodeURIComponent(code):"/signup";
}
function err(msg){
  document.getElementById("player").innerHTML='<div class="err">'+msg+'<br/><br/><a style="color:var(--gold-text);text-decoration:underline" href="/" target="_blank" rel="noopener">bowdownvisuals.com</a></div>';
}
function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
fetch("/api/embed/"+KIND+"/"+encodeURIComponent(ID),{headers:{"Accept":"application/json"}})
.then(function(r){if(!r.ok)throw 0;return r.json();})
.then(function(d){setCta(d.ref_code);${inner}})
.catch(function(){err("This embed is unavailable — it may have been removed.");});
})();
</script></body></html>`;
}

const TRACK_JS = `
var p=document.getElementById("player");
p.style.flexDirection="column";p.style.padding="14px";p.style.gap="10px";
p.innerHTML=
'<div style="display:flex;gap:12px;align-items:center;min-height:0">'+
(d.artwork_url?'<img src="'+esc(d.artwork_url)+'" alt="" style="width:84px;height:84px;border-radius:12px;object-fit:cover;border:1px solid var(--thumb-line);flex-shrink:0"/>':
'<div style="width:84px;height:84px;border-radius:12px;background:var(--fallback);border:1px solid var(--thumb-line);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:28px">🎵</div>')+
'<div style="min-width:0;flex:1"><div class="title">'+esc(d.title)+'</div><div class="artist">by <b>'+esc(d.artist_name)+'</b></div></div>'+
(d.artist_slug?'<a class="door ghost" href="/artist/'+esc(d.artist_slug)+'" target="_blank" rel="noopener" style="flex-shrink:0;font-size:12px">Profile</a>':"")+
'</div>'+
'<audio controls preload="metadata" src="'+esc(d.audio_url)+'"></audio>';`;

const VIDEO_JS = `
var p=document.getElementById("player");
p.style.flexDirection="column";
p.innerHTML=
'<video controls playsinline preload="metadata" '+(d.thumbnail_url?'poster="'+esc(d.thumbnail_url)+'" ':"")+'src="'+esc(d.video_url)+'"></video>'+
'<div style="padding:8px 12px 4px"><div class="title" style="font-size:13px">'+esc(d.title)+'</div><div class="artist">by <b>'+esc(d.artist_name)+'</b></div></div>';`;

const PLAYLIST_JS = `
var p=document.getElementById("player");
p.style.flexDirection="column";p.style.padding="12px";p.style.gap="8px";p.style.overflowY="auto";
var items=(d.items||[]).map(function(it,i){
var link=it.kind==="track"?"/track/"+it.id:"/watch/"+it.id;
return '<a href="'+link+'" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:10px;padding:8px;min-height:44px;border-radius:10px;background:var(--chip)">'+
'<span style="width:20px;text-align:center;font-size:11px;color:var(--faint)">'+(i+1)+'</span>'+
(it.thumb?'<img src="'+esc(it.thumb)+'" alt="" style="width:38px;height:38px;border-radius:8px;object-fit:cover;flex-shrink:0"/>':
'<div style="width:38px;height:38px;border-radius:8px;background:var(--chip);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:15px">'+(it.kind==="video"?"🎬":"🎵")+'</div>')+
'<span style="font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1">'+esc(it.title)+'</span></a>';
}).join("");
p.innerHTML=
'<div style="display:flex;gap:10px;align-items:center">'+
(d.cover_url?'<img src="'+esc(d.cover_url)+'" alt="" style="width:64px;height:64px;border-radius:12px;object-fit:cover;border:1px solid var(--thumb-line);flex-shrink:0"/>':
'<div style="width:64px;height:64px;border-radius:12px;background:var(--fallback);border:1px solid var(--thumb-line);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:24px">🎶</div>')+
'<div style="min-width:0"><div class="title">'+esc(d.title)+'</div><div class="artist">by <b>'+esc(d.owner_name)+'</b> · '+d.item_count+' items</div></div></div>'+
'<div style="display:flex;flex-direction:column;gap:4px;overflow-y:auto">'+items+'</div>';`;

const PROFILE_JS = `
var p=document.getElementById("player");
p.style.flexDirection="column";p.style.padding="14px";p.style.gap="10px";p.style.alignItems="center";p.style.textAlign="center";p.style.overflowY="auto";
var feat="";
if(d.featured){
feat='<div style="width:100%;background:var(--chip);border:1px solid var(--line);border-radius:12px;padding:10px;text-align:left">'+
'<div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:var(--gold-text);font-weight:700;margin-bottom:6px">Featured drop</div>'+
'<div class="title" style="font-size:13px">'+esc(d.featured.title)+'</div>'+
(d.featured.kind==="track"
?'<audio controls preload="metadata" src="'+esc(d.featured.media_url)+'" style="margin-top:8px"></audio>'
:'<a href="/watch/'+esc(d.featured.id)+'" target="_blank" rel="noopener" style="display:block;margin-top:8px;position:relative">'+
(d.featured.thumb?'<img src="'+esc(d.featured.thumb)+'" alt="" style="width:100%;border-radius:8px;display:block"/>':"")+
'<span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center"><span style="width:44px;height:44px;border-radius:50%;background:var(--gold);color:var(--gold-ink);display:flex;align-items:center;justify-content:center;font-size:18px">▶</span></span></a>')+
'</div>';
}
p.innerHTML=
(d.avatar_url?'<img src="'+esc(d.avatar_url)+'" alt="" style="width:72px;height:72px;border-radius:50%;object-fit:cover;border:2px solid var(--gold)"/>':
'<div style="width:72px;height:72px;border-radius:50%;background:var(--fallback);border:2px solid var(--gold);display:flex;align-items:center;justify-content:center;font-size:30px">🦈</div>')+
'<div><div class="title" style="font-size:17px">'+esc(d.display_name)+'</div>'+
(d.follower_count>0?'<div class="artist">'+d.follower_count+' follower'+(d.follower_count===1?'':'s')+'</div>':"")+
(d.bio?'<div class="artist" style="white-space:normal;margin-top:4px">'+esc(d.bio)+'</div>':"")+'</div>'+
'<a class="door" href="/artist/'+esc(d.slug)+'" target="_blank" rel="noopener">Follow on Bow Down Visuals</a>'+
feat;`;

const LATEST_JS = `
var p=document.getElementById("player");
p.style.flexDirection="column";
if(!d.video){
p.style.alignItems="center";p.style.justifyContent="center";p.style.textAlign="center";p.style.padding="16px";p.style.gap="10px";
p.innerHTML=
(d.avatar_url?'<img src="'+esc(d.avatar_url)+'" alt="" style="width:56px;height:56px;border-radius:50%;object-fit:cover;border:2px solid var(--gold)"/>':"")+
'<div><div class="title">'+esc(d.artist_name)+'</div><div class="artist" style="white-space:normal">No videos yet — the newest drop will land here.</div></div>'+
'<a class="door" href="/artist/'+esc(d.artist_slug)+'" target="_blank" rel="noopener">Visit the profile</a>';
}else{
var v=d.video;
p.innerHTML=
'<div style="display:flex;align-items:center;gap:8px;padding:10px 12px 0">'+
'<span style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:var(--gold-text);font-weight:800">Newest drop</span>'+
(v.is_short?'<span style="font-size:10px;font-weight:800;border:1px solid var(--line);color:var(--gold-text);border-radius:999px;padding:2px 8px">SHORT</span>':"")+
'</div>'+
'<div style="flex:1;min-height:0;padding:8px 12px"><video controls playsinline preload="metadata" '+(v.thumbnail_url?'poster="'+esc(v.thumbnail_url)+'" ':"")+'src="'+esc(v.video_url)+'"></video></div>'+
'<div style="padding:0 12px 10px"><div class="title" style="font-size:13px">'+esc(v.title)+'</div><div class="artist">by <b>'+esc(d.artist_name)+'</b></div></div>';
}`;

/* The live badge re-checks every minute: a badge that says LIVE after
   the show ends would be a lie with a pulse. */
const LIVE_JS = `
var p=document.getElementById("player");
p.style.flexDirection="column";p.style.padding="14px";p.style.gap="10px";p.style.justifyContent="center";
function render(d){
p.innerHTML=
'<div style="display:flex;align-items:center;gap:12px;min-width:0">'+
(d.avatar_url?'<img src="'+esc(d.avatar_url)+'" alt="" style="width:48px;height:48px;border-radius:50%;object-fit:cover;border:2px solid var(--gold);flex-shrink:0"/>':
'<div style="width:48px;height:48px;border-radius:50%;background:var(--fallback);border:2px solid var(--gold);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0">🦈</div>')+
'<div style="min-width:0;flex:1"><div class="title" style="font-size:15px">'+esc(d.display_name)+'</div>'+
(d.is_live
?'<div style="display:flex;align-items:center;gap:6px;margin-top:2px"><span class="livedot"></span><span style="font-size:12px;font-weight:800;color:#e5484d">LIVE NOW</span><span class="artist" style="margin-top:0">'+d.stream.viewer_count+' watching</span></div>'+
'<div class="artist">'+esc(d.stream.title)+'</div>'
:'<div class="artist">Not live right now</div>')+
'</div>'+
(d.is_live
?'<a class="door" href="/live/'+esc(d.stream.id)+'" target="_blank" rel="noopener" style="flex-shrink:0">Watch live</a>'
:'<a class="door ghost" href="/artist/'+esc(d.artist_slug)+'" target="_blank" rel="noopener" style="flex-shrink:0">Profile</a>')+
'</div>';
}
render(d);
setInterval(function(){
fetch("/api/embed/live/"+encodeURIComponent(d.artist_slug),{headers:{"Accept":"application/json"}})
.then(function(r){return r.ok?r.json():null;})
.then(function(nd){if(nd)render(nd);})
.catch(function(){});
},60000);`;

const TIPS_JS = `
var p=document.getElementById("player");
p.style.flexDirection="column";p.style.padding="14px";p.style.gap="10px";p.style.alignItems="center";p.style.textAlign="center";p.style.overflowY="auto";p.style.justifyContent="center";
var amounts=(d.suggested_amounts||[]).map(function(a){return '<span class="amount">$'+esc(a)+'</span>';}).join("");
p.innerHTML=
'<div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:var(--gold-text);font-weight:800">Tip jar</div>'+
'<div class="title" style="font-size:17px">Tip '+esc(d.display_name)+'</div>'+
(d.message?'<div class="artist" style="white-space:normal">'+esc(d.message)+'</div>':"")+
(amounts?'<div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center">'+amounts+'</div>':"")+
'<a class="door" href="/tips/'+esc(d.handle)+'" target="_blank" rel="noopener">Leave a tip</a>'+
((d.goal_label||d.goal_amount)?'<div class="artist">'+esc(d.goal_label||"Goal")+(d.goal_amount?": $"+esc(d.goal_amount):"")+'</div>':"")+
'<div class="artist" style="font-size:11px">Tips are paid on Bow Down Visuals — safe and secure.</div>';`;

const PRODUCT_JS = `
var p=document.getElementById("player");
p.style.flexDirection="column";p.style.padding="12px";p.style.gap="8px";p.style.overflowY="auto";
var price=d.price_cents>0?"$"+(d.price_cents/100).toFixed(2):"Free";
p.innerHTML=
(d.image_url?'<img src="'+esc(d.image_url)+'" alt="" style="width:100%;max-height:55%;object-fit:cover;border-radius:12px;border:1px solid var(--thumb-line)"/>':
'<div style="width:100%;height:120px;border-radius:12px;background:var(--fallback);border:1px solid var(--thumb-line);display:flex;align-items:center;justify-content:center;font-size:34px">🛍️</div>')+
'<div class="title">'+esc(d.name)+'</div>'+
'<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><span style="font-size:16px;font-weight:800;color:var(--gold-text)">'+price+'</span><span class="artist" style="margin-top:0">from <b>'+esc(d.shop_name)+'</b></span></div>'+
(d.description?'<div class="artist" style="white-space:normal">'+esc(d.description)+'</div>':"")+
'<a class="door" href="/shop/'+esc(d.shop_handle)+'" target="_blank" rel="noopener" style="align-self:flex-start">See it in the shop</a>';`;

function sendEmbed(kind: string, id: string, js: string) {
  return (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    /* Embeds must be frameable anywhere — the global middleware skips
       X-Frame-Options/CSP for /embed/* (see app.ts). Cache briefly. */
    res.setHeader("Cache-Control", "public, max-age=120");
    res.send(embedShell(kind, id, js));
  };
}

embedPageRouter.get("/embed/track/:id", (req, res) => sendEmbed("track", String(req.params["id"]), TRACK_JS)(req, res));
embedPageRouter.get("/embed/video/:id", (req, res) => sendEmbed("video", String(req.params["id"]), VIDEO_JS)(req, res));
embedPageRouter.get("/embed/playlist/:id", (req, res) => sendEmbed("playlist", String(req.params["id"]), PLAYLIST_JS)(req, res));
embedPageRouter.get("/embed/profile/:slug", (req, res) => sendEmbed("profile", String(req.params["slug"]), PROFILE_JS)(req, res));
embedPageRouter.get("/embed/latest/:slug", (req, res) => sendEmbed("latest", String(req.params["slug"]), LATEST_JS)(req, res));
embedPageRouter.get("/embed/live/:slug", (req, res) => sendEmbed("live", String(req.params["slug"]), LIVE_JS)(req, res));
embedPageRouter.get("/embed/tips/:handle", (req, res) => sendEmbed("tips", String(req.params["handle"]), TIPS_JS)(req, res));
embedPageRouter.get("/embed/product/:id", (req, res) => sendEmbed("product", String(req.params["id"]), PRODUCT_JS)(req, res));

export default embedApiRouter;
