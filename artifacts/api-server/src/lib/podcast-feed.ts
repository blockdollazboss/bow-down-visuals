/**
 * podcast-feed.ts — hosted per-show podcast RSS (Lane F10, Stack-100 #3).
 *
 * The Podcast Studio already generates episodes; this module gives a
 * creator's show a real, directory-grade RSS 2.0 feed with iTunes tags so
 * it can live on Apple Podcasts and Spotify:
 *
 *   show     = the creator's public profile (creator_profiles)
 *   episodes = their published profile_tracks (the schema's own contract:
 *              "a podcaster's episodes live in profile_tracks")
 *   settings = creator_profiles.theme_config.podcastFeed (jsonb — no
 *              migration; completeThemeConfig passes unknown keys through)
 *
 * Enclosures are the hard part: stored track audio is a permanent storage
 * ref whose playable form is a 1-day signed URL — useless in a feed that
 * directories poll for months. resolveEnclosure therefore prefers a direct
 * public CDN URL for R2 objects, and falls back to the API's own stable
 * redirect endpoint (/api/podcast-feed/:slug/episodes/:trackId.mp3). The
 * enclosure length is the object's exact byte size (R2 HeadObject; HTTP
 * Range probe on the signed URL when the object is not in R2) — Apple
 * hard-rejects length<=0, so an episode whose size cannot be proven is
 * omitted from the feed rather than poisoning it.
 */
import {
  parseSupabaseStorageRefBucketed,
  refreshSupabaseStorageUrl,
  r2KeyForBucket,
} from "./objectStorage";
import { isR2Configured, r2ObjectSize } from "./r2-client";
import { siteOrigin } from "./og-preview";
import { logger } from "./logger";

/* ── Show settings (theme_config.podcastFeed) ────────────────────────── */

export interface PodcastFeedSettings {
  /** Show title override (default: profile display name). */
  title?: string;
  /** Show description override (default: profile bio). */
  description?: string;
  /** Author override (default: profile display name). */
  author?: string;
  /** Apple top-level category (default "Arts"). */
  category?: string;
  /** Apple subcategory — only rendered when it belongs to the category. */
  subcategory?: string;
  /** Explicit-content flag (default false). */
  explicit?: boolean;
  /** Artwork URL override (default: profile avatar, then banner). */
  artworkUrl?: string;
  /** BCP-47-ish language tag (default "en-us"). */
  language?: string;
}

const SETTINGS_KEY = "podcastFeed";

