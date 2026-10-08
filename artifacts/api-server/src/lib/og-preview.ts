/* Dynamic OG/Twitter link-preview cards for shareable public URLs.
   ---------------------------------------------------------------------------
   The frontend is a client-rendered SPA: social scrapers (X/Twitter, Facebook,
   Discord, Telegram, WhatsApp, LinkedIn, Slack, iMessage…) never run its JS,
   so every shareable URL used to unfurl the generic homepage card.

   This module fixes that at the edge: a middleware (mounted in app.ts before
   the SPA fallback) sniffs bot User-Agents on shareable routes, resolves the
   entity from the same Drizzle tables the public API endpoints use, and
   answers with a tiny self-contained HTML document carrying per-entity
   og:title / og:description / og:image / og:url / twitter:card tags plus
   schema.org JSON-LD. Humans are never intercepted — they keep getting
   index.html exactly as before.

   The viral loop: share link → beautiful card with the entity's own artwork
   → clicks → new users. Any shareable URL whose entity is missing or has no
   artwork gets the branded gold/black fallback card (/og-fallback.png) —
   never the generic homepage card.

   No DB migration, no sidebar changes, no paid services. Bot HTML responses
   are cacheable for 10 minutes; resolver failures degrade to the branded
   fallback card rather than 500s. */

import { createHash } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import {
  creatorProfilesTable,
  profileTracksTable,
  profileVideosTable,
  playlistsTable,
  showcaseItemsTable,
  challengesTable,
  albumsTable,
  bioPagesTable,
  contentPlansTable,
  reviewLinksTable,
  shopsTable,
  nfcProfilesTable,
  pressKitsTable,
} from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { logger } from "./logger";

/* ── Site origin ─────────────────────────────────────────────────────────── */

export function siteOrigin(): string {
  const base =
    process.env["PUBLIC_SITE_URL"] ??
    process.env["SITE_URL"] ??
    "https://bowdownvisuals.com";
  return base.replace(/\/+$/, "");
}

/** Absolute URL for an og:image. Media rows store absolute R2/Supabase URLs,
    site-relative paths, or bare storage keys; the frontend's mediaUrl()
    resolves the latter two against the site origin when MEDIA_CDN_URL is
    empty — we mirror that here so cards always carry fetchable images. */
export function absoluteMediaUrl(
  raw: string | null | undefined,
  origin: string,
): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  if (/^(https?:|data:|blob:)/i.test(s)) return s;
  const clean = s.startsWith("/") ? s.slice(1) : s;
  const cdn = (process.env["MEDIA_CDN_URL"] ?? "").replace(/\/+$/, "");
  return cdn ? `${cdn}/${clean}` : `${origin}/${clean}`;
}

