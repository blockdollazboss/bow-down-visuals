/* Dynamic sitemap (Stack-300 SEO #82).
   ---------------------------------------------------------------------------
   The static FE sitemap (public/sitemap.xml) lists exactly the 16 static
   public URLs and can never grow: every dynamic public route in the
   access law (FE src/lib/public-routes.ts) — creator profiles, shops,
   tracks, videos, albums, bio pages, tip jars, fan landings — was absent
   from every sitemap, so search engines could only discover those pages
   by following links.

   This module serves the full picture from the API (mounted in app.ts
   before the SPA fallback, so it shadows the static file):

     GET /sitemap.xml            → a sitemap INDEX: the static child
                                   (the FE file's own set, served from
                                   the same data) plus one child per
                                   dynamic family below.
     GET /sitemap-static.xml     → the static public set (mirrors
                                   public/sitemap.xml exactly — that file
                                   stays as the no-API fallback and the
                                   lockdown test keeps pinning it).
     GET /sitemap-<family>.xml   → one urlset generated live from the
                                   family's table, public rows only.

   The families mirror the og-preview resolver predicates EXACTLY — a URL
   is listed only when its public page actually renders for a guest:
   profiles is_public, tracks/videos published AND on a public profile,
   shops always public storefronts, products active, albums published,
   bio pages published, challenges any status but hidden, playlists
   public on a public profile, plans / photo-presets / unlock gates /
   NFC cards / press kits by their resolvers' own public flags.

   Deliberately NOT listed (public by the access law but unlistable):
   token surfaces (/review/:token, /sync-one-sheet/:token,
   /live/guest/:token — unguessable credentials, and the og rail already
   noindexes them), auth/transactional pages (/login, /signup,
   /reset-password, /qr-login, /store/success, the OBS overlay trio),
   /splits/:slug (private agreements — their og cards are noindex),
   /presave/:slug + /join/:handle (conversion landings with no
   public-flagged source table on this rail), /post/:id and
   /events/:id (LOCKED in the route matrix — members only),
   /sound/:id, /premiere/:id, /live/:id (ephemeral or resolver-only
   surfaces — premieres/streams are schedules, not crawl targets),
   /hashtag/:tag, /vertical/:vertical, /genre/:genre (unbounded tag
   spaces — no finite public set to list; /showcase/:slug IS listed
   below: its route matrix entry is "locked" for the SPA gate, but the
   og rail has served per-item showcase cards all along — the sitemap
   follows the card rail's established public treatment).

   Children are capped at SITEMAP_CHILD_CAP rows (newest first) — far
   above the protocol's 50,000-URL child limit headroom the index format
   exists for; if a family ever outgrows the cap, it gets its own
   pagination then. Responses cache for an hour: sitemaps are crawler
   food, not live data. */

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
  shopsTable,
  shopProductsTable,
  nfcProfilesTable,
  pressKitsTable,
  photoPresetsTable,
  socialUnlockGatesTable,
  groupsTable,
} from "@workspace/db";
import { eq, and, desc, inArray } from "drizzle-orm";
import { siteOrigin } from "./og-preview";
import { logger } from "./logger";

/* ── The static public set ───────────────────────────────────────────────
   Mirrors FE public/sitemap.xml EXACTLY (which the lockdown test pins
   against the access-law static set). If that file's set ever changes,
   this list changes with it — the sitemap test pins the two together. */
export const STATIC_SITEMAP_PATHS: readonly string[] = [
  "/",
  "/world",
  "/charts",
  "/scenes",
  "/shorts",
  "/beats",
  "/shoutouts",
  "/memberships",
  "/contests",
  "/winners",
  "/terms",
  "/privacy",
  "/refund-policy",
  "/moderation",
  "/storefronts",
  "/app",
];

/** Rows per child sitemap (newest first when the family outgrows it). */
export const SITEMAP_CHILD_CAP = 10_000;

