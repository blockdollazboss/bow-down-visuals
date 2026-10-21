/**
 * social-catalog.ts — read a creator's OWN catalog back from the accounts
 * THEY connected, for the back-catalog migration assistant (0200).
 *
 * What the platforms actually allow a third-party app to do, honestly:
 *   - Instagram (graph.instagram.com, scopes granted at connect:
 *     instagram_business_basic + instagram_business_content_publish):
 *     the media list of the account itself IS readable, and each item
 *     carries a media_url for the account's own file. Listing + bringing
 *     the file home is the sanctioned path.
 *   - Facebook Pages (graph.facebook.com, scopes: pages_read_engagement
 *     + pages_show_list + pages_manage_posts): the Page's own video list
 *     IS readable. The playable file URL (`source`) is returned when the
 *     token's permissions allow; when it is absent the item lists but
 *     cannot be fetched, and the caller marks it blocked — never scraped.
 *   - TikTok (scopes granted at connect: user.info.basic, video.upload):
 *     there is NO catalog-read scope on the connection and no download
 *     pipe for a creator's videos. This module deliberately has no
 *     TikTok lister — the assistant parks TikTok with the reason stated.
 *
 * All functions take an optional fetchImpl so tests inject a mock (the
 * social-meta.ts / social-tiktok.ts house pattern). Errors carry the
 * platform's message in plain words; an expired token (Graph code 190)
 * is flagged so the UI can say "reconnect in Settings".
 */
import { logger } from "./logger";

export type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;
const defaultFetch: FetchImpl = (url, init) => fetch(url, init);

const GRAPH_VERSION = "v21.0";
const GRAPH_IG = `https://graph.instagram.com/${GRAPH_VERSION}`;
const GRAPH_FB = `https://graph.facebook.com/${GRAPH_VERSION}`;

/** Hard caps so one scan stays one bounded job, stated in the UI. */
export const CATALOG_SCAN_PAGE_CAP = 5;
export const CATALOG_SCAN_ITEM_CAP = 250;

export class CatalogProviderError extends Error {
  /** Graph error code, when the platform sent one (190 = token expired). */
  metaCode?: number;
  constructor(message: string, metaCode?: number) {
    super(message);
    this.name = "CatalogProviderError";
    this.metaCode = metaCode;
  }
  get tokenExpired(): boolean {
    return this.metaCode === 190;
  }
}

export interface RemoteCatalogItem {
  externalId: string;
  kind: "video";
  /** First line of the caption/description, or a dated fallback. */
  title: string;
  /** The full original caption/description (seeds the rebuild draft). */
  caption: string;
  permalink: string | null;
  /** The platform's file URL for the creator's own media, or NULL when
      the platform would not hand one over (→ the item parks blocked). */
  fileUrl: string | null;
  thumbnailUrl: string | null;
  durationSec: number | null;
  isReel: boolean;
}

interface GraphErrorBody {
  error?: { code?: number; message?: string };
}

async function graphGet<T>(
  base: string,
  path: string,
  params: Record<string, string>,
  fetchImpl: FetchImpl,
  platformLabel: string,
): Promise<T & GraphErrorBody> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetchImpl(`${base}${path}?${qs}`);
  const body = (await res.json().catch(() => ({}))) as T & GraphErrorBody;
  if (!res.ok || body.error) {
    const code = body.error?.code;
    const msg = body.error?.message ?? `HTTP ${res.status}`;
    logger.warn({ path, metaCode: code }, "[social-catalog] Graph API error");
    if (code === 190) {
      throw new CatalogProviderError(
        `Your ${platformLabel} connection has expired. Reconnect it in Settings, then scan again.`,
        code,
      );
    }
    throw new CatalogProviderError(`${platformLabel} said: ${msg.slice(0, 180)}`, code);
  }
  return body;
}

interface GraphPage<T> {
  data?: T[];
  paging?: { next?: string };
}

async function graphGetAbsolute<T>(url: string, fetchImpl: FetchImpl, platformLabel: string): Promise<T & GraphErrorBody> {
  const res = await fetchImpl(url);
  const body = (await res.json().catch(() => ({}))) as T & GraphErrorBody;
  if (!res.ok || body.error) {
    const code = body.error?.code;
    const msg = body.error?.message ?? `HTTP ${res.status}`;
    if (code === 190) {
      throw new CatalogProviderError(
        `Your ${platformLabel} connection has expired. Reconnect it in Settings, then scan again.`,
        code,
      );
    }
    throw new CatalogProviderError(`${platformLabel} said: ${msg.slice(0, 180)}`, code);
  }
  return body;
}

function firstLine(text: string | undefined | null, fallback: string): string {
  const line = (text ?? "").split(/\r?\n/).map((s) => s.trim()).find((s) => s.length > 0);
  return (line ?? fallback).slice(0, 140);
}