/* ── HTML safety ─────────────────────────────────────────────────────────── */

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function truncate(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/* ── Bot detection ───────────────────────────────────────────────────────── */

/* Social/SEO scrapers that fetch pages without running JS. Kept generous on
   purpose: a false positive only serves a bot a static preview of the same
   page it asked for (plus a meta-refresh into the SPA), never a different
   experience. Normal browser UAs never match. */
const BOT_RE =
  /bot|crawler|spider|scraper|preview|facebookexternalhit|facebot|twitterbot|discordbot|telegrambot|linkedinbot|slackbot|slack-imgproxy|whatsapp|pinterest|redditbot|tumblr|skypeuripreview|embedly|ifttt|quora|flipboard|hatena|vkshare|nuzzel|newsblur|feedly|bitlybot|googlebot|bingbot|duckduckbot|yandexbot|baiduspider|sogou|exabot/i;

export function isSocialBot(userAgent: string | undefined | null): boolean {
  if (!userAgent) return false;
  return BOT_RE.test(userAgent);
}

/* ── Shareable routes ────────────────────────────────────────────────────── */

export type ShareKind =
  | "track"
  | "video"
  | "playlist"
  | "artist"
  | "showcase"
  | "challenge"
  | "album"
  | "bio"
  | "plan"
  | "review"
  | "sound"
  | "shop"
  | "templates"
  | "templates-thumbnails"
  | "templates-hooks"
  | "templates-captions"
  | "templates-videos"
  | "hashtag"
  | "genre"
  | "vertical"
  | "presave"
  | "tips"
  | "join"
  | "card"
  | "press";

export interface ShareMatch {
  kind: ShareKind;
  param: string;
}

const ID_RE = "[A-Za-z0-9_-]{6,64}";
const SLUG_RE = "[A-Za-z0-9_.-]{1,120}";

const ROUTE_PATTERNS: Array<{ kind: ShareKind; re: RegExp }> = [
  { kind: "track", re: new RegExp(`^/track/(${ID_RE})$`) },
  { kind: "video", re: new RegExp(`^/watch/(${ID_RE})$`) },
  { kind: "playlist", re: new RegExp(`^/playlist/(${ID_RE})$`) },
  { kind: "artist", re: new RegExp(`^/artist/(${SLUG_RE})$`) },
  { kind: "showcase", re: new RegExp(`^/showcase/(${SLUG_RE})$`) },
  { kind: "challenge", re: new RegExp(`^/challenge/(${SLUG_RE})$`) },
  { kind: "album", re: new RegExp(`^/albums/(${SLUG_RE})$`) },
  { kind: "bio", re: new RegExp(`^/bio/(${SLUG_RE})$`) },
  { kind: "plan", re: new RegExp(`^/plan/(${SLUG_RE})$`) },
  { kind: "review", re: new RegExp(`^/review/(${ID_RE})$`) },
  { kind: "sound", re: new RegExp(`^/sound/(${SLUG_RE})$`) },
  { kind: "shop", re: new RegExp(`^/shop/(${SLUG_RE})$`) },
  { kind: "templates", re: /^\/templates\/?$/ },
  { kind: "templates-thumbnails", re: /^\/templates\/thumbnails\/?$/ },
  { kind: "templates-hooks", re: /^\/templates\/hooks\/?$/ },
  { kind: "templates-captions", re: /^\/templates\/captions\/?$/ },
  { kind: "templates-videos", re: /^\/templates\/videos\/?$/ },
  { kind: "hashtag", re: new RegExp(`^/hashtag/(${SLUG_RE})$`) },
  { kind: "genre", re: new RegExp(`^/genre/(${SLUG_RE})$`) },
  { kind: "vertical", re: new RegExp(`^/vertical/(${SLUG_RE})$`) },
  { kind: "presave", re: new RegExp(`^/presave/(${SLUG_RE})$`) },
  { kind: "tips", re: new RegExp(`^/tips/(${SLUG_RE})$`) },
  { kind: "join", re: new RegExp(`^/join/(${SLUG_RE})$`) },
  { kind: "card", re: new RegExp(`^/c/(${SLUG_RE})$`) },
  { kind: "press", re: new RegExp(`^/press/(${SLUG_RE})$`) },
];

/** Match a request path against the shareable route table. Returns null for
    non-shareable paths so the middleware passes through untouched. */
export function matchShareableRoute(path: string): ShareMatch | null {
  const normalized =
    path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  for (const { kind, re } of ROUTE_PATTERNS) {
    const m = re.exec(normalized);
    if (m) return { kind, param: m[1] ?? "" };
  }
  return null;
}

/* ── Card model ──────────────────────────────────────────────────────────── */

export interface ShareCard {
  /** <title> and og:title — entity title + creator name. */
  title: string;
  /** og:description — one or two sentences, plain text. */
  description: string;
  /** Absolute URL for og:image / twitter:image. Always set (fallback card). */
  image: string;
  imageAlt: string;
  /** Canonical share URL (og:url + <link rel=canonical>). */
  url: string;
  /** og:type. */
  ogType: "website" | "music.song" | "video.other" | "profile" | "music.album" | "music.playlist";
  /** twitter:card — always summary_large_image for rich previews. */
  twitterCard: "summary_large_image";
  /** robots meta. Review links are noindex; everything else is indexable. */
  robots: string;
  /** Optional playable media (og:video) — videos only. */
  videoUrl?: string;
  videoType?: string;
  /** Optional schema.org JSON-LD. */
  jsonLd?: Record<string, unknown>;
}

const FALLBACK_IMAGE = "/og-fallback.png";
const SITE_NAME = "Bow Down Visuals";

function fallbackImage(origin: string): string {
  return `${origin}${FALLBACK_IMAGE}`;
}

/** Branded fallback card for a shareable URL whose entity is missing,
    private, or has no artwork. Typed per route so it never reads as the
    generic homepage card. */
export function genericCard(match: ShareMatch, origin: string): ShareCard {
  const path = {
    track: `/track/${match.param}`,
    video: `/watch/${match.param}`,
    playlist: `/playlist/${match.param}`,
    artist: `/artist/${match.param}`,
    showcase: `/showcase/${match.param}`,
    challenge: `/challenge/${match.param}`,
    album: `/albums/${match.param}`,
    bio: `/bio/${match.param}`,
    plan: `/plan/${match.param}`,
    review: `/review/${match.param}`,
    sound: `/sound/${match.param}`,
    shop: `/shop/${match.param}`,
    templates: "/templates",
    "templates-thumbnails": "/templates/thumbnails",
    "templates-hooks": "/templates/hooks",
    "templates-captions": "/templates/captions",
    "templates-videos": "/templates/videos",
    hashtag: `/hashtag/${match.param}`,
    genre: `/genre/${match.param}`,
    vertical: `/vertical/${match.param}`,
    presave: `/presave/${match.param}`,
    tips: `/tips/${match.param}`,
    join: `/join/${match.param}`,
    card: `/c/${match.param}`,
    press: `/press/${match.param}`,
  }[match.kind];

  const copy: Record<ShareKind, { title: string; description: string }> = {
    track: { title: "Listen on Bow Down Visuals", description: "Stream creator audio on Bow Down Visuals — the content creator's cheat code." },
    video: { title: "Watch on Bow Down Visuals", description: "Watch creator videos on Bow Down Visuals — the content creator's cheat code." },
    playlist: { title: "Playlist on Bow Down Visuals", description: "A creator playlist on Bow Down Visuals — the content creator's cheat code." },
    artist: { title: "Creator on Bow Down Visuals", description: "A creator profile on Bow Down Visuals — the content creator's cheat code." },
    showcase: { title: "Showcase on Bow Down Visuals", description: "Community showcase on Bow Down Visuals — the content creator's cheat code." },
    challenge: { title: "Challenge on Bow Down Visuals", description: "A creator challenge on Bow Down Visuals — join in and take the crown." },
    album: { title: "Album on Bow Down Visuals", description: "An album on Bow Down Visuals — the content creator's cheat code." },
    bio: { title: "Link in bio on Bow Down Visuals", description: "A creator's link-in-bio page on Bow Down Visuals." },
    plan: { title: "Content plan on Bow Down Visuals", description: "A creator content plan on Bow Down Visuals." },
    review: { title: "Private review link", description: "A private video review link on Bow Down Visuals." },
    sound: { title: "Sound on Bow Down Visuals", description: "A trending sound on Bow Down Visuals — use it in your next video." },
    shop: { title: "Shop on Bow Down Visuals", description: "A creator shop on Bow Down Visuals." },
    templates: { title: "Templates — Bow Down Visuals", description: "Free creator templates on Bow Down Visuals — thumbnails, hooks, captions, video templates." },
    "templates-thumbnails": { title: "Thumbnail Templates — Bow Down Visuals", description: "30 pro thumbnail templates on Bow Down Visuals — click-to-remix for your next video." },
    "templates-hooks": { title: "Hook Templates — Bow Down Visuals", description: "30 viral hook templates on Bow Down Visuals — openers that stop the scroll." },
    "templates-captions": { title: "Caption Packs — Bow Down Visuals", description: "30 caption packs on Bow Down Visuals — captions engineered to convert." },
    "templates-videos": { title: "Video Templates — Bow Down Visuals", description: "Video templates on Bow Down Visuals — pro motion, one click away." },
    hashtag: { title: `#${match.param} on Bow Down Visuals`, description: `Explore #${match.param} on Bow Down Visuals — videos, sounds, and creators.` },
    genre: { title: `${match.param} on Bow Down Visuals`, description: `Explore ${match.param} on Bow Down Visuals — tracks, videos, and creators.` },
    vertical: { title: `${match.param} creators on Bow Down Visuals`, description: `Discover ${match.param} creators on Bow Down Visuals.` },
    presave: { title: "Presave on Bow Down Visuals", description: "Presave this release on Bow Down Visuals — be first when it drops." },
    tips: { title: "Tip a creator on Bow Down Visuals", description: "Support a creator directly with tips on Bow Down Visuals." },
    join: { title: "Join on Bow Down Visuals", description: "Join a creator's list on Bow Down Visuals." },
    card: { title: "Digital card on Bow Down Visuals", description: "A creator's NFC digital card on Bow Down Visuals — tap in." },
    press: { title: "Press kit on Bow Down Visuals", description: "A creator press kit on Bow Down Visuals." },
  };
  const entry = copy[match.kind];

  return {
    title: entry.title,
    description: entry.description,
    image: fallbackImage(origin),
    imageAlt: "Bow Down Visuals — the content creator's cheat code",
    url: `${origin}${path}`,
    ogType: "website",
    twitterCard: "summary_large_image",
    robots: match.kind === "review" ? "noindex, nofollow" : "index, follow",
  };
}

/* ── Entity resolvers ────────────────────────────────────────────────────── */

type ProfileRow = typeof creatorProfilesTable.$inferSelect;

async function publicProfileById(id: string): Promise<ProfileRow | null> {
  const [p] = await db
    .select()
    .from(creatorProfilesTable)
    .where(eq(creatorProfilesTable.id, id))
    .limit(1);
  return p && p.isPublic ? p : null;
}

function formatCount(n: number | null | undefined): string {
  const v = n ?? 0;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(v);
}

function artistJsonLd(p: ProfileRow, origin: string): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    name: p.displayName,
    url: `${origin}/artist/${p.slug}`,
    ...(p.bio ? { description: truncate(p.bio, 200) } : {}),
    mainEntity: {
      "@type": "Person",
      name: p.displayName,
      url: `${origin}/artist/${p.slug}`,
      ...(p.avatarUrl ? { image: absoluteMediaUrl(p.avatarUrl, origin) } : {}),
      ...(p.bio ? { description: truncate(p.bio, 200) } : {}),
    },
  };
}

