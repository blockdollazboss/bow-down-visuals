/**
 * $0 verification suite for the WaveSpeed (LatentSync) provider client.
 *
 * Pins the billing-safety contract:
 *  - a submit makes exactly ONE HTTP attempt (never auto-retried — a
 *    retry after an unclear failure can create a second billed task);
 *  - an out-of-funds answer classifies as "balance" ahead of everything
 *    else, so the poller fails closed instead of looping;
 *  - a no-response submit classifies as "transport" (outcome unknown),
 *    never as something the poller would resubmit;
 * and the resolution-honesty helper: LatentSync's known downscale
 * (672x1344 in → 432x880 out in the 2026-10-24 clean test) must compute
 * to resolutionReduced=true, while an unprobeable output stays null
 * (unknown), never a silent false.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  WaveSpeedError,
  classifyWaveSpeedSubmitError,
  isWaveSpeedBalanceError,
  normalizeWaveSpeedStatus,
  waveSpeedStatus,
  waveSpeedSubmit,
} from "../wavespeed";
import { buildResolutionMeta } from "../sync-labs";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  process.env["WAVESPEED_BASE_URL"] = "https://ws.example/api/v3";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env["WAVESPEED_BASE_URL"];
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("waveSpeedSubmit", () => {
  it("posts video+audio URLs to the model endpoint once and returns the prediction id", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: { id: "pred-1", status: "created" } }));
    const id = await waveSpeedSubmit("https://cdn/clip.mp4", "https://cdn/seg.mp3", "ws-key");
    expect(id).toBe("pred-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://ws.example/api/v3/bytedance/latentsync");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer ws-key");
    expect(JSON.parse(init.body as string)).toEqual({
      video: "https://cdn/clip.mp4",
      audio: "https://cdn/seg.mp3",
    });
  });

  it("accepts a bare (unenveloped) id response too", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { id: "pred-2" }));
    await expect(waveSpeedSubmit("https://c/v.mp4", "https://c/a.mp3", "k")).resolves.toBe("pred-2");
  });

  it("a 402 insufficient-balance answer throws a balance-classified error", async () => {
    fetchMock.mockResolvedValue(jsonResponse(402, { message: "Insufficient balance" }));
    const err = await waveSpeedSubmit("https://c/v.mp4", "https://c/a.mp3", "k").catch((e) => e);
    expect(err).toBeInstanceOf(WaveSpeedError);
    expect(err.status).toBe(402);
    expect(isWaveSpeedBalanceError(err)).toBe(true);
    expect(classifyWaveSpeedSubmitError(err)).toBe("balance");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a balance message without a 402 still classifies as balance", async () => {
    fetchMock.mockResolvedValue(jsonResponse(403, { message: "insufficient credits for this model" }));
    const err = await waveSpeedSubmit("https://c/v.mp4", "https://c/a.mp3", "k").catch((e) => e);
    expect(classifyWaveSpeedSubmitError(err)).toBe("balance");
  });

  it("a 503 answer classifies as transient (provider answered, nothing issued)", async () => {
    fetchMock.mockResolvedValue(jsonResponse(503, { message: "service unavailable" }));
    const err = await waveSpeedSubmit("https://c/v.mp4", "https://c/a.mp3", "k").catch((e) => e);
    expect(classifyWaveSpeedSubmitError(err)).toBe("transient");
  });

  it("a 422 answer classifies as permanent", async () => {
    fetchMock.mockResolvedValue(jsonResponse(422, { message: "invalid input" }));
    const err = await waveSpeedSubmit("https://c/v.mp4", "https://c/a.mp3", "k").catch((e) => e);
    expect(classifyWaveSpeedSubmitError(err)).toBe("permanent");
  });

  it("a no-response submit classifies as transport — the poller must never resubmit it", async () => {
    fetchMock.mockRejectedValue(new Error("fetch failed"));
    const err = await waveSpeedSubmit("https://c/v.mp4", "https://c/a.mp3", "k").catch((e) => e);
    expect(err).toBeInstanceOf(WaveSpeedError);
    expect(err.status).toBeNull();
    expect(classifyWaveSpeedSubmitError(err)).toBe("transport");
    expect(fetchMock).toHaveBeenCalledTimes(1); // exactly one attempt, no retry inside the client
  });
});

describe("waveSpeedStatus + normalizeWaveSpeedStatus", () => {
  it("reads the outputs list of a completed prediction", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { data: { status: "completed", outputs: ["https://cdn/out.mp4"] } }),
    );
    const job = await waveSpeedStatus("pred-1", "ws-key");
    expect(job.status).toBe("completed");
    expect(job.outputUrl).toBe("https://cdn/out.mp4");
    expect(normalizeWaveSpeedStatus(job)).toBe("completed");
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("https://ws.example/api/v3/predictions/pred-1/result");
  });

  it("terminal failure spellings all normalize to failed", () => {
    for (const s of ["failed", "cancelled", "timeout", "deleted"]) {
      expect(normalizeWaveSpeedStatus({ status: s })).toBe("failed");
    }
    expect(normalizeWaveSpeedStatus({ status: "created" })).toBe("pending");
    expect(normalizeWaveSpeedStatus({ status: "processing" })).toBe("processing");
  });
});

describe("buildResolutionMeta — downscale honesty", () => {
  it("flags the known LatentSync downscale (672x1344 in, 432x880 out)", () => {
    const meta = buildResolutionMeta({ width: 672, height: 1344 }, { width: 432, height: 880 });
    expect(meta.resolutionReduced).toBe(true);
    expect(meta.inputWidth).toBe(672);
    expect(meta.outputHeight).toBe(880);
  });

  it("same or larger output is not reduced", () => {
    expect(
      buildResolutionMeta({ width: 672, height: 1344 }, { width: 672, height: 1344 })
        .resolutionReduced,
    ).toBe(false);
    expect(
      buildResolutionMeta({ width: 432, height: 880 }, { width: 672, height: 1344 })
        .resolutionReduced,
    ).toBe(false);
  });

  it("an unprobeable side stays unknown (null), never a silent false", () => {
    expect(buildResolutionMeta({ width: 672, height: 1344 }, null).resolutionReduced).toBeNull();
    expect(buildResolutionMeta(null, { width: 432, height: 880 }).resolutionReduced).toBeNull();
    expect(buildResolutionMeta(null, null)).toEqual({
      inputWidth: null,
      inputHeight: null,
      outputWidth: null,
      outputHeight: null,
      resolutionReduced: null,
    });
  });
});
