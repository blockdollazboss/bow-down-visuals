/**
 * podcast-feed.ts — the hosted per-show podcast RSS feed (Lane F10).
 *
 *   GET /api/podcast-feed/:slug                      public RSS 2.0 + iTunes XML
 *   GET /api/podcast-feed/:slug/episodes/:file       public 302 → fresh signed audio URL
 *   GET /api/podcast-feed/me                         authed: my show + feed state
 *   PUT /api/podcast-feed/me/settings                authed: save show settings
 *
 * Public by design (read-only; published episodes of public profiles —
 * the D1 creator-media principle). The feed renders from live rows on
 * every request, so publishing or unpublishing an episode updates the
 * directories' next poll automatically. Show settings live in
 * creator_profiles.theme_config.podcastFeed (see lib/podcast-feed.ts).
 *
 * Directories are NEVER submitted to by us: submission is the creator's
 * one-time manual step in their own Apple/Spotify accounts, and the UI
 * says exactly that.
 */
import { Router } from "express";
import { z } from "zod";
import { db, creatorProfilesTable, profileTracksTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { siteOrigin, absoluteMediaUrl } from "../lib/og-preview";
import { refreshSupabaseStorageUrl } from "../lib/objectStorage";
import { getSupabaseAdmin } from "../lib/supabase-admin";
import {
  APPLE_PODCAST_CATEGORIES,
  buildFeedShow,
  buildPodcastFeedXml,
  readPodcastFeedSettings,
  resolveEnclosure,
  writePodcastFeedSettings,
  type PodcastFeedEpisode,
  type PodcastFeedSettings,
} from "../lib/podcast-feed";

const router = Router();

type ProfileRow = typeof creatorProfilesTable.$inferSelect;
type TrackRow = typeof profileTracksTable.$inferSelect;

const MAX_FEED_EPISODES = 300;

function feedUrlFor(slug: string): string {
  return `${siteOrigin()}/api/podcast-feed/${slug}`;
}

async function loadPublicProfile(slug: string): Promise<ProfileRow | null> {
  const [profile] = await db
    .select()
    .from(creatorProfilesTable)
    .where(eq(creatorProfilesTable.slug, slug.toLowerCase()))
    .limit(1);
  if (!profile || !profile.isPublic) return null;
  return profile;
}

async function loadMyProfile(userId: string): Promise<ProfileRow | null> {
  const [profile] = await db
    .select()
    .from(creatorProfilesTable)
    .where(eq(creatorProfilesTable.userId, userId))
    .limit(1);
  return profile ?? null;
}

async function loadPublishedEpisodes(profileId: string): Promise<TrackRow[]> {
  return db
    .select()
    .from(profileTracksTable)
    .where(
      and(
        eq(profileTracksTable.profileId, profileId),
        eq(profileTracksTable.isPublished, true),
      ),
    )
    .orderBy(desc(profileTracksTable.createdAt))
    .limit(MAX_FEED_EPISODES);
}

/** Refresh a stored media value (ref or URL) to an absolute playable URL. */
async function absoluteRefreshed(raw: string | null | undefined): Promise<string | null> {
  if (!raw) return null;
  const refreshed = await refreshSupabaseStorageUrl(raw);
  return absoluteMediaUrl(refreshed, siteOrigin());
}

/* ── Owner email (itunes:owner) — cached; feeds omit it when unknown ── */

const ownerEmailCache = new Map<string, { at: number; email: string | null }>();
const OWNER_EMAIL_TTL_MS = 15 * 60_000;

async function ownerEmailFor(userId: string): Promise<string | null> {
  const hit = ownerEmailCache.get(userId);
  if (hit && Date.now() - hit.at < OWNER_EMAIL_TTL_MS) return hit.email;
  let email: string | null = null;
  try {
    const { data } = await getSupabaseAdmin().auth.admin.getUserById(userId);
    email = data?.user?.email ?? null;
  } catch (err) {
    logger.warn({ err, userId }, "podcast-feed: owner email lookup failed");
  }
  ownerEmailCache.set(userId, { at: Date.now(), email });
  return email;
}

/* ── GET /api/podcast-feed/me ────────────────────────────────────────── */

router.get("/podcast-feed/me", requireAuth, async (req, res) => {
  try {
    const profile = await loadMyProfile(req.userId!);
    if (!profile) {
      res.json({ hasProfile: false });
      return;
    }
    const episodes = await loadPublishedEpisodes(profile.id);
    const settings = readPodcastFeedSettings(profile.themeConfig);
    res.json({
      hasProfile: true,
      slug: profile.slug,
      feedUrl: feedUrlFor(profile.slug),
      profilePublic: profile.isPublic,
      episodeCount: episodes.length,
      settings,
      defaults: {
        title: profile.displayName,
        description: profile.bio,
        author: profile.displayName,
        artworkUrl: profile.avatarUrl ?? profile.bannerUrl ?? null,
      },
      categories: APPLE_PODCAST_CATEGORIES,
    });
  } catch (err) {
    logger.error({ err }, "podcast-feed: /me failed");
    res.status(500).json({ error: "Could not load your podcast feed settings." });
  }
});

/* ── PUT /api/podcast-feed/me/settings ───────────────────────────────── */

const settingsSchema = z.object({
  title: z.string().trim().max(255).nullable().optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  author: z.string().trim().max(255).nullable().optional(),
  category: z
    .string()
    .refine((c) => c in APPLE_PODCAST_CATEGORIES, "Unknown Apple podcast category.")
    .nullable()
    .optional(),
  subcategory: z.string().trim().max(60).nullable().optional(),
  explicit: z.boolean().nullable().optional(),
  artworkUrl: z.string().trim().url().max(2048).nullable().optional(),
  language: z.string().trim().max(16).nullable().optional(),
});

router.put("/podcast-feed/me/settings", requireAuth, async (req, res) => {
  try {
    const parsed = settingsSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid podcast settings.",
        details: parsed.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      });
      return;
    }
    const profile = await loadMyProfile(req.userId!);
    if (!profile) {
      res.status(404).json({ error: "Create your creator profile first — your podcast lives on it." });
      return;
    }

    const current = readPodcastFeedSettings(profile.themeConfig);
    const patch = parsed.data;
    const merged: PodcastFeedSettings = { ...current };
    for (const key of [
      "title", "description", "author", "category", "subcategory", "artworkUrl", "language",
    ] as const) {
      const v = patch[key];
      if (v === null) delete merged[key];
      else if (v !== undefined) merged[key] = v;
    }
    if (patch.explicit === null) delete merged.explicit;
    else if (patch.explicit !== undefined) merged.explicit = patch.explicit;

    // A subcategory is only meaningful under its own category.
    if (merged.category && merged.subcategory) {
      const subs = APPLE_PODCAST_CATEGORIES[merged.category] ?? [];
      if (!subs.includes(merged.subcategory)) delete merged.subcategory;
    }

    await db
      .update(creatorProfilesTable)
      .set({
        themeConfig: writePodcastFeedSettings(profile.themeConfig, merged),
        updatedAt: new Date(),
      })
      .where(eq(creatorProfilesTable.id, profile.id));

    res.json({ settings: merged, feedUrl: feedUrlFor(profile.slug) });
  } catch (err) {
    logger.error({ err }, "podcast-feed: settings save failed");
    res.status(500).json({ error: "Could not save your podcast settings." });
  }
});