async function resolveTrack(id: string, origin: string): Promise<ShareCard | null> {
  const [t] = await db.select().from(profileTracksTable).where(eq(profileTracksTable.id, id)).limit(1);
  if (!t || !t.isPublished) return null;
  const p = await publicProfileById(t.profileId);
  if (!p) return null;
  const image = absoluteMediaUrl(t.artworkUrl, origin) ?? absoluteMediaUrl(p.avatarUrl, origin) ?? fallbackImage(origin);
  const bits = [`"${t.title}" by ${p.displayName}`];
  if (t.genre) bits.push(t.genre);
  if (t.playCount) bits.push(`${formatCount(t.playCount)} plays`);
  return {
    title: `${t.title} — ${p.displayName}`,
    description: truncate(`Listen to ${bits.join(" · ")} on Bow Down Visuals.`, 200),
    image,
    imageAlt: `${t.title} by ${p.displayName} — artwork`,
    url: `${origin}/track/${t.id}`,
    ogType: "music.song",
    twitterCard: "summary_large_image",
    robots: "index, follow",
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "MusicRecording",
      name: t.title,
      url: `${origin}/track/${t.id}`,
      image,
      byArtist: { "@type": "MusicGroup", name: p.displayName, url: `${origin}/artist/${p.slug}` },
      ...(t.genre ? { genre: t.genre } : {}),
      ...(t.durationSec ? { duration: `PT${t.durationSec}S` } : {}),
      interactionStatistic: {
        "@type": "InteractionCounter",
        interactionType: "https://schema.org/ListenAction",
        userInteractionCount: t.playCount ?? 0,
      },
    },
  };
}

