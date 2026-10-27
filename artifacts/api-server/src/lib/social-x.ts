import { createHash, randomBytes } from "node:crypto";
import { logger } from "./logger";

/* Thin X (Twitter) API v2 client for auto-posting (Wave-4 #42).
   Mirrors the social-tiktok.ts / social-meta.ts house pattern: every
   function takes an optional `fetchImpl` so tests inject a mock — no
   live calls and no credentials are ever needed to test this module.
   No tokens are ever logged; error messages are sanitized for users.

   Endpoints (X API v2, verified against developer.x.com docs):
   - OAuth2 + PKCE (REQUIRED by X — plain code flow is refused):
       authorize  https://twitter.com/i/oauth2/authorize
       token      POST https://api.twitter.com/2/oauth2/token
                  (form body + HTTP Basic client auth; code_verifier)
   - User:   GET  https://api.twitter.com/2/users/me
   - Post:   POST https://api.twitter.com/2/tweets  { text, media }
   - Media:  POST https://api.twitter.com/2/media/upload
                  (INIT → APPEND ×n → FINALIZE, multipart form)
             GET  https://api.twitter.com/2/media/upload?command=STATUS
   Scopes: tweet.read tweet.write users.read offline.access
   (offline.access is what earns a refresh_token; X user access
   tokens live ~2h and the refresh token ROTATES on use). */

const X_API = "https://api.twitter.com/2";
const X_AUTHORIZE = "https://twitter.com/i/oauth2/authorize";

export type FetchImpl = (
  url: string,
  init?: Omit<RequestInit, "body"> & { body?: unknown },
) => Promise<Response>;

/* defaultFetch adapts FetchImpl's loosely-typed body to the real fetch. */
const defaultFetch: FetchImpl = (url, init) => fetch(url, init as RequestInit);

/** Error from the X API with a user-facing message. */
export class XApiError extends Error {
  readonly userMessage: string;
  readonly xStatus?: number;
  constructor(userMessage: string, xStatus?: number, detail?: string) {
    super(detail ? `${userMessage} (${detail})` : userMessage);
    this.name = "XApiError";
    this.userMessage = userMessage;
    this.xStatus = xStatus;
  }
}

/** X caps a standard post at 280 characters. We count Unicode code
    points; X's own weighted counting (CJK/emoji count double) can only
    make the real limit stricter, and a weighted overflow surfaces as a
    mapped 403 below — never as a silent truncation. */
export const TWEET_MAX_CHARS = 280;

export function tweetCharCount(text: string): number {
  return [...text].length;
}

export function assertValidTweetText(text: string): void {
  const trimmed = text.trim();
  if (!trimmed) throw new XApiError("Write something to post to X first.");
  if (tweetCharCount(trimmed) > TWEET_MAX_CHARS) {
    throw new XApiError(
      `X posts cap at ${TWEET_MAX_CHARS} characters — this one is ${tweetCharCount(trimmed)}. Shorten it and try again.`,
    );
  }
}

/* ── PKCE ──────────────────────────────────────────────────────────────── */

function base64Url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** RFC 7636 code verifier: 43–128 chars from the unreserved set. */
export function generateCodeVerifier(): string {
  return base64Url(randomBytes(48));
}

/** S256 challenge: BASE64URL(SHA256(verifier)). */
export function codeChallengeS256(verifier: string): string {
  return base64Url(createHash("sha256").update(verifier, "ascii").digest());
}

/* ── OAuth (Authorization Code + PKCE) ─────────────────────────────────── */

export interface XOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export const X_SCOPES = "tweet.read tweet.write users.read offline.access";

/** Builds the X OAuth 2.0 authorize URL with the PKCE S256 challenge. */
export function buildXAuthUrl(cfg: XOAuthConfig, state: string, codeChallenge: string): string {
  const qs = new URLSearchParams({
    response_type: "code",
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    scope: X_SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `${X_AUTHORIZE}?${qs.toString()}`;
}

interface XTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

export interface XTokens {
  accessToken: string;
  refreshToken: string;
  expiresInSec: number;
}

async function oauthToken(
  cfg: XOAuthConfig,
  params: Record<string, string>,
  fetchImpl: FetchImpl,
): Promise<XTokenResponse> {
  const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`, "utf8").toString("base64");
  const res = await fetchImpl(`${X_API}/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams(params).toString(),
  });
  const body = (await res.json().catch(() => ({}))) as XTokenResponse;
  if (!res.ok || body.error || !body.access_token) {
    logger.warn({ oauthError: body.error, status: res.status }, "[social-x] OAuth token exchange failed");
    throw new XApiError(
      "X refused the connection. Try again, and make sure you approved posting permission.",
      res.status,
      body.error ?? "oauth/token",
    );
  }
  return body;
}