export function readPodcastFeedSettings(themeConfig: unknown): PodcastFeedSettings {
  if (!themeConfig || typeof themeConfig !== "object" || Array.isArray(themeConfig)) {
    return {};
  }
  const raw = (themeConfig as Record<string, unknown>)[SETTINGS_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const r = raw as Record<string, unknown>;
  const str = (v: unknown, max: number): string | undefined =>
    typeof v === "string" && v.trim().length > 0 ? v.trim().slice(0, max) : undefined;
  const category = str(r["category"], 60);
  return {
    title: str(r["title"], 255),
    description: str(r["description"], 4000),
    author: str(r["author"], 255),
    category: category && category in APPLE_PODCAST_CATEGORIES ? category : undefined,
    subcategory: str(r["subcategory"], 60),
    explicit: typeof r["explicit"] === "boolean" ? r["explicit"] : undefined,
    artworkUrl: str(r["artworkUrl"], 2048),
    language: str(r["language"], 16),
  };
}

/** Merge validated settings into a theme_config object (returns a new object). */
export function writePodcastFeedSettings(
  themeConfig: unknown,
  settings: PodcastFeedSettings,
): Record<string, unknown> {
  const base =
    themeConfig && typeof themeConfig === "object" && !Array.isArray(themeConfig)
      ? { ...(themeConfig as Record<string, unknown>) }
      : {};
  base[SETTINGS_KEY] = { ...settings };
  return base;
}

/* ── Apple Podcasts category tree (Apple's published taxonomy) ──────── */

export const APPLE_PODCAST_CATEGORIES: Readonly<Record<string, readonly string[]>> = {
  "Arts": ["Books", "Design", "Fashion & Beauty", "Food", "Performing Arts", "Visual Arts"],
  "Business": ["Careers", "Entrepreneurship", "Investing", "Management", "Marketing", "Non-Profit"],
  "Comedy": ["Comedy Interviews", "Improv", "Stand-Up"],
  "Education": ["Courses", "How To", "Language Learning", "Self-Improvement"],
  "Fiction": ["Comedy Fiction", "Drama", "Science Fiction"],
  "Government": [],
  "History": [],
  "Health & Fitness": ["Alternative Health", "Fitness", "Medicine", "Mental Health", "Nutrition", "Sexuality"],
  "Kids & Family": ["Education for Kids", "Parenting", "Pets & Animals", "Stories for Kids"],
  "Leisure": ["Animation & Manga", "Automotive", "Aviation", "Crafts", "Games", "Hobbies", "Home & Garden", "Video Games"],
  "Music": ["Music Commentary", "Music History", "Music Interviews"],
  "News": ["Business News", "Daily News", "Entertainment News", "News Commentary", "Politics", "Sports News", "Tech News"],
  "Religion & Spirituality": ["Buddhism", "Christianity", "Hinduism", "Islam", "Judaism", "Religion", "Spirituality", "Taoism"],
  "Science": ["Astronomy", "Chemistry", "Earth Sciences", "Life Sciences", "Mathematics", "Natural Sciences", "Nature", "Physics", "Social Sciences"],
  "Society & Culture": ["Documentary", "Personal Journals", "Philosophy", "Places & Travel", "Relationships"],
  "Sports": ["Baseball", "Basketball", "Fantasy Sports", "Football", "Golf", "Hockey", "Running", "Rugby", "Soccer", "Swimming", "Tennis", "Volleyball", "Wilderness", "Wrestling"],
  "TV & Film": ["After Shows", "Film History", "Film Interviews", "Film Reviews", "TV Reviews"],
  "Technology": [],
  "True Crime": [],
};

export const DEFAULT_PODCAST_CATEGORY = "Arts";

/* ── Feed model ──────────────────────────────────────────────────────── */

export interface PodcastFeedShow {
  title: string;
  /** Canonical show page — the creator's public profile. */
  link: string;
  description: string;
  language: string;
  author: string;
  ownerName?: string;
  ownerEmail?: string;
  artworkUrl?: string;
  category: string;
  subcategory?: string;
  explicit: boolean;
  /** Absolute URL of this feed itself (atom:link rel="self"). */
  feedUrl: string;
}

export interface PodcastFeedEpisode {
  /** Stable GUID — the public track landing URL, a permalink by design (D1). */
  guid: string;
  title: string;
  description: string;
  pubDate: Date;
  durationSeconds: number;
  explicit: boolean;
  artworkUrl?: string;
  enclosure: { url: string; length: number; type: string };
}

/* ── XML helpers ─────────────────────────────────────────────────────── */

export function escapeXmlText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function escapeXmlAttr(s: string): string {
  return escapeXmlText(s).replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** itunes:duration — M:SS under an hour, H:MM:SS above it. */
export function formatItunesDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/**
 * Render the complete RSS 2.0 + iTunes feed. Pure: callers resolve
 * enclosures/artwork to absolute URLs first, so this is fully testable
 * and its output is what the validator tests pin.
 */
export function buildPodcastFeedXml(
  show: PodcastFeedShow,
  episodes: PodcastFeedEpisode[],
  now: Date = new Date(),
): string {
  const sub =
    show.subcategory &&
    (APPLE_PODCAST_CATEGORIES[show.category] ?? []).includes(show.subcategory)
      ? show.subcategory
      : undefined;
  const categoryXml = sub
    ? `    <itunes:category text="${escapeXmlAttr(show.category)}">\n` +
      `      <itunes:category text="${escapeXmlAttr(sub)}"/>\n` +
      `    </itunes:category>\n`
    : `    <itunes:category text="${escapeXmlAttr(show.category)}"/>\n`;

  const lines: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<rss version="2.0"` +
      ` xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"` +
      ` xmlns:atom="http://www.w3.org/2005/Atom"` +
      ` xmlns:content="http://purl.org/rss/1.0/modules/content/">`,
    `  <channel>`,
    `    <title>${escapeXmlText(show.title)}</title>`,
    `    <link>${escapeXmlText(show.link)}</link>`,
    `    <description>${escapeXmlText(show.description)}</description>`,
    `    <language>${escapeXmlText(show.language)}</language>`,
    `    <copyright>${escapeXmlText(`© ${now.getUTCFullYear()} ${show.author}`)}</copyright>`,
    `    <lastBuildDate>${now.toUTCString()}</lastBuildDate>`,
    `    <atom:link href="${escapeXmlAttr(show.feedUrl)}" rel="self" type="application/rss+xml"/>`,
    `    <itunes:author>${escapeXmlText(show.author)}</itunes:author>`,
    `    <itunes:summary>${escapeXmlText(show.description)}</itunes:summary>`,
    `    <itunes:type>episodic</itunes:type>`,
    `    <itunes:explicit>${show.explicit ? "true" : "false"}</itunes:explicit>`,
    categoryXml.trimEnd(),
  ];
  if (show.ownerName && show.ownerEmail) {
    lines.push(
      `    <itunes:owner>`,
      `      <itunes:name>${escapeXmlText(show.ownerName)}</itunes:name>`,
      `      <itunes:email>${escapeXmlText(show.ownerEmail)}</itunes:email>`,
      `    </itunes:owner>`,
    );
  }
  if (show.artworkUrl) {
    lines.push(
      `    <itunes:image href="${escapeXmlAttr(show.artworkUrl)}"/>`,
      `    <image>`,
      `      <url>${escapeXmlText(show.artworkUrl)}</url>`,
      `      <title>${escapeXmlText(show.title)}</title>`,
      `      <link>${escapeXmlText(show.link)}</link>`,
      `    </image>`,
    );
  }
  for (const ep of episodes) {
    lines.push(
      `    <item>`,
      `      <title>${escapeXmlText(ep.title)}</title>`,
      `      <description>${escapeXmlText(ep.description)}</description>`,
      `      <pubDate>${ep.pubDate.toUTCString()}</pubDate>`,
      `      <guid isPermaLink="true">${escapeXmlText(ep.guid)}</guid>`,
      `      <enclosure url="${escapeXmlAttr(ep.enclosure.url)}" length="${ep.enclosure.length}" type="${escapeXmlAttr(ep.enclosure.type)}"/>`,
      `      <itunes:duration>${formatItunesDuration(ep.durationSeconds)}</itunes:duration>`,
      `      <itunes:episodeType>full</itunes:episodeType>`,
      `      <itunes:explicit>${ep.explicit ? "true" : "false"}</itunes:explicit>`,
    );
    if (ep.artworkUrl) {
      lines.push(`      <itunes:image href="${escapeXmlAttr(ep.artworkUrl)}"/>`);
    }
    lines.push(`    </item>`);
  }
  lines.push(`  </channel>`, `</rss>`, ``);
  return lines.join("\n");
}

/* ── Enclosure resolution ────────────────────────────────────────────── */

export interface Enclosure {
  url: string;
  length: number;
  type: string;
}

const MIME_BY_EXT: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/x-m4a",
  mp4: "audio/mp4",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/opus",
  flac: "audio/flac",
  aac: "audio/aac",
};