async function resolveVideo(id: string, origin: string): Promise<ShareCard | null> {
  const [v] = await db.select().from(profileVideosTable).where(eq(profileVideosTable.id, id)).limit(1);
  if (!v || !v.isPublished) return null;
  const p = await publicProfileById(v.profileId);
  if (!p) return null;
  const image = absoluteMediaUrl(v.thumbnailUrl, origin) ?? absoluteMediaUrl(p.avatarUrl, origin) ?? fallbackImage(origin);
  const videoUrl = absoluteMediaUrl(v.videoUrl, origin);
  const bits = [`"${v.title}" by ${p.displayName}`];
  if (v.viewCount) bits.push(`${formatCount(v.viewCount)} views`);
  return {
    title: `${v.title} — ${p.displayName}`,
    description: truncate(v.description ? `${v.description} — Watch ${bits.join(" · ")} on Bow Down Visuals.` : `Watch ${bits.join(" · ")} on Bow Down Visuals.`, 200),
    image,
    imageAlt: `${v.title} by ${p.displayName} — thumbnail`,
    url: `${origin}/watch/${v.id}`,
    ogType: "video.other",
    twitterCard: "summary_large_image",
    robots: "index, follow",
    ...(videoUrl && /^https?:/i.test(videoUrl) ? { videoUrl, videoType: "video/mp4" } : {}),
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "VideoObject",
      name: v.title,
      description: truncate(v.description || `Watch "${v.title}" by ${p.displayName} on Bow Down Visuals.`, 200),
      thumbnailUrl: image,
      uploadDate: v.createdAt instanceof Date ? v.createdAt.toISOString() : String(v.createdAt),
      ...(v.durationSec ? { duration: `PT${v.durationSec}S` } : {}),
      ...(videoUrl ? { contentUrl: videoUrl } : {}),
      interactionStatistic: {
        "@type": "InteractionCounter",
        interactionType: "https://schema.org/WatchAction",
        userInteractionCount: v.viewCount ?? 0,
      },
    },
  };
}

async function resolvePlaylist(id: string, origin: string): Promise<ShareCard | null> {
  const [pl] = await db.select().from(playlistsTable).where(eq(playlistsTable.id, id)).limit(1);
  if (!pl || !pl.isPublic) return null;
  const owner = await publicProfileById(pl.ownerProfileId);
  if (!owner) return null;
  const image = absoluteMediaUrl(pl.coverUrl, origin) ?? absoluteMediaUrl(owner.avatarUrl, origin) ?? fallbackImage(origin);
  const count = Array.isArray(pl.items) ? pl.items.length : 0;
  return {
    title: `${pl.title} — ${owner.displayName}`,
    description: truncate(pl.description ? `${pl.description} — a ${pl.kind} by ${owner.displayName} (${count} items) on Bow Down Visuals.` : `A ${pl.kind} by ${owner.displayName} (${count} items) on Bow Down Visuals.`, 200),
    image,
    imageAlt: `${pl.title} — playlist cover`,
    url: `${origin}/playlist/${pl.id}`,
    ogType: "music.playlist",
    twitterCard: "summary_large_image",
    robots: "index, follow",
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "MusicPlaylist",
      name: pl.title,
      url: `${origin}/playlist/${pl.id}`,
      image,
      numTracks: count,
      ...(pl.description ? { description: truncate(pl.description, 200) } : {}),
    },
  };
}

async function resolveArtist(slug: string, origin: string): Promise<ShareCard | null> {
  const [p] = await db
    .select()
    .from(creatorProfilesTable)
    .where(eq(creatorProfilesTable.slug, slug.toLowerCase()))
    .limit(1);
  if (!p || !p.isPublic) return null;
  const image = absoluteMediaUrl(p.avatarUrl, origin) ?? absoluteMediaUrl(p.bannerUrl, origin) ?? fallbackImage(origin);
  const bits = [p.displayName];
  if (p.vertical) bits.push(p.vertical);
  if (p.followerCount) bits.push(`${formatCount(p.followerCount)} followers`);
  return {
    title: `${p.displayName} — creator on Bow Down Visuals`,
    description: truncate(p.bio ? `${bits.join(" · ")} — ${p.bio}` : `${bits.join(" · ")} on Bow Down Visuals.`, 200),
    image,
    imageAlt: `${p.displayName} — creator avatar`,
    url: `${origin}/artist/${p.slug}`,
    ogType: "profile",
    twitterCard: "summary_large_image",
    robots: "index, follow",
    jsonLd: artistJsonLd(p, origin),
  };
}

