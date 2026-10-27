import { describe, it, expect, vi } from "vitest";
import {
  buildXAuthUrl,
  generateCodeVerifier,
  codeChallengeS256,
  exchangeCodeForXTokens,
  refreshXTokens,
  fetchXUserInfo,
  postTweet,
  tweetPermalink,
  tweetCharCount,
  assertValidTweetText,
  TWEET_MAX_CHARS,
  planMediaSegments,
  MEDIA_SEGMENT_SIZE,
  initMediaUpload,
  appendMediaSegment,
  uploadMediaToX,
  publishToX,
  XApiError,
  type FetchImpl,
} from "../social-x";

/* Queued mock fetch: each call consumes the next { status, body }.
   Mirrors social-tiktok.test.ts — no live calls, no credentials. */
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

const noSleep = async () => {};
const CFG = { clientId: "cid-1", clientSecret: "csecret-1", redirectUri: "https://x.test/api/social/x/callback" };

describe("PKCE", () => {
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

describe("buildXAuthUrl", () => {
  it("points at X's OAuth2 authorize with PKCE + offline.access", () => {
    const url = buildXAuthUrl(CFG, "state-xyz", "challenge-1");
    expect(url).toContain("https://twitter.com/i/oauth2/authorize");
    expect(url).toContain("response_type=code");
    expect(url).toContain("client_id=cid-1");
    expect(url).toContain(`redirect_uri=${encodeURIComponent(CFG.redirectUri)}`);
    expect(new URL(url).searchParams.get("scope")).toBe("tweet.read tweet.write users.read offline.access");
    expect(url).toContain("state=state-xyz");
    expect(url).toContain("code_challenge=challenge-1");
    expect(url).toContain("code_challenge_method=S256");
  });
});

describe("exchangeCodeForXTokens", () => {
  it("posts the code grant with Basic client auth + code_verifier and parses tokens", async () => {
    const fetchImpl = mockFetch([
      { body: { access_token: "at-1", refresh_token: "rt-1", expires_in: 7200, token_type: "bearer" } },
    ]);
    const tokens = await exchangeCodeForXTokens(CFG, "code-1", "verifier-1", fetchImpl);
    expect(tokens).toEqual({ accessToken: "at-1", refreshToken: "rt-1", expiresInSec: 7200 });
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.twitter.com/2/oauth2/token");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${Buffer.from("cid-1:csecret-1").toString("base64")}`);
    const form = new URLSearchParams(init.body as string);
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("code")).toBe("code-1");
    expect(form.get("code_verifier")).toBe("verifier-1");
    expect(form.get("redirect_uri")).toBe(CFG.redirectUri);
  });

  it("defaults expiresInSec to 7200 when X omits it", async () => {
    const fetchImpl = mockFetch([{ body: { access_token: "at-1", refresh_token: "rt-1" } }]);
    const tokens = await exchangeCodeForXTokens(CFG, "code-1", "v", fetchImpl);
    expect(tokens.expiresInSec).toBe(7200);
  });

  it("fails honestly when X returns no refresh token (connection wouldn't last)", async () => {
    const fetchImpl = mockFetch([{ body: { access_token: "at-1" } }]);
    await expect(exchangeCodeForXTokens(CFG, "code-1", "v", fetchImpl)).rejects.toBeInstanceOf(XApiError);
    const err = await exchangeCodeForXTokens(CFG, "c", "v", mockFetch([{ body: { access_token: "at-1" } }])).catch(
      (e) => e,
    );
    expect((err as XApiError).userMessage).toMatch(/refresh token/i);
  });

  it("throws a user-friendly error when X rejects the code", async () => {
    const fetchImpl = mockFetch([
      { status: 400, body: { error: "invalid_request", error_description: "code not recognized" } },
    ]);
    await expect(exchangeCodeForXTokens(CFG, "bad", "v", fetchImpl)).rejects.toBeInstanceOf(XApiError);
  });
});

describe("refreshXTokens", () => {
  it("uses the refresh_token grant and returns the rotated tokens", async () => {
    const fetchImpl = mockFetch([
      { body: { access_token: "at-2", refresh_token: "rt-2", expires_in: 7200 } },
    ]);
    const tokens = await refreshXTokens(CFG, "rt-1", fetchImpl);
    expect(tokens.accessToken).toBe("at-2");
    expect(tokens.refreshToken).toBe("rt-2");
    const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(new URLSearchParams(init.body as string).get("grant_type")).toBe("refresh_token");
  });

  it("maps a failed refresh to the reconnect message", async () => {
    const fetchImpl = mockFetch([{ status: 400, body: { error: "invalid_grant" } }]);
    const err = await refreshXTokens(CFG, "rt-dead", fetchImpl).catch((e) => e);
    expect(err).toBeInstanceOf(XApiError);
    expect((err as XApiError).userMessage).toMatch(/Reconnect/);
  });
});

describe("fetchXUserInfo", () => {
  it("returns id, username and display name from /users/me", async () => {
    const fetchImpl = mockFetch([
      { body: { data: { id: "123", username: "creator", name: "The Creator" } } },
    ]);
    await expect(fetchXUserInfo("at-1", fetchImpl)).resolves.toEqual({
      userId: "123",
      username: "creator",
      displayName: "The Creator",
    });
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.twitter.com/2/users/me");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer at-1");
  });
});

