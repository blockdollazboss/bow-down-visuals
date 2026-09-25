import { logger } from "./logger";

/* Thin TikTok API client for the auto-post DRAFTS tier (Content Posting API,
   `video.upload` scope → the video lands in the creator's TikTok inbox and
   they finish publishing in the TikTok app).

   Endpoints verified against the TikTok for Developers docs (Sept 2026):
   - OAuth:  https://www.tiktok.com/v2/auth/authorize/
             POST https://open.tiktokapis.com/v2/oauth/token/
   - User:   GET  https://open.tiktokapis.com/v2/user/info/
   - Inbox:  POST https://open.tiktokapis.com/v2/post/publish/inbox/video/init/
   - Chunks: PUT  {upload_url} (from init response)
   - Status: POST https://open.tiktokapis.com/v2/post/publish/status/fetch/

   All functions take an optional `fetchImpl` so tests can inject a mock —
   production call sites omit it and use the global fetch.
   No tokens are ever logged here; error messages are sanitized for users. */

const TIKTOK_API = "https://open.tiktokapis.com/v2";

export type FetchImpl = (
  url: string,
  init?: Omit<RequestInit, "body"> & { body?: unknown },
) => Promise<Response>;

/* defaultFetch adapts FetchImpl's loosely-typed body to the real fetch. */
const defaultFetch: FetchImpl = (url, init) => fetch(url, init as RequestInit);

/** Error from the TikTok API with a user-facing message. */
export class TikTokApiError extends Error {
  readonly userMessage: string;
  readonly tiktokCode?: string;
  constructor(userMessage: string, tiktokCode?: string, detail?: string) {
    super(detail ? `${userMessage} (${detail})` : userMessage);
    this.name = "TikTokApiError";
    this.userMessage = userMessage;
    this.tiktokCode = tiktokCode;
  }
}

interface TikTokErrorEnvelope {
  error?: { code?: string; message?: string; log_id?: string };
}

function userMessageFor(code: string | undefined, message: string): string {
  if (code === "access_token_invalid") {
    return "Your TikTok connection expired. Reconnect it in Settings → Connected Accounts.";
  }
  if (code === "scope_not_authorized") {
    return "TikTok refused the upload — the connection is missing the upload permission. Reconnect it in Settings.";
  }
  if (code === "rate_limit_exceeded") {
    return "TikTok is rate-limiting uploads right now (6 per minute). Wait a minute and try again.";
  }
  if (code === "spam_risk_too_many_posts") {
    return "TikTok's daily upload cap for this account is reached. Try again tomorrow.";
  }
  if (code === "spam_risk_user_banned_from_posting") {
    return "TikTok has blocked this account from posting via the API.";
  }
  if (code === "url_ownership_unverified") {
    return "TikTok couldn't pull the video from its URL. Try again — we'll upload it directly instead.";
  }
  return message
    ? `TikTok said: ${message.slice(0, 180)}`
    : "TikTok returned an error. Please try again.";
}

/** Throws TikTokApiError unless body.error.code === "ok". */
function assertOk(body: TikTokErrorEnvelope, context: string): void {
  const code = body.error?.code;
  if (code === "ok" || code === undefined) return;
  const message = body.error?.message ?? `HTTP error during ${context}`;
  logger.warn({ code, context }, "[social-tiktok] TikTok API error");
  throw new TikTokApiError(userMessageFor(code, message), code, context);
}

