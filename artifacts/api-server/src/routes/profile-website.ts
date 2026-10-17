import { Router } from "express";
import { z } from "zod";
import {
  db,
  creatorProfilesTable,
  profileTracksTable,
  profileVideosTable,
  storeProductsTable,
  shopsTable,
  shopProductsTable,
  digitalSalesTable,
  storeOrdersTable,
  retentionPrefsTable,
} from "@workspace/db";
import { eq, and, desc, inArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { arcadeStatsForUser } from "./arcade";
import { partyStatsForUser } from "./party";
import { refreshSupabaseStorageUrlsDeep } from "../lib/objectStorage";
import { formatUsd } from "../lib/platform-fees";
import {
  PROFILE_BLOCK_TYPES,
  MAX_PROFILE_BLOCKS,
  PROFILE_COLORWAYS,
  PROFILE_FONT_IDS,
  colorwayById,
  validateLayout,
  effectiveLayout,
  type ProfileBlockDto,
} from "../lib/profile-website";

/* ── "The profile IS the website" — data/engine routes (Stack 3) ─────────
   Items 2/3/4 are PLUMBING ONLY (their visuals are design-gated — the
   owner picks the design from artifact options before any editor UI or
   profile rendering changes):
     #2 block layout model   GET /creator-profiles/me/layout (auth)
                             PUT /creator-profiles/me/layout (auth, strict)
                             GET /creator-profiles/:slug/layout (public)
     #3 theme settings data  GET /creator-profiles/me/theme-settings (auth)
                             PUT /creator-profiles/me/theme-settings (auth)
     #4 profile store DTO    GET /creator-profiles/:slug/store-catalog (public)
   Item 5 (spotlight pin) and item 6 (fan collections) are full builds:
     #5 pin                  GET /creator-profiles/:slug/spotlight (public)
                             PUT /creator-profiles/me/spotlight (auth)
     #6 fan collections      GET /collections/:slug (public, privacy-aware)
                             GET /collections/me (auth)
                             PUT /collections/me/visibility (auth)
   DTOs are explicit camelCase, hand-built — never a raw row spread.
   Owner writes resolve the profile from the SESSION only.            */

const router = Router();

type ProfileRow = typeof creatorProfilesTable.$inferSelect;

async function getOwnProfile(userId: string): Promise<ProfileRow | null> {
  const [row] = await db
    .select()
    .from(creatorProfilesTable)
    .where(eq(creatorProfilesTable.userId, userId))
    .limit(1);
  return row ?? null;
}

async function getPublicProfileBySlug(slug: string): Promise<ProfileRow | null> {
  const [row] = await db
    .select()
    .from(creatorProfilesTable)
    .where(eq(creatorProfilesTable.slug, slug.toLowerCase()))
    .limit(1);
  if (!row || !row.isPublic) return null;
  return row;
}

const NO_PROFILE = {
  error: "NO_PROFILE",
  message: "Create your creator profile first — your page is your website, and it starts there.",
} as const;

/* ═══ #2 — Block layout model ═══════════════════════════════════════════ */

export interface LayoutResponseDto {
  layout: ProfileBlockDto[];
  isDefault: boolean;
  blockTypes: typeof PROFILE_BLOCK_TYPES;
  maxBlocks: number;
}

function layoutResponse(profile: ProfileRow): LayoutResponseDto {
  const { blocks, isDefault } = effectiveLayout(profile);
  return { layout: blocks, isDefault, blockTypes: PROFILE_BLOCK_TYPES, maxBlocks: MAX_PROFILE_BLOCKS };
}

router.get("/creator-profiles/me/layout", publicApiLimiter, requireAuth, async (req, res) => {
  try {
    const own = await getOwnProfile(req.userId!);
    if (!own) {
      res.status(404).json(NO_PROFILE);
      return;
    }
    res.json(layoutResponse(own));
  } catch (err) {
    req.log.error({ err }, "profile layout GET (me) error");
    res.status(500).json({ error: "Couldn't load your page layout. Try again." });
  }
});

router.put("/creator-profiles/me/layout", publicApiLimiter, requireAuth, async (req, res) => {
  try {
    const own = await getOwnProfile(req.userId!);
    if (!own) {
      res.status(404).json(NO_PROFILE);
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const v = validateLayout(body["layout"]);
    if (!v.ok) {
      res.status(400).json({ error: v.error, message: v.message });
      return;
    }
    await db
      .update(creatorProfilesTable)
      .set({ layoutBlocks: v.blocks as unknown as Array<Record<string, unknown>>, updatedAt: new Date() })
      .where(eq(creatorProfilesTable.id, own.id));
    const saved = await getOwnProfile(req.userId!);
    res.json({ saved: true, ...(saved ? layoutResponse(saved) : { layout: v.blocks, isDefault: false, blockTypes: PROFILE_BLOCK_TYPES, maxBlocks: MAX_PROFILE_BLOCKS }) });
  } catch (err) {
    req.log.error({ err }, "profile layout PUT error");
    res.status(500).json({ error: "Couldn't save your page layout. Try again." });
  }
});

router.get("/creator-profiles/:slug/layout", publicApiLimiter, async (req, res) => {
  try {
    const profile = await getPublicProfileBySlug(String(req.params["slug"] ?? ""));
    if (!profile) {
      res.status(404).json({ error: "This creator hasn't set up shop yet — or the profile went private." });
      return;
    }
    /* Public reads never leak hidden blocks' config: visitors get the
       visible blocks only, in order. */
    const full = layoutResponse(profile);
    res.json({ ...full, layout: full.layout.filter((b) => b.visible) });
  } catch (err) {
    req.log.error({ err }, "profile layout GET (public) error");
    res.status(500).json({ error: "Couldn't load this page layout. Try again." });
  }
});

/* ═══ #3 — Theme settings data ══════════════════════════════════════════ */

export interface ThemeSettingsDto {
  colorway: string | null;
  headingFont: string | null;
  bodyFont: string | null;
  colorways: Array<{ id: string; name: string }>;
  fonts: readonly string[];
}

function themeSettingsOf(profile: ProfileRow): ThemeSettingsDto {
  const cfg = (profile.themeConfig ?? {}) as Record<string, unknown>;
  const themeId = typeof cfg["themeId"] === "string" ? cfg["themeId"] : profile.themeId;
  const fonts = (cfg["fonts"] ?? {}) as Record<string, unknown>;
  return {
    colorway: colorwayById(themeId) ? themeId : null,
    headingFont: typeof fonts["heading"] === "string" ? fonts["heading"] : null,
    bodyFont: typeof fonts["body"] === "string" ? fonts["body"] : null,
    colorways: PROFILE_COLORWAYS.map((c) => ({ id: c.id, name: c.name })),
    fonts: PROFILE_FONT_IDS,
  };
}

router.get("/creator-profiles/me/theme-settings", publicApiLimiter, requireAuth, async (req, res) => {
  try {
    const own = await getOwnProfile(req.userId!);
    if (!own) {
      res.status(404).json(NO_PROFILE);
      return;
    }
    res.json(themeSettingsOf(own));
  } catch (err) {
    req.log.error({ err }, "theme-settings GET error");
    res.status(500).json({ error: "Couldn't load your theme settings. Try again." });
  }
});

const themeSettingsSchema = z
  .object({
    colorway: z.string().max(60).optional(),
    headingFont: z.string().max(60).optional(),
    bodyFont: z.string().max(60).optional(),
  })
  .refine((d) => d.colorway !== undefined || d.headingFont !== undefined || d.bodyFont !== undefined, {
    message: "Send at least one setting to change.",
  });

router.put("/creator-profiles/me/theme-settings", publicApiLimiter, requireAuth, async (req, res) => {
  try {
    const own = await getOwnProfile(req.userId!);
    if (!own) {
      res.status(404).json(NO_PROFILE);
      return;
    }
    const parsed = themeSettingsSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "INVALID_THEME_SETTINGS", message: parsed.error.issues[0]?.message ?? "Invalid theme settings." });
      return;
    }
    const { colorway, headingFont, bodyFont } = parsed.data;

    const colorwayDef = colorway !== undefined ? colorwayById(colorway) : undefined;
    if (colorway !== undefined && !colorwayDef) {
      res.status(400).json({
        error: "UNKNOWN_COLORWAY",
        message: "That colorway isn't one of the designed looks. Pick from the colorway list.",
      });
      return;
    }
    for (const [field, value] of [["headingFont", headingFont], ["bodyFont", bodyFont]] as const) {
      if (value !== undefined && !(PROFILE_FONT_IDS as readonly string[]).includes(value)) {
        res.status(400).json({
          error: "UNKNOWN_FONT",
          message: `That ${field === "headingFont" ? "heading" : "body"} font isn't one of the designed fonts. Pick from the font list.`,
        });
        return;
      }
    }

    /* Resolve keys server-side into the values theme_config already
       carries (extended in place — no parallel store). */
    const existing = (own.themeConfig ?? {}) as Record<string, unknown>;
    const fonts = { ...((existing["fonts"] ?? {}) as Record<string, unknown>) };
    if (headingFont !== undefined) fonts["heading"] = headingFont;
    if (bodyFont !== undefined) fonts["body"] = bodyFont;
    const nextConfig: Record<string, unknown> = { ...existing, fonts };
    const patch: Partial<ProfileRow> = { updatedAt: new Date() };
    if (colorwayDef) {
      nextConfig["themeId"] = colorwayDef.id;
      nextConfig["colors"] = { ...colorwayDef.colors };
      patch.themeId = colorwayDef.id;
    }
    patch.themeConfig = nextConfig;

    await db.update(creatorProfilesTable).set(patch).where(eq(creatorProfilesTable.id, own.id));
    const saved = await getOwnProfile(req.userId!);
    res.json({ saved: true, ...(saved ? themeSettingsOf(saved) : themeSettingsOf({ ...own, ...patch } as ProfileRow)) });
  } catch (err) {
    req.log.error({ err }, "theme-settings PUT error");
    res.status(500).json({ error: "Couldn't save your theme settings. Try again." });
  }
});