function toTokens(body: XTokenResponse, context: string): XTokens {
  if (!body.refresh_token) {
    /* Without offline.access X returns no refresh token and the
       connection would die in ~2h with no way back — fail the connect
       honestly instead of storing a zombie account. */
    throw new XApiError(
      "X didn't return a refresh token, so the connection wouldn't last. Try connecting again.",
      undefined,
      context,
    );
  }
  return {
    accessToken: body.access_token!,
    refreshToken: body.refresh_token,
    expiresInSec: body.expires_in ?? 7200, // X user tokens live ~2h
  };
}

/** Authorization code (+ PKCE verifier) → access + refresh tokens. */
export async function exchangeCodeForXTokens(
  cfg: XOAuthConfig,
  code: string,
  codeVerifier: string,
  fetchImpl: FetchImpl = defaultFetch,
): Promise<XTokens> {
  const body = await oauthToken(
    cfg,
    {
      grant_type: "authorization_code",
      code,
      redirect_uri: cfg.redirectUri,
      code_verifier: codeVerifier,
    },
    fetchImpl,
  );
  return toTokens(body, "oauth/token exchange");
}

/** Refreshes an expired access token. X ROTATES the refresh token —
    callers must persist both new values. */
export async function refreshXTokens(
  cfg: XOAuthConfig,
  refreshToken: string,
  fetchImpl: FetchImpl = defaultFetch,
): Promise<XTokens> {
  const body = await oauthToken(cfg, { grant_type: "refresh_token", refresh_token: refreshToken }, fetchImpl).catch(
    (err) => {
      if (err instanceof XApiError) {
        throw new XApiError(
          "Your X connection expired and couldn't be refreshed. Reconnect it in Settings → Connected Accounts.",
          err.xStatus,
          "refresh_failed",
        );
      }
      throw err;
    },
  );
  return toTokens(body, "oauth/token refresh");
}

/* ── API helpers ───────────────────────────────────────────────────────── */

interface XErrorEnvelope {
  errors?: Array<{ message?: string; code?: number }>;
  title?: string;
  detail?: string;
  status?: number;
}

function userMessageFor(status: number, body: XErrorEnvelope): string {
  const detail = body.detail ?? body.errors?.[0]?.message ?? "";
  if (status === 401) {
    return "Your X connection expired. Reconnect it in Settings → Connected Accounts.";
  }
  if (status === 403 && /duplicate/i.test(detail)) {
    return "X refused this post because it's a duplicate of a recent post. Change the text and try again.";
  }
  if (status === 403) {
    return "X refused the post — the connected account may lack posting permission, or the app is set to read-only. Reconnect it in Settings.";
  }
  if (status === 429) {
    return "X is rate-limiting posts right now. Wait a few minutes and try again.";
  }
  return detail
    ? `X said: ${detail.slice(0, 180)}`
    : "X returned an error. Please try again.";
}

async function xFetch<T>(
  path: string,
  accessToken: string,
  init: { method: string; body?: unknown; contentType?: string },
  fetchImpl: FetchImpl,
): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` };
  if (init.contentType) headers["Content-Type"] = init.contentType;
  const res = await fetchImpl(`${X_API}${path}`, { method: init.method, headers, body: init.body });
  const parsed = (await res.json().catch(() => ({}))) as XErrorEnvelope & T;
  if (!res.ok) {
    logger.warn({ path, status: res.status }, "[social-x] X API error");
    throw new XApiError(userMessageFor(res.status, parsed), res.status, path);
  }
  return parsed as T;
}

/* ── User ──────────────────────────────────────────────────────────────── */

export async function fetchXUserInfo(
  accessToken: string,
  fetchImpl: FetchImpl = defaultFetch,
): Promise<{ userId: string; username: string; displayName: string }> {
  const res = await xFetch<{ data?: { id?: string; username?: string; name?: string } }>(
    "/users/me",
    accessToken,
    { method: "GET" },
    fetchImpl,
  );
  const user = res.data;
  if (!user?.id) throw new XApiError("X didn't return your profile. Try again.");
  return { userId: user.id, username: user.username ?? "", displayName: user.name ?? "" };
}

/* ── Posting ───────────────────────────────────────────────────────────── */

export function tweetPermalink(username: string, tweetId: string): string {
  return username ? `https://x.com/${username}/status/${tweetId}` : `https://x.com/i/status/${tweetId}`;
}

