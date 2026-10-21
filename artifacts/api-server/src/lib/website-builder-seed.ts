/**
 * website-builder-seed.ts — build the AI Website Builder's generation
 * context from the creator's REAL material instead of a blank brief.
 *
 * The builder used to start from `businessName + description` alone and its
 * system prompt told the model to "invent plausible creator-specific
 * content (show dates, song titles, bio)". On a real creator's public site
 * that is fabrication-as-a-feature. This module is the fix, and it is the
 * one advantage no outside builder can copy: the creator's catalog, brand
 * kit, and profile already live here.
 *
 * Discipline:
 *  - Every fact in the seed comes from a row the CALLER owns (all queries
 *    are scoped by userId; store products resolve through the caller's own
 *    profile id). Another member's material can never enter a build.
 *  - The rendered context lists what is NOT provided just as explicitly,
 *    so the model is steered to honest, visibly-labeled placeholders —
 *    never to invented substitutes (see BUILDER_FACT_RULES).
 *  - Loading never throws: a seed failure degrades to whatever was
 *    gathered (possibly an empty seed) and generation proceeds on the
 *    honest-placeholder path instead of failing a paid build.
 *  - Raw SQL via db.execute, per the house pattern (routes/locations.ts,
 *    routes/hub-projects.ts): the drizzle builder's rowMode is rejected
 *    by the pg-mem test harness; raw SQL runs identically in both.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { brandKitDto, type StoredBrandKit } from "./brand-record";
import { logger } from "./logger";

export interface CreatorSeedProfile {
  displayName: string;
  bio: string;
  vertical: string;
  avatarUrl: string | null;
  bannerUrl: string | null;
  socialLinks: Record<string, string>;
}

export interface CreatorSeedSong {
  title: string;
  genre: string | null;
  coverArtUrl: string | null;
}

export interface CreatorSeedVideo {
  title: string;
  thumbnailUrl: string | null;
  videoUrl: string | null;
}

export interface CreatorSeedProduct {
  title: string;
  kind: string;
  priceCents: number;
  description: string;
}

export interface CreatorSeedShow {
  city: string;
  venue: string;
  date: string; // ISO date (yyyy-mm-dd) — a fact, never rounded or invented
  status: string;
  notes: string | null;
}

export interface CreatorSeed {
  profile: CreatorSeedProfile | null;
  brandKit: StoredBrandKit | null;
  songs: CreatorSeedSong[];
  videos: CreatorSeedVideo[];
  products: CreatorSeedProduct[];
  shows: CreatorSeedShow[];
}

export function emptyCreatorSeed(): CreatorSeed {
  return { profile: null, brandKit: null, songs: [], videos: [], products: [], shows: [] };
}

const SONG_LIMIT = 12;
const VIDEO_LIMIT = 8;
const PRODUCT_LIMIT = 12;
const SHOW_LIMIT = 10;

type Row = Record<string, unknown>;

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v : null;
}

function asRecord(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  if (typeof v === "string") {
    try {
      const parsed: unknown = JSON.parse(v);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* not JSON — treat as absent */
    }
  }
  return {};
}

/**
 * Load everything the builder may state as fact about this creator.
 * Owner-scoped throughout; never throws.
 */