/* ═══ #4 — Profile store catalog DTO ════════════════════════════════════ */

export interface StoreCatalogItemDto {
  kind: "track" | "video" | "product";
  productKind: string | null;
  id: string;
  title: string;
  artworkUrl: string | null;
  priceCents: number;
  price: string;
  compareAtCents: number | null;
  pwyw: { enabled: boolean; minCents: number } | null;
  buyUrl: string;
}

export interface StoreCatalogDto {
  profile: { slug: string; displayName: string; profileUrl: string };
  items: StoreCatalogItemDto[];
  counts: { tracks: number; videos: number; products: number; total: number };
}

/** Assemble one creator's sellable catalog from the EXISTING surfaces:
    profile tracks/videos priced via download_price_cents (the store.ts
    rail), store_products priced via price_cents (the storefront rail),
    and the creator's customer-shop products priced via price_cents
    (the /shop/:handle rail). Prices are copied from those exact fields —
    displayed price here IS the charged price there, by construction.
    Every buyUrl lands on a page that can actually complete the sale:
    /store/buy for tracks/videos, /storefront/product for store
    products, and the public shop page for shop products. */
export async function buildStoreCatalog(profile: ProfileRow): Promise<StoreCatalogDto> {
  const [tracks, videos, products, shopRows] = await Promise.all([
    db.select().from(profileTracksTable)
      .where(and(eq(profileTracksTable.profileId, profile.id), eq(profileTracksTable.isPublished, true)))
      .orderBy(desc(profileTracksTable.playCount)),
    db.select().from(profileVideosTable)
      .where(and(eq(profileVideosTable.profileId, profile.id), eq(profileVideosTable.isPublished, true)))
      .orderBy(desc(profileVideosTable.viewCount)),
    db.select().from(storeProductsTable)
      .where(and(eq(storeProductsTable.profileId, profile.id), eq(storeProductsTable.isActive, true)))
      .orderBy(desc(storeProductsTable.createdAt)),
    db.select().from(shopsTable)
      .where(eq(shopsTable.user_id, profile.userId))
      .limit(1),
  ]);
  const shop = shopRows[0] ?? null;
  const shopProducts = shop
    ? await db.select().from(shopProductsTable)
        .where(eq(shopProductsTable.shop_id, shop.id))
        .orderBy(desc(shopProductsTable.created_at))
    : [];

  const items: StoreCatalogItemDto[] = [];
  for (const t of tracks) {
    if (t.downloadPriceCents <= 0) continue;
    items.push({
      kind: "track",
      productKind: null,
      id: t.id,
      title: t.title,
      artworkUrl: t.artworkUrl ?? null,
      priceCents: t.downloadPriceCents,
      price: formatUsd(t.downloadPriceCents),
      compareAtCents: null,
      pwyw: t.pwywEnabled ? { enabled: true, minCents: t.pwywMinCents } : null,
      buyUrl: `/store/buy/track/${t.id}`,
    });
  }
  for (const v of videos) {
    if (v.downloadPriceCents <= 0) continue;
    items.push({
      kind: "video",
      productKind: null,
      id: v.id,
      title: v.title,
      artworkUrl: v.thumbnailUrl ?? null,
      priceCents: v.downloadPriceCents,
      price: formatUsd(v.downloadPriceCents),
      compareAtCents: null,
      pwyw: v.pwywEnabled ? { enabled: true, minCents: v.pwywMinCents } : null,
      buyUrl: `/store/buy/video/${v.id}`,
    });
  }
  for (const p of products) {
    items.push({
      kind: "product",
      productKind: p.kind,
      id: p.id,
      title: p.title,
      artworkUrl: Array.isArray(p.mediaUrls) && p.mediaUrls.length > 0 ? p.mediaUrls[0]! : null,
      priceCents: p.priceCents,
      price: formatUsd(p.priceCents),
      compareAtCents: p.compareAtCents ?? null,
      pwyw: null,
      buyUrl: `/storefront/product/${p.id}`,
    });
  }
  if (shop) {
    for (const sp of shopProducts) {
      items.push({
        kind: "product",
        productKind: "shop",
        id: sp.id,
        title: sp.name,
        artworkUrl: sp.image_url ?? null,
        priceCents: sp.price_cents,
        price: formatUsd(sp.price_cents),
        compareAtCents: null,
        pwyw: null,
        buyUrl: `/shop/${shop.handle}`,
      });
    }
  }

  return {
    profile: { slug: profile.slug, displayName: profile.displayName, profileUrl: `/artist/${profile.slug}` },
    items,
    counts: {
      tracks: items.filter((i) => i.kind === "track").length,
      videos: items.filter((i) => i.kind === "video").length,
      products: items.filter((i) => i.kind === "product").length,
      total: items.length,
    },
  };
}

