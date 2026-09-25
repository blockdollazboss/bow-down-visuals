import { logger } from "./logger";

/* Thin Meta Graph API client for the Instagram auto-post MVP.
   All functions take an optional `fetchImpl` so tests can inject a mock —
   production call sites omit it and use the global fetch.
   No tokens are ever logged here; error messages are sanitized. */

const GRAPH_VERSION = "v21.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

export type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

const defaultFetch: FetchImpl = (url, init) => fetch(url, init);

/** Error from the Meta Graph API with a user-facing message. */
export class MetaApiError extends Error {
  readonly userMessage: string;
  readonly metaCode?: number;
  constructor(userMessage: string, metaCode?: number, detail?: string) {
    super(detail ? `${userMessage} (${detail})` : userMessage);
    this.name = "MetaApiError";
    this.userMessage = userMessage;
    this.metaCode = metaCode;
  }
}

interface MetaErrorBody {
  error?: { message?: string; code?: number; error_subcode?: number };
}

function userMessageFor(metaCode: number | undefined, metaMessage: string): string {
  if (metaCode === 190) {
    return "Your Instagram connection expired. Reconnect it in Settings → Connected Accounts.";
  }
  if (metaCode === 100 && /video_url/i.test(metaMessage)) {
    return "Instagram couldn't fetch the video from its URL. Try exporting again, then repost.";
  }
  if (metaCode === 200 || metaCode === 10) {
    return "Instagram refused the post — the connected account may lack posting permission. Reconnect it in Settings.";
  }
  return metaMessage
    ? `Instagram said: ${metaMessage.slice(0, 180)}`
    : "Instagram returned an error. Please try again.";
}

async function graphGet<T>(path: string, params: Record<string, string>, fetchImpl: FetchImpl): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetchImpl(`${GRAPH}${path}?${qs}`);
  const body = (await res.json().catch(() => ({}))) as MetaErrorBody & T;
  if (!res.ok || body.error) {
    const code = body.error?.code;
    const msg = body.error?.message ?? `HTTP ${res.status}`;
    logger.warn({ path, metaCode: code }, "[social-meta] Graph API error");
    throw new MetaApiError(userMessageFor(code, msg), code, `HTTP ${res.status}`);
  }
  return body as T;
}

