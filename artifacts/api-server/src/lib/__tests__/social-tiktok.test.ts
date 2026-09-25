import { describe, it, expect, vi } from "vitest";
import {
  buildTikTokAuthUrl,
  exchangeCodeForTikTokTokens,
  refreshTikTokTokens,
  fetchTikTokUserInfo,
  planChunks,
  initInboxVideoUpload,
  putVideoChunk,
  pollInboxUntilReady,
  uploadDraftToTikTok,
  TikTokApiError,
  type FetchImpl,
} from "../social-tiktok";

/* Queued mock fetch: each call consumes the next { status, body }. */
function mockFetch(queue: Array<{ status?: number; body: unknown }>): FetchImpl {
  return vi.fn(async () => {
    const next = queue.shift();
    if (!next) throw new Error("mockFetch: out of queued responses");
    const status = next.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => next.body,
    } as Response;
  });
}

const noSleep = async () => {};
const CFG = { clientKey: "ck-1", clientSecret: "cs-1", redirectUri: "https://x.test/tiktok-cb" };

describe("buildTikTokAuthUrl", () => {
  it("points at TikTok's Login Kit with the drafts-tier scopes", () => {
    const url = buildTikTokAuthUrl(CFG, "state-xyz");
    expect(url).toContain("https://www.tiktok.com/v2/auth/authorize/");
    expect(url).toContain("client_key=ck-1");
    expect(url).toContain(`redirect_uri=${encodeURIComponent(CFG.redirectUri)}`);
    expect(url).toContain("response_type=code");
    expect(url).toContain(encodeURIComponent("user.info.basic,video.upload"));
    expect(url).toContain("state=state-xyz");
  });
});

describe("exchangeCodeForTikTokTokens", () => {
  it("posts the code grant and parses tokens + open_id", async () => {
    const fetchImpl = mockFetch([
      {
        body: {
          access_token: "at-1",
          refresh_token: "rt-1",
          open_id: "open-1",
          expires_in: 86400,
          refresh_expires_in: 31536000,
        },
      },
    ]);
    const tokens = await exchangeCodeForTikTokTokens(CFG, "code-1", fetchImpl);
    expect(tokens).toEqual({ accessToken: "at-1", refreshToken: "rt-1", openId: "open-1", expiresInSec: 86400 });
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/v2/oauth/token/");
    const form = new URLSearchParams(init.body as string);
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("code")).toBe("code-1");
  });

  it("throws a user-friendly error when TikTok rejects the code", async () => {
    const fetchImpl = mockFetch([{ status: 400, body: { error: "invalid_code", error_description: "code not recognized" } }]);
    await expect(exchangeCodeForTikTokTokens(CFG, "bad-code", fetchImpl)).rejects.toBeInstanceOf(TikTokApiError);
  });
});

describe("refreshTikTokTokens", () => {
  it("uses the refresh_token grant and returns the rotated tokens", async () => {
    const fetchImpl = mockFetch([
      { body: { access_token: "at-2", refresh_token: "rt-2", open_id: "open-1", expires_in: 86400 } },
    ]);
    const tokens = await refreshTikTokTokens(CFG, "rt-1", fetchImpl);
    expect(tokens.accessToken).toBe("at-2");
    expect(tokens.refreshToken).toBe("rt-2");
    const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(new URLSearchParams(init.body as string).get("grant_type")).toBe("refresh_token");
  });
});

describe("fetchTikTokUserInfo", () => {
  it("returns open_id and display_name", async () => {
    const fetchImpl = mockFetch([
      { body: { error: { code: "ok" }, data: { user: { open_id: "open-1", display_name: "creator" } } } },
    ]);
    await expect(fetchTikTokUserInfo("at-1", fetchImpl)).resolves.toEqual({ openId: "open-1", displayName: "creator" });
  });
});

describe("planChunks", () => {
  it("uploads files under 5 MB as a single chunk", () => {
    expect(planChunks(4 * 1024 * 1024)).toEqual({ chunkSize: 4 * 1024 * 1024, totalChunks: 1 });
  });
  it("plans 8 MB chunks for larger files, last chunk absorbing the remainder", () => {
    const { chunkSize, totalChunks } = planChunks(50 * 1024 * 1024);
    expect(chunkSize).toBe(8 * 1024 * 1024);
    expect(totalChunks).toBe(6);
    // non-final chunks are exactly 8MB (>= 5MB minimum), final is 8MB + remainder
  });
});

