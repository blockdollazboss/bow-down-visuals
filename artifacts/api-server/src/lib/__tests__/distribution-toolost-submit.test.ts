/**
 * Too Lost release submission — the provider client (Front 14).
 *
 * The whole provider is mocked at the fetch seam. What is pinned:
 *   - the five pipeline steps hit their documented endpoints in order;
 *   - the metadata call ALWAYS carries isAiGenerated, and carries
 *     aiDocumentation exactly when the release is AI-generated;
 *   - the client REFUSES to send an AI declaration without its rights
 *     documentation (guard in the client, not only at the route);
 *   - { data: … } envelopes and numeric ids are tolerated;
 *   - failures surface as TooLostApiError with OUR step sentence — a
 *     raw provider body never appears in the message;
 *   - a 401 keeps its status on the error (the route's refresh+retry
 *     depends on it).
 */
import { describe, it, expect } from "vitest";
import {
  createToolostRelease, requestToolostTrackUploadUrl, requestToolostArtworkUploadUrl,
  uploadToolostBytes, fetchToolostSourceFile, attachToolostTracks,
  patchToolostReleaseMetadata, submitToolostRelease, TooLostApiError,
  type FetchImpl,
} from "../distribution-toolost";

interface RecordedCall { url: string; method: string; headers: any; body: any }

function recordingFetch(handler: (url: string, init: any) => { status?: number; body?: unknown }) {
  const calls: RecordedCall[] = [];
  const impl = (async (url: any, init: any) => {
    const parsedBody = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
    calls.push({ url: String(url), method: init?.method ?? "GET", headers: init?.headers ?? {}, body: parsedBody });
    const r = handler(String(url), init);
    return {
      ok: (r.status ?? 200) < 400,
      status: r.status ?? 200,
      json: async () => r.body ?? {},
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      headers: { get: (h: string) => (h === "content-type" ? "audio/wav" : null) },
    } as unknown as Response;
  }) as unknown as FetchImpl;
  return { calls, impl };
}

describe("createToolostRelease", () => {
  it("returns the id as a string from a flat body, and from the { data } envelope with a numeric id", async () => {
    const flat = recordingFetch(() => ({ body: { id: "rel-1" } }));
    await expect(createToolostRelease("tok", flat.impl)).resolves.toBe("rel-1");
    expect(flat.calls[0]!.url).toBe("https://api.toolost.com/v1/releases");
    expect(flat.calls[0]!.method).toBe("POST");
    expect(flat.calls[0]!.headers.Authorization).toBe("Bearer tok");

    const env = recordingFetch(() => ({ body: { data: { id: 73518 } } }));
    await expect(createToolostRelease("tok", env.impl)).resolves.toBe("73518");
  });

  it("refuses a success body with no id — the draft wasn't confirmed", async () => {
    const { impl } = recordingFetch(() => ({ body: {} }));
    await expect(createToolostRelease("tok", impl)).rejects.toBeInstanceOf(TooLostApiError);
  });
});

describe("upload ticket + bytes", () => {
  it("requests a track ticket with kind audio and PUTs the raw bytes with the ticket's headers", async () => {
    const { calls, impl } = recordingFetch((url) => {
      if (url.endsWith("/tracks/upload-url")) return { body: { uploadUrl: "https://s3.example.com/put-audio", fileKey: "audio-key-1", headers: { "Content-Type": "audio/wav" } } };
      return { body: {} };
    });
    const ticket = await requestToolostTrackUploadUrl("tok", "rel 1", { fileName: "track-audio.wav", contentType: "audio/wav" }, impl);
    expect(ticket).toEqual({ uploadUrl: "https://s3.example.com/put-audio", fileKey: "audio-key-1", headers: { "Content-Type": "audio/wav" } });
    expect(calls[0]!.url).toBe("https://api.toolost.com/v1/releases/rel%201/tracks/upload-url");
    expect(calls[0]!.body).toEqual({ kind: "audio", fileName: "track-audio.wav", contentType: "audio/wav" });

    const bytes = new Uint8Array([7, 8, 9]);
    await uploadToolostBytes(ticket, bytes, impl);
    const put = calls[1]!;
    expect(put.url).toBe("https://s3.example.com/put-audio");
    expect(put.method).toBe("PUT");
    expect(put.body).toBe(bytes);
    expect(put.headers).toEqual({ "Content-Type": "audio/wav" });
    expect(put.headers.Authorization).toBeUndefined();
  });

  it("requests an artwork ticket without a kind field", async () => {
    const { calls, impl } = recordingFetch(() => ({ body: { data: { uploadUrl: "https://s3.example.com/put-art", fileKey: "cover-key-1", headers: {} } } }));
    const ticket = await requestToolostArtworkUploadUrl("tok", "r1", { fileName: "cover.png", contentType: "image/png" }, impl);
    expect(ticket.fileKey).toBe("cover-key-1");
    expect(calls[0]!.url).toBe("https://api.toolost.com/v1/releases/r1/artwork/upload-url");
    expect(calls[0]!.body).toEqual({ fileName: "cover.png", contentType: "image/png" });
  });

  it("a failed PUT is a sanitized error, and a ticket missing its URL is refused", async () => {
    const failing = recordingFetch(() => ({ status: 403, body: { message: "RAW_S3_MARKER" } }));
    const err = await uploadToolostBytes({ uploadUrl: "https://s3.example.com/x", fileKey: "k", headers: {} }, new Uint8Array([1]), failing.impl).catch((e) => e);
    expect(err).toBeInstanceOf(TooLostApiError);
    expect((err as Error).message).not.toContain("RAW_S3_MARKER");

    const empty = recordingFetch(() => ({ body: {} }));
    await expect(requestToolostTrackUploadUrl("tok", "r1", { fileName: "a.wav", contentType: "audio/wav" }, empty.impl)).rejects.toBeInstanceOf(TooLostApiError);
  });
});