/* ── GET /api/podcast-feed/:slug/episodes/:file — stable enclosure door ─ */

router.get(
  "/podcast-feed/:slug/episodes/:file",
  publicApiLimiter,
  async (req, res) => {
    try {
      const slug = String(req.params["slug"] ?? "");
      const file = String(req.params["file"] ?? "");
      const trackId = file.replace(/\.mp3$/i, "");
      const profile = await loadPublicProfile(slug);
      if (!profile) {
        res.status(404).type("text/plain").send("Podcast feed not found.");
        return;
      }
      const [track] = await db
        .select()
        .from(profileTracksTable)
        .where(
          and(
            eq(profileTracksTable.id, trackId),
            eq(profileTracksTable.profileId, profile.id),
            eq(profileTracksTable.isPublished, true),
          ),
        )
        .limit(1);
      if (!track) {
        res.status(404).type("text/plain").send("Episode not found.");
        return;
      }
      const signed = await refreshSupabaseStorageUrl(track.audioUrl);
      if (!/^https?:\/\//i.test(signed)) {
        logger.error({ trackId }, "podcast-feed: enclosure door could not sign audio");
        res.status(502).type("text/plain").send("Episode audio is unavailable right now.");
        return;
      }
      res.setHeader("Cache-Control", "no-store");
      res.redirect(302, signed);
    } catch (err) {
      logger.error({ err }, "podcast-feed: enclosure door failed");
      res.status(500).type("text/plain").send("Episode audio is unavailable right now.");
    }
  },
);

