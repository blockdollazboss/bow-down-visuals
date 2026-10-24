/**
 * Avatar client — Hedra wiring pins.
 *
 * Covers: the env provider selector (owner-ruled Hedra default), the
 * Character-3 submit body shape, the Hedra job-status mapping, and the
 * submit flow with fetch stubbed end to end (no live provider calls):
 *  - inputs are uploaded to /v3/files and the HANDLES are submitted,
 *    never the raw source URLs
 *  - Hedra's submit idempotency key is forwarded
 *  - a missing character image fails BEFORE any provider call
 *  - supplied driving audio skips the TTS step entirely
 *  - script-only with no voice service configured fails honestly
 *  - HeyGen (reserved) still throws its honest not-implemented error
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  avatarProviderConfigured,
  avatarProviderName,
  buildHedraSubmitInput,
  getAvatarVideoStatus,
  hedraResolution,
  mapHedraJobPayload,
  submitAvatarVideo,
} from "../avatar-client";

const ENV_KEYS = [
  "AVATAR_PROVIDER",
  "HEDRA_API_KEY",
  "HEYGEN_API_KEY",
  "HEDRA_AVATAR_MODEL",
  "HEDRA_AVATAR_RESOLUTION",
  "ELEVENLABS_API_KEY",
  "AVATAR_TTS_VOICE_ID",
] as const;

let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.unstubAllGlobals();
});

/* ── Selector ─────────────────────────────────────────────────────── */

describe("avatarProviderName — env selector", () => {
  it("is null (unconfigured) with no keys", () => {
    expect(avatarProviderName()).toBeNull();
    expect(avatarProviderConfigured()).toBe(false);
  });

  it("selects hedra when only HEDRA_API_KEY exists", () => {
    process.env["HEDRA_API_KEY"] = "k_test";
    expect(avatarProviderName()).toBe("hedra");
    expect(avatarProviderConfigured()).toBe(true);
  });

  it("defaults to hedra when both keys exist (owner-ruled engine)", () => {
    process.env["HEDRA_API_KEY"] = "k_test";
    process.env["HEYGEN_API_KEY"] = "hg_test";
    expect(avatarProviderName()).toBe("hedra");
  });

  it("falls back to heygen when only HEYGEN_API_KEY exists", () => {
    process.env["HEYGEN_API_KEY"] = "hg_test";
    expect(avatarProviderName()).toBe("heygen");
  });

  it("AVATAR_PROVIDER=heygen wins when its key exists", () => {
    process.env["HEDRA_API_KEY"] = "k_test";
    process.env["HEYGEN_API_KEY"] = "hg_test";
    process.env["AVATAR_PROVIDER"] = "heygen";
    expect(avatarProviderName()).toBe("heygen");
  });

  it("AVATAR_PROVIDER=hedra wins when its key exists", () => {
    process.env["HEDRA_API_KEY"] = "k_test";
    process.env["HEYGEN_API_KEY"] = "hg_test";
    process.env["AVATAR_PROVIDER"] = "hedra";
    expect(avatarProviderName()).toBe("hedra");
  });

  it("a forced provider without its key does not select", () => {
    process.env["AVATAR_PROVIDER"] = "hedra";
    process.env["HEYGEN_API_KEY"] = "hg_test";
    expect(avatarProviderName()).toBe("heygen");
  });
});

/* ── Pure builders / mapping ──────────────────────────────────────── */

describe("buildHedraSubmitInput", () => {
  it("builds the Character-3 input with url handles and 720p default", () => {
    const input = buildHedraSubmitInput({
      imageHandleUrl: "https://hedra.example/handle/img",
      audioHandleUrl: "https://hedra.example/handle/aud",
      prompt: "Host speaking to camera",
    });
    expect(input).toEqual({
      start_image: { source: "url", url: "https://hedra.example/handle/img" },
      audio: { source: "url", url: "https://hedra.example/handle/aud" },
      prompt: "Host speaking to camera",
      aspect_ratio: "16:9",
      resolution: "720p",
    });
  });

  it("passes the requested aspect ratio through", () => {
    const input = buildHedraSubmitInput({
      imageHandleUrl: "i",
      audioHandleUrl: "a",
      prompt: "p",
      aspectRatio: "9:16",
    });
    expect(input.aspect_ratio).toBe("9:16");
  });

  it("honors HEDRA_AVATAR_RESOLUTION and ignores garbage values", () => {
    process.env["HEDRA_AVATAR_RESOLUTION"] = "1080p";
    expect(hedraResolution()).toBe("1080p");
    process.env["HEDRA_AVATAR_RESOLUTION"] = "4k-ultra";
    expect(hedraResolution()).toBe("720p");
  });
});