function datedFallback(label: string, iso: string | undefined): string {
  if (!iso) return label;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return label;
  return `${label} · ${d.toISOString().slice(0, 10)}`;
}

interface IgMedia {
  id: string;
  caption?: string;
  media_type?: string;
  media_product_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  timestamp?: string;
}

/**
 * List the connected Instagram account's own videos/reels. Non-video
 * posts (photos, carousels) are counted as skipped, not listed — the
 * catalog move is for video/audio work, and the UI says so.
 */
export async function listInstagramMedia(
  account: { igUserId: string; accessToken: string },
  fetchImpl: FetchImpl = defaultFetch,
): Promise<{ items: RemoteCatalogItem[]; skippedNonVideo: number }> {
  const items: RemoteCatalogItem[] = [];
  let skippedNonVideo = 0;
  let path: string | null = `/${account.igUserId}/media`;
  let params: Record<string, string> = {
    fields: "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp",
    limit: "50",
    access_token: account.accessToken,
  };
  let nextUrl: string | null = null;
  for (let page = 0; page < CATALOG_SCAN_PAGE_CAP; page++) {
    const body: GraphPage<IgMedia> & GraphErrorBody = nextUrl
      ? await graphGetAbsolute<GraphPage<IgMedia>>(nextUrl, fetchImpl, "Instagram")
      : await graphGet<GraphPage<IgMedia>>(GRAPH_IG, path!, params, fetchImpl, "Instagram");
    for (const m of body.data ?? []) {
      const isVideo = m.media_type === "VIDEO";
      if (!isVideo) {
        skippedNonVideo++;
        continue;
      }
      if (items.length >= CATALOG_SCAN_ITEM_CAP) break;
      items.push({
        externalId: m.id,
        kind: "video",
        title: firstLine(m.caption, datedFallback("Instagram video", m.timestamp)),
        caption: (m.caption ?? "").slice(0, 4000),
        permalink: m.permalink ?? null,
        fileUrl: m.media_url ?? null,
        /* For videos, thumbnail_url is the poster frame; media_url on an
           image post would be the image — video items only here. */
        thumbnailUrl: m.thumbnail_url ?? null,
        durationSec: null,
        isReel: m.media_product_type === "REELS",
      });
    }
    if (items.length >= CATALOG_SCAN_ITEM_CAP) break;
    nextUrl = body.paging?.next ?? null;
    if (!nextUrl) break;
    path = null;
    params = {};
  }
  return { items, skippedNonVideo };
}

interface FbVideo {
  id: string;
  title?: string;
  description?: string;
  source?: string;
  picture?: string;
  permalink_url?: string;
  length?: number;
  created_time?: string;
}

/**
 * List the connected Facebook Page's own videos. `source` (the playable
 * file) is included when the Page token's permissions allow it; items
 * without it still list — the fetch step parks them blocked with the
 * reason, because working around it would mean scraping, and we don't.
 */
export async function listFacebookPageVideos(
  account: { pageId: string; accessToken: string },
  fetchImpl: FetchImpl = defaultFetch,
): Promise<{ items: RemoteCatalogItem[]; skippedNonVideo: number }> {
  const items: RemoteCatalogItem[] = [];
  let path: string | null = `/${account.pageId}/videos`;
  let params: Record<string, string> = {
    fields: "id,title,description,source,picture,permalink_url,length,created_time",
    limit: "50",
    access_token: account.accessToken,
  };
  let nextUrl: string | null = null;
  for (let page = 0; page < CATALOG_SCAN_PAGE_CAP; page++) {
    const body: GraphPage<FbVideo> & GraphErrorBody = nextUrl
      ? await graphGetAbsolute<GraphPage<FbVideo>>(nextUrl, fetchImpl, "Facebook")
      : await graphGet<GraphPage<FbVideo>>(GRAPH_FB, path!, params, fetchImpl, "Facebook");
    for (const v of body.data ?? []) {
      if (items.length >= CATALOG_SCAN_ITEM_CAP) break;
      const caption = v.description ?? "";
      items.push({
        externalId: v.id,
        kind: "video",
        title: firstLine(v.title || caption, datedFallback("Facebook video", v.created_time)),
        caption: caption.slice(0, 4000),
        permalink: v.permalink_url ? `https://www.facebook.com${v.permalink_url}` : null,
        fileUrl: v.source ?? null,
        thumbnailUrl: v.picture ?? null,
        durationSec: typeof v.length === "number" ? Math.round(v.length) : null,
        isReel: false,
      });
    }
    if (items.length >= CATALOG_SCAN_ITEM_CAP) break;
    nextUrl = body.paging?.next ?? null;
    if (!nextUrl) break;
    path = null;
    params = {};
  }
  return { items, skippedNonVideo: 0 };
}