async function resolveShowcase(slug: string, origin: string): Promise<ShareCard | null> {
  const [item] = await db.select().from(showcaseItemsTable).where(eq(showcaseItemsTable.slug, slug)).limit(1);
  if (!item) return null;
  const isVideo = item.media_type === "video";
  const image =
    absoluteMediaUrl(item.thumbnail_url, origin) ??
    (!isVideo ? absoluteMediaUrl(item.media_url, origin) : null) ??
    fallbackImage(origin);
  const videoUrl = isVideo ? absoluteMediaUrl(item.media_url, origin) : null;
  return {
    title: `${item.title} — ${item.creator_name}`,
    description: truncate(item.description ? `${item.description} — showcased by ${item.creator_name} on Bow Down Visuals.` : `Showcased by ${item.creator_name} on Bow Down Visuals.`, 200),
    image,
    imageAlt: `${item.title} — showcase`,
    url: `${origin}/showcase/${item.slug}`,
    ogType: isVideo ? "video.other" : "website",
    twitterCard: "summary_large_image",
    robots: "index, follow",
    ...(videoUrl && /^https?:/i.test(videoUrl) ? { videoUrl, videoType: "video/mp4" } : {}),
    jsonLd: {
      "@context": "https://schema.org",
      "@type": isVideo ? "VideoObject" : "VisualArtwork",
      name: item.title,
      url: `${origin}/showcase/${item.slug}`,
      image,
      ...(item.description ? { description: truncate(item.description, 200) } : {}),
      creator: { "@type": "Person", name: item.creator_name },
    },
  };
}

async function resolveChallenge(slug: string, origin: string): Promise<ShareCard | null> {
  const [ch] = await db.select().from(challengesTable).where(eq(challengesTable.slug, slug)).limit(1);
  if (!ch) return null;
  const image = absoluteMediaUrl(ch.coverUrl, origin) ?? fallbackImage(origin);
  const bits: string[] = [];
  if (ch.hashtag) bits.push(ch.hashtag);
  if (ch.entryCount) bits.push(`${formatCount(ch.entryCount)} entries`);
  if (ch.prizeText) bits.push(`Prize: ${ch.prizeText}`);
  return {
    title: `${ch.title} — challenge on Bow Down Visuals`,
    description: truncate(ch.description ? `${bits.join(" · ")} — ${ch.description}` : `${bits.join(" · ")} — join the challenge on Bow Down Visuals.`, 200),
    image,
    imageAlt: `${ch.title} — challenge cover`,
    url: `${origin}/challenge/${ch.slug}`,
    ogType: "website",
    twitterCard: "summary_large_image",
    robots: "index, follow",
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "CreativeWork",
      name: ch.title,
      url: `${origin}/challenge/${ch.slug}`,
      image,
      ...(ch.description ? { description: truncate(ch.description, 200) } : {}),
    },
  };
}

async function resolveAlbum(slug: string, origin: string): Promise<ShareCard | null> {
  const [album] = await db
    .select()
    .from(albumsTable)
    .where(and(eq(albumsTable.slug, slug), eq(albumsTable.status, "published")))
    .limit(1);
  if (!album) return null;
  const image = absoluteMediaUrl(album.cover_art_url, origin) ?? fallbackImage(origin);
  // Artist display name via the owner's creator profile (best effort).
  let artistName: string | null = null;
  try {
    const [prof] = await db
      .select({ displayName: creatorProfilesTable.displayName, isPublic: creatorProfilesTable.isPublic })
      .from(creatorProfilesTable)
      .where(eq(creatorProfilesTable.userId, album.user_id))
      .limit(1);
    if (prof && prof.isPublic) artistName = prof.displayName;
  } catch { /* best effort */ }
  // Owner's referral code so shared album links carry ?ref=CODE (viral earning loop).
  let refSuffix = "";
  try {
    const { getSupabaseAdmin } = await import("./supabase-admin");
    const { data } = await getSupabaseAdmin()
      .from("referral_codes")
      .select("code")
      .eq("user_id", album.user_id)
      .maybeSingle();
    const code = (data as { code?: string } | null)?.code;
    if (code) refSuffix = `?ref=${encodeURIComponent(code)}`;
  } catch { /* best effort */ }
  return {
    title: artistName ? `${album.title} — ${artistName}` : `${album.title} — album on Bow Down Visuals`,
    description: truncate(album.release_notes ? `${album.release_notes} — an album${artistName ? ` by ${artistName}` : ""} on Bow Down Visuals.` : `An album${artistName ? ` by ${artistName}` : ""} on Bow Down Visuals.`, 200),
    image,
    imageAlt: `${album.title} — album cover`,
    url: `${origin}/albums/${album.slug}${refSuffix}`,
    ogType: "music.album",
    twitterCard: "summary_large_image",
    robots: "index, follow",
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "MusicAlbum",
      name: album.title,
      url: `${origin}/albums/${album.slug}`,
      image,
      ...(album.release_notes ? { description: truncate(album.release_notes, 200) } : {}),
      ...(artistName ? { byArtist: { "@type": "MusicGroup", name: artistName } } : {}),
    },
  };
}