/** POST /2/tweets — text-only, or with already-uploaded media ids. */
export async function postTweet(
  accessToken: string,
  input: { text: string; mediaIds?: string[] },
  fetchImpl: FetchImpl = defaultFetch,
): Promise<{ tweetId: string }> {
  assertValidTweetText(input.text);
  const payload: Record<string, unknown> = { text: input.text.trim() };
  if (input.mediaIds && input.mediaIds.length > 0) payload["media"] = { media_ids: input.mediaIds };
  const res = await xFetch<{ data?: { id?: string; text?: string } }>(
    "/tweets",
    accessToken,
    { method: "POST", contentType: "application/json", body: JSON.stringify(payload) },
    fetchImpl,
  );
  const tweetId = res.data?.id;
  if (!tweetId) throw new XApiError("X didn't confirm the post. Please try again.");
  return { tweetId };
}

/* ── Media upload (chunked, mirrors TikTok's init → chunks → poll) ─────── */

export const MEDIA_SEGMENT_SIZE = 5 * 1024 * 1024; // X recommends ≤5 MB APPEND segments

/** Plans APPEND segments: every segment ≤5 MB, final one absorbs the remainder. */
export function planMediaSegments(totalBytes: number): { segmentSize: number; totalSegments: number } {
  if (totalBytes <= MEDIA_SEGMENT_SIZE) return { segmentSize: totalBytes, totalSegments: 1 };
  const totalSegments = Math.ceil(totalBytes / MEDIA_SEGMENT_SIZE);
  return { segmentSize: MEDIA_SEGMENT_SIZE, totalSegments };
}

export type XMediaCategory = "tweet_video" | "tweet_image" | "tweet_gif";

interface MediaUploadBody {
  data?: { id?: string; media_key?: string; processing_info?: ProcessingInfo };
  media_id_string?: string;
  processing_info?: ProcessingInfo;
}

interface ProcessingInfo {
  state?: "pending" | "in_progress" | "succeeded" | "failed";
  check_after_secs?: number;
  progress_percent?: number;
  error?: { message?: string };
}

function readMediaId(body: MediaUploadBody): string | null {
  return body.data?.id ?? body.media_id_string ?? null;
}

function readProcessingInfo(body: MediaUploadBody): ProcessingInfo | undefined {
  return body.data?.processing_info ?? body.processing_info;
}

function formBody(fields: Record<string, string>, mediaChunk?: Buffer): unknown {
  /* Real calls send multipart form data (X's media upload requires it);
     under the FetchImpl test seam the fields ride as a FormData the mock
     can inspect. */
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  if (mediaChunk) form.set("media", new Blob([new Uint8Array(mediaChunk)]));
  return form;
}

async function mediaFormPost<T>(
  accessToken: string,
  fields: Record<string, string>,
  fetchImpl: FetchImpl,
  mediaChunk?: Buffer,
): Promise<T> {
  const res = await fetchImpl(`${X_API}/media/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: formBody(fields, mediaChunk),
  });
  const parsed = (await res.json().catch(() => ({}))) as XErrorEnvelope & T;
  if (!res.ok) {
    logger.warn({ status: res.status, command: fields["command"] }, "[social-x] media upload error");
    throw new XApiError(userMessageFor(res.status, parsed), res.status, `media/upload ${fields["command"]}`);
  }
  return parsed as T;
}

/** INIT — declares the media; returns the media id. */
export async function initMediaUpload(
  accessToken: string,
  input: { totalBytes: number; mediaType: string; mediaCategory: XMediaCategory },
  fetchImpl: FetchImpl = defaultFetch,
): Promise<string> {
  const res = await mediaFormPost<MediaUploadBody>(
    accessToken,
    {
      command: "INIT",
      total_bytes: String(input.totalBytes),
      media_type: input.mediaType,
      media_category: input.mediaCategory,
    },
    fetchImpl,
  );
  const mediaId = readMediaId(res);
  if (!mediaId) throw new XApiError("X didn't start the media upload. Please try again.");
  return mediaId;
}

/** APPEND — one segment. X answers 200/201/204 with an empty body. */
export async function appendMediaSegment(
  accessToken: string,
  mediaId: string,
  segmentIndex: number,
  chunk: Buffer,
  fetchImpl: FetchImpl = defaultFetch,
): Promise<void> {
  const res = await fetchImpl(`${X_API}/media/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: formBody({ command: "APPEND", media_id: mediaId, segment_index: String(segmentIndex) }, chunk),
  });
  if (res.status !== 200 && res.status !== 201 && res.status !== 204) {
    const parsed = (await res.json().catch(() => ({}))) as XErrorEnvelope;
    logger.warn({ status: res.status }, "[social-x] media APPEND failed");
    throw new XApiError(userMessageFor(res.status, parsed), res.status, "media/upload APPEND");
  }
}