describe("fetchToolostSourceFile", () => {
  it("returns the bytes and content type of OUR stored file", async () => {
    const { impl } = recordingFetch(() => ({ body: {} }));
    const file = await fetchToolostSourceFile("https://files.example.com/track.wav", "couldn't read it", impl);
    expect(Array.from(file.bytes)).toEqual([1, 2, 3]);
    expect(file.contentType).toBe("audio/wav");
  });

  it("fails with the caller's plain message when the file can't be read", async () => {
    const { impl } = recordingFetch(() => ({ status: 404, body: {} }));
    const err = await fetchToolostSourceFile("https://files.example.com/gone.wav", "We couldn't read this release's audio file.", impl).catch((e) => e);
    expect(err).toBeInstanceOf(TooLostApiError);
    expect((err as Error).message).toBe("We couldn't read this release's audio file.");
  });
});

describe("attach + metadata + submit", () => {
  it("attaches the audio key per track, PATCHes metadata WITH the AI declaration, then submits — in order", async () => {
    const { calls, impl } = recordingFetch(() => ({ body: {} }));
    await attachToolostTracks("tok", "r1", [{ title: "Song A", isrc: "USRC10000001", audioFileKey: "audio-key-1" }], impl);
    await patchToolostReleaseMetadata("tok", "r1", {
      title: "Song A", artistName: "Creator One", genre: "hip-hop", explicit: false,
      coverFileKey: "cover-key-1",
      isAiGenerated: true,
      aiDocumentation: { fileName: "rights.pdf", fileUrl: "https://files.example.com/rights.pdf" },
    }, impl);
    await submitToolostRelease("tok", "r1", impl);

    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "PUT https://api.toolost.com/v1/releases/r1/tracks",
      "PATCH https://api.toolost.com/v1/releases/r1/metadata",
      "POST https://api.toolost.com/v1/releases/r1/submit",
    ]);
    expect(calls[0]!.body).toEqual({ tracks: [{ title: "Song A", isrc: "USRC10000001", audioFileKey: "audio-key-1" }] });
    const meta = calls[1]!.body;
    expect(meta.isAiGenerated).toBe(true);
    expect(meta.aiDocumentation).toEqual({ fileName: "rights.pdf", fileUrl: "https://files.example.com/rights.pdf" });
    expect(meta.coverFileKey).toBe("cover-key-1");
    expect(meta).not.toHaveProperty("coverUrl");
  });

  it("a non-AI metadata call carries isAiGenerated false and NO aiDocumentation key", async () => {
    const { calls, impl } = recordingFetch(() => ({ body: {} }));
    await patchToolostReleaseMetadata("tok", "r1", { title: "Song A", isAiGenerated: false }, impl);
    expect(calls[0]!.body.isAiGenerated).toBe(false);
    expect(calls[0]!.body).not.toHaveProperty("aiDocumentation");
  });

  it("REFUSES to send an AI declaration without its documentation — fetch never fires", async () => {
    const { calls, impl } = recordingFetch(() => ({ body: {} }));
    const err = await patchToolostReleaseMetadata("tok", "r1", { title: "Song A", isAiGenerated: true }, impl).catch((e) => e);
    expect(err).toBeInstanceOf(TooLostApiError);
    expect((err as Error).message).toContain("rights documentation");
    expect(calls).toHaveLength(0);
  });

  it("provider failures are sanitized: status kept (401 retry depends on it), raw body never in the message", async () => {
    const raw = recordingFetch(() => ({ status: 422, body: { message: "RAW_PROVIDER_MARKER_XYZ validation failed: field coverUrl" } }));
    const err = await patchToolostReleaseMetadata("tok", "r1", { title: "Song A", isAiGenerated: false }, raw.impl).catch((e) => e);
    expect(err).toBeInstanceOf(TooLostApiError);
    expect((err as TooLostApiError).toolostStatus).toBe(422);
    expect((err as Error).message).not.toContain("RAW_PROVIDER_MARKER_XYZ");

    const unauth = recordingFetch(() => ({ status: 401, body: { message: "token expired" } }));
    const err401 = await submitToolostRelease("tok", "r1", unauth.impl).catch((e) => e);
    expect((err401 as TooLostApiError).toolostStatus).toBe(401);
  });
});