router.get("/creator-profiles/:slug/store-catalog", publicApiLimiter, async (req, res) => {
  try {
    const profile = await getPublicProfileBySlug(String(req.params["slug"] ?? ""));
    if (!profile) {
      res.status(404).json({ error: "This creator hasn't set up shop yet — or the profile went private." });
      return;
    }
    const catalog = await buildStoreCatalog(profile);
    res.json(await refreshSupabaseStorageUrlsDeep(catalog));
  } catch (err) {
    req.log.error({ err }, "store-catalog GET error");
    res.status(500).json({ error: "Couldn't load this creator's store. Try again." });
  }
});

/* ═══ #4b — Profile game record (DE-15) ═══════════════════════════════════
   The Trophy Shelf's game group: the profile OWNER's arcade bests and
   party record, aggregated by the SAME helpers behind /arcade/me and
   /party/me (one aggregation, every surface). Aggregates only — scores
   and wins are status, never currency; nothing here touches credits.
   Privacy: a creator who opted out of leaderboards
   (retention_prefs.leaderboard_visible = false) shows no game record
   publicly either — the same opt-out the leaderboards honor. */
export interface ProfileGameStatsDto {
  profile: { slug: string; displayName: string };
  visible: boolean;
  arcade: Awaited<ReturnType<typeof arcadeStatsForUser>>;
  party: Awaited<ReturnType<typeof partyStatsForUser>>;
}

