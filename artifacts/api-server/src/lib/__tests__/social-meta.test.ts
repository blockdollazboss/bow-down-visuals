import { describe, it, expect, vi } from "vitest";
import {
  buildAuthUrl,
  exchangeCodeForLongLivedToken,
  fetchInstagramProfile,
  createReelContainer,
  pollContainerUntilFinished,
  publishReelToInstagram,
  MetaApiError,
  type FetchImpl,
} from "../social-meta";

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

describe("buildAuthUrl", () => {
  it("uses Instagram Login with the business scopes", () => {
    const url = buildAuthUrl(
      { appId: "123", appSecret: "shh", redirectUri: "https://x.test/cb" },
      "state-abc",
    );
    expect(url).toContain("https://www.instagram.com/oauth/authorize");
    expect(url).toContain("client_id=123");
    expect(url).toContain("state=state-abc");
    expect(url).toContain("enable_fb_login=0");
    expect(url).toContain(encodeURIComponent("instagram_business_basic"));
    expect(url).toContain(encodeURIComponent("instagram_business_content_publish"));
    expect(url).not.toContain("facebook.com");
    expect(url).not.toContain("pages_show_list");
  });
});

describe("exchangeCodeForLongLivedToken", () => {
  const cfg = { appId: "ig-app-1", appSecret: "ig-secret", redirectUri: "https://x.test/cb" };

  it("exchanges code → short-lived → long-lived and returns the IG user id", async () => {
    const fetchImpl = mockFetch([
      { body: { access_token: "short-lived", user_id: 987654321 } }, // api.instagram.com token
      { body: { access_token: "long-lived", expires_in: 5184000 } }, // ig_exchange_token
    ]);
    const result = await exchangeCodeForLongLivedToken(cfg, "auth-code", fetchImpl);
    expect(result).toEqual({
      accessToken: "long-lived",
      expiresInSec: 5184000,
      igUserId: "987654321",
    });
    const [tokenUrl, tokenInit] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(tokenUrl).toContain("api.instagram.com/oauth/access_token");
    const body = new URLSearchParams(tokenInit.body as string);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("auth-code");
    expect(body.get("client_id")).toBe("ig-app-1");
  });

  it("throws MetaApiError when the code exchange fails", async () => {
    const fetchImpl = mockFetch([
      { status: 400, body: { error: { message: "Invalid code", code: 100 } } },
    ]);
    await expect(exchangeCodeForLongLivedToken(cfg, "bad-code", fetchImpl)).rejects.toThrow(MetaApiError);
  });
});

describe("fetchInstagramProfile", () => {
  it("returns the IG user id and username from /me", async () => {
    const fetchImpl = mockFetch([{ body: { id: "987654321", username: "bowdownvisuals" } }]);
    const profile = await fetchInstagramProfile("tok", fetchImpl);
    expect(profile).toEqual({ igUserId: "987654321", username: "bowdownvisuals" });
    const [url] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toContain("graph.instagram.com");
    expect(url).toContain("/me");
  });
});

describe("publishReelToInstagram", () => {
  const input = {
    igUserId: "ig-1",
    accessToken: "token",
    videoUrl: "https://cdn.test/v.mp4",
    caption: "hello #test",
  };

  it("runs container → poll → publish → permalink", async () => {
    const fetchImpl = mockFetch([
      { body: { id: "container-1" } },                       // createReelContainer
      { body: { status_code: "IN_PROGRESS" } },              // poll 1
      { body: { status_code: "FINISHED" } },                 // poll 2
      { body: { id: "media-9" } },                           // media_publish
      { body: { permalink: "https://instagram.com/p/abc" } }, // permalink
    ]);
    const result = await publishReelToInstagram(input, fetchImpl, noSleep);
    expect(result).toEqual({ mediaId: "media-9", permalink: "https://instagram.com/p/abc" });
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });

  it("sends media_type=REELS with the video URL and caption", async () => {
    const fetchImpl = mockFetch([
      { body: { id: "c1" } },
      { body: { status_code: "FINISHED" } },
      { body: { id: "m1" } },
      { body: { permalink: "p" } },
    ]);
    await publishReelToInstagram(input, fetchImpl, noSleep);
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/ig-1/media");
    const body = new URLSearchParams(init.body as string);
    expect(body.get("media_type")).toBe("REELS");
    expect(body.get("video_url")).toBe(input.videoUrl);
    expect(body.get("caption")).toBe(input.caption);
    expect(body.get("share_to_feed")).toBe("true");
  });

  it("throws a user-friendly error when the container errors", async () => {
    const make = () =>
      mockFetch([
        { body: { id: "c1" } },
        { body: { status_code: "ERROR" } },
      ]);
    await expect(publishReelToInstagram(input, make(), noSleep)).rejects.toThrow(MetaApiError);
    let caught: unknown;
    try {
      await publishReelToInstagram(input, make(), noSleep);
      expect.unreachable("expected publish to throw");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(MetaApiError);
    expect((caught as MetaApiError).userMessage).toMatch(/couldn't process/i);
  });

  it("maps Meta code 190 to the reconnect message", async () => {
    const fetchImpl = mockFetch([
      {
        status: 400,
        body: { error: { message: "Invalid OAuth access token.", code: 190 } },
      },
    ]);
    const err = await createReelContainer("ig-1", "bad", {
      videoUrl: input.videoUrl,
      caption: "",
    }, fetchImpl).catch((e) => e);
    expect(err).toBeInstanceOf(MetaApiError);
    expect((err as MetaApiError).userMessage).toMatch(/reconnect/i);
  });

  it("never includes the access token value in the thrown message", async () => {
    const accessToken = "SECRETACCESSTOKEN999";
    const fetchImpl = mockFetch([
      { status: 500, body: { error: { message: "Something blew up", code: 1 } } },
    ]);
    let caught: unknown;
    try {
      await createReelContainer("ig-1", accessToken, {
        videoUrl: input.videoUrl,
        caption: "",
      }, fetchImpl);
      expect.unreachable("expected createReelContainer to throw");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(MetaApiError);
    expect((caught as MetaApiError).message).not.toContain(accessToken);
    expect((caught as MetaApiError).userMessage).not.toContain(accessToken);
  });
});

describe("pollContainerUntilFinished", () => {
  it("resolves immediately when already FINISHED", async () => {
    const fetchImpl = mockFetch([{ body: { status_code: "FINISHED" } }]);
    await expect(
      pollContainerUntilFinished("c1", "tok", fetchImpl, noSleep),
    ).resolves.toBeUndefined();
  });
});