describe("tweet text rules", () => {
  it("counts code points and enforces the 280 cap without truncating", () => {
    expect(tweetCharCount("hello")).toBe(5);
    expect(tweetCharCount("a".repeat(280))).toBe(280);
    expect(() => assertValidTweetText("a".repeat(280))).not.toThrow();
    expect(() => assertValidTweetText("a".repeat(281))).toThrow(XApiError);
    expect(() => assertValidTweetText("   ")).toThrow(XApiError);
    expect(TWEET_MAX_CHARS).toBe(280);
  });

  it("builds permalinks from username + id, with the /i/ fallback", () => {
    expect(tweetPermalink("creator", "999")).toBe("https://x.com/creator/status/999");
    expect(tweetPermalink("", "999")).toBe("https://x.com/i/status/999");
  });
});

describe("postTweet", () => {
  it("posts JSON text to /2/tweets and returns the tweet id", async () => {
    const fetchImpl = mockFetch([{ status: 201, body: { data: { id: "t-1", text: "hello" } } }]);
    await expect(postTweet("at-1", { text: "hello" }, fetchImpl)).resolves.toEqual({ tweetId: "t-1" });
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.twitter.com/2/tweets");
    expect(JSON.parse(init.body as string)).toEqual({ text: "hello" });
  });

  it("attaches media ids when provided", async () => {
    const fetchImpl = mockFetch([{ status: 201, body: { data: { id: "t-2" } } }]);
    await postTweet("at-1", { text: "watch", mediaIds: ["m-1"] }, fetchImpl);
    const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ text: "watch", media: { media_ids: ["m-1"] } });
  });

  it("rejects over-long text before any network call", async () => {
    const fetchImpl = mockFetch([]);
    await expect(postTweet("at-1", { text: "a".repeat(281) }, fetchImpl)).rejects.toBeInstanceOf(XApiError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps 401 to the reconnect message and 429 to rate-limit", async () => {
    const err401 = await postTweet("at-1", { text: "hi" }, mockFetch([{ status: 401, body: {} }])).catch((e) => e);
    expect((err401 as XApiError).userMessage).toMatch(/Reconnect/);
    const err429 = await postTweet("at-1", { text: "hi" }, mockFetch([{ status: 429, body: {} }])).catch((e) => e);
    expect((err429 as XApiError).userMessage).toMatch(/rate-limit/i);
  });

  it("maps a duplicate-content 403 to its own message", async () => {
    const fetchImpl = mockFetch([
      { status: 403, body: { detail: "You are not allowed to create a Tweet with duplicate content." } },
    ]);
    const err = await postTweet("at-1", { text: "same" }, fetchImpl).catch((e) => e);
    expect((err as XApiError).userMessage).toMatch(/duplicate/i);
  });
});

describe("planMediaSegments", () => {
  it("uploads files under 5 MB as a single segment", () => {
    expect(planMediaSegments(1024)).toEqual({ segmentSize: 1024, totalSegments: 1 });
    expect(planMediaSegments(MEDIA_SEGMENT_SIZE)).toEqual({
      segmentSize: MEDIA_SEGMENT_SIZE,
      totalSegments: 1,
    });
  });
  it("plans ceil(size/5MB) segments for larger files", () => {
    expect(planMediaSegments(12 * 1024 * 1024)).toEqual({ segmentSize: MEDIA_SEGMENT_SIZE, totalSegments: 3 });
  });
});