router.get("/creator-profiles/:slug/game-stats", publicApiLimiter, async (req, res) => {
  try {
    const profile = await getPublicProfileBySlug(String(req.params["slug"] ?? ""));
    if (!profile) {
      res.status(404).json({ error: "This creator hasn't set up shop yet — or the profile went private." });
      return;
    }
    const [pref] = await db
      .select({ visible: retentionPrefsTable.leaderboardVisible })
      .from(retentionPrefsTable)
      .where(eq(retentionPrefsTable.userId, profile.userId))
      .limit(1);
    const visible = pref?.visible !== false;
    const dto: ProfileGameStatsDto = {
      profile: { slug: profile.slug, displayName: profile.displayName },
      visible,
      arcade: visible ? await arcadeStatsForUser(profile.userId) : [],
      party: visible
        ? await partyStatsForUser(profile.userId)
        : { games: [], totalMatches: 0 },
    };
    res.json(dto);
  } catch (err) {
    req.log.error({ err }, "game-stats GET error");
    res.status(500).json({ error: "Couldn't load this creator's game record. Try again." });
  }
});

/* ═══ #5 — Spotlight pin ════════════════════════════════════════════════ */

export interface SpotlightPinDto {
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

/** Resolve a profile's pin to its content. A pin whose content was
    unpublished or deleted resolves to null (the section hides) — the
    stored pin survives, so re-publishing restores it. */
export async function loadSpotlightPin(profile: ProfileRow): Promise<SpotlightPinDto | null> {
  if (!profile.pinnedKind || !profile.pinnedItemId) return null;
  if (profile.pinnedKind === "track") {
    const [t] = await db.select().from(profileTracksTable)
      .where(and(eq(profileTracksTable.id, profile.pinnedItemId), eq(profileTracksTable.profileId, profile.id)))
      .limit(1);
    if (!t || !t.isPublished) return null;
    return {
      kind: "track",
      itemId: t.id,
      title: t.title,
      mediaUrl: t.audioUrl,
      artworkUrl: t.artworkUrl ?? null,
      durationSec: t.durationSec,
      creatorSlug: profile.slug,
      creatorName: profile.displayName,
      pageUrl: `/artist/${profile.slug}`,
    };
  }
  const [v] = await db.select().from(profileVideosTable)
    .where(and(eq(profileVideosTable.id, profile.pinnedItemId), eq(profileVideosTable.profileId, profile.id)))
    .limit(1);
  if (!v || !v.isPublished) return null;
  return {
    kind: "video",
    itemId: v.id,
    title: v.title,
    mediaUrl: v.videoUrl,
    artworkUrl: v.thumbnailUrl ?? null,
    durationSec: v.durationSec,
    creatorSlug: profile.slug,
    creatorName: profile.displayName,
    pageUrl: `/artist/${profile.slug}`,
  };
}

router.get("/creator-profiles/:slug/spotlight", publicApiLimiter, async (req, res) => {
  try {
    const profile = await getPublicProfileBySlug(String(req.params["slug"] ?? ""));
    if (!profile) {
      res.status(404).json({ error: "This creator hasn't set up shop yet — or the profile went private." });
      return;
    }
    const pin = await loadSpotlightPin(profile);
    res.json(await refreshSupabaseStorageUrlsDeep({ pin }));
  } catch (err) {
    req.log.error({ err }, "spotlight GET error");
    res.status(500).json({ error: "Couldn't load the spotlight pin. Try again." });
  }
});

const spotlightPutSchema = z.object({
  kind: z.enum(["track", "video"]).nullable(),
  itemId: z.string().nullable().optional(),
});

router.put("/creator-profiles/me/spotlight", publicApiLimiter, requireAuth, async (req, res) => {
  try {
    const own = await getOwnProfile(req.userId!);
    if (!own) {
      res.status(404).json(NO_PROFILE);
      return;
    }
    const parsed = spotlightPutSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "INVALID_PIN", message: "Pin a track or a video — or clear the pin with kind: null." });
      return;
    }
    const { kind, itemId } = parsed.data;