describe("initInboxVideoUpload", () => {
  it("sends FILE_UPLOAD source_info to the inbox init endpoint", async () => {
    const fetchImpl = mockFetch([
      {
        body: {
          error: { code: "ok", message: "", log_id: "x" },
          data: { publish_id: "pub-1", upload_url: "https://upload.tiktok.test/u1" },
        },
      },
    ]);
    const size = 50 * 1024 * 1024;
    const result = await initInboxVideoUpload("at-1", size, fetchImpl);
    expect(result).toEqual({ publishId: "pub-1", uploadUrl: "https://upload.tiktok.test/u1" });
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/post/publish/inbox/video/init/");
    const body = JSON.parse(init.body as string);
    expect(body.source_info.source).toBe("FILE_UPLOAD");
    expect(body.source_info.video_size).toBe(size);
    expect(body.source_info.chunk_size).toBe(8 * 1024 * 1024);
    expect(body.source_info.total_chunk_count).toBe(6);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer at-1");
  });
});

describe("putVideoChunk", () => {
  it("PUTs with Content-Range and accepts 206", async () => {
    const fetchImpl = mockFetch([{ status: 206, body: {} }]);
    await putVideoChunk("https://upload.tiktok.test/u1", Buffer.alloc(8), 0, 16, fetchImpl);
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://upload.tiktok.test/u1");
    expect(init.method).toBe("PUT");
    expect((init.headers as Record<string, string>)["Content-Range"]).toBe("bytes 0-7/16");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("video/mp4");
  });

  it("throws a user-friendly error on a failed chunk", async () => {
    const fetchImpl = mockFetch([{ status: 500, body: {} }]);
    await expect(putVideoChunk("https://u.test", Buffer.alloc(8), 0, 16, fetchImpl)).rejects.toBeInstanceOf(
      TikTokApiError,
    );
  });
});

describe("pollInboxUntilReady", () => {
  it("resolves when TikTok reports SEND_TO_USER_INBOX", async () => {
    const fetchImpl = mockFetch([
      { body: { error: { code: "ok" }, data: { status: "PROCESSING_UPLOAD" } } },
      { body: { error: { code: "ok" }, data: { status: "SEND_TO_USER_INBOX" } } },
    ]);
    await expect(pollInboxUntilReady("pub-1", "at-1", fetchImpl, noSleep)).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("throws with the fail reason when TikTok reports FAILED", async () => {
    const fetchImpl = mockFetch([
      { body: { error: { code: "ok" }, data: { status: "FAILED", fail_reason: "VIDEO_TOO_LONG" } } },
    ]);
    await expect(pollInboxUntilReady("pub-1", "at-1", fetchImpl, noSleep)).rejects.toThrow(TikTokApiError);
  });
});

describe("uploadDraftToTikTok", () => {
  it("runs init → chunk PUT → poll until inbox", async () => {
    const videoBytes = Buffer.alloc(4 * 1024 * 1024); // single chunk
    const fetchImpl = mockFetch([
      {
        body: {
          error: { code: "ok" },
          data: { publish_id: "pub-9", upload_url: "https://upload.tiktok.test/u9" },
        },
      },
      { status: 201, body: {} }, // chunk PUT (single chunk = complete)
      { body: { error: { code: "ok" }, data: { status: "SEND_TO_USER_INBOX" } } },
    ]);
    const result = await uploadDraftToTikTok({ accessToken: "at-1", videoBytes }, fetchImpl, noSleep);
    expect(result).toEqual({ publishId: "pub-9" });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("maps rate-limit errors to a plain user message", async () => {
    const fetchImpl = mockFetch([
      {
        status: 429,
        body: { error: { code: "rate_limit_exceeded", message: "too many requests", log_id: "x" }, data: {} },
      },
    ]);
    const err = await uploadDraftToTikTok({ accessToken: "at-1", videoBytes: Buffer.alloc(1024) }, fetchImpl, noSleep).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(TikTokApiError);
    expect((err as TikTokApiError).userMessage).toMatch(/rate-limit/i);
  });

  it("maps expired-token errors to the reconnect message", async () => {
    const fetchImpl = mockFetch([
      {
        status: 401,
        body: { error: { code: "access_token_invalid", message: "token invalid", log_id: "x" }, data: {} },
      },
    ]);
    const err = await uploadDraftToTikTok({ accessToken: "at-1", videoBytes: Buffer.alloc(1024) }, fetchImpl, noSleep).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(TikTokApiError);
    expect((err as TikTokApiError).userMessage).toMatch(/Reconnect/);
  });
});