async function resolveBio(slug: string, origin: string): Promise<ShareCard | null> {
  const [page] = await db
    .select()
    .from(bioPagesTable)
    .where(and(eq(bioPagesTable.slug, slug), eq(bioPagesTable.isPublished, true)))
    .limit(1);
  if (!page) return null;
  const image = absoluteMediaUrl(page.avatarUrl, origin) ?? fallbackImage(origin);
  let refSuffix = "";
  try {
    const { getSupabaseAdmin } = await import("./supabase-admin");
    const { data } = await getSupabaseAdmin()
      .from("referral_codes")
      .select("code")
      .eq("user_id", page.userId)
      .maybeSingle();
    const code = (data as { code?: string } | null)?.code;
    if (code) refSuffix = `?ref=${encodeURIComponent(code)}`;
  } catch { /* best effort */ }
  const name = page.displayName || "Creator";
  return {
    title: `${name} — links on Bow Down Visuals`,
    description: truncate(page.headline || page.bio ? `${page.headline || ""}${page.headline && page.bio ? " — " : ""}${page.bio || ""}`.trim() || `${name}'s link-in-bio page on Bow Down Visuals.` : `${name}'s link-in-bio page on Bow Down Visuals.`, 200),
    image,
    imageAlt: `${name} — avatar`,
    url: `${origin}/bio/${page.slug}${refSuffix}`,
    ogType: "profile",
    twitterCard: "summary_large_image",
    robots: "index, follow",
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "ProfilePage",
      name,
      url: `${origin}/bio/${page.slug}`,
      ...(page.bio ? { description: truncate(page.bio, 200) } : {}),
    },
  };
}

async function resolvePlan(slug: string, origin: string): Promise<ShareCard | null> {
  const [plan] = await db.select().from(contentPlansTable).where(eq(contentPlansTable.slug, slug)).limit(1);
  if (!plan) return null;
  return {
    title: `${plan.title} — content plan on Bow Down Visuals`,
    description: truncate(`A content plan by ${plan.creator_name} on Bow Down Visuals.`, 200),
    image: fallbackImage(origin),
    imageAlt: `${plan.title} — content plan`,
    url: `${origin}/plan/${plan.slug}`,
    ogType: "website",
    twitterCard: "summary_large_image",
    robots: "index, follow",
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "CreativeWork",
      name: plan.title,
      url: `${origin}/plan/${plan.slug}`,
      creator: { "@type": "Person", name: plan.creator_name },
    },
  };
}

/** sha256 hex of the public URL token — mirrors review-links.ts (raw token is never stored). */
function hashReviewToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

async function resolveReview(token: string, origin: string): Promise<ShareCard | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const [link] = await db
    .select()
    .from(reviewLinksTable)
    .where(eq(reviewLinksTable.token_hash, hashReviewToken(token)))
    .limit(1);
  if (!link) return null;
  // Expired, closed, or password-locked links stay private: no title leak,
  // generic noindex card.
  const expired = link.expires_at && new Date(link.expires_at).getTime() < Date.now();
  if (expired || link.status === "closed" || link.password_hash) {
    return {
      title: "Private review link",
      description: "A private video review link on Bow Down Visuals.",
      image: fallbackImage(origin),
      imageAlt: "Bow Down Visuals — the content creator's cheat code",
      url: `${origin}/review/${token}`,
      ogType: "website",
      twitterCard: "summary_large_image",
      robots: "noindex, nofollow",
    };
  }
  return {
    title: `${link.title} — review this cut`,
    description: truncate("Review this cut on Bow Down Visuals — leave timestamped feedback, no account needed.", 200),
    image: fallbackImage(origin),
    imageAlt: `${link.title} — review link`,
    url: `${origin}/review/${token}`,
    ogType: "website",
    twitterCard: "summary_large_image",
    robots: "noindex, nofollow",
  };
}

async function resolveSound(id: string, origin: string): Promise<ShareCard | null> {
  const [meta] = (await db.execute(sql`
    SELECT MAX(sound_title) AS title, COUNT(*)::int AS use_count
    FROM profile_videos WHERE sound_id = ${id} AND is_published = true
  `)).rows as Array<{ title: string | null; use_count: number }>;
  const useCount = Number(meta?.use_count ?? 0);
  if (!useCount || !meta?.title) return null;
  const [top] = await db
    .select({ thumbnailUrl: profileVideosTable.thumbnailUrl })
    .from(profileVideosTable)
    .where(and(eq(profileVideosTable.soundId, id), eq(profileVideosTable.isPublished, true)))
    .orderBy(desc(profileVideosTable.viewCount))
    .limit(1);
  const image = absoluteMediaUrl(top?.thumbnailUrl, origin) ?? fallbackImage(origin);
  return {
    title: `${meta.title} — sound on Bow Down Visuals`,
    description: truncate(`"${meta.title}" — used in ${formatCount(useCount)} videos. Use this sound in your next video on Bow Down Visuals.`, 200),
    image,
    imageAlt: `${meta.title} — sound`,
    url: `${origin}/sound/${id}`,
    ogType: "website",
    twitterCard: "summary_large_image",
    robots: "index, follow",
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "MusicRecording",
      name: meta.title,
      url: `${origin}/sound/${id}`,
      image,
    },
  };
}

