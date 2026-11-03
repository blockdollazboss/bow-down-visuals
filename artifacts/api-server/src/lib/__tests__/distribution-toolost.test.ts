import { describe, it, expect, vi, afterEach } from "vitest";
import {
  buildToolostAuthUrl,
  generateCodeVerifier,
  codeChallengeS256,
  exchangeCodeForToolostTokens,
  refreshToolostTokens,
  fetchToolostProfile,
  toolostConfigured,
  toolostOAuthConfig,
  toolostRedirectUri,
  TOOLOST_SCOPES,
  TooLostApiError,
  type FetchImpl,
} from "../distribution-toolost";

/* Queued mock fetch: each call consumes the next { status, body }.
   Mirrors social-x.test.ts — no live calls, no credentials. */
function mockFetch(queue: Array<{ status?: number; body?: unknown }>): FetchImpl {
  return vi.fn(async () => {
    const next = queue.shift();
    if (!next) throw new Error("mockFetch: out of queued responses");
    const status = next.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => next.body ?? {},
    } as Response;
  });
}

const CFG = {
  clientId: "tl-client-1",
  clientSecret: "tl-secret-1",
  redirectUri: "https://bowdownvisuals.com/api/distribution/toolost/callback",
};

describe("PKCE (shared house helpers, Too Lost surface)", () => {
  it("generates verifiers in the RFC 7636 unreserved set, 43–128 chars", () => {
    for (let i = 0; i < 20; i++) {
      const v = generateCodeVerifier();
      expect(v.length).toBeGreaterThanOrEqual(43);
      expect(v.length).toBeLessThanOrEqual(128);
      expect(v).toMatch(/^[A-Za-z0-9\-_~.]+$/);
    }
    expect(generateCodeVerifier()).not.toBe(generateCodeVerifier());
  });

  it("computes the S256 challenge (RFC 7636 appendix B vector)", () => {
    expect(codeChallengeS256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });
});

describe("buildToolostAuthUrl", () => {
  it("points at Too Lost's authorize with PKCE + the app-request scopes", () => {
    const url = buildToolostAuthUrl(CFG, "state-xyz", "challenge-1");
    expect(url).toContain("https://toolost.com/oauth/authorize");
    expect(url).toContain("response_type=code");
    expect(url).toContain("client_id=tl-client-1");
    expect(url).toContain(`redirect_uri=${encodeURIComponent(CFG.redirectUri)}`);
    expect(new URL(url).searchParams.get("scope")).toBe(
      "read:profile read:catalog write:releases read:analytics read:earnings",
    );
    expect(TOOLOST_SCOPES).toBe("read:profile read:catalog write:releases read:analytics read:earnings");
    expect(url).toContain("state=state-xyz");
    expect(url).toContain("code_challenge=challenge-1");
    expect(url).toContain("code_challenge_method=S256");
    /* The client secret never rides the authorize URL. */
    expect(url).not.toContain("tl-secret-1");
  });
});

describe("exchangeCodeForToolostTokens", () => {
  it("posts the code grant as a form body (client credentials included) with the code_verifier, and parses tokens", async () => {
    const fetchImpl = mockFetch([
      { body: { access_token: "at-1", refresh_token: "rt-1", expires_in: 1296000, token_type: "Bearer" } },
    ]);
    const tokens = await exchangeCodeForToolostTokens(CFG, "code-1", "verifier-1", fetchImpl);
    expect(tokens).toEqual({ accessToken: "at-1", refreshToken: "rt-1", expiresInSec: 1296000 });
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://toolost.com/oauth/token");
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    /* Their docs put credentials in the form body, not a Basic header. */
    expect(headers.Authorization).toBeUndefined();
    const form = new URLSearchParams(init.body as string);
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("code")).toBe("code-1");
    expect(form.get("code_verifier")).toBe("verifier-1");
    expect(form.get("redirect_uri")).toBe(CFG.redirectUri);
    expect(form.get("client_id")).toBe("tl-client-1");
    expect(form.get("client_secret")).toBe("tl-secret-1");
  });

  it("defaults expiresInSec to 1296000 (15 days per their docs) when omitted", async () => {
    const fetchImpl = mockFetch([{ body: { access_token: "at-1", refresh_token: "rt-1" } }]);
    const tokens = await exchangeCodeForToolostTokens(CFG, "code-1", "v", fetchImpl);
    expect(tokens.expiresInSec).toBe(1296000);
  });

  it("fails honestly when Too Lost returns no refresh token (connection wouldn't last)", async () => {
    const fetchImpl = mockFetch([{ body: { access_token: "at-1" } }]);
    await expect(exchangeCodeForToolostTokens(CFG, "code-1", "v", fetchImpl)).rejects.toBeInstanceOf(TooLostApiError);
  });

  it("maps a refused exchange to a plain user message, never the raw payload", async () => {
    const fetchImpl = mockFetch([{ status: 400, body: { error: "invalid_grant", error_description: "code expired" } }]);
    const err = await exchangeCodeForToolostTokens(CFG, "code-1", "v", fetchImpl).catch((e) => e);
    expect(err).toBeInstanceOf(TooLostApiError);
    expect(err.userMessage).toContain("Too Lost refused the connection");
    expect(err.userMessage).not.toContain("invalid_grant");
    expect(err.toolostStatus).toBe(400);
  });
});

