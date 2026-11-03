import { logger } from "./logger";
import { generateCodeVerifier, codeChallengeS256 } from "./social-x";

/* Too Lost distribution partner API — OAuth half (connect flow only).
   Mirrors the social-x.ts house pattern: every network function takes an
   optional `fetchImpl` so tests inject a mock — no live calls and no
   credentials are ever needed to test this module. No tokens are ever
   logged; error messages are sanitized for users.

   Release submission is deliberately NOT here — that is the next lane
   (the release metadata call carries their AI-declaration fields
   `isAiGenerated` + `aiDocumentation`, which belong to that lane's
   design, not to the connect flow).

   Endpoints (verified against developer.toolost.com/docs, 2026-11-03):
   - OAuth 2.0 Authorization Code, confidential client + PKCE S256
     (PKCE is required for public clients and recommended for all;
     the verifier minted here never leaves the server — only its
     S256 challenge rides the authorize URL, same as the X flow):
       authorize  GET  https://toolost.com/oauth/authorize
       token      POST https://toolost.com/oauth/token
                  (form body: grant_type, client_id, client_secret,
                   redirect_uri, code, code_verifier)
   - API base:  https://api.toolost.com/v1
   - Profile:   GET  https://api.toolost.com/v1/me   (scope read:profile)
   Scopes requested (the app-request set):
     read:profile read:catalog write:releases read:analytics read:earnings
   Token lifetimes per their docs: access 15 days, refresh 30 days. */

const TOOLOST_API = "https://api.toolost.com/v1";
const TOOLOST_AUTHORIZE = "https://toolost.com/oauth/authorize";
const TOOLOST_TOKEN = "https://toolost.com/oauth/token";

export type FetchImpl = (
  url: string,
  init?: Omit<RequestInit, "body"> & { body?: unknown },
) => Promise<Response>;

/* defaultFetch adapts FetchImpl's loosely-typed body to the real fetch. */
const defaultFetch: FetchImpl = (url, init) => fetch(url, init as RequestInit);

/** Error from the Too Lost API with a user-facing message. */
export class TooLostApiError extends Error {
  readonly userMessage: string;
  readonly toolostStatus?: number;
  constructor(userMessage: string, toolostStatus?: number, detail?: string) {
    super(detail ? `${userMessage} (${detail})` : userMessage);
    this.name = "TooLostApiError";
    this.userMessage = userMessage;
    this.toolostStatus = toolostStatus;
  }
}

/* ── Config (env-only; nothing is ever hardcoded) ──────────────────────── */

export interface ToolostOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function toolostConfigured(): boolean {
  return Boolean(process.env["TOOLOST_CLIENT_ID"] && process.env["TOOLOST_CLIENT_SECRET"]);
}

export function toolostRedirectUri(): string {
  return process.env["TOOLOST_REDIRECT_URI"] ?? "https://bowdownvisuals.com/api/distribution/toolost/callback";
}

/** Full OAuth config, or null when the integration is unconfigured —
    callers turn null into the honest "not configured" state. */
export function toolostOAuthConfig(): ToolostOAuthConfig | null {
  const clientId = process.env["TOOLOST_CLIENT_ID"];
  const clientSecret = process.env["TOOLOST_CLIENT_SECRET"];
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, redirectUri: toolostRedirectUri() };
}

/* ── PKCE (helpers live in social-x.ts; re-exported for this surface) ──── */

export { generateCodeVerifier, codeChallengeS256 };

/* ── OAuth (Authorization Code + PKCE) ─────────────────────────────────── */

export const TOOLOST_SCOPES = "read:profile read:catalog write:releases read:analytics read:earnings";