/** FINALIZE — returns processing_info when X still needs to process. */
export async function finalizeMediaUpload(
  accessToken: string,
  mediaId: string,
  fetchImpl: FetchImpl = defaultFetch,
): Promise<ProcessingInfo | undefined> {
  const res = await mediaFormPost<MediaUploadBody>(accessToken, { command: "FINALIZE", media_id: mediaId }, fetchImpl);
  return readProcessingInfo(res);
}

/** STATUS — poll target while processing_info.state isn't terminal. */
export async function fetchMediaStatus(
  accessToken: string,
  mediaId: string,
  fetchImpl: FetchImpl = defaultFetch,
): Promise<ProcessingInfo | undefined> {
  const qs = new URLSearchParams({ command: "STATUS", media_id: mediaId }).toString();
  const res = await xFetch<MediaUploadBody>(`/media/upload?${qs}`, accessToken, { method: "GET" }, fetchImpl);
  return readProcessingInfo(res);
}

const MEDIA_POLL_MAX_TRIES = 30;

/** Polls until X finishes processing the media (or fails). No-op when
    FINALIZE already reported succeeded / returned no processing_info. */
export async function pollMediaUntilReady(
  accessToken: string,
  mediaId: string,
  initial: ProcessingInfo | undefined,
  fetchImpl: FetchImpl = defaultFetch,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<void> {
  let info = initial;
  for (let i = 0; i < MEDIA_POLL_MAX_TRIES; i++) {
    if (!info || info.state === "succeeded") return;
    if (info.state === "failed") {
      throw new XApiError(
        info.error?.message
          ? `X couldn't process the media (${info.error.message.slice(0, 120)}). Try a different export.`
          : "X couldn't process the media. Try a different export.",
      );
    }
    await sleep(Math.max(1, info.check_after_secs ?? 5) * 1000);
    info = await fetchMediaStatus(accessToken, mediaId, fetchImpl);
    logger.info({ mediaId, state: info?.state, try: i + 1 }, "[social-x] media poll");
  }
  throw new XApiError("X is taking too long to process the media. Try again in a few minutes.");
}

/** Full chunked upload: INIT → APPEND ×n → FINALIZE → poll. */
export async function uploadMediaToX(
  input: { accessToken: string; bytes: Buffer; mediaType: string; mediaCategory: XMediaCategory },
  fetchImpl: FetchImpl = defaultFetch,
  sleep?: (ms: number) => Promise<void>,
): Promise<{ mediaId: string }> {
  const size = input.bytes.length;
  if (size === 0) throw new XApiError("The media file is empty — export it again, then repost.");
  const { segmentSize, totalSegments } = planMediaSegments(size);
  const mediaId = await initMediaUpload(
    input.accessToken,
    { totalBytes: size, mediaType: input.mediaType, mediaCategory: input.mediaCategory },
    fetchImpl,
  );
  let offset = 0;
  for (let i = 0; i < totalSegments; i++) {
    const end = i === totalSegments - 1 ? size : offset + segmentSize;
    await appendMediaSegment(input.accessToken, mediaId, i, input.bytes.subarray(offset, end), fetchImpl);
    offset = end;
  }
  const info = await finalizeMediaUpload(input.accessToken, mediaId, fetchImpl);
  await pollMediaUntilReady(input.accessToken, mediaId, info, fetchImpl, sleep);
  return { mediaId };
}

export interface PublishToXInput {
  accessToken: string;
  text: string;
  mediaBytes?: Buffer;
  mediaType?: string;
  mediaCategory?: XMediaCategory;
  username?: string;
}

/** Full publish flow: optional media upload, then the tweet itself. */
export async function publishToX(
  input: PublishToXInput,
  fetchImpl: FetchImpl = defaultFetch,
  sleep?: (ms: number) => Promise<void>,
): Promise<{ tweetId: string; permalink: string }> {
  assertValidTweetText(input.text);
  let mediaIds: string[] | undefined;
  if (input.mediaBytes && input.mediaBytes.length > 0) {
    const { mediaId } = await uploadMediaToX(
      {
        accessToken: input.accessToken,
        bytes: input.mediaBytes,
        mediaType: input.mediaType ?? "video/mp4",
        mediaCategory: input.mediaCategory ?? "tweet_video",
      },
      fetchImpl,
      sleep,
    );
    mediaIds = [mediaId];
  }
  const { tweetId } = await postTweet(input.accessToken, { text: input.text, mediaIds }, fetchImpl);
  return { tweetId, permalink: tweetPermalink(input.username ?? "", tweetId) };
}

/** Downloads a media URL into memory with a hard size cap (mirrors TikTok's). */
export async function downloadMediaBytes(url: string, maxBytes: number): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok || !res.body) {
    throw new XApiError("Couldn't download the media for upload. Try exporting again.");
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      throw new XApiError(`That file is too large to send to X (${Math.round(maxBytes / 1024 / 1024)} MB cap).`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