export async function loadCreatorSeed(userId: string): Promise<CreatorSeed> {
  const seed = emptyCreatorSeed();
  let profileId: string | null = null;

  try {
    const { rows } = await db.execute(sql`
      SELECT id, display_name, bio, vertical, avatar_url, banner_url, social_links, theme_config
      FROM creator_profiles
      WHERE user_id = ${userId}
      LIMIT 1
    `);
    const profile = rows[0] as Row | undefined;
    if (profile) {
      profileId = typeof profile["id"] === "string" ? profile["id"] : null;
      const linksRaw = asRecord(profile["social_links"]);
      const socialLinks: Record<string, string> = {};
      for (const [k, v] of Object.entries(linksRaw)) {
        if (typeof v === "string" && v.trim().length > 0) socialLinks[k] = v;
      }
      seed.profile = {
        displayName: typeof profile["display_name"] === "string" ? profile["display_name"] : "",
        bio: typeof profile["bio"] === "string" ? profile["bio"] : "",
        vertical: typeof profile["vertical"] === "string" ? profile["vertical"] : "music",
        avatarUrl: strOrNull(profile["avatar_url"]),
        bannerUrl: strOrNull(profile["banner_url"]),
        socialLinks,
      };
      /* The brand kit lives on this same row (theme_config.brandKit) —
         normalize it with the brand record's own DTO so the builder reads
         the kit exactly the way every other consumer does. */
      seed.brandKit = brandKitDto(asRecord(profile["theme_config"])["brandKit"]);
    }
  } catch (err) {
    logger.error({ err, userId }, "[website-builder] seed: profile load failed");
  }

  try {
    const { rows } = await db.execute(sql`
      SELECT title, genre, cover_art_url
      FROM songs
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
      LIMIT ${SONG_LIMIT}
    `);
    seed.songs = (rows as Row[]).map((r) => ({
      title: typeof r["title"] === "string" ? r["title"] : "",
      genre: strOrNull(r["genre"]),
      coverArtUrl: strOrNull(r["cover_art_url"]),
    }));
  } catch (err) {
    logger.error({ err, userId }, "[website-builder] seed: songs load failed");
  }

  try {
    const { rows } = await db.execute(sql`
      SELECT title, thumbnail_url, video_url
      FROM generated_clips
      WHERE user_id = ${userId} AND status = 'completed'
      ORDER BY created_at DESC
      LIMIT ${VIDEO_LIMIT}
    `);
    seed.videos = (rows as Row[])
      .map((r) => ({
        title: typeof r["title"] === "string" ? r["title"].trim() : "",
        thumbnailUrl: strOrNull(r["thumbnail_url"]),
        videoUrl: strOrNull(r["video_url"]),
      }))
      .filter((v) => v.title.length > 0);
  } catch (err) {
    logger.error({ err, userId }, "[website-builder] seed: videos load failed");
  }

  if (profileId) {
    try {
      const { rows } = await db.execute(sql`
        SELECT title, kind, price_cents, description
        FROM store_products
        WHERE profile_id = ${profileId} AND is_active = true
        ORDER BY created_at DESC
        LIMIT ${PRODUCT_LIMIT}
      `);
      seed.products = (rows as Row[]).map((r) => ({
        title: typeof r["title"] === "string" ? r["title"] : "",
        kind: typeof r["kind"] === "string" ? r["kind"] : "",
        priceCents: typeof r["price_cents"] === "number" ? r["price_cents"] : 0,
        description: typeof r["description"] === "string" ? r["description"] : "",
      }));
    } catch (err) {
      logger.error({ err, userId }, "[website-builder] seed: products load failed");
    }
  }

  try {
    const { rows } = await db.execute(sql`
      SELECT city, venue, show_date, status, notes
      FROM tour_dates
      WHERE user_id = ${userId}
        AND status IN ('upcoming', 'confirmed')
        AND show_date >= now()
      ORDER BY show_date ASC
      LIMIT ${SHOW_LIMIT}
    `);
    seed.shows = (rows as Row[]).map((r) => ({
      city: typeof r["city"] === "string" ? r["city"] : "",
      venue: typeof r["venue"] === "string" ? r["venue"] : "",
      date: new Date(r["show_date"] as string).toISOString().slice(0, 10),
      status: typeof r["status"] === "string" ? r["status"] : "",
      notes: strOrNull(r["notes"]),
    }));
  } catch (err) {
    logger.error({ err, userId }, "[website-builder] seed: shows load failed");
  }

  return seed;
}

export interface CreatorSeedSummary {
  profile: boolean;
  brandKit: boolean;
  songs: number;
  videos: number;
  products: number;
  shows: number;
}

/** What a build was actually seeded from — surfaced to the creator. */
export function seedSummary(seed: CreatorSeed): CreatorSeedSummary {
  return {
    profile: seed.profile !== null,
    brandKit: seed.brandKit !== null,
    songs: seed.songs.length,
    videos: seed.videos.length,
    products: seed.products.length,
    shows: seed.shows.length,
  };
}

