import { logger } from "./logger";

/* Thin Instagram Platform API client for the Instagram auto-post MVP.
   Uses Instagram Login (instagram.com/oauth/authorize) — the auth flow Meta
   requires for newly created apps. No Facebook Page is involved: the token
   exchange returns the Instagram user ID directly, and publishing goes to
   graph.instagram.com with the same long-lived user token.
   All functions take an optional `fetchImpl` so tests can inject a mock —
   production call sites omit it and use the global fetch.
   No tokens are ever logged here; error messages are sanitized. */

const GRAPH_VERSION = "v21.0";
const GRAPH = `https://graph.instagram.com/${GRAPH_VERSION}`;
const OAUTH_AUTHORIZE = "https://www.instagram.com/oauth/authorize";
const OAUTH_TOKEN = "https://api.instagram.com/oauth/access_token";

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
  appId: string; // Instagram app ID (from the Meta app's Instagram product)
  appSecret: string; // Instagram app secret
  redirectUri: string;
}

/* Instagram Login authorize URL. `enable_fb_login=0` forces the pure
   Instagram consent screen instead of routing through Facebook Login. */
export function buildAuthUrl(cfg: MetaOAuthConfig, state: string): string {
  const scopes = ["instagram_business_basic", "instagram_business_content_publish"].join(",");
  const qs = new URLSearchParams({
    enable_fb_login: "0",
    client_id: cfg.appId,
    redirect_uri: cfg.redirectUri,
    scope: scopes,
    response_type: "code",
    state,
  });
  return `${OAUTH_AUTHORIZE}?${qs.toString()}`;
}

interface InstagramCodeExchange {
  access_token: string;
  user_id?: number | string;
}

interface InstagramLongLived {
  access_token: string;
  expires_in?: number;
  token_type?: string;
}

/** code → short-lived token → 60-day long-lived token via Instagram's own
   OAuth endpoints. Returns the Instagram user ID from the first exchange. */
export async function exchangeCodeForLongLivedToken(
  cfg: MetaOAuthConfig,
  code: string,
  fetchImpl: FetchImpl = defaultFetch,
): Promise<{ accessToken: string; expiresInSec: number; igUserId: string }> {
  const shortRes = await fetchImpl(OAUTH_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.appId,
      client_secret: cfg.appSecret,
      grant_type: "authorization_code",
      redirect_uri: cfg.redirectUri,
      code,
    }).toString(),
  });
  const shortBody = (await shortRes.json().catch(() => ({}))) as MetaErrorBody & InstagramCodeExchange;
  if (!shortRes.ok || shortBody.error || !shortBody.access_token) {
    const msg = shortBody.error?.message ?? `HTTP ${shortRes.status}`;
    logger.warn({ metaCode: shortBody.error?.code }, "[social-meta] Instagram code exchange failed");
    throw new MetaApiError(userMessageFor(shortBody.error?.code, msg), shortBody.error?.code);
  }
  const igUserId = String(shortBody.user_id ?? "");
  if (!igUserId) throw new MetaApiError("Instagram login didn't return an account. Try again.");

  const longQs = new URLSearchParams({
    grant_type: "ig_exchange_token",
    client_secret: cfg.appSecret,
    access_token: shortBody.access_token,
  }).toString();
  const longRes = await fetchImpl(`${GRAPH}/access_token?${longQs}`);
  const longBody = (await longRes.json().catch(() => ({}))) as MetaErrorBody & InstagramLongLived;
  if (!longRes.ok || longBody.error || !longBody.access_token) {
    const msg = longBody.error?.message ?? `HTTP ${longRes.status}`;
    logger.warn({ metaCode: longBody.error?.code }, "[social-meta] Instagram long-lived exchange failed");
    throw new MetaApiError(userMessageFor(longBody.error?.code, msg), longBody.error?.code);
  }
  return {
    accessToken: longBody.access_token,
    expiresInSec: longBody.expires_in ?? 60 * 24 * 3600,
    igUserId,
  };
}

export interface InstagramProfile {
  igUserId: string;
  username: string;
}

/** Resolves the connected Business/Creator account's username. The user ID
   comes straight from the token exchange — no Facebook Pages lookup needed. */
export async function fetchInstagramProfile(
  accessToken: string,
  fetchImpl: FetchImpl = defaultFetch,
): Promise<InstagramProfile> {
  const res = await graphGet<{ id?: string | number; username?: string }>(
    "/me",
    { fields: "id,username", access_token: accessToken },
    fetchImpl,
  );
  return { igUserId: String(res.id ?? ""), username: res.username ?? "" };
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
