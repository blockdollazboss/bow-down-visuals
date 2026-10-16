/**
 * Unit tests for the Cloudflare Stream client (lib/cloudflare-stream).
 * No real network: fetch is stubbed, env is injected. Covers the
 * configured/unconfigured gate, the create-input request shape, playback
 * URL derivation, and provider-error mapping.
 */
import { describe, it, expect, vi } from "vitest";
import {
  isStreamConfigured,
  streamCredentials,
  createLiveInput,
  deleteLiveInput,
  playbackUrlsFromWhip,
  StreamNotConfiguredError,
  StreamProviderError,
} from "../cloudflare-stream";

const ENV = { CLOUDFLARE_ACCOUNT_ID: "acct-123", CLOUDFLARE_STREAM_TOKEN: "tok-abc" } as NodeJS.ProcessEnv;
const NO_ENV = {} as NodeJS.ProcessEnv;

describe("isStreamConfigured / streamCredentials", () => {
  it("is false until BOTH env vars are set", () => {
    expect(isStreamConfigured(NO_ENV)).toBe(false);
    expect(isStreamConfigured({ CLOUDFLARE_ACCOUNT_ID: "acct-123" } as NodeJS.ProcessEnv)).toBe(false);
    expect(isStreamConfigured({ CLOUDFLARE_STREAM_TOKEN: "tok-abc" } as NodeJS.ProcessEnv)).toBe(false);
    expect(isStreamConfigured(ENV)).toBe(true);
  });

  it("trims whitespace and rejects blanks", () => {
    expect(
      isStreamConfigured({ CLOUDFLARE_ACCOUNT_ID: "  ", CLOUDFLARE_STREAM_TOKEN: "tok" } as NodeJS.ProcessEnv),
    ).toBe(false);
    expect(streamCredentials(ENV)).toEqual({ accountId: "acct-123", token: "tok-abc" });
  });
});

describe("playbackUrlsFromWhip", () => {
  it("derives WHEP + HLS from the publish URL", () => {
    const whip = "https://customer-f33z.cloudflarestream.com/abc123/webRTC/publish";
    expect(playbackUrlsFromWhip(whip)).toEqual({
      whep_url: "https://customer-f33z.cloudflarestream.com/abc123/webRTC/play",
      hls_url: "https://customer-f33z.cloudflarestream.com/abc123/manifest/video.m3u8",
    });
  });

  it("returns nulls for missing or non-WHIP urls", () => {
    expect(playbackUrlsFromWhip(null)).toEqual({ whep_url: null, hls_url: null });
    expect(playbackUrlsFromWhip(undefined)).toEqual({ whep_url: null, hls_url: null });
    expect(playbackUrlsFromWhip("https://example.com/some/video.mp4")).toEqual({
      whep_url: null,
      hls_url: null,
    });
  });
});

describe("createLiveInput", () => {
  it("throws StreamNotConfiguredError when env is unset (no fetch made)", async () => {
    const fetchImpl = vi.fn();
    await expect(createLiveInput("My Stream", fetchImpl as never, NO_ENV)).rejects.toBeInstanceOf(
      StreamNotConfiguredError,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("POSTs to the account live_inputs endpoint with recording off and maps the result", async () => {
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/acct-123/stream/live_inputs");
      expect(init.method).toBe("POST");
      expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer tok-abc");
      const body = JSON.parse(String(init.body));
      expect(body.meta.name).toBe("Friday Night Live");
      expect(body.recording.mode).toBe("off");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          result: {
            uid: "input-uid-1",
            webRTC: { url: "https://customer-f33z.cloudflarestream.com/input-uid-1/webRTC/publish" },
            webRTCPlayback: { url: "https://customer-f33z.cloudflarestream.com/input-uid-1/webRTC/play" },
          },
        }),
      } as Response;
    });
    const out = await createLiveInput("Friday Night Live", fetchImpl as never, ENV);
    expect(out).toEqual({
      providerInputId: "input-uid-1",
      playbackId: "input-uid-1",
      whipUrl: "https://customer-f33z.cloudflarestream.com/input-uid-1/webRTC/publish",
      whepUrl: "https://customer-f33z.cloudflarestream.com/input-uid-1/webRTC/play",
    });
  });

  it("derives the WHEP url when the provider omits webRTCPlayback", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        result: {
          uid: "u2",
          webRTC: { url: "https://customer-z.cloudflarestream.com/u2/webRTC/publish" },
        },
      }),
    }) as never);
    const out = await createLiveInput("x", fetchImpl as never, ENV);
    expect(out.whepUrl).toBe("https://customer-z.cloudflarestream.com/u2/webRTC/play");
  });

  it("maps provider failure to StreamProviderError with the provider message", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 403,
      json: async () => ({ success: false, errors: [{ message: "Not authorized" }] }),
    }) as never);
    await expect(createLiveInput("x", fetchImpl as never, ENV)).rejects.toMatchObject({
      name: "StreamProviderError",
      status: 403,
    });
  });
});

describe("deleteLiveInput", () => {
  it("DELETEs the input and tolerates a 404 (already gone)", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }) as never);
    await expect(deleteLiveInput("gone", fetchImpl as never, ENV)).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.cloudflare.com/client/v4/accounts/acct-123/stream/live_inputs/gone",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("throws StreamProviderError on other failures", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }) as never);
    await expect(deleteLiveInput("x", fetchImpl as never, ENV)).rejects.toBeInstanceOf(StreamProviderError);
  });
});
