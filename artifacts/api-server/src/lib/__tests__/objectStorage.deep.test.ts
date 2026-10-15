/**
 * Deep-walk leaf-guard tests for refreshSupabaseStorageUrlsDeep /
 * refreshSignedGcsUrlsDeep.
 *
 * Both walkers used to rebuild EVERY object via Object.entries. A Date
 * has no entries, so Date values in refreshed payloads (created_at-style
 * fields across profile / storefront / social reads) came out as {} —
 * and Buffers / class instances were mangled the same way. The walkers
 * now only descend into arrays and plain objects; any other object is a
 * leaf and must pass through as the very same instance.
 *
 * String handling must stay identical: only strings are ref-refreshed.
 * The witnesses below are network-free by construction — a public-bucket
 * URL returns byte-identical on the documented R2-miss path, and a
 * provably-expired legacy GCS URL (which the Supabase walker nulls out)
 * proves string processing really ran inside nested structures.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  refreshSupabaseStorageUrlsDeep,
  refreshSignedGcsUrlsDeep,
  ARTIST_REFERENCES_BUCKET,
} from "../objectStorage";

const PROJECT = "https://example.supabase.co";
const ENV_KEYS = ["SUPABASE_URL", "VITE_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  process.env["SUPABASE_URL"] = PROJECT;
  process.env["SUPABASE_SERVICE_ROLE_KEY"] = "service-role-key";
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

/** Issued 2020-01-01 with a 60s life — provably expired, no clock games. */
const EXPIRED_GCS_URL =
  "https://storage.googleapis.com/some-bucket/clips/old.mp4" +
  "?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Date=20200101T000000Z" +
  "&X-Goog-Expires=60&X-Goog-SignedHeaders=host&X-Goog-Signature=deadbeef";

const PUBLIC_REF = `${PROJECT}/storage/v1/object/public/${ARTIST_REFERENCES_BUCKET}/vaults/abc/pic.jpg`;

class Marker {
  constructor(public clip = EXPIRED_GCS_URL) {}
}

describe("refreshSupabaseStorageUrlsDeep — non-plain values are leaves", () => {
  it("passes a top-level Date through as the same instance", async () => {
    const when = new Date("2026-10-14T04:00:00.000Z");
    await expect(refreshSupabaseStorageUrlsDeep(when)).resolves.toBe(when);
  });

  it("keeps Dates, Buffers and class instances intact inside a mixed payload, while still processing strings", async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error("this payload must not need the network");
    });
    vi.stubGlobal("fetch", fetchSpy);

    const createdAt = new Date("2026-09-01T12:30:00.000Z");
    const updatedAt = new Date("2026-10-01T08:15:00.000Z");
    const blob = Buffer.from("fake-bytes");
    const marker = new Marker();
    const nullProto: Record<string, unknown> = Object.create(null);
    nullProto["deadClip"] = EXPIRED_GCS_URL;
    nullProto["at"] = updatedAt;

    const out = await refreshSupabaseStorageUrlsDeep({
      id: 7,
      title: "plain string",
      createdAt,
      cover: PUBLIC_REF,
      nested: {
        updatedAt,
        tags: ["keep me", EXPIRED_GCS_URL],
        blob,
        marker,
        nothing: null,
        flag: true,
      },
      list: [{ at: createdAt }, "text", 42],
      nullProto,
    });

    // Leaves: same instances, values untouched.
    expect(out.createdAt).toBe(createdAt);
    expect(out.createdAt.getTime()).toBe(Date.parse("2026-09-01T12:30:00.000Z"));
    expect(out.nested.updatedAt).toBe(updatedAt);
    expect(out.list[0]).toEqual({ at: createdAt });
    expect((out.list[0] as { at: Date }).at).toBe(createdAt);
    expect(out.nested.blob).toBe(blob);
    expect(out.nested.blob.toString()).toBe("fake-bytes");
    expect(out.nested.marker).toBe(marker);
    // Leaf semantics: the string INSIDE a class instance is not walked.
    expect(out.nested.marker.clip).toBe(EXPIRED_GCS_URL);

    // Plain structure: walked, strings processed exactly as before.
    expect(out.id).toBe(7);
    expect(out.title).toBe("plain string");
    expect(out.cover).toBe(PUBLIC_REF); // public-bucket URL: byte-identical on the R2-miss path
    expect(out.nested.tags).toEqual(["keep me", null]); // expired GCS nulled — processing ran
    expect(out.nested.nothing).toBeNull();
    expect(out.nested.flag).toBe(true);
    expect(out.list[1]).toBe("text");
    expect(out.list[2]).toBe(42);

    // Null-prototype objects still count as plain and keep walking.
    expect(out.nullProto["deadClip"]).toBeNull();
    expect(out.nullProto["at"]).toBe(updatedAt);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("passes top-level scalars through untouched", async () => {
    await expect(refreshSupabaseStorageUrlsDeep(null)).resolves.toBeNull();
    await expect(refreshSupabaseStorageUrlsDeep(42)).resolves.toBe(42);
    await expect(refreshSupabaseStorageUrlsDeep("plain")).resolves.toBe("plain");
    await expect(refreshSupabaseStorageUrlsDeep(true)).resolves.toBe(true);
  });
});

describe("refreshSupabaseStorageUrlsDeep — malformed % escapes survive the walk", () => {
  it("passes a payload containing one malformed-% URL among normal values through without rejecting", async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error("this payload must not need the network");
    });
    vi.stubGlobal("fetch", fetchSpy);

    const malformedPublic = `${PROJECT}/storage/v1/object/public/${ARTIST_REFERENCES_BUCKET}/vaults/50%off/pic%zz.jpg`;
    const payload = {
      id: 9,
      title: "normal values",
      cover: malformedPublic,
      nested: { tags: ["keep me", malformedPublic], count: 3, flag: false, nothing: null },
      list: [malformedPublic, "plain text"],
    };

    let out: typeof payload | undefined;
    await expect(
      (async () => {
        out = await refreshSupabaseStorageUrlsDeep(payload);
      })(),
    ).resolves.not.toThrow();

    // Malformed-% public URL: parsed with its raw segment preserved, and
    // returned byte-identical on the documented viaPublicUrl R2-miss path.
    expect(out!.cover).toBe(malformedPublic);
    expect(out!.nested.tags).toEqual(["keep me", malformedPublic]);
    expect(out!.list).toEqual([malformedPublic, "plain text"]);
    // Normal values untouched.
    expect(out!.id).toBe(9);
    expect(out!.title).toBe("normal values");
    expect(out!.nested.count).toBe(3);
    expect(out!.nested.flag).toBe(false);
    expect(out!.nested.nothing).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("refreshSignedGcsUrlsDeep — non-plain values are leaves", () => {
  it("keeps Dates intact in a nested payload (signing offline → strings unchanged)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline — signing must fail soft");
      }),
    );
    const createdAt = new Date("2026-08-20T00:00:00.000Z");
    const out = await refreshSignedGcsUrlsDeep({
      title: "scene data",
      createdAt,
      scenes: [{ at: createdAt, demoClipUrl: "https://storage.googleapis.com/b/clip.mp4?X-Goog-Signature=x" }],
    });
    expect(out.createdAt).toBe(createdAt);
    expect(out.scenes[0].at).toBe(createdAt);
    expect(out.scenes[0].demoClipUrl).toBe(
      "https://storage.googleapis.com/b/clip.mp4?X-Goog-Signature=x",
    );
    expect(out.title).toBe("scene data");
  });
});