describe("refreshToolostTokens", () => {
  it("posts the refresh grant and parses the new pair", async () => {
    const fetchImpl = mockFetch([{ body: { access_token: "at-2", refresh_token: "rt-2", expires_in: 1296000 } }]);
    const tokens = await refreshToolostTokens(CFG, "rt-1", fetchImpl);
    expect(tokens).toEqual({ accessToken: "at-2", refreshToken: "rt-2", expiresInSec: 1296000 });
    const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const form = new URLSearchParams(init.body as string);
    expect(form.get("grant_type")).toBe("refresh_token");
    expect(form.get("refresh_token")).toBe("rt-1");
  });

  it("keeps the presented refresh token when the response doesn't rotate it", async () => {
    const fetchImpl = mockFetch([{ body: { access_token: "at-2", expires_in: 1296000 } }]);
    const tokens = await refreshToolostTokens(CFG, "rt-1", fetchImpl);
    expect(tokens.refreshToken).toBe("rt-1");
  });

  it("tells the user to reconnect when the refresh is refused", async () => {
    const fetchImpl = mockFetch([{ status: 400, body: { error: "invalid_grant" } }]);
    const err = await refreshToolostTokens(CFG, "rt-1", fetchImpl).catch((e) => e);
    expect(err).toBeInstanceOf(TooLostApiError);
    expect(err.userMessage).toContain("Reconnect it");
  });
});

describe("fetchToolostProfile", () => {
  it("reads id + display name from /v1/me with the bearer token", async () => {
    const fetchImpl = mockFetch([{ body: { id: 4242, display_name: "Creator One" } }]);
    const profile = await fetchToolostProfile("at-1", fetchImpl);
    expect(profile).toEqual({ providerUserId: "4242", displayName: "Creator One" });
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.toolost.com/v1/me");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer at-1");
  });

  it("tolerates a nested user object and alternate name fields", async () => {
    const fetchImpl = mockFetch([{ body: { user: { id: "u-9", username: "creatornine" } } }]);
    await expect(fetchToolostProfile("at-1", fetchImpl)).resolves.toEqual({
      providerUserId: "u-9",
      displayName: "creatornine",
    });
  });

  it("returns nulls (never throws) when the profile call fails — the connection still stands", async () => {
    const fetchImpl = mockFetch([{ status: 500, body: { message: "boom" } }]);
    await expect(fetchToolostProfile("at-1", fetchImpl)).resolves.toEqual({
      providerUserId: null,
      displayName: null,
    });
  });
});

describe("config (env-only)", () => {
  const KEYS = ["TOOLOST_CLIENT_ID", "TOOLOST_CLIENT_SECRET", "TOOLOST_REDIRECT_URI"] as const;
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("is unconfigured until both id and secret are set", () => {
    delete process.env["TOOLOST_CLIENT_ID"];
    delete process.env["TOOLOST_CLIENT_SECRET"];
    expect(toolostConfigured()).toBe(false);
    expect(toolostOAuthConfig()).toBeNull();
    process.env["TOOLOST_CLIENT_ID"] = "only-id";
    expect(toolostConfigured()).toBe(false);
    expect(toolostOAuthConfig()).toBeNull();
    process.env["TOOLOST_CLIENT_SECRET"] = "only-secret";
    expect(toolostConfigured()).toBe(true);
    expect(toolostOAuthConfig()).toMatchObject({ clientId: "only-id", clientSecret: "only-secret" });
  });

  it("defaults the redirect URI to the registered production callback", () => {
    delete process.env["TOOLOST_REDIRECT_URI"];
    expect(toolostRedirectUri()).toBe("https://bowdownvisuals.com/api/distribution/toolost/callback");
    process.env["TOOLOST_REDIRECT_URI"] = "https://staging.test/api/distribution/toolost/callback";
    expect(toolostRedirectUri()).toBe("https://staging.test/api/distribution/toolost/callback");
  });
});