    if (kind === null) {
      await db.update(creatorProfilesTable)
        .set({ pinnedKind: null, pinnedItemId: null, updatedAt: new Date() })
        .where(eq(creatorProfilesTable.id, own.id));
      res.json({ saved: true, pin: null });
      return;
    }
    if (!itemId) {
      res.status(400).json({ error: "INVALID_PIN", message: "Pick the track or video to pin." });
      return;
    }

    /* The pinned content must be the CALLER'S OWN and published — a pin
       is the top of your page, it only ever shows your own work. */
    if (kind === "track") {
      const [t] = await db.select({ id: profileTracksTable.id, isPublished: profileTracksTable.isPublished })
        .from(profileTracksTable)
        .where(and(eq(profileTracksTable.id, itemId), eq(profileTracksTable.profileId, own.id)))
        .limit(1);
      if (!t) {
        res.status(400).json({ error: "PIN_NOT_YOURS", message: "You can only pin your own tracks." });
        return;
      }
      if (!t.isPublished) {
        res.status(400).json({ error: "PIN_NOT_PUBLIC", message: "Publish that track first — the spotlight only shows public work." });
        return;
      }
    } else {
      const [v] = await db.select({ id: profileVideosTable.id, isPublished: profileVideosTable.isPublished })
        .from(profileVideosTable)
        .where(and(eq(profileVideosTable.id, itemId), eq(profileVideosTable.profileId, own.id)))
        .limit(1);
      if (!v) {
        res.status(400).json({ error: "PIN_NOT_YOURS", message: "You can only pin your own videos." });
        return;
      }
      if (!v.isPublished) {
        res.status(400).json({ error: "PIN_NOT_PUBLIC", message: "Publish that video first — the spotlight only shows public work." });
        return;
      }
    }

