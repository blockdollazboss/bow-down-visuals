import { describe, it, expect, vi } from "vitest";
import {
  buildFacebookAuthUrl,
  exchangeFacebookCodeForLongLivedToken,
  listPages,
  publishVideoToPage,
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

/* Mock fetch that also records every URL it was called with. */
function recordingFetch(queue: Array<{ status?: number; body: unknown }>) {
  const urls: string[] = [];
  const bodies: string[] = [];
  const impl: FetchImpl = (async (url: string, init?: RequestInit) => {
    urls.push(url);
    bodies.push(String(init?.body ?? ""));
    const next = queue.shift();
    if (!next) throw new Error("recordingFetch: out of queued responses");
    const status = next.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => next.body,
    } as Response;
  }) as unknown as FetchImpl;
  return { impl, urls, bodies };
}

const noSleep = async () => {};

describe("buildFacebookAuthUrl", () => {
  it("requests only page scopes — no Instagram permission", () => {
    const url = buildFacebookAuthUrl(
      { appId: "123", appSecret: "shh", redirectUri: "https://x.test/fb-cb" },
      "state-xyz",
    );
    expect(url).toContain("facebook.com/v21.0/dialog/oauth");
    expect(url).toContain("client_id=123");
    expect(url).toContain("state=state-xyz");
    expect(url).toContain(encodeURIComponent("pages_manage_posts"));
    expect(url).toContain(encodeURIComponent("pages_read_engagement"));
    expect(url).toContain(encodeURIComponent("pages_show_list"));
    expect(url).not.toContain("instagram_business_content_publish");
  });
});

describe("exchangeFacebookCodeForLongLivedToken", () => {
  const cfg = { appId: "fb-app-1", appSecret: "fb-secret", redirectUri: "https://x.test/fb-cb" };

  it("exchanges code for short-lived then long-lived token via graph.facebook.com", async () => {
    const { impl, urls } = recordingFetch([
      { body: { access_token: "short-token", expires_in: 3600 } },
      { body: { access_token: "long-token", expires_in: 5184000 } },
    ]);
    const result = await exchangeFacebookCodeForLongLivedToken(cfg, "auth-code", impl);
    expect(result).toEqual({ accessToken: "long-token", expiresInSec: 5184000 });
    // Both legs hit the Facebook OAuth endpoint — never the Instagram one.
    expect(urls[0]).toContain("https://graph.facebook.com/v21.0/oauth/access_token");
    expect(urls[0]).not.toContain("instagram.com");
    expect(urls[0]).toContain("code=auth-code");
    expect(urls[1]).toContain("grant_type=fb_exchange_token");
    expect(urls[1]).not.toContain("ig_exchange_token");
  });

  it("throws a Facebook-flavored error when the code exchange fails", async () => {
    const fetchImpl = mockFetch([
      { status: 400, body: { error: { message: "Invalid verification code format.", code: 100 } } },
    ]);
    const err = await exchangeFacebookCodeForLongLivedToken(cfg, "bad-code", fetchImpl).catch((e) => e);
    expect(err).toBeInstanceOf(MetaApiError);
    expect((err as MetaApiError).userMessage).toMatch(/facebook/i);
  });
});

describe("listPages", () => {
  it("maps every Page with its token and IG link status", async () => {
    const fetchImpl = mockFetch([
      {
        body: {
          data: [
            { id: "p1", name: "Page One", access_token: "tok-1" },
            { id: "p2", name: "Page Two", access_token: "tok-2" },
            { id: "p3", name: "No Token Page" }, // skipped — no access_token
          ],
        },
      },
      { body: { instagram_business_account: { id: "ig-1" } } },
      { body: {} },
    ]);
    const pages = await listPages("user-token", fetchImpl);
    expect(pages).toEqual([
      { pageId: "p1", pageName: "Page One", pageAccessToken: "tok-1", igUserId: "ig-1" },
      { pageId: "p2", pageName: "Page Two", pageAccessToken: "tok-2", igUserId: null },
    ]);
  });

  it("hits graph.facebook.com, never graph.instagram.com", async () => {
    const { impl, urls } = recordingFetch([
      { body: { data: [{ id: "p1", name: "Page One", access_token: "tok-1" }] } },
      { body: {} },
    ]);
    await listPages("user-token", impl);
    for (const url of urls) {
      expect(url).toContain("https://graph.facebook.com/v21.0");
      expect(url).not.toContain("graph.instagram.com");
    }
  });
});


describe("publishVideoToPage", () => {
  const input = {
    pageId: "page-1",
    accessToken: "page-token",
    videoUrl: "https://cdn.test/v.mp4",
    description: "hello #test",
  };

  it("uploads to the graph-video host with file_url + description, then polls and fetches the permalink", async () => {
    const { impl, urls, bodies } = recordingFetch([
      { body: { id: "video-1" } },                                    // POST /{page-id}/videos
      { body: { status: { video_status: "processing" } } },            // poll 1
      { body: { status: { video_status: "ready" } } },                 // poll 2
      { body: { permalink_url: "https://facebook.com/v/abc" } },       // permalink
    ]);
    const result = await publishVideoToPage(input, impl, noSleep);
    expect(result).toEqual({ videoId: "video-1", permalink: "https://facebook.com/v/abc" });

    // Upload goes to the graph-video host, not graph.facebook.com.
    expect(urls[0]).toBe("https://graph-video.facebook.com/v21.0/page-1/videos");
    // Status poll + permalink read go to graph.facebook.com, never graph.instagram.com.
    expect(urls[1]).toContain("https://graph.facebook.com/v21.0/video-1");
    expect(urls[3]).toContain("https://graph.facebook.com/v21.0/video-1");
    for (const url of urls.slice(1)) expect(url).not.toContain("graph.instagram.com");
    const uploadParams = new URLSearchParams(bodies[0]);
    expect(uploadParams.get("file_url")).toBe("https://cdn.test/v.mp4");
    expect(uploadParams.get("description")).toBe("hello #test");
    expect(uploadParams.get("access_token")).toBe("page-token");
  });

  it("still succeeds when processing runs long (the POST is the publish)", async () => {
    // 12 polls × PROCESSING → timeout; must resolve anyway, then permalink fetch.
    const queue = [{ body: { id: "video-2" } }];
    for (let i = 0; i < 12; i++) queue.push({ body: { status: { video_status: "processing" } } });
    queue.push({ body: {} });
    const { impl } = recordingFetch(queue);
    const result = await publishVideoToPage(input, impl, noSleep);
    expect(result.videoId).toBe("video-2");
    expect(result.permalink).toBe(""); // permalink fetch failed gracefully
  });

  it("throws when Facebook reports a processing error", async () => {
    const fetchImpl = mockFetch([
      { body: { id: "video-3" } },
      { body: { status: { video_status: "error" } } },
    ]);
    await expect(publishVideoToPage(input, fetchImpl, noSleep)).rejects.toThrow(MetaApiError);
  });

  it("maps Meta code 190 to the reconnect message", async () => {
    const fetchImpl = mockFetch([
      { status: 400, body: { error: { message: "Invalid OAuth access token.", code: 190 } } },
    ]);
    const err = await publishVideoToPage(input, fetchImpl, noSleep).catch((e) => e);
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
      await publishVideoToPage({ ...input, accessToken }, fetchImpl, noSleep);
      expect.unreachable("expected publishVideoToPage to throw");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(MetaApiError);
    expect((caught as MetaApiError).message).not.toContain(accessToken);
    expect((caught as MetaApiError).userMessage).not.toContain(accessToken);
  });
});