interface SitemapEntry {
  path: string;
  lastmod?: Date | string | null;
}

/* ── XML rendering ─────────────────────────────────────────────────────── */

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function lastmodValue(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export function renderUrlset(origin: string, entries: SitemapEntry[]): string {
  const lines = entries.map((e) => {
    const lm = lastmodValue(e.lastmod);
    return `  <url><loc>${escapeXml(`${origin}${e.path}`)}</loc>${lm ? `<lastmod>${lm}</lastmod>` : ""}</url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${lines.join("\n")}\n</urlset>\n`;
}

export function renderIndex(origin: string, children: string[]): string {
  const lines = children.map(
    (name) => `  <sitemap><loc>${escapeXml(`${origin}/sitemap-${name}.xml`)}</loc></sitemap>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${lines.join("\n")}\n</sitemapindex>\n`;
}

/* ── Family loaders ──────────────────────────────────────────────────────
   One loader per child. Each returns public entries only, applying the
   same visibility predicate as the matching og-preview resolver. */

type Loader = (origin: string) => Promise<SitemapEntry[]>;

async function publicProfileIds(): Promise<Set<string>> {
  const rows = await db
    .select({ id: creatorProfilesTable.id })
    .from(creatorProfilesTable)
    .where(eq(creatorProfilesTable.isPublic, true));
  return new Set(rows.map((r) => r.id));
}

const loaders: Record<string, Loader> = {
  artists: async () => {
    const rows = await db
      .select({ slug: creatorProfilesTable.slug, updatedAt: creatorProfilesTable.updatedAt })
      .from(creatorProfilesTable)
      .where(eq(creatorProfilesTable.isPublic, true))
      .orderBy(desc(creatorProfilesTable.updatedAt))
      .limit(SITEMAP_CHILD_CAP);
    return rows.map((r) => ({ path: `/artist/${r.slug}`, lastmod: r.updatedAt }));
  },

  groups: async () => {
    const rows = await db
      .select({ slug: groupsTable.slug, createdAt: groupsTable.createdAt })
      .from(groupsTable)
      .where(eq(groupsTable.isPublic, true))
      .orderBy(desc(groupsTable.createdAt))
      .limit(SITEMAP_CHILD_CAP);
    return rows.map((r) => ({ path: `/group/${r.slug}`, lastmod: r.createdAt }));
  },

  shops: async () => {
    const rows = await db
      .select({ handle: shopsTable.handle, updated_at: shopsTable.updated_at })
      .from(shopsTable)
      .orderBy(desc(shopsTable.updated_at))
      .limit(SITEMAP_CHILD_CAP);
    return rows.map((r) => ({ path: `/shop/${r.handle}`, lastmod: r.updated_at }));
  },

  products: async () => {
    const rows = await db
      .select({ id: shopProductsTable.id })
      .from(shopProductsTable)
      .where(eq(shopProductsTable.status, "active"))
      .limit(SITEMAP_CHILD_CAP);
    return rows.map((r) => ({ path: `/storefront/product/${r.id}` }));
  },

  tracks: async () => {
    const pub = await publicProfileIds();
    const rows = await db
      .select({ id: profileTracksTable.id, profileId: profileTracksTable.profileId, createdAt: profileTracksTable.createdAt })
      .from(profileTracksTable)
      .where(eq(profileTracksTable.isPublished, true))
      .orderBy(desc(profileTracksTable.createdAt))
      .limit(SITEMAP_CHILD_CAP * 2);
    return rows
      .filter((r) => pub.has(r.profileId))
      .slice(0, SITEMAP_CHILD_CAP)
      .map((r) => ({ path: `/track/${r.id}`, lastmod: r.createdAt }));
  },

  videos: async () => {
    const pub = await publicProfileIds();
    const rows = await db
      .select({ id: profileVideosTable.id, profileId: profileVideosTable.profileId })
      .from(profileVideosTable)
      .where(eq(profileVideosTable.isPublished, true))
      .limit(SITEMAP_CHILD_CAP * 2);
    return rows
      .filter((r) => pub.has(r.profileId))
      .slice(0, SITEMAP_CHILD_CAP)
      .map((r) => ({ path: `/watch/${r.id}` }));
  },

  albums: async () => {
    const rows = await db
      .select({ slug: albumsTable.slug, updated_at: albumsTable.updated_at })
      .from(albumsTable)
      .where(eq(albumsTable.status, "published"))
      .orderBy(desc(albumsTable.updated_at))
      .limit(SITEMAP_CHILD_CAP);
    return rows
      .filter((r) => r.slug)
      .map((r) => ({ path: `/albums/${r.slug}`, lastmod: r.updated_at }));
  },

  playlists: async () => {
    const pub = await publicProfileIds();
    const rows = await db
      .select({ id: playlistsTable.id, ownerProfileId: playlistsTable.ownerProfileId })
      .from(playlistsTable)
      .where(eq(playlistsTable.isPublic, true))
      .limit(SITEMAP_CHILD_CAP * 2);
    return rows
      .filter((r) => pub.has(r.ownerProfileId))
      .slice(0, SITEMAP_CHILD_CAP)
      .map((r) => ({ path: `/playlist/${r.id}` }));
  },

  bio: async () => {
    const rows = await db
      .select({ slug: bioPagesTable.slug, updatedAt: bioPagesTable.updatedAt })
      .from(bioPagesTable)
      .where(eq(bioPagesTable.isPublished, true))
      .orderBy(desc(bioPagesTable.updatedAt))
      .limit(SITEMAP_CHILD_CAP);
    return rows.map((r) => ({ path: `/bio/${r.slug}`, lastmod: r.updatedAt }));
  },

  /* Tip jars ride the creator profile's own public flag + its
     tipJarEnabled switch (the /tips/:handle gate) — the handle IS the
     profile slug. */
  tips: async () => {
    const rows = await db
      .select({ slug: creatorProfilesTable.slug, updatedAt: creatorProfilesTable.updatedAt })
      .from(creatorProfilesTable)
      .where(and(eq(creatorProfilesTable.isPublic, true), eq(creatorProfilesTable.tipJarEnabled, true)))
      .orderBy(desc(creatorProfilesTable.updatedAt))
      .limit(SITEMAP_CHILD_CAP);
    return rows.map((r) => ({ path: `/tips/${r.slug}`, lastmod: r.updatedAt }));
  },

  challenges: async () => {
    const rows = await db
      .select({ slug: challengesTable.slug, createdAt: challengesTable.createdAt })
      .from(challengesTable)
      .where(inArray(challengesTable.status, ["upcoming", "live", "judging", "winners"]))
      .orderBy(desc(challengesTable.createdAt))
      .limit(SITEMAP_CHILD_CAP);
    const entries: SitemapEntry[] = [];
    for (const r of rows) {
      entries.push({ path: `/challenge/${r.slug}`, lastmod: r.createdAt });
      entries.push({ path: `/challenge/${r.slug}/winners`, lastmod: r.createdAt });
    }
    return entries;
  },

  showcase: async () => {
    const rows = await db
      .select({ slug: showcaseItemsTable.slug })
      .from(showcaseItemsTable)
      .limit(SITEMAP_CHILD_CAP);
    return rows.map((r) => ({ path: `/showcase/${r.slug}` }));
  },

  plans: async () => {
    const rows = await db
      .select({ slug: contentPlansTable.slug })
      .from(contentPlansTable)
      .limit(SITEMAP_CHILD_CAP);
    return rows.map((r) => ({ path: `/plan/${r.slug}` }));
  },

  "photo-presets": async () => {
    const rows = await db
      .select({ share_slug: photoPresetsTable.share_slug })
      .from(photoPresetsTable)
      .where(eq(photoPresetsTable.is_public, true))
      .limit(SITEMAP_CHILD_CAP);
    return rows
      .filter((r) => r.share_slug)
      .map((r) => ({ path: `/photo-preset/${r.share_slug}` }));
  },

  collections: async () => {
    const rows = await db
      .select({ slug: creatorProfilesTable.slug, updatedAt: creatorProfilesTable.updatedAt })
      .from(creatorProfilesTable)
      .where(
        and(
          eq(creatorProfilesTable.isPublic, true),
          eq(creatorProfilesTable.collectionVisibility, "public"),
        ),
      )
      .orderBy(desc(creatorProfilesTable.updatedAt))
      .limit(SITEMAP_CHILD_CAP);
    return rows.map((r) => ({ path: `/collection/${r.slug}`, lastmod: r.updatedAt }));
  },

  cards: async () => {
    const rows = await db
      .select({ slug: nfcProfilesTable.slug })
      .from(nfcProfilesTable)
      .where(eq(nfcProfilesTable.isActive, true))
      .limit(SITEMAP_CHILD_CAP);
    return rows.map((r) => ({ path: `/c/${r.slug}` }));
  },

  press: async () => {
    const rows = await db
      .select({ handle: pressKitsTable.handle })
      .from(pressKitsTable)
      .where(eq(pressKitsTable.is_public, true))
      .limit(SITEMAP_CHILD_CAP);
    return rows.map((r) => ({ path: `/press/${r.handle}` }));
  },

  unlock: async () => {
    const rows = await db
      .select({ slug: socialUnlockGatesTable.slug })
      .from(socialUnlockGatesTable)
      .limit(SITEMAP_CHILD_CAP);
    return rows.map((r) => ({ path: `/unlock/${r.slug}` }));
  },
};

/** Child names in index order: "static" first, then the families. */
export const SITEMAP_CHILDREN: readonly string[] = [
  "static",
  "artists",
  "groups",
  "shops",
  "products",
  "tracks",
  "videos",
  "albums",
  "playlists",
  "bio",
  "tips",
  "challenges",
  "showcase",
  "plans",
  "photo-presets",
  "collections",
  "cards",
  "press",
  "unlock",
];

const CHILD_PATH_RE = /^\/sitemap-([a-z-]+)\.xml$/;

/* ── Middleware ────────────────────────────────────────────────────────── */

/**
 * Sitemap middleware. Mount BEFORE express.static + the SPA fallback
 * (app.ts, beside ogPreviewMiddleware) so /sitemap.xml is the dynamic
 * index rather than the static FE file. All other paths pass through.
 * A family that fails to load degrades to an empty urlset (logged) —
 * a crawler must never get a 500 for a sitemap.
 */
export function sitemapMiddleware() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (req.method !== "GET") {
        next();
        return;
      }
      const origin = siteOrigin();
      if (req.path === "/sitemap.xml") {
        res.set("Content-Type", "application/xml; charset=utf-8");
        res.set("Cache-Control", "public, max-age=3600");
        res.send(renderIndex(origin, [...SITEMAP_CHILDREN]));
        return;
      }
      const m = CHILD_PATH_RE.exec(req.path);
      if (!m) {
        next();
        return;
      }
      const name = m[1] as string;
      res.set("Content-Type", "application/xml; charset=utf-8");
      res.set("Cache-Control", "public, max-age=3600");
      if (name === "static") {
        res.send(renderUrlset(origin, STATIC_SITEMAP_PATHS.map((path) => ({ path }))));
        return;
      }
      const loader = loaders[name];
      if (!loader) {
        res.status(404).send(renderUrlset(origin, []));
        return;
      }
      try {
        const entries = await loader(origin);
        res.send(renderUrlset(origin, entries));
      } catch (err) {
        logger.warn({ err, child: name }, "sitemap child failed; serving empty urlset");
        res.send(renderUrlset(origin, []));
      }
    } catch (err) {
      next(err);
    }
  };
}