export function mimeTypeForAudio(audioRef: string, headContentType?: string | null): string {
  if (headContentType && headContentType.startsWith("audio/")) return headContentType;
  const clean = audioRef.split(/[?#]/)[0] ?? audioRef;
  const ext = clean.slice(clean.lastIndexOf(".") + 1).toLowerCase();
  return MIME_BY_EXT[ext] ?? "audio/mpeg";
}

/** Public CDN base for R2 objects, when one is configured. */
export function publicCdnBase(): string {
  return (
    process.env["R2_PUBLIC_URL"] ??
    process.env["MEDIA_CDN_URL"] ??
    ""
  ).replace(/\/+$/, "");
}

interface EnclosureDeps {
  headR2: (key: string) => Promise<{ size: number; contentType: string | null } | null>;
  refreshUrl: (ref: string) => Promise<string>;
  rangeProbe: (url: string) => Promise<number | null>;
  cdnBase: string;
  isR2: boolean;
}

const defaultDeps: EnclosureDeps = {
  headR2: (key) => r2ObjectSize(key),
  refreshUrl: (ref) => refreshSupabaseStorageUrl(ref),
  rangeProbe: (url) => probeLengthViaRange(url),
  cdnBase: publicCdnBase(),
  isR2: isR2Configured(),
};

/** 1-byte Range GET: S3/R2 and Supabase both answer 206 + Content-Range
 *  with the object's total size. Never downloads the episode. */
export async function probeLengthViaRange(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, {
      headers: { Range: "bytes=0-0" },
      signal: AbortSignal.timeout(15_000),
    });
    const contentRange = res.headers.get("content-range");
    if (res.status === 206 && contentRange) {
      const total = Number(contentRange.slice(contentRange.lastIndexOf("/") + 1));
      return Number.isFinite(total) && total > 0 ? total : null;
    }
    if (res.status === 200) {
      const len = Number(res.headers.get("content-length"));
      return Number.isFinite(len) && len > 0 ? len : null;
    }
    return null;
  } catch {
    return null;
  }
}