/* ── GET /api/podcast-feed/:slug — the feed itself ───────────────────── */

router.get("/podcast-feed/:slug", publicApiLimiter, async (req, res) => {
  try {
    const slug = String(req.params["slug"] ?? "");
    const profile = await loadPublicProfile(slug);
    if (!profile) {
      res.status(404).type("text/plain").send("Podcast feed not found.");
      return;
    }

    const settings = readPodcastFeedSettings(profile.themeConfig);
    const rows = await loadPublishedEpisodes(profile.id);
    const origin = siteOrigin();
    const feedUrl = feedUrlFor(profile.slug);

    const artworkRaw = settings.artworkUrl ?? profile.avatarUrl ?? profile.bannerUrl;
    const [artworkUrl, ownerEmail] = await Promise.all([
      artworkRaw && /^https?:\/\//i.test(artworkRaw)
        ? Promise.resolve(artworkRaw)
        : absoluteRefreshed(artworkRaw),
      ownerEmailFor(profile.userId),
    ]);

    const show = buildFeedShow(profile, { feedUrl, artworkUrl, ownerEmail });
    const explicit = settings.explicit ?? false;

    const episodes: PodcastFeedEpisode[] = [];
    let skipped = 0;
    for (const track of rows) {
      const fallbackUrl = `${origin}/api/podcast-feed/${profile.slug}/episodes/${track.id}.mp3`;
      const enclosure = await resolveEnclosure(
        { id: track.id, audioUrl: track.audioUrl },
        fallbackUrl,
      );
      if (!enclosure) {
        skipped++;
        continue;
      }
      const tags = (track.tags ?? []).filter(Boolean);
      const descriptionParts = [track.title];
      if (track.genre) descriptionParts.push(track.genre);
      if (tags.length) descriptionParts.push(`Topics: ${tags.join(", ")}`);
      episodes.push({
        guid: `${origin}/track/${track.id}`,
        title: track.title,
        description: descriptionParts.join(" — "),
        pubDate: track.createdAt ? new Date(track.createdAt) : new Date(),
        durationSeconds: track.durationSec ?? 0,
        explicit,
        artworkUrl: (await absoluteRefreshed(track.artworkUrl)) ?? undefined,
        enclosure,
      });
    }
    if (skipped > 0) {
      logger.warn(
        { slug: profile.slug, skipped },
        "podcast-feed: episodes omitted — enclosure size unprovable",
      );
    }

    const xml = buildPodcastFeedXml(show, episodes);
    res.setHeader("Content-Type", "application/rss+xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=300");
    res.status(200).send(xml);
  } catch (err) {
    logger.error({ err }, "podcast-feed: feed render failed");
    res.status(500).type("text/plain").send("Podcast feed is unavailable right now.");
  }
});

export default router;
