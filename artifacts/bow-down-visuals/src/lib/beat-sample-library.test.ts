/* Beat sample library — the durable-upload client: door-rule
 * validation (mirrors the server), the declare → PUT → confirm save
 * flow with honest failures, list/delete, and registry rehydration
 * through the manifest seam. Fetch is faked; buffers are stand-ins,
 * exactly like the registry treats them (opaque AudioBuffer values). */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  BEAT_SAMPLE_MAX_BYTES,
  beatSampleContentTypeForFile,
  beatSampleEntries,
  beatSampleManifestEntries,
  beatSampleSoundId,
  deleteBeatSample,
  fetchBeatSamples,
  isPersistedBeatSoundId,
  persistBeatSample,
  registerBeatSampleLibrary,
  sampleIdFromBeatSoundId,
  validateBeatSampleFile,
  type BeatSampleRecord,
} from "@/lib/beat-sample-library";
import {
  clearRegisteredBeatSounds,
  ensureBeatSampleBuffer,
  getBeatSound,
  hasSampleBuffer,
  isUnavailableSampleAssignment,
  resolveTrackSound,
} from "@/lib/beat-sounds";

const SAMPLE_ID = "123e4567-e89b-42d3-a456-426614174000";
const RECORD: BeatSampleRecord = {
  id: SAMPLE_ID,
  soundId: `upload:${SAMPLE_ID}`,
  name: "My Kick",
  kind: "kick",
  contentType: "audio/wav",
  sizeBytes: 44_100,
  url: "https://cdn.example.test/u1/beat-samples/x.wav",
};

const fakeFile = (over: Partial<{ name: string; type: string; size: number }> = {}) =>
  ({ name: "kick.wav", type: "audio/wav", size: 44_100, ...over }) as File;

function jsonRes(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response;
}

beforeEach(() => {
  clearRegisteredBeatSounds();
});

describe("door rules mirror the server", () => {
  it("accepts the picker formats by reported type", () => {
    expect(beatSampleContentTypeForFile({ name: "a.wav", type: "audio/wav" })).toBe("audio/wav");
    expect(beatSampleContentTypeForFile({ name: "a.mp3", type: "audio/mpeg" })).toBe("audio/mpeg");
    expect(beatSampleContentTypeForFile({ name: "a.ogg", type: "audio/ogg" })).toBe("audio/ogg");
    expect(validateBeatSampleFile(fakeFile()).ok).toBe(true);
  });

  it("falls back to the extension when the browser reports no useful type", () => {
    expect(beatSampleContentTypeForFile({ name: "loop.FLAC", type: "" })).toBe("audio/flac");
    expect(beatSampleContentTypeForFile({ name: "loop.m4a", type: "application/octet-stream" })).toBe("audio/mp4");
  });

  it("refuses non-audio files and oversize/empty files with named reasons", () => {
    expect(validateBeatSampleFile(fakeFile({ name: "doc.pdf", type: "application/pdf" }))).toEqual({
      ok: false, reason: "unsupported-type",
    });
    expect(validateBeatSampleFile(fakeFile({ size: BEAT_SAMPLE_MAX_BYTES + 1 }))).toEqual({
      ok: false, reason: "too-large",
    });
    expect(validateBeatSampleFile(fakeFile({ size: 0 })).ok).toBe(false);
    expect(validateBeatSampleFile(fakeFile({ size: BEAT_SAMPLE_MAX_BYTES })).ok).toBe(true);
  });
});

describe("durable id shape", () => {
  it("round-trips a saved sample id", () => {
    expect(beatSampleSoundId(SAMPLE_ID)).toBe(`upload:${SAMPLE_ID}`);
    expect(sampleIdFromBeatSoundId(`upload:${SAMPLE_ID}`)).toBe(SAMPLE_ID);
    expect(isPersistedBeatSoundId(`upload:${SAMPLE_ID}`)).toBe(true);
  });

  it("session upload ids and synth ids are not library ids", () => {
    expect(sampleIdFromBeatSoundId("upload:m5x2k9-1")).toBeNull();
    expect(isPersistedBeatSoundId("upload:m5x2k9-1")).toBe(false);
    expect(sampleIdFromBeatSoundId("synth:kick")).toBeNull();
    expect(sampleIdFromBeatSoundId(null)).toBeNull();
    expect(sampleIdFromBeatSoundId(undefined)).toBeNull();
  });
});