function clipText(s: string, max: number): string {
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Render the seed as the prompt's fact block. Pure and deterministic.
 * States what exists AND what is missing — the missing list is what keeps
 * the model on the honest-placeholder path (BUILDER_FACT_RULES).
 */
export function buildSeedContext(seed: CreatorSeed): string {
  const lines: string[] = [];
  const missing: string[] = [];

  lines.push(
    "CREATOR'S REAL MATERIAL — drawn from this creator's own Bow Down Visuals account. " +
      "Together with the brief above, this is the ONLY source of facts about this creator. " +
      "If the brief and this material disagree, the brief (their newest instruction) wins.",
  );

  if (seed.profile) {
    const p = seed.profile;
    lines.push("", "Profile (real):");
    lines.push(`- Stage name: ${p.displayName}`);
    if (p.bio.trim()) lines.push(`- Bio (their own words): "${clipText(p.bio, 600)}"`);
    lines.push(`- Creator lane: ${p.vertical}`);
    if (p.avatarUrl) lines.push(`- Profile photo: ${p.avatarUrl} (use as their portrait image)`);
    if (p.bannerUrl) lines.push(`- Banner image: ${p.bannerUrl} (use as a hero/banner image)`);
    const links = Object.entries(p.socialLinks).filter(([, v]) => v.trim().length > 0);
    if (links.length > 0) {
      lines.push(
        `- Their real links: ${links.map(([k, v]) => `${k}: ${v}`).join(" · ")} (link social icons to these URLs; a platform not listed here gets NO link)`,
      );
    } else {
      missing.push("social/streaming links (render social icons unlinked or omit them — never guess a URL or handle)");
    }
  } else {
    missing.push("a Bow Down Visuals profile (use only the site name and facts from the brief)");
  }

  if (seed.brandKit) {
    const kit = seed.brandKit;
    lines.push("", "Brand kit (their saved brand — design the site in this brand):");
    if (kit.brandName) lines.push(`- Brand name: ${kit.brandName}`);
    if (kit.colors.length > 0) {
      lines.push(
        `- Colors: ${kit.colors.map((c) => `${c.hex}${c.name ? ` "${c.name}"` : ""} (${c.role})`).join(", ")}`,
      );
    }
    if (kit.fonts.length > 0) {
      const lead = kit.fonts[0]!;
      lines.push(`- Fonts: headings "${lead.heading}", body "${lead.body}"`);
    }
    if (kit.logoUrl) {
      lines.push(`- Logo: ${kit.logoUrl} (use THIS logo image in the header; never draw, redraw, or substitute a different logo)`);
    }
    const tagline = kit.selectedTagline ?? kit.taglines[0];
    if (tagline) lines.push(`- Tagline${kit.selectedTagline ? " (their pick)" : ""}: "${tagline}"`);
    if (kit.bioLines.length > 0) {
      lines.push(`- Bio lines (theirs): ${kit.bioLines.map((b) => `"${clipText(b, 300)}"`).join(" · ")}`);
    }
    if (kit.pressFacts.length > 0) {
      lines.push(`- Press facts (real, from their kit): ${kit.pressFacts.map((f) => `"${clipText(f, 300)}"`).join(" · ")}`);
    }
  } else {
    missing.push("a saved brand kit (choose a palette in the brief's spirit; do not claim it is their official brand)");
  }

  if (seed.songs.length > 0) {
    lines.push("", "Music catalog (real releases — use these exact titles, link/embed nothing you were not given):");
    for (const s of seed.songs) {
      lines.push(
        `- "${s.title}"${s.genre ? ` (${s.genre})` : ""}${s.coverArtUrl ? ` — cover art: ${s.coverArtUrl}` : ""}`,
      );
    }
  } else {
    missing.push("songs in their catalog (a music section lists no releases yet — use the labeled placeholder, never an invented tracklist)");
  }

  if (seed.videos.length > 0) {
    lines.push("", "Videos (real — use these exact titles):");
    for (const v of seed.videos) {
      lines.push(
        `- "${v.title}"${v.thumbnailUrl ? ` — thumbnail: ${v.thumbnailUrl}` : ""}${v.videoUrl ? ` — watch: ${v.videoUrl}` : ""}`,
      );
    }
  } else {
    missing.push("videos (no video section content from their account yet)");
  }

  if (seed.products.length > 0) {
    lines.push("", "Store products (real — these exact names and prices, no others):");
    for (const p of seed.products) {
      lines.push(`- "${p.title}" (${p.kind}) — ${formatPrice(p.priceCents)}${p.description ? ` — ${clipText(p.description, 200)}` : ""}`);
    }
  } else {
    missing.push("store products (do not invent products or prices; a store section uses the labeled placeholder)");
  }

  if (seed.shows.length > 0) {
    lines.push("", "Upcoming shows (real dates — the ONLY dates that may appear as shows):");
    for (const s of seed.shows) {
      lines.push(`- ${s.date} — ${s.city} — ${s.venue} (${s.status})${s.notes ? ` — ${clipText(s.notes, 200)}` : ""}`);
    }
  } else {
    missing.push("upcoming shows (a shows/tour section uses the labeled placeholder — NEVER a made-up date, city, or venue)");
  }

  if (missing.length > 0) {
    lines.push(
      "",
      "NOT PROVIDED — the creator has not given Bow Down Visuals this material. Where the template calls for it, use an honest placeholder visibly labeled as a placeholder in the rendered page (for example: [Placeholder — add your upcoming show dates]) and list it in the README's \"Placeholders to replace\" section:",
      ...missing.map((m) => `- ${m}`),
    );
  }

  return lines.join("\n");
}

/**
 * The anti-fabrication law for generated sites, embedded in the builder's
 * system prompt for both the initial build and conversational edits.
 */
export const BUILDER_FACT_RULES = `FACT RULES — NEVER INVENT FACTS:
- Do NOT fabricate show dates, cities, venues, song or release titles, product names, prices, testimonials, press quotes, follower/subscriber counts, chart positions, or biographical claims. A fabricated fact on a real creator's public site is a defect, not a style choice.
- The only facts you may state about the creator are (a) what their brief says and (b) the CREATOR'S REAL MATERIAL section of the prompt — their real profile, brand kit, catalog, products, and shows, drawn from their account. Marketing language, section copy, layout, and styling are yours to write; facts are not.
- Image URLs: use the real artwork, cover art, logo, photo, and thumbnail URLs given in the creator's material wherever a section shows their work or brand. For imagery they have not provided, reference an "images/…" placeholder path whose alt text labels it as a placeholder, and list it in the README.
- Where a section needs content the creator has not provided, write the section around an honest placeholder that is VISIBLY labeled as a placeholder in the rendered page (for example: [Placeholder — add your upcoming show dates]) and list every placeholder you used in the README under a "Placeholders to replace" section, so the owner can find and replace each one. No lorem ipsum, and no unlabeled filler that reads as fact.`;