/** Builds the Too Lost authorize URL with the PKCE S256 challenge. */
export function buildToolostAuthUrl(cfg: ToolostOAuthConfig, state: string, codeChallenge: string): string {
  const qs = new URLSearchParams({
    response_type: "code",
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    scope: TOOLOST_SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `${TOOLOST_AUTHORIZE}?${qs.toString()}`;
}

interface ToolostTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  error?: string;
  error_description?: string;
  message?: string;
}

export interface ToolostTokens {
  accessToken: string;
  refreshToken: string;
  expiresInSec: number;
}

/* Their docs put the client credentials in the form body (not a Basic
   header — that is Spotify/X style, not theirs). */
async function oauthToken(
  cfg: ToolostOAuthConfig,
  params: Record<string, string>,
  fetchImpl: FetchImpl,
): Promise<ToolostTokenResponse> {
  const res = await fetchImpl(TOOLOST_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, ...params }).toString(),
  });
  const body = (await res.json().catch(() => ({}))) as ToolostTokenResponse;
  if (!res.ok || body.error || !body.access_token) {
    logger.warn({ oauthError: body.error, status: res.status }, "[toolost] OAuth token exchange failed");
    throw new TooLostApiError(
      "Too Lost refused the connection. Try again, and make sure you approved the access request.",
      res.status,
      body.error ?? "oauth/token",
    );
  }
  return body;
}

function toTokens(body: ToolostTokenResponse, presentedRefreshToken?: string): ToolostTokens {
  if (!body.refresh_token && !presentedRefreshToken) {
    /* A connection whose refresh token is missing dies at the 15-day
       access-token mark with no way back — fail the connect honestly
       instead of storing an account that silently expires. */
    throw new TooLostApiError(
      "Too Lost didn't return a refresh token, so the connection wouldn't last. Try connecting again.",
      undefined,
      "oauth/token missing refresh_token",
    );
  }
  return {
    accessToken: body.access_token!,
    /* Their docs don't promise rotation on refresh; when a refresh
       response omits a new refresh token, the presented one stands. */
    refreshToken: body.refresh_token ?? presentedRefreshToken!,
    expiresInSec: body.expires_in ?? 1_296_000, // 15 days, per their docs
  };
}

/** Authorization code (+ PKCE verifier) → access + refresh tokens. */
export async function exchangeCodeForToolostTokens(
  cfg: ToolostOAuthConfig,
  code: string,
  codeVerifier: string,
  fetchImpl: FetchImpl = defaultFetch,
): Promise<ToolostTokens> {
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
  return toTokens(body);
}

/** Refreshes an expired access token. Callers must persist both returned
    values (the refresh token may or may not have rotated). */
export async function refreshToolostTokens(
  cfg: ToolostOAuthConfig,
  refreshToken: string,
  fetchImpl: FetchImpl = defaultFetch,
): Promise<ToolostTokens> {
  const body = await oauthToken(cfg, { grant_type: "refresh_token", refresh_token: refreshToken }, fetchImpl).catch(
    (err) => {
      if (err instanceof TooLostApiError) {
        throw new TooLostApiError(
          "Your Too Lost connection expired and couldn't be refreshed. Reconnect it from the Distribute page.",
          err.toolostStatus,
          "refresh_failed",
        );
      }
      throw err;
    },
  );
  return toTokens(body, refreshToken);
}

/* ── Profile ───────────────────────────────────────────────────────────── */

export interface ToolostProfile {
  providerUserId: string | null;
  displayName: string | null;
}

/** GET /v1/me — best-effort identity for the stored account row. The
    connect itself is proven by the token exchange; a profile hiccup
    must not strand a valid connection (the Spotify callback in
    distribution-legacy.ts is tolerant the same way). The docs don't
    publish the /me body shape, so every field is read defensively. */
export async function fetchToolostProfile(
  accessToken: string,
  fetchImpl: FetchImpl = defaultFetch,
): Promise<ToolostProfile> {
  try {
    const res = await fetchImpl(`${TOOLOST_API}/me`, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return { providerUserId: null, displayName: null };
    const body = (await res.json().catch(() => ({}))) as {
      id?: string | number;
      display_name?: string;
      displayName?: string;
      name?: string;
      username?: string;
      email?: string;
      user?: { id?: string | number; display_name?: string; name?: string; username?: string };
    };
    const u = body.user;
    const id = u?.id ?? body.id;
    return {
      providerUserId: id !== undefined && id !== null ? String(id) : null,
      displayName:
        u?.display_name ?? u?.name ?? u?.username ??
        body.display_name ?? body.displayName ?? body.name ?? body.username ?? body.email ?? null,
    };
  } catch (err) {
    logger.warn({ err }, "[toolost] profile fetch failed (connection still stored)");
    return { providerUserId: null, displayName: null };
  }
}