async function resolveShop(handle: string, origin: string): Promise<ShareCard | null> {
  const [shop] = await db
    .select()
    .from(shopsTable)
    .where(eq(shopsTable.handle, handle.toLowerCase()))
    .limit(1);
  if (!shop) return null;
  const image = absoluteMediaUrl(shop.banner_image_url, origin) ?? fallbackImage(origin);
  return {
    title: `${shop.name} — shop on Bow Down Visuals`,
    description: truncate(shop.tagline || shop.description || `Shop ${shop.name} on Bow Down Visuals.`, 200),
    image,
    imageAlt: `${shop.name} — shop`,
    url: `${origin}/shop/${shop.handle}`,
    ogType: "website",
    twitterCard: "summary_large_image",
    robots: "index, follow",
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "Store",
      name: shop.name,
      url: `${origin}/shop/${shop.handle}`,
      image,
      ...(shop.description ? { description: truncate(shop.description, 200) } : {}),
    },
  };
}

/* ── Static curated cards (no DB) ────────────────────────────────────────── */

async function resolveNfcCard(slug: string, origin: string): Promise<ShareCard | null> {
  const [card] = await db
    .select()
    .from(nfcProfilesTable)
    .where(and(eq(nfcProfilesTable.slug, slug), eq(nfcProfilesTable.isActive, true)))
    .limit(1);
  if (!card) return null;
  const image = absoluteMediaUrl(card.avatarUrl, origin) ?? fallbackImage(origin);
  const name = card.displayName || "Creator";
  return {
    title: card.title ? `${name} — ${card.title}` : `${name} — digital card`,
    description: truncate(card.bio || `${name}'s NFC digital card on Bow Down Visuals — tap in.`, 200),
    image,
    imageAlt: `${name} — digital card`,
    url: `${origin}/c/${card.slug}`,
    ogType: "profile",
    twitterCard: "summary_large_image",
    robots: "index, follow",
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "ProfilePage",
      name,
      url: `${origin}/c/${card.slug}`,
      ...(card.bio ? { description: truncate(card.bio, 200) } : {}),
    },
  };
}

async function resolvePressKit(handle: string, origin: string): Promise<ShareCard | null> {
  const [kit] = await db
    .select()
    .from(pressKitsTable)
    .where(and(eq(pressKitsTable.handle, handle.toLowerCase()), eq(pressKitsTable.is_public, true)))
    .limit(1);
  if (!kit) return null;
  const photos = Array.isArray(kit.photo_urls) ? kit.photo_urls.filter((u): u is string => typeof u === "string") : [];
  const image = absoluteMediaUrl(photos[0], origin) ?? fallbackImage(origin);
  return {
    title: `${kit.artist_name} — press kit`,
    description: truncate(kit.tagline || kit.bio || `${kit.artist_name}'s press kit on Bow Down Visuals.`, 200),
    image,
    imageAlt: `${kit.artist_name} — press kit`,
    url: `${origin}/press/${kit.handle}`,
    ogType: "profile",
    twitterCard: "summary_large_image",
    robots: "index, follow",
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "ProfilePage",
      name: kit.artist_name,
      url: `${origin}/press/${kit.handle}`,
      ...(kit.bio ? { description: truncate(kit.bio, 200) } : {}),
    },
  };
}

function staticCard(match: ShareMatch, origin: string): ShareCard | null {
  const base = genericCard(match, origin);
  const overrides: Partial<Record<ShareKind, { title: string; description: string }>> = {
    templates: {
      title: "Creator Templates — Bow Down Visuals",
      description: "Free, remixable creator templates: thumbnails, hooks, captions, and video templates. Pick one, make it yours — Bow Down Visuals.",
    },
    "templates-thumbnails": {
      title: "30 Thumbnail Templates — Bow Down Visuals",
      description: "30 pro thumbnail templates built to win the click. Remix any of them in one tap on Bow Down Visuals.",
    },
    "templates-hooks": {
      title: "30 Hook Templates — Bow Down Visuals",
      description: "30 viral hook templates — openers engineered to stop the scroll. Remix yours on Bow Down Visuals.",
    },
    "templates-captions": {
      title: "30 Caption Packs — Bow Down Visuals",
      description: "30 caption packs engineered to convert views into follows and sales. Remix yours on Bow Down Visuals.",
    },
    "templates-videos": {
      title: "Video Templates — Bow Down Visuals",
      description: "Pro video templates — motion, pacing, and style handled. Remix yours on Bow Down Visuals.",
    },
    hashtag: {
      title: `#${match.param} — explore on Bow Down Visuals`,
      description: `Videos, sounds, and creators tagged #${match.param} on Bow Down Visuals.`,
    },
    genre: {
      title: `${match.param} — explore on Bow Down Visuals`,
      description: `Tracks, videos, and creators in ${match.param} on Bow Down Visuals.`,
    },
    vertical: {
      title: `${match.param} creators — Bow Down Visuals`,
      description: `Discover ${match.param} creators on Bow Down Visuals — watch, listen, and follow.`,
    },
    presave: {
      title: "Presave this release — Bow Down Visuals",
      description: "Presave on Bow Down Visuals and be first in line when it drops.",
    },
    tips: {
      title: `Tip @${match.param} — Bow Down Visuals`,
      description: `Support @${match.param} directly with a tip on Bow Down Visuals.`,
    },
    join: {
      title: `Join @${match.param} — Bow Down Visuals`,
      description: `Join @${match.param}'s list on Bow Down Visuals — drops, presaves, and exclusives.`,
    },
  };
  const o = overrides[match.kind];
  if (!o) return null;
  return { ...base, title: o.title, description: o.description };
}