    await db.update(creatorProfilesTable)
      .set({ pinnedKind: kind, pinnedItemId: itemId, updatedAt: new Date() })
      .where(eq(creatorProfilesTable.id, own.id));
    const saved = await getOwnProfile(req.userId!);
    const pin = saved ? await loadSpotlightPin(saved) : null;
    res.json(await refreshSupabaseStorageUrlsDeep({ saved: true, pin }));
  } catch (err) {
    req.log.error({ err }, "spotlight PUT error");
    res.status(500).json({ error: "Couldn't save your spotlight pin. Try again." });
  }
});

/* ═══ #6 — Fan collections ══════════════════════════════════════════════ */

export interface CollectionItemDto {
  kind: "track" | "video" | "product";
  itemId: string;
  title: string;
  artworkUrl: string | null;
  creatorName: string;
  creatorSlug: string;
  creatorUrl: string;
  amountCents: number;
  purchasedAt: Date;
}

export interface CollectionDto {
  fan: { slug: string; displayName: string; avatarUrl: string | null; profileUrl: string };
  visibility: "public" | "private";
  items: CollectionItemDto[];
}

/** Everything a fan bought: digital_sales (tracks/videos/albums via the
    store rail) + completed store_orders (products via the storefront
    rail), newest first. Titles/artwork resolve from the catalog rows;
    a deleted catalog item falls back to the order's stored title. */
export async function buildCollection(fanProfile: ProfileRow): Promise<CollectionItemDto[]> {
  const [sales, orders] = await Promise.all([
    db.select().from(digitalSalesTable)
      .where(eq(digitalSalesTable.buyerUserId, fanProfile.userId))
      .orderBy(desc(digitalSalesTable.createdAt))
      .limit(200),
    db.select().from(storeOrdersTable)
      .where(and(eq(storeOrdersTable.buyerUserId, fanProfile.userId), eq(storeOrdersTable.status, "completed")))
      .orderBy(desc(storeOrdersTable.createdAt))
      .limit(200),
  ]);
  if (sales.length === 0 && orders.length === 0) return [];

  const sellerIds = [...new Set([
    ...sales.map((s) => s.profileId),
    ...orders.map((o) => o.profileId),
  ])];
  const sellers = sellerIds.length
    ? await db.select().from(creatorProfilesTable).where(inArray(creatorProfilesTable.id, sellerIds))
    : [];
  const sellerById = new Map(sellers.map((p) => [p.id, p]));

  const items: CollectionItemDto[] = [];
  for (const s of sales) {
    const seller = sellerById.get(s.profileId);
    let title = "Content";
    let artworkUrl: string | null = null;
    if (s.itemKind === "track") {
      const [t] = await db.select().from(profileTracksTable).where(eq(profileTracksTable.id, s.itemId)).limit(1);
      if (t) { title = t.title; artworkUrl = t.artworkUrl ?? null; }
    } else if (s.itemKind === "video") {
      const [v] = await db.select().from(profileVideosTable).where(eq(profileVideosTable.id, s.itemId)).limit(1);
      if (v) { title = v.title; artworkUrl = v.thumbnailUrl ?? null; }
    }
    items.push({
      kind: s.itemKind === "video" ? "video" : "track",
      itemId: s.itemId,
      title,
      artworkUrl,
      creatorName: seller?.displayName ?? "Creator",
      creatorSlug: seller?.slug ?? "",
      creatorUrl: seller ? `/artist/${seller.slug}` : "",
      amountCents: s.amountCents,
      purchasedAt: s.createdAt,
    });
  }
  for (const o of orders) {
    const seller = sellerById.get(o.profileId);
    let artworkUrl: string | null = null;
    if (o.productId) {
      const [p] = await db.select().from(storeProductsTable).where(eq(storeProductsTable.id, o.productId)).limit(1);
      if (p && Array.isArray(p.mediaUrls) && p.mediaUrls.length > 0) artworkUrl = p.mediaUrls[0]!;
    }
    items.push({
      kind: "product",
      itemId: o.productId ?? o.id,
      title: o.productTitle || "Product",
      artworkUrl,
      creatorName: seller?.displayName ?? "Creator",
      creatorSlug: seller?.slug ?? "",
      creatorUrl: seller ? `/artist/${seller.slug}` : "",
      amountCents: o.amountCents,
      purchasedAt: o.createdAt,
    });
  }
  items.sort((a, b) => new Date(b.purchasedAt).getTime() - new Date(a.purchasedAt).getTime());
  return items.slice(0, 200);
}