describe("persistBeatSample — declare, PUT, confirm", () => {
  it("runs the three steps in order and returns the ready record", async () => {
    const calls: Array<{ url: string; method?: string; headers?: Record<string, string> }> = [];
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method, headers: init?.headers as Record<string, string> });
      if (url === "/api/beat-samples") {
        return jsonRes({ sample: { id: SAMPLE_ID }, uploadUrl: "https://uploads.example.test/put?sig=1" }, true, 201);
      }
      if (url.startsWith("https://uploads.example.test")) return jsonRes({}, true);
      if (url === `/api/beat-samples/${SAMPLE_ID}/complete`) return jsonRes({ sample: RECORD });
      throw new Error(`unexpected fetch ${url}`);
    });
    const record = await persistBeatSample({
      token: "tok-1", file: fakeFile(), name: "My Kick", kind: "kick", fetcher: fetcher as unknown as typeof fetch,
    });
    expect(record).toEqual(RECORD);
    expect(calls.map((c) => c.url)).toEqual([
      "/api/beat-samples",
      "https://uploads.example.test/put?sig=1",
      `/api/beat-samples/${SAMPLE_ID}/complete`,
    ]);
    // API calls carry the session; the presigned PUT carries the type only.
    expect(calls[0]!.headers?.Authorization).toBe("Bearer tok-1");
    expect(calls[1]!.headers?.["Content-Type"]).toBe("audio/wav");
    expect(calls[1]!.headers?.Authorization).toBeUndefined();
    expect(calls[2]!.headers?.Authorization).toBe("Bearer tok-1");
  });

  it("surfaces the server's plain words when the declare step refuses, and uploads nothing", async () => {
    const fetcher = vi.fn(async () => jsonRes({ error: "That file type can't be saved as a sound." }, false, 400));
    await expect(
      persistBeatSample({ token: "t", file: fakeFile(), name: "X", kind: "kick", fetcher: fetcher as unknown as typeof fetch }),
    ).rejects.toThrow("That file type can't be saved as a sound.");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("stops before confirm when the PUT fails — no record is claimed", async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url === "/api/beat-samples") {
        return jsonRes({ sample: { id: SAMPLE_ID }, uploadUrl: "https://uploads.example.test/put" }, true, 201);
      }
      return jsonRes({}, false, 403);
    });
    await expect(
      persistBeatSample({ token: "t", file: fakeFile(), name: "X", kind: "kick", fetcher: fetcher as unknown as typeof fetch }),
    ).rejects.toThrow("couldn't be uploaded");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("refuses an oversize file before any network call", async () => {
    const fetcher = vi.fn(async () => jsonRes({}));
    await expect(
      persistBeatSample({
        token: "t", file: fakeFile({ size: BEAT_SAMPLE_MAX_BYTES + 1 }), name: "X", kind: "kick",
        fetcher: fetcher as unknown as typeof fetch,
      }),
    ).rejects.toThrow("20 MB");
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("fetchBeatSamples + deleteBeatSample", () => {
  it("parses the list and drops malformed rows instead of inventing sounds", async () => {
    const fetcher = vi.fn(async () =>
      jsonRes({ samples: [RECORD, { id: "broken" }, null, { ...RECORD, id: "x", url: "" }] }),
    );
    const records = await fetchBeatSamples("tok", fetcher as unknown as typeof fetch);
    expect(records).toEqual([RECORD]);
  });

  it("a signed-out caller has an empty library and makes no call", async () => {
    const fetcher = vi.fn(async () => jsonRes({ samples: [RECORD] }));
    await expect(fetchBeatSamples(null, fetcher as unknown as typeof fetch)).resolves.toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("a failed list load throws — the caller picks the honest degraded state", async () => {
    const fetcher = vi.fn(async () => jsonRes({ error: "Couldn't load your sound library — please try again." }, false, 500));
    await expect(fetchBeatSamples("tok", fetcher as unknown as typeof fetch)).rejects.toThrow("Couldn't load your sound library");
  });

  it("delete hits the rail and surfaces failures", async () => {
    const ok = vi.fn(async () => jsonRes({ ok: true }));
    await deleteBeatSample("tok", SAMPLE_ID, ok as unknown as typeof fetch);
    expect(ok).toHaveBeenCalledWith(`/api/beat-samples/${SAMPLE_ID}`, expect.objectContaining({ method: "DELETE" }));
    const bad = vi.fn(async () => jsonRes({ error: "That sound wasn't found in your library." }, false, 404));
    await expect(deleteBeatSample("tok", SAMPLE_ID, bad as unknown as typeof fetch)).rejects.toThrow("wasn't found");
  });
});

describe("rehydration through the registry seam", () => {
  it("manifest + picker entries carry the durable id, kind and URL", () => {
    expect(beatSampleManifestEntries([RECORD])).toEqual([
      { id: RECORD.soundId, name: "My Kick", kind: "kick", source: "upload", url: RECORD.url },
    ]);
    expect(beatSampleEntries([RECORD])[0]).toMatchObject({
      id: RECORD.soundId, source: "upload", url: RECORD.url, defaultVolume: 1,
    });
  });

  it("registered library sounds resolve as themselves once their buffer loads", async () => {
    expect(registerBeatSampleLibrary([RECORD])).toBe(1);
    const entry = getBeatSound(RECORD.soundId);
    expect(entry?.source).toBe("upload");
    // Before the bytes arrive the assignment is honestly unavailable…
    expect(isUnavailableSampleAssignment(RECORD.soundId, 0)).toBe(true);
    expect(resolveTrackSound(RECORD.soundId, 0).fellBack).toBe(true);

    const fakeBuffer = { __tag: "kick-bytes" } as unknown as AudioBuffer;
    const ctx = { decodeAudioData: async (_raw: ArrayBuffer) => fakeBuffer } as unknown as BaseAudioContext;
    const fetcher = async (url: string) => {
      expect(url).toBe(RECORD.url);
      return new ArrayBuffer(8);
    };
    const loaded = await ensureBeatSampleBuffer(entry!, ctx, fetcher);
    expect(loaded).toBe(fakeBuffer);
    expect(hasSampleBuffer(entry!)).toBe(true);
    // …and after, the saved project plays the creator's own sound.
    expect(resolveTrackSound(RECORD.soundId, 0)).toEqual({ entry, fellBack: false });
    expect(isUnavailableSampleAssignment(RECORD.soundId, 0)).toBe(false);
  });

  it("a failed buffer load keeps the honest fallback (never a dead track)", async () => {
    registerBeatSampleLibrary([RECORD]);
    const entry = getBeatSound(RECORD.soundId)!;
    const ctx = { decodeAudioData: async () => { throw new Error("bad audio"); } } as unknown as BaseAudioContext;
    await expect(ensureBeatSampleBuffer(entry, ctx, async () => new ArrayBuffer(4))).resolves.toBeNull();
    expect(resolveTrackSound(RECORD.soundId, 0).fellBack).toBe(true);
  });
});