async function tiktokPost<T>(
  path: string,
  accessToken: string,
  body: Record<string, unknown>,
  fetchImpl: FetchImpl,
): Promise<T> {
  const res = await fetchImpl(`${TIKTOK_API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify(body),
  });
  const parsed = (await res.json().catch(() => ({}))) as TikTokErrorEnvelope & T;
  if (!res.ok && parsed.error?.code === undefined) {
    throw new TikTokApiError(`TikTok returned HTTP ${res.status}. Please try again.`, `http_${res.status}`, path);
  }
  assertOk(parsed, path);
  return parsed as T;
}

async function tiktokGet<T>(
  path: string,
  accessToken: string,
  params: Record<string, string>,
  fetchImpl: FetchImpl,
): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetchImpl(`${TIKTOK_API}${path}?${qs}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const parsed = (await res.json().catch(() => ({}))) as TikTokErrorEnvelope & T;
  if (!res.ok && parsed.error?.code === undefined) {
    throw new TikTokApiError(`TikTok returned HTTP ${res.status}. Please try again.`, `http_${res.status}`, path);
  }
  assertOk(parsed, path);
  return parsed as T;
}

/* ── OAuth (Login Kit) ─────────────────────────────────────────────────── */

export interface TikTokOAuthConfig {
  clientKey: string;
  clientSecret: string;
  redirectUri: string;
}

/** Builds the TikTok Login Kit authorize URL (drafts tier: video.upload). */
export function buildTikTokAuthUrl(cfg: TikTokOAuthConfig, state: string): string {
  const qs = new URLSearchParams({
    client_key: cfg.clientKey,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: "user.info.basic,video.upload",
    state,
  });
  return `https://www.tiktok.com/v2/auth/authorize/?${qs.toString()}`;
}

interface OAuthTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_expires_in?: number;
  open_id?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

async function oauthToken(
  cfg: TikTokOAuthConfig,
  params: Record<string, string>,
  fetchImpl: FetchImpl,
): Promise<OAuthTokenResponse> {
  const res = await fetchImpl(`${TIKTOK_API}/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: cfg.clientKey,
      client_secret: cfg.clientSecret,
      ...params,
    }).toString(),
  });
  const body = (await res.json().catch(() => ({}))) as OAuthTokenResponse;
  if (body.error || !body.access_token) {
    const msg = body.error_description || body.error || `HTTP ${res.status}`;
    logger.warn({ oauthError: body.error }, "[social-tiktok] OAuth token exchange failed");
    throw new TikTokApiError(
      "TikTok refused the connection. Try again, and make sure you approved the upload permission.",
      body.error,
      "oauth/token",
    );
  }
  return body;
}

export interface TikTokTokens {
  accessToken: string;
  refreshToken: string;
  openId: string;
  expiresInSec: number;
}

/** Authorization code → access + refresh tokens + open_id. */
export async function exchangeCodeForTikTokTokens(
  cfg: TikTokOAuthConfig,
  code: string,
  fetchImpl: FetchImpl = defaultFetch,
): Promise<TikTokTokens> {
  const body = await oauthToken(
    cfg,
    { code, grant_type: "authorization_code", redirect_uri: cfg.redirectUri },
    fetchImpl,
  );
  if (!body.refresh_token || !body.open_id) {
    throw new TikTokApiError("TikTok didn't return a complete login. Try again.");
  }
  return {
    accessToken: body.access_token!,
    refreshToken: body.refresh_token,
    openId: body.open_id,
    expiresInSec: body.expires_in ?? 86400, // TikTok user tokens live ~24h
  };
}

/** Refreshes an expired access token. TikTok ROTATES the refresh token —
    callers must persist both new values. */
export async function refreshTikTokTokens(
  cfg: TikTokOAuthConfig,
  refreshToken: string,
  fetchImpl: FetchImpl = defaultFetch,
): Promise<TikTokTokens> {
  const body = await oauthToken(cfg, { grant_type: "refresh_token", refresh_token: refreshToken }, fetchImpl);
  if (!body.refresh_token || !body.open_id) {
    throw new TikTokApiError(
      "Your TikTok connection expired and couldn't be refreshed. Reconnect it in Settings → Connected Accounts.",
      "refresh_failed",
    );
  }
  return {
    accessToken: body.access_token!,
    refreshToken: body.refresh_token,
    openId: body.open_id,
    expiresInSec: body.expires_in ?? 86400,
  };
}

export async function fetchTikTokUserInfo(
  accessToken: string,
  fetchImpl: FetchImpl = defaultFetch,
): Promise<{ openId: string; displayName: string }> {
  const res = await tiktokGet<{ data?: { user?: { open_id?: string; display_name?: string } } }>(
    "/user/info/",
    accessToken,
    { fields: "open_id,display_name,avatar_url" },
    fetchImpl,
  );
  const user = res.data?.user;
  if (!user?.open_id) throw new TikTokApiError("TikTok didn't return your profile. Try again.");
  return { openId: user.open_id, displayName: user.display_name ?? "" };
}

/* ── Inbox video upload (drafts tier) ──────────────────────────────────── */

export interface InboxInitResult {
  publishId: string;
  uploadUrl: string | null;
}

const CHUNK_SIZE = 8 * 1024 * 1024; // 8 MB — within TikTok's 5–64 MB chunk window

/** Plans chunking per TikTok's rules: total = floor(size/chunk), last chunk
    absorbs the remainder; files under 5 MB go as a single chunk. */
export function planChunks(videoSize: number): { chunkSize: number; totalChunks: number } {
  if (videoSize < 5 * 1024 * 1024) return { chunkSize: videoSize, totalChunks: 1 };
  const totalChunks = Math.max(1, Math.floor(videoSize / CHUNK_SIZE));
  return { chunkSize: CHUNK_SIZE, totalChunks };
}

/** POST /post/publish/inbox/video/init/ — drafts tier takes source_info only. */
export async function initInboxVideoUpload(
  accessToken: string,
  videoSize: number,
  fetchImpl: FetchImpl = defaultFetch,
): Promise<InboxInitResult> {
  const { chunkSize, totalChunks } = planChunks(videoSize);
  const res = await tiktokPost<{
    data?: { publish_id?: string; upload_url?: string };
  }>(
    "/post/publish/inbox/video/init/",
    accessToken,
    {
      source_info: {
        source: "FILE_UPLOAD",
        video_size: videoSize,
        chunk_size: chunkSize,
        total_chunk_count: totalChunks,
      },
    },
    fetchImpl,
  );
  const publishId = res.data?.publish_id;
  if (!publishId) throw new TikTokApiError("TikTok didn't start the upload. Please try again.");
  return { publishId, uploadUrl: res.data?.upload_url ?? null };
}

/** PUTs one chunk to the upload_url. Accepts 201 (complete) / 206 (partial). */
export async function putVideoChunk(
  uploadUrl: string,
  chunk: Buffer,
  firstByte: number,
  totalSize: number,
  fetchImpl: FetchImpl = defaultFetch,
): Promise<void> {
  const lastByte = firstByte + chunk.length - 1;
  const res = await fetchImpl(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(chunk.length),
      "Content-Range": `bytes ${firstByte}-${lastByte}/${totalSize}`,
    },
    // Buffer streams straight into fetch (undici accepts Uint8Array bodies).
    body: chunk,
  });
  if (res.status !== 201 && res.status !== 206) {
    logger.warn({ status: res.status }, "[social-tiktok] chunk upload failed");
    throw new TikTokApiError("The video upload to TikTok stalled. Please try again.", `chunk_http_${res.status}`);
  }
}

export type InboxStatus =
  | "PROCESSING_UPLOAD"
  | "PROCESSING_DOWNLOAD"
  | "SEND_TO_USER_INBOX"
  | "PUBLISH_COMPLETE"
  | "FAILED";

export async function fetchInboxStatus(
  publishId: string,
  accessToken: string,
  fetchImpl: FetchImpl = defaultFetch,
): Promise<{ status: InboxStatus; failReason?: string }> {
  const res = await tiktokPost<{
    data?: { status?: InboxStatus; fail_reason?: string };
  }>("/post/publish/status/fetch/", accessToken, { publish_id: publishId }, fetchImpl);
  const status = res.data?.status;
  if (!status) throw new TikTokApiError("TikTok didn't report an upload status. Please try again.");
  return { status, failReason: res.data?.fail_reason };
}

const POLL_INTERVAL_MS = 10_000;
const POLL_MAX_TRIES = 30; // ~5 minutes

/** Polls until the video reaches the creator's inbox (drafts-tier success) or fails. */
export async function pollInboxUntilReady(
  publishId: string,
  accessToken: string,
  fetchImpl: FetchImpl = defaultFetch,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<void> {
  for (let i = 0; i < POLL_MAX_TRIES; i++) {
    const { status, failReason } = await fetchInboxStatus(publishId, accessToken, fetchImpl);
    logger.info({ publishId, status, try: i + 1 }, "[social-tiktok] inbox poll");
    if (status === "SEND_TO_USER_INBOX") return; // drafts tier: waiting in the TikTok app inbox
    if (status === "PUBLISH_COMPLETE") return; // user already posted it from the inbox
    if (status === "FAILED") {
      throw new TikTokApiError(
        failReason
          ? `TikTok couldn't process the video (${failReason.replace(/_/g, " ")}). Try a different export.`
          : "TikTok couldn't process the video. Try a different export.",
        "inbox_failed",
      );
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new TikTokApiError("TikTok is taking too long to process the video. Check your TikTok inbox in a few minutes.");
}

export interface UploadDraftInput {
  accessToken: string;
  videoBytes: Buffer;
}

/** Full drafts-tier flow: init → chunked PUT → poll until inbox. */
export async function uploadDraftToTikTok(
  input: UploadDraftInput,
  fetchImpl: FetchImpl = defaultFetch,
  sleep?: (ms: number) => Promise<void>,
): Promise<{ publishId: string }> {
  const size = input.videoBytes.length;
  const { chunkSize } = planChunks(size);
  const { publishId, uploadUrl } = await initInboxVideoUpload(input.accessToken, size, fetchImpl);
  if (!uploadUrl) throw new TikTokApiError("TikTok didn't return an upload URL. Please try again.");
  let offset = 0;
  while (offset < size) {
    const chunk = input.videoBytes.subarray(offset, Math.min(offset + chunkSize, size));
    await putVideoChunk(uploadUrl, chunk, offset, size, fetchImpl);
    offset += chunk.length;
  }
  await pollInboxUntilReady(publishId, input.accessToken, fetchImpl, sleep);
  return { publishId };
}

/** Downloads a video URL into memory with a hard size cap. */
export async function downloadVideoBytes(url: string, maxBytes: number): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok || !res.body) {
    throw new TikTokApiError("Couldn't download the video for upload. Try exporting again.");
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      throw new TikTokApiError(
        `That video is too large to send to TikTok (${Math.round(maxBytes / 1024 / 1024)} MB cap).`,
      );
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