describe("media upload flow", () => {
  it("INIT sends command/total_bytes/media_category as form fields", async () => {
    const fetchImpl = mockFetch([{ body: { data: { id: "m-1", media_key: "k" } } }]);
    await expect(
      initMediaUpload("at-1", { totalBytes: 2048, mediaType: "video/mp4", mediaCategory: "tweet_video" }, fetchImpl),
    ).resolves.toBe("m-1");
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.twitter.com/2/media/upload");
    const form = init.body as FormData;
    expect(form.get("command")).toBe("INIT");
    expect(form.get("total_bytes")).toBe("2048");
    expect(form.get("media_type")).toBe("video/mp4");
    expect(form.get("media_category")).toBe("tweet_video");
  });

  it("accepts the legacy media_id_string shape too", async () => {
    const fetchImpl = mockFetch([{ body: { media_id_string: "m-legacy" } }]);
    await expect(
      initMediaUpload("at-1", { totalBytes: 10, mediaType: "image/png", mediaCategory: "tweet_image" }, fetchImpl),
    ).resolves.toBe("m-legacy");
  });

  it("APPEND accepts 204 and sends segment_index", async () => {
    const fetchImpl = mockFetch([{ status: 204 }]);
    await expect(appendMediaSegment("at-1", "m-1", 2, Buffer.alloc(8), fetchImpl)).resolves.toBeUndefined();
    const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const form = init.body as FormData;
    expect(form.get("command")).toBe("APPEND");
    expect(form.get("segment_index")).toBe("2");
    expect(form.get("media_id")).toBe("m-1");
  });

  it("runs INIT → APPEND ×n → FINALIZE → tweet for a 12 MB video", async () => {
    const bytes = Buffer.alloc(12 * 1024 * 1024);
    const fetchImpl = mockFetch([
      { body: { data: { id: "m-9" } } }, // INIT
      { status: 204 }, // APPEND 0
      { status: 204 }, // APPEND 1
      { status: 204 }, // APPEND 2
      { body: { data: { id: "m-9", processing_info: { state: "succeeded" } } } }, // FINALIZE
      { status: 201, body: { data: { id: "t-9" } } }, // POST /tweets
    ]);
    const result = await publishToX(
      { accessToken: "at-1", text: "new video", mediaBytes: bytes, username: "creator" },
      fetchImpl,
      noSleep,
    );
    expect(result).toEqual({ tweetId: "t-9", permalink: "https://x.com/creator/status/t-9" });
    const calls = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit][];
    const appends = calls.filter(([, init]) => (init.body as FormData)?.get?.("command") === "APPEND");
    expect(appends).toHaveLength(3);
    const tweetBody = JSON.parse(calls[calls.length - 1][1].body as string);
    expect(tweetBody.media).toEqual({ media_ids: ["m-9"] });
  });

  it("polls STATUS while X processes, then posts", async () => {
    const fetchImpl = mockFetch([
      { body: { data: { id: "m-5" } } }, // INIT
      { status: 204 }, // APPEND 0
      { body: { data: { id: "m-5", processing_info: { state: "pending", check_after_secs: 1 } } } }, // FINALIZE
      { body: { data: { id: "m-5", processing_info: { state: "in_progress", check_after_secs: 1 } } } }, // STATUS
      { body: { data: { id: "m-5", processing_info: { state: "succeeded" } } } }, // STATUS
      { status: 201, body: { data: { id: "t-5" } } }, // tweet
    ]);
    const result = await uploadMediaToX(
      { accessToken: "at-1", bytes: Buffer.alloc(1024), mediaType: "video/mp4", mediaCategory: "tweet_video" },
      fetchImpl,
      noSleep,
    );
    expect(result).toEqual({ mediaId: "m-5" });
    // uploadMediaToX stops after FINALIZE+poll: 5 calls (INIT/APPEND/FINALIZE/STATUS/STATUS)
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });

  it("throws when X reports media processing failed", async () => {
    const fetchImpl = mockFetch([
      { body: { data: { id: "m-6" } } },
      { status: 204 },
      { body: { data: { id: "m-6", processing_info: { state: "failed", error: { message: "bad codec" } } } } },
    ]);
    const err = await uploadMediaToX(
      { accessToken: "at-1", bytes: Buffer.alloc(1024), mediaType: "video/mp4", mediaCategory: "tweet_video" },
      fetchImpl,
      noSleep,
    ).catch((e) => e);
    expect(err).toBeInstanceOf(XApiError);
    expect((err as XApiError).userMessage).toMatch(/bad codec/);
  });

  it("text-only publishToX skips media upload entirely", async () => {
    const fetchImpl = mockFetch([{ status: 201, body: { data: { id: "t-7" } } }]);
    const result = await publishToX({ accessToken: "at-1", text: "just words", username: "creator" }, fetchImpl, noSleep);
    expect(result.permalink).toBe("https://x.com/creator/status/t-7");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