describe("mapHedraJobPayload", () => {
  it("maps the four Hedra states", () => {
    expect(mapHedraJobPayload({ status: "IN_QUEUE" }).status).toBe("queued");
    expect(mapHedraJobPayload({ status: "IN_PROGRESS" }).status).toBe("processing");
    expect(mapHedraJobPayload({ status: "FAILED", error: { message: "bad audio" } })).toEqual({
      providerJobId: "",
      status: "failed",
      error: "bad audio",
    });
  });

  it("extracts the finished video URL on completion", () => {
    const r = mapHedraJobPayload({
      status: "COMPLETED",
      outputs: [{ status: "COMPLETED", url: "https://cdn.example/out.mp4" }],
    });
    expect(r.status).toBe("done");
    expect(r.videoUrl).toBe("https://cdn.example/out.mp4");
  });

  it("treats COMPLETED without an output as failed, never as silent success", () => {
    const r = mapHedraJobPayload({ status: "COMPLETED", outputs: [] });
    expect(r.status).toBe("failed");
    expect(r.error).toMatch(/no video output/i);
  });
});

/* ── Submit flow (fetch stubbed) ──────────────────────────────────── */

interface FetchCall {
  url: string;
  init?: RequestInit;
}

function stubFetch(routes: {
  image?: () => Response;
  audio?: () => Response;
  tts?: () => Response;
  submit?: (body: unknown) => Response;
}) {
  const calls: FetchCall[] = [];
  let fileCount = 0;
  const impl = async (input: unknown, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push({ url, init });
    if (url === "https://img.example/char.png") {
      return routes.image ? routes.image() : new Response(Buffer.from("png-bytes"), { status: 200, headers: { "content-type": "image/png" } });
    }
    if (url === "https://audio.example/voice.mp3") {
      return routes.audio ? routes.audio() : new Response(Buffer.from("mp3-bytes"), { status: 200, headers: { "content-type": "audio/mpeg" } });
    }
    if (url.startsWith("https://api.elevenlabs.io/")) {
      return routes.tts ? routes.tts() : new Response(Buffer.from("tts-bytes"), { status: 200 });
    }
    if (url === "https://api.hedra.com/v3/files") {
      fileCount += 1;
      return new Response(JSON.stringify({ url: `https://hedra.example/handle/${fileCount}` }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url === "https://api.hedra.com/v3/models/hedra-character-3") {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      return routes.submit
        ? routes.submit(body)
        : new Response(JSON.stringify({ job_id: "job_123", status: "IN_QUEUE" }), {
            status: 202,
            headers: { "content-type": "application/json" },
          });
    }
    if (url === "https://api.hedra.com/v3/jobs/job_123") {
      return new Response(
        JSON.stringify({ status: "COMPLETED", outputs: [{ status: "COMPLETED", url: "https://cdn.example/out.mp4" }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  };
  vi.stubGlobal("fetch", vi.fn(impl));
  return calls;
}

const baseReq = {
  avatarId: "avatar-host-male",
  script: "Welcome back to the show.",
  userId: "user-1",
  imageUrl: "https://img.example/char.png",
  audioUrl: "https://audio.example/voice.mp3",
};

describe("submitAvatarVideo — hedra flow", () => {
  beforeEach(() => {
    process.env["HEDRA_API_KEY"] = "k_test_secret";
  });

  it("uploads inputs, submits handles (not raw URLs), forwards the idempotency key", async () => {
    let submitBody: { input?: Record<string, unknown>; idempotency_key?: string } | null = null;
    const calls = stubFetch({
      submit: (body) => {
        submitBody = body as typeof submitBody;
        return new Response(JSON.stringify({ job_id: "job_123", status: "IN_QUEUE" }), {
          status: 202,
          headers: { "content-type": "application/json" },
        });
      },
    });

    const result = await submitAvatarVideo({ ...baseReq, idempotencyKey: "avatar-presenter:job-1" });
    expect(result).toEqual({ providerJobId: "job_123", status: "processing" });

    const fileCalls = calls.filter((c) => c.url.endsWith("/v3/files"));
    expect(fileCalls).toHaveLength(2);
    for (const c of fileCalls) {
      expect((c.init?.headers as Record<string, string>)["Authorization"]).toBe("Key k_test_secret");
    }
    expect(submitBody?.idempotency_key).toBe("avatar-presenter:job-1");
    const input = submitBody?.input as { start_image: { url: string }; audio: { url: string }; resolution: string };
    expect(input.start_image.url).toMatch(/^https:\/\/hedra\.example\/handle\//);
    expect(input.audio.url).toMatch(/^https:\/\/hedra\.example\/handle\//);
    expect(input.start_image.url).not.toBe(baseReq.imageUrl);
    expect(input.resolution).toBe("720p");
    // Supplied audio means the TTS rail is never touched.
    expect(calls.some((c) => c.url.includes("elevenlabs"))).toBe(false);
  });

  it("fails BEFORE any provider call when no character image exists", async () => {
    const calls = stubFetch({});
    await expect(
      submitAvatarVideo({ avatarId: "avatar-host-male", script: "Hi", userId: "user-1" }),
    ).rejects.toMatchObject({ name: "AvatarInputError", code: "AVATAR_IMAGE_REQUIRED" });
    expect(calls).toHaveLength(0);
  });

  it("speaks the script via the TTS rail when no driving audio is supplied", async () => {
    process.env["ELEVENLABS_API_KEY"] = "el_test";
    const calls = stubFetch({});
    const result = await submitAvatarVideo({
      avatarId: "avatar-host-male",
      script: "Hello from the studio.",
      userId: "user-1",
      imageUrl: "https://img.example/char.png",
    });
    expect(result.providerJobId).toBe("job_123");
    expect(calls.some((c) => c.url.includes("api.elevenlabs.io/v1/text-to-speech"))).toBe(true);
  });

  it("fails honestly when neither driving audio nor a voice service exists", async () => {
    delete process.env["ELEVENLABS_API_KEY"];
    stubFetch({});
    await expect(
      submitAvatarVideo({
        avatarId: "avatar-host-male",
        script: "Hello.",
        userId: "user-1",
        imageUrl: "https://img.example/char.png",
      }),
    ).rejects.toMatchObject({ name: "AvatarInputError", code: "AVATAR_AUDIO_REQUIRED" });
  });

  it("surfaces a Hedra HTTP error as AvatarProviderError with its status", async () => {
    stubFetch({
      submit: () =>
        new Response(JSON.stringify({ error: { code: "INSUFFICIENT_BALANCE", message: "wallet empty" } }), {
          status: 402,
          headers: { "content-type": "application/json" },
        }),
    });
    await expect(submitAvatarVideo({ ...baseReq })).rejects.toMatchObject({
      name: "AvatarProviderError",
      status: 402,
    });
  });
});

describe("getAvatarVideoStatus — hedra", () => {
  it("returns done + the video URL and echoes the job id", async () => {
    process.env["HEDRA_API_KEY"] = "k_test_secret";
    stubFetch({});
    const r = await getAvatarVideoStatus("job_123");
    expect(r).toEqual({
      providerJobId: "job_123",
      status: "done",
      videoUrl: "https://cdn.example/out.mp4",
    });
  });
});

describe("submitAvatarVideo — heygen stays honest", () => {
  it("throws not-implemented (never a fake success)", async () => {
    process.env["AVATAR_PROVIDER"] = "heygen";
    process.env["HEYGEN_API_KEY"] = "hg_test";
    await expect(submitAvatarVideo({ ...baseReq })).rejects.toThrow(/not implemented/i);
  });

  it("throws AvatarNotConfiguredError with no keys at all", async () => {
    await expect(submitAvatarVideo({ ...baseReq })).rejects.toMatchObject({
      name: "AvatarNotConfiguredError",
      code: "AVATAR_PROVIDER_NOT_CONFIGURED",
    });
  });
});