/** Resolve a shareable route to its rich card. Returns null when the entity
    doesn't exist or isn't public — the caller then serves the branded
    generic card with a 404 status. */
export async function resolveShareCard(
  match: ShareMatch,
  origin: string,
): Promise<ShareCard | null> {
  switch (match.kind) {
    case "track": return resolveTrack(match.param, origin);
    case "video": return resolveVideo(match.param, origin);
    case "playlist": return resolvePlaylist(match.param, origin);
    case "artist": return resolveArtist(match.param, origin);
    case "showcase": return resolveShowcase(match.param, origin);
    case "challenge": return resolveChallenge(match.param, origin);
    case "album": return resolveAlbum(match.param, origin);
    case "bio": return resolveBio(match.param, origin);
    case "plan": return resolvePlan(match.param, origin);
    case "review": return resolveReview(match.param, origin);
    case "sound": return resolveSound(match.param, origin);
    case "shop": return resolveShop(match.param, origin);
    case "card": return resolveNfcCard(match.param, origin);
    case "press": return resolvePressKit(match.param.toLowerCase(), origin);
    default: return staticCard(match, origin);
  }
}

/* ── HTML document ───────────────────────────────────────────────────────── */

function metaTag(property: string, content: string): string {
  return `<meta property="${property}" content="${escapeHtml(content)}" />`;
}

function metaName(name: string, content: string): string {
  return `<meta name="${name}" content="${escapeHtml(content)}" />`;
}

/** Minimal self-contained preview document for scrapers. Includes a
    meta-refresh + visible link so any human whose UA matched the bot list
    lands in the real SPA instantly. */
export function buildOgHtml(card: ShareCard): string {
  const tags: string[] = [
    `<title>${escapeHtml(card.title)}</title>`,
    metaName("description", card.description),
    metaName("robots", card.robots),
    `<link rel="canonical" href="${escapeHtml(card.url)}" />`,
    metaTag("og:site_name", SITE_NAME),
    metaTag("og:type", card.ogType),
    metaTag("og:title", card.title),
    metaTag("og:description", card.description),
    metaTag("og:url", card.url),
    metaTag("og:image", card.image),
    metaTag("og:image:width", "1200"),
    metaTag("og:image:height", "630"),
    metaTag("og:image:alt", card.imageAlt),
    `<meta name="twitter:card" content="${card.twitterCard}" />`,
    metaName("twitter:title", card.title),
    metaName("twitter:description", card.description),
    metaName("twitter:image", card.image),
    metaName("twitter:image:alt", card.imageAlt),
  ];
  if (card.videoUrl) {
    tags.push(
      metaTag("og:video", card.videoUrl),
      metaTag("og:video:secure_url", card.videoUrl),
      metaTag("og:video:type", card.videoType ?? "video/mp4"),
      metaTag("og:video:width", "1280"),
      metaTag("og:video:height", "720"),
    );
  }
  if (card.jsonLd) {
    // JSON-LD is machine-generated from DB rows; escape the closing script
    // sequence so a hostile title/description can't break out of the block.
    const json = JSON.stringify(card.jsonLd).replace(/<\//g, "<\\/");
    tags.push(`<script type="application/ld+json">${json}</script>`);
  }
  tags.push(`<meta http-equiv="refresh" content="0;url=${escapeHtml(card.url)}" />`);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
${tags.join("\n")}
<style>
  body{background:#0a0a0a;color:#e8d9a8;font-family:Georgia,serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center;padding:2rem}
  a{color:#d4af37}
  .crown{font-size:3rem}
</style>
</head>
<body>
<main>
<div class="crown">👑</div>
<h1>${escapeHtml(card.title)}</h1>
<p>${escapeHtml(card.description)}</p>
<p><a href="${escapeHtml(card.url)}">Open on ${escapeHtml(SITE_NAME)} →</a></p>
</main>
</body>
</html>`;
}

/* ── Middleware ──────────────────────────────────────────────────────────── */

/**
 * Bot-aware link-preview middleware. Mount BEFORE the SPA static fallback.
 * Only handles GET requests with a scraper User-Agent on shareable routes;
 * everything else passes through untouched (humans always get index.html).
 */
export function ogPreviewMiddleware() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (req.method !== "GET") {
        next();
        return;
      }
      if (!isSocialBot(req.get("user-agent"))) {
        next();
        return;
      }
      const match = matchShareableRoute(req.path);
      if (!match) {
        next();
        return;
      }
      const origin = siteOrigin();
      let card: ShareCard | null = null;
      try {
        card = await resolveShareCard(match, origin);
      } catch (err) {
        // Resolver failure degrades to the branded fallback card — a bot
        // must never get a 500 or the generic homepage card.
        logger.warn({ err, kind: match.kind, param: match.param }, "og-preview resolve failed; serving fallback card");
      }
      const found = card !== null;
      const finalCard = card ?? genericCard(match, origin);
      res.status(found ? 200 : 404);
      res.set("Content-Type", "text/html; charset=utf-8");
      res.set("Cache-Control", "public, max-age=600");
      res.set("Vary", "User-Agent");
      res.send(buildOgHtml(finalCard));
    } catch (err) {
      next(err);
    }
  };
}