async function graphPost<T>(
  path: string,
  params: Record<string, string>,
  fetchImpl: FetchImpl,
): Promise<T> {
  const res = await fetchImpl(`${GRAPH}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const body = (await res.json().catch(() => ({}))) as MetaErrorBody & T;
  if (!res.ok || body.error) {
    const code = body.error?.code;
    const msg = body.error?.message ?? `HTTP ${res.status}`;
    logger.warn({ path, metaCode: code }, "[social-meta] Graph API error");
    throw new MetaApiError(userMessageFor(code, msg), code, `HTTP ${res.status}`);
  }
  return body as T;
}

export interface MetaOAuthConfig {
  appId: string;
  appSecret: string;
  redirectUri: string;
}

/** Builds the Meta OAuth authorize URL (Facebook Login for Business). */
export function buildAuthUrl(cfg: MetaOAuthConfig, state: string): string {
  const scopes = [
    "instagram_business_content_publish",
    "pages_read_engagement",
    "pages_show_list",
  ].join(",");
  const qs = new URLSearchParams({
    client_id: cfg.appId,
    redirect_uri: cfg.redirectUri,
    scope: scopes,
    state,
    response_type: "code",
  });
  return `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${qs.toString()}`;
}

/** code → short-lived token → 60-day long-lived user token. */
export async function exchangeCodeForLongLivedToken(
  cfg: MetaOAuthConfig,
  code: string,
  fetchImpl: FetchImpl = defaultFetch,
): Promise<{ accessToken: string; expiresInSec: number }> {
  const short = await graphGet<{ access_token: string }>(
    "/oauth/access_token",
    {
      client_id: cfg.appId,
      client_secret: cfg.appSecret,
      redirect_uri: cfg.redirectUri,
      code,
    },
    fetchImpl,
  );
  if (!short.access_token) throw new MetaApiError("Instagram login didn't return a token. Try again.");
  const long = await graphGet<{ access_token: string; expires_in: number }>(
    "/oauth/access_token",
    {
      grant_type: "fb_exchange_token",
      client_id: cfg.appId,
      client_secret: cfg.appSecret,
      fb_exchange_token: short.access_token,
    },
    fetchImpl,
  );
  if (!long.access_token) throw new MetaApiError("Instagram login didn't return a token. Try again.");
  return { accessToken: long.access_token, expiresInSec: long.expires_in ?? 60 * 24 * 3600 };
}

export interface ConnectedPage {
  pageId: string;
  pageName: string;
  pageAccessToken: string;
  igUserId: string;
}

/* NOTE: findInstagramPage is defined below in the Facebook Pages section —
   it is implemented on top of listPages() so both OAuth flows share the
   Page enumeration. */

export async function fetchInstagramUsername(
  igUserId: string,
  pageAccessToken: string,
  fetchImpl: FetchImpl = defaultFetch,
): Promise<string> {
  const res = await graphGet<{ username?: string }>(
    `/${igUserId}`,
    { fields: "username", access_token: pageAccessToken },
    fetchImpl,
  );
  return res.username ?? "";
}

/* ── Reels publishing ─────────────────────────────────────────────────── */

export async function createReelContainer(
  igUserId: string,
  accessToken: string,
  opts: { videoUrl: string; caption: string },
  fetchImpl: FetchImpl = defaultFetch,
): Promise<string> {
  const res = await graphPost<{ id?: string }>(
    `/${igUserId}/media`,
    {
      media_type: "REELS",
      video_url: opts.videoUrl,
      caption: opts.caption,
      share_to_feed: "true",
      access_token: accessToken,
    },
    fetchImpl,
  );
  if (!res.id) throw new MetaApiError("Instagram didn't create the upload. Please try again.");
  return res.id;
}

export type ContainerStatus = "IN_PROGRESS" | "FINISHED" | "ERROR" | "EXPIRED";

const POLL_INTERVAL_MS = 10_000;
const POLL_MAX_TRIES = 30; // ~5 minutes

/** Polls the media container until Meta finishes transcoding. Throws on ERROR/EXPIRED/timeout. */
export async function pollContainerUntilFinished(
  containerId: string,
  accessToken: string,
  fetchImpl: FetchImpl = defaultFetch,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<void> {
  for (let i = 0; i < POLL_MAX_TRIES; i++) {
    const res = await graphGet<{ status_code?: ContainerStatus }>(
      `/${containerId}`,
      { fields: "status_code", access_token: accessToken },
      fetchImpl,
    );
    const status = res.status_code;
    logger.info({ containerId, status, try: i + 1 }, "[social-meta] container poll");
    if (status === "FINISHED") return;
    if (status === "ERROR" || status === "EXPIRED") {
      throw new MetaApiError("Instagram couldn't process the video. Try a different export, then repost.");
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new MetaApiError("Instagram is taking too long to process the video. Try again in a few minutes.");
}

export async function publishContainer(
  igUserId: string,
  accessToken: string,
  containerId: string,
  fetchImpl: FetchImpl = defaultFetch,
): Promise<string> {
  const res = await graphPost<{ id?: string }>(
    `/${igUserId}/media_publish`,
    { creation_id: containerId, access_token: accessToken },
    fetchImpl,
  );
  if (!res.id) throw new MetaApiError("Instagram didn't publish the reel. Please try again.");
  return res.id;
}

export async function fetchPermalink(
  mediaId: string,
  accessToken: string,
  fetchImpl: FetchImpl = defaultFetch,
): Promise<string> {
  const res = await graphGet<{ permalink?: string }>(
    `/${mediaId}`,
    { fields: "permalink", access_token: accessToken },
    fetchImpl,
  );
  return res.permalink ?? "";
}

export interface PublishReelInput {
  igUserId: string;
  accessToken: string;
  videoUrl: string;
  caption: string;
}

/** Full flow: container → poll → publish → permalink. Used by the route and the tests. */
export async function publishReelToInstagram(
  input: PublishReelInput,
  fetchImpl: FetchImpl = defaultFetch,
  sleep?: (ms: number) => Promise<void>,
): Promise<{ mediaId: string; permalink: string }> {
  const containerId = await createReelContainer(
    input.igUserId,
    input.accessToken,
    { videoUrl: input.videoUrl, caption: input.caption },
    fetchImpl,
  );
  await pollContainerUntilFinished(containerId, input.accessToken, fetchImpl, sleep);
  const mediaId = await publishContainer(input.igUserId, input.accessToken, containerId, fetchImpl);
  const permalink = await fetchPermalink(mediaId, input.accessToken, fetchImpl);
  return { mediaId, permalink };
}

/* ── Facebook Pages video publishing ─────────────────────────────────────
   POST https://graph-video.facebook.com/v21.0/{page-id}/videos
   with file_url + description (verified against Meta docs, Sept 2026).
   Unlike Instagram there is no second publish step — the POST *is* the
   publish; Meta then processes the video asynchronously. Since June 2025
   all Facebook videos surface as Reels — we say so in the UI, never claim
   a classic "video post". */

const GRAPH_VIDEO = `https://graph-video.facebook.com/${GRAPH_VERSION}`;

/** Builds the Facebook OAuth authorize URL (page posting scopes only — no
   Instagram permission, so users without an IG Business account can still
   connect their Pages). */
export function buildFacebookAuthUrl(cfg: MetaOAuthConfig, state: string): string {
  const scopes = ["pages_manage_posts", "pages_read_engagement", "pages_show_list"].join(",");
  const qs = new URLSearchParams({
    client_id: cfg.appId,
    redirect_uri: cfg.redirectUri,
    scope: scopes,
    state,
    response_type: "code",
  });
  return `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${qs.toString()}`;
}

export interface PageConnection {
  pageId: string;
  pageName: string;
  pageAccessToken: string;
  /** Linked IG Business/Creator id, or null when the Page has none. */
  igUserId: string | null;
}

/** Lists ALL of the user's Pages (with per-page access tokens). */
export async function listPages(
  longLivedToken: string,
  fetchImpl: FetchImpl = defaultFetch,
): Promise<PageConnection[]> {
  const pages = await graphGet<{ data?: Array<{ id: string; name: string; access_token: string }> }>(
    "/me/accounts",
    { access_token: longLivedToken },
    fetchImpl,
  );
  const out: PageConnection[] = [];
  for (const page of pages.data ?? []) {
    if (!page.access_token) continue;
    const detail = await graphGet<{ instagram_business_account?: { id: string } }>(
      `/${page.id}`,
      { fields: "instagram_business_account", access_token: longLivedToken },
      fetchImpl,
    );
    out.push({
      pageId: page.id,
      pageName: page.name,
      pageAccessToken: page.access_token,
      igUserId: detail.instagram_business_account?.id ?? null,
    });
  }
  return out;
}

/** Finds the user's first Page with a linked Instagram Business/Creator account. */
export async function findInstagramPage(
  longLivedToken: string,
  fetchImpl: FetchImpl = defaultFetch,
): Promise<ConnectedPage> {
  for (const page of await listPages(longLivedToken, fetchImpl)) {
    if (page.igUserId) {
      return {
        pageId: page.pageId,
        pageName: page.pageName,
        pageAccessToken: page.pageAccessToken,
        igUserId: page.igUserId,
      };
    }
  }
  throw new MetaApiError(
    "No Instagram Business or Creator account is linked to your Facebook Pages. " +
      "Link one in the Instagram app (Settings → Account type and tools), then try again.",
  );
}

function userMessageForFacebook(metaCode: number | undefined, metaMessage: string): string {
  if (metaCode === 190) {
    return "Your Facebook connection expired. Reconnect it in Settings → Connected Accounts.";
  }
  if (metaCode === 200 || metaCode === 10) {
    return "Facebook refused the post — the Page may lack posting permission. Reconnect it in Settings.";
  }
  return metaMessage
    ? `Facebook said: ${metaMessage.slice(0, 180)}`
    : "Facebook returned an error. Please try again.";
}

async function graphVideoPost<T>(
  path: string,
  params: Record<string, string>,
  fetchImpl: FetchImpl,
): Promise<T> {
  const res = await fetchImpl(`${GRAPH_VIDEO}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const body = (await res.json().catch(() => ({}))) as MetaErrorBody & T;
  if (!res.ok || body.error) {
    const code = body.error?.code;
    const msg = body.error?.message ?? `HTTP ${res.status}`;
    logger.warn({ path, metaCode: code }, "[social-meta] graph-video API error");
    throw new MetaApiError(userMessageForFacebook(code, msg), code, `HTTP ${res.status}`);
  }
  return body as T;
}

/* Defensive read of the video node's processing state. The Video reference
   exposes `status` (with video_status); we accept any clear "ready" signal
   and only hard-fail on an explicit error, so a doc-shape drift degrades to
   "keep waiting" rather than a false failure. */
type PageVideoStatus = "READY" | "PROCESSING" | "ERROR";

function readPageVideoStatus(body: unknown): PageVideoStatus {
  const b = (body ?? {}) as Record<string, unknown>;
  const status = b.status;
  const nested =
    typeof status === "object" && status !== null
      ? (status as Record<string, unknown>).video_status
      : undefined;
  const raw = String(
    nested ?? b.video_status ?? (typeof status === "string" ? status : ""),
  ).toLowerCase();
  if (/error|fail/.test(raw)) return "ERROR";
  if (/ready|complete|published/.test(raw)) return "READY";
  return "PROCESSING";
}

const PAGE_POLL_INTERVAL_MS = 15_000;
const PAGE_POLL_MAX_TRIES = 12; // ~3 minutes

/** Uploads the video to the Page and waits until Meta finishes processing.
   Unlike Instagram there is no second publish call — a successful POST means
   the video is on the Page; the poll only gates the permalink fetch. On
   timeout we return anyway (the post exists; processing finishes async). */
export async function publishVideoToPage(
  input: { pageId: string; accessToken: string; videoUrl: string; description: string },
  fetchImpl: FetchImpl = defaultFetch,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<{ videoId: string; permalink: string }> {
  const created = await graphVideoPost<{ id?: string }>(
    `/${input.pageId}/videos`,
    {
      file_url: input.videoUrl,
      description: input.description,
      access_token: input.accessToken,
    },
    fetchImpl,
  );
  if (!created.id) throw new MetaApiError("Facebook didn't accept the video. Please try again.");
  const videoId = created.id;

  for (let i = 0; i < PAGE_POLL_MAX_TRIES; i++) {
    const res = await graphGet<unknown>(
      `/${videoId}`,
      { fields: "status", access_token: input.accessToken },
      fetchImpl,
    ).catch(() => null);
    const status = readPageVideoStatus(res);
    logger.info({ videoId, status, try: i + 1 }, "[social-meta] page video poll");
    if (status === "READY") break;
    if (status === "ERROR") {
      throw new MetaApiError("Facebook couldn't process the video. Try a different export, then repost.");
    }
    await sleep(PAGE_POLL_INTERVAL_MS);
  }

  const permalink = await graphGet<{ permalink_url?: string }>(
    `/${videoId}`,
    { fields: "permalink_url", access_token: input.accessToken },
    fetchImpl,
  )
    .then((r) => r.permalink_url ?? "")
    .catch(() => "");
  return { videoId, permalink };
}