function collectionDto(fanProfile: ProfileRow, items: CollectionItemDto[]): CollectionDto {
  return {
    fan: {
      slug: fanProfile.slug,
      displayName: fanProfile.displayName,
      avatarUrl: fanProfile.avatarUrl ?? null,
      profileUrl: `/artist/${fanProfile.slug}`,
    },
    visibility: fanProfile.collectionVisibility === "private" ? "private" : "public",
    items,
  };
}

/* The /me routes register BEFORE /:slug — Express matches in order
   and "me" would otherwise be captured as a fan slug. */
router.get("/collections/me", publicApiLimiter, requireAuth, async (req, res) => {
  try {
    const own = await getOwnProfile(req.userId!);
    if (!own) {
      res.status(404).json(NO_PROFILE);
      return;
    }
    const items = await buildCollection(own);
    res.json(await refreshSupabaseStorageUrlsDeep(collectionDto(own, items)));
  } catch (err) {
    req.log.error({ err }, "collection GET (me) error");
    res.status(500).json({ error: "Couldn't load your collection. Try again." });
  }
});

const visibilitySchema = z.object({ visibility: z.enum(["public", "private"]) });


router.put("/collections/me/visibility", publicApiLimiter, requireAuth, async (req, res) => {
  try {
    const own = await getOwnProfile(req.userId!);
    if (!own) {
      res.status(404).json(NO_PROFILE);
      return;
    }
    const parsed = visibilitySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "INVALID_VISIBILITY", message: "Collection visibility is either public or private." });
      return;
    }
    await db.update(creatorProfilesTable)
      .set({ collectionVisibility: parsed.data.visibility, updatedAt: new Date() })
      .where(eq(creatorProfilesTable.id, own.id));
    res.json({ saved: true, visibility: parsed.data.visibility });
  } catch (err) {
    req.log.error({ err }, "collection visibility PUT error");
    res.status(500).json({ error: "Couldn't save your collection setting. Try again." });
  }
});


router.get("/collections/:slug", publicApiLimiter, async (req, res) => {
  try {
    const fanProfile = await getPublicProfileBySlug(String(req.params["slug"] ?? ""));
    if (!fanProfile) {
      res.status(404).json({ error: "No collection at that address — the fan has no public profile." });
      return;
    }
    if (fanProfile.collectionVisibility === "private") {
      /* Honest private state: the page renders "this collection is
         private" — no items, no counts, nothing leaks. */
      res.json({ ...collectionDto(fanProfile, []), isPrivate: true });
      return;
    }
    const items = await buildCollection(fanProfile);
    res.json(await refreshSupabaseStorageUrlsDeep({ ...collectionDto(fanProfile, items), isPrivate: false }));
  } catch (err) {
    req.log.error({ err }, "collection GET (public) error");
    res.status(500).json({ error: "Couldn't load this collection. Try again." });
  }
});

export default router;