const enclosureCache = new Map<string, { at: number; value: Enclosure | null }>();
const ENCLOSURE_CACHE_TTL_MS = 10 * 60_000;

export function clearEnclosureCache(): void {
  enclosureCache.clear();
}

/**
 * Resolve a stored track's audio into a feed-ready enclosure, or null
 * when no truthful length exists (the caller then omits the episode —
 * Apple rejects the whole feed over one bad enclosure).
 *
 * URL choice: a direct public CDN URL when the object lives in R2 and a
 * public base is configured (fast, range-friendly, no hop); otherwise
 * the caller's stable fallback URL (the API redirect endpoint).
 */
export async function resolveEnclosure(
  track: { id: string; audioUrl: string },
  fallbackUrl: string,
  deps: EnclosureDeps = defaultDeps,
): Promise<Enclosure | null> {
  const cacheKey = `${track.id}:${track.audioUrl}`;
  const hit = enclosureCache.get(cacheKey);
  if (hit && Date.now() - hit.at < ENCLOSURE_CACHE_TTL_MS) return hit.value;

  let value: Enclosure | null = null;
  try {
    const parsed = parseSupabaseStorageRefBucketed(track.audioUrl);
    const r2Key = parsed ? r2KeyForBucket(parsed.bucket, parsed.objectPath) : null;

    let size: number | null = null;
    let headType: string | null = null;
    let provenInR2 = false;
    if (r2Key && deps.isR2) {
      const head = await deps.headR2(r2Key);
      if (head) {
        size = head.size;
        headType = head.contentType;
        provenInR2 = true;
      }
    }

    // Direct CDN URL only when the object is proven to sit in R2 — a
    // legacy ref that never migrated would 404 on the CDN base.
    let url: string | null = null;
    if (r2Key && deps.cdnBase && provenInR2) {
      url = `${deps.cdnBase}/${r2Key}`;
    }
    if (size === null) {
      // Not provable from R2 — probe the playable (signed) URL directly.
      const signed = await deps.refreshUrl(track.audioUrl);
      if (signed && signed !== track.audioUrl && !signed.startsWith("r2://") && !signed.startsWith("supabase://")) {
        size = await deps.rangeProbe(signed);
        // Only a stable public-bucket URL may be used directly; a signed
        // URL expires in a day, so everything else takes the fallback.
        if (size !== null && !url && parsed?.viaPublicUrl) url = signed;
      }
    }
    if (size !== null && size > 0) {
      value = {
        url: url ?? fallbackUrl,
        length: size,
        type: mimeTypeForAudio(track.audioUrl, headType),
      };
    }
  } catch (err) {
    logger.warn({ err, trackId: track.id }, "podcast-feed: enclosure resolution failed");
    value = null;
  }

  enclosureCache.set(cacheKey, { at: Date.now(), value });
  return value;
}

/* ── Show assembly from a profile row ────────────────────────────────── */

export interface FeedProfileRow {
  slug: string;
  displayName: string;
  bio: string;
  avatarUrl: string | null;
  bannerUrl: string | null;
  themeConfig: unknown;
}

/** Build the channel model from a profile + resolved settings. The
 *  caller supplies absolute artwork/feed URLs (storage refs refreshed). */
export function buildFeedShow(
  profile: FeedProfileRow,
  opts: {
    feedUrl: string;
    artworkUrl?: string | null;
    ownerEmail?: string | null;
  },
): PodcastFeedShow {
  const s = readPodcastFeedSettings(profile.themeConfig);
  const origin = siteOrigin();
  return {
    title: s.title ?? profile.displayName,
    link: `${origin}/artist/${profile.slug}`,
    description: s.description ?? (profile.bio || profile.displayName),
    language: s.language ?? "en-us",
    author: s.author ?? profile.displayName,
    ownerName: profile.displayName,
    ownerEmail: opts.ownerEmail ?? undefined,
    artworkUrl: opts.artworkUrl ?? undefined,
    category: s.category ?? DEFAULT_PODCAST_CATEGORY,
    subcategory: s.subcategory,
    explicit: s.explicit ?? false,
    feedUrl: opts.feedUrl,
  };
}
