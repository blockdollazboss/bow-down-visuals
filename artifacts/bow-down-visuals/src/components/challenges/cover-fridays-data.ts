/**
 * cover-fridays-data.ts — the ONE contract between GET
 * /api/challenges/cover-fridays and the Cover Fridays card.
 *
 * The wire is NOT the view model, and pretending otherwise crashed
 * the homepage (boundary telemetry, Oct 29 2026: two trips on "/",
 * TypeError "Cannot read properties of undefined (reading
 * 'toLocaleString')"). The route serves snake_case scalars
 * (week_key, entry_count, past_crowns — api-server/src/routes/
 * cover-fridays.ts builds them explicitly) and nests the crowned
 * cover under `creator` / `video` (the crownedCovers() mapping in
 * api-server/src/lib/cover-fridays.ts). The card used to cast that
 * JSON straight to an invented camelCase interface, so
 * `challenge.entryCount` was undefined in every real payload with a
 * live challenge row — and the render formatted it.
 *
 * normalizeCoverFridaysPayload is the only door: it translates the
 * served shape into the view model below and coerces every count
 * the way the server lib coerces its own rows (Number(x ?? 0)), so
 * a count the render formats is a real number by construction —
 * never a call-site patch, never an undefined receiver.
 */

export interface CoverTheme {
  title: string;
  description: string;
  hashtag: string;
}

export interface CrownedCover {
  weekKey: string;
  themeTitle: string;
  crownedAt: string;
  videoId: string;
  videoTitle: string;
  thumbnailUrl: string | null;
  displayName: string;
  slug: string;
  viewCount: number;
}

export interface CoverFridaysData {
  weekKey: string;
  theme: CoverTheme;
  challenge: {
    slug: string;
    status: string;
    entryCount: number;
  } | null;
  featured: CrownedCover | null;
  pastCrowns: CrownedCover[];
}

/** The card's count rendering — one formatter, exercised by the pin. */
export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Counts arrive as numbers from the server's own Number(?? 0)
 *  coercion; anything else (a field a future payload drops) still
 *  lands as a real number here, at the contract door. */
function asCount(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function normalizeCrowned(raw: unknown): CrownedCover | null {
  if (!isRecord(raw)) return null;
  const creator = isRecord(raw.creator) ? raw.creator : {};
  const video = isRecord(raw.video) ? raw.video : {};
  return {
    weekKey: asString(raw.weekKey),
    themeTitle: asString(raw.themeTitle),
    crownedAt: asString(raw.crownedAt),
    videoId: asString(video.id),
    videoTitle: asString(video.title),
    thumbnailUrl: typeof video.thumbnailUrl === "string" ? video.thumbnailUrl : null,
    displayName: asString(creator.displayName),
    slug: asString(creator.slug),
    viewCount: asCount(raw.viewCount),
  };
}

/**
 * Translate one served payload into the card's view model.
 * Returns null when the payload carries no theme — the card's
 * long-standing rule: a failed or empty read hides the card rather
 * than showing an invented theme.
 */
export function normalizeCoverFridaysPayload(json: unknown): CoverFridaysData | null {
  if (!isRecord(json) || !isRecord(json.theme)) return null;
  const theme = json.theme;
  const ch = isRecord(json.challenge) ? json.challenge : null;
  const past = Array.isArray(json.past_crowns) ? json.past_crowns : [];
  return {
    weekKey: asString(json.week_key),
    theme: {
      title: asString(theme.title),
      description: asString(theme.description),
      hashtag: asString(theme.hashtag),
    },
    challenge: ch
      ? {
          slug: asString(ch.slug),
          status: asString(ch.status),
          entryCount: asCount(ch.entry_count),
        }
      : null,
    featured: normalizeCrowned(json.featured),
    pastCrowns: past
      .map(normalizeCrowned)
      .filter((c): c is CrownedCover => c !== null),
  };
}
