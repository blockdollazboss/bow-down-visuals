/**
 * Parser tests for parseSupabaseStorageRefBucketed / refreshSupabaseStorageUrl
 * covering the public-bucket recognition added for egress driver #2:
 * pre-migration rows hold stable `/storage/v1/object/public/<bucket>/…`
 * URLs for the PUBLIC buckets (artist-references, shop-products), and
 * wired read routes can only resolve them R2-first if the parser
 * recognizes them as storage refs.
 *
 * Recognition must be exact-host + exact-bucket: the prefix is built
 * from the configured SUPABASE_URL, so URLs on any other host — and
 * public-form URLs for the PRIVATE buckets — must never parse.
 *
 * Pure parser tests (no network); the one refresh test runs with R2
 * unconfigured, where an R2 miss on a viaPublicUrl value must return
 * the stored URL byte-identical without touching Supabase.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  parseSupabaseStorageRefBucketed,
  parseSupabaseStorageRef,
  refreshSupabaseStorageUrl,
  ARTIST_REFERENCES_BUCKET,
  SHOP_PRODUCTS_BUCKET,
  SUPABASE_CLIPS_BUCKET,
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

describe("parseSupabaseStorageRefBucketed — public-bucket URLs", () => {
  it("recognizes an artist-references public URL and flags viaPublicUrl", () => {
    const parsed = parseSupabaseStorageRefBucketed(
      `${PROJECT}/storage/v1/object/public/${ARTIST_REFERENCES_BUCKET}/vaults/abc/pic.jpg`,
    );
    expect(parsed).toEqual({
      bucket: ARTIST_REFERENCES_BUCKET,
      objectPath: "vaults/abc/pic.jpg",
      viaPublicUrl: true,
    });
  });

  it("recognizes a shop-products public URL and strips the query string", () => {
    const parsed = parseSupabaseStorageRefBucketed(
      `${PROJECT}/storage/v1/object/public/${SHOP_PRODUCTS_BUCKET}/u1/products/p.png?download=1`,
    );
    expect(parsed).toEqual({
      bucket: SHOP_PRODUCTS_BUCKET,
      objectPath: "u1/products/p.png",
      viaPublicUrl: true,
    });
  });

  it("decodes URL-encoded object paths", () => {
    const parsed = parseSupabaseStorageRefBucketed(
      `${PROJECT}/storage/v1/object/public/${ARTIST_REFERENCES_BUCKET}/my%20folder/a%20b.jpg`,
    );
    expect(parsed?.objectPath).toBe("my folder/a b.jpg");
  });

  it("rejects a public-form URL for a PRIVATE bucket", () => {
    expect(
      parseSupabaseStorageRefBucketed(
        `${PROJECT}/storage/v1/object/public/${SUPABASE_CLIPS_BUCKET}/clips/a.mp4`,
      ),
    ).toBeNull();
  });

  it("rejects a public URL for an unknown bucket on our own host", () => {
    expect(
      parseSupabaseStorageRefBucketed(
        `${PROJECT}/storage/v1/object/public/avatars/u1/a.png`,
      ),
    ).toBeNull();
  });

  it("rejects a public URL on a DIFFERENT host (exact-host rule)", () => {
    expect(
      parseSupabaseStorageRefBucketed(
        `https://other-project.supabase.co/storage/v1/object/public/${ARTIST_REFERENCES_BUCKET}/x.jpg`,
      ),
    ).toBeNull();
    expect(
      parseSupabaseStorageRefBucketed(
        `https://cdn.example.com/storage/v1/object/public/${SHOP_PRODUCTS_BUCKET}/x.png`,
      ),
    ).toBeNull();
  });

  it("rejects a public URL with an empty object path", () => {
    expect(
      parseSupabaseStorageRefBucketed(
        `${PROJECT}/storage/v1/object/public/${ARTIST_REFERENCES_BUCKET}/`,
      ),
    ).toBeNull();
  });

  it("path-only variant returns the object path for a public URL", () => {
    expect(
      parseSupabaseStorageRef(
        `${PROJECT}/storage/v1/object/public/${SHOP_PRODUCTS_BUCKET}/u1/p.png`,
      ),
    ).toBe("u1/p.png");
  });
});

describe("parseSupabaseStorageRefBucketed — pre-existing forms still parse", () => {
  it("parses r2:// and supabase:// refs for the newly-known buckets", () => {
    expect(
      parseSupabaseStorageRefBucketed(`r2://${SHOP_PRODUCTS_BUCKET}/u1/products/p.png`),
    ).toEqual({ bucket: SHOP_PRODUCTS_BUCKET, objectPath: "u1/products/p.png" });
    expect(
      parseSupabaseStorageRefBucketed(`supabase://${ARTIST_REFERENCES_BUCKET}/vaults/x.jpg`),
    ).toEqual({ bucket: ARTIST_REFERENCES_BUCKET, objectPath: "vaults/x.jpg" });
  });

  it("still parses a signed URL for a private bucket", () => {
    const parsed = parseSupabaseStorageRefBucketed(
      `${PROJECT}/storage/v1/object/sign/${SUPABASE_CLIPS_BUCKET}/clips/a.mp4?token=zzz`,
    );
    expect(parsed).toEqual({ bucket: SUPABASE_CLIPS_BUCKET, objectPath: "clips/a.mp4" });
  });

  it("still returns null for unrelated and legacy GCS URLs", () => {
    expect(parseSupabaseStorageRefBucketed("https://example.com/pic.jpg")).toBeNull();
    expect(
      parseSupabaseStorageRefBucketed("https://storage.googleapis.com/some-bucket/clips/a.mp4"),
    ).toBeNull();
  });
});

describe("parseSupabaseStorageRefBucketed — malformed % escapes do not throw", () => {
  it("signed-URL branch: returns the ref with the raw segment preserved for %zz", () => {
    let parsed: ReturnType<typeof parseSupabaseStorageRefBucketed>;
    expect(() => {
      parsed = parseSupabaseStorageRefBucketed(
        `${PROJECT}/storage/v1/object/sign/${SUPABASE_CLIPS_BUCKET}/clips/100%zz.mp4?token=zzz`,
      );
    }).not.toThrow();
    expect(parsed!).toEqual({
      bucket: SUPABASE_CLIPS_BUCKET,
      objectPath: "clips/100%zz.mp4",
    });
  });

  it("signed-URL branch: returns the ref with the raw segment preserved for a trailing %", () => {
    let parsed: ReturnType<typeof parseSupabaseStorageRefBucketed>;
    expect(() => {
      parsed = parseSupabaseStorageRefBucketed(
        `${PROJECT}/storage/v1/object/sign/${SUPABASE_CLIPS_BUCKET}/clips/trailing%.mp4?token=zzz`,
      );
    }).not.toThrow();
    expect(parsed!).toEqual({
      bucket: SUPABASE_CLIPS_BUCKET,
      objectPath: "clips/trailing%.mp4",
    });
  });

  it("public-bucket branch: returns the ref with the raw segment preserved for %zz", () => {
    let parsed: ReturnType<typeof parseSupabaseStorageRefBucketed>;
    expect(() => {
      parsed = parseSupabaseStorageRefBucketed(
        `${PROJECT}/storage/v1/object/public/${ARTIST_REFERENCES_BUCKET}/vaults/50%off/pic%zz.jpg`,
      );
    }).not.toThrow();
    expect(parsed!).toEqual({
      bucket: ARTIST_REFERENCES_BUCKET,
      objectPath: "vaults/50%off/pic%zz.jpg",
      viaPublicUrl: true,
    });
  });

  it("public-bucket branch: returns the ref with the raw segment preserved for a trailing %", () => {
    let parsed: ReturnType<typeof parseSupabaseStorageRefBucketed>;
    expect(() => {
      parsed = parseSupabaseStorageRefBucketed(
        `${PROJECT}/storage/v1/object/public/${SHOP_PRODUCTS_BUCKET}/u1/products/100%.png`,
      );
    }).not.toThrow();
    expect(parsed!).toEqual({
      bucket: SHOP_PRODUCTS_BUCKET,
      objectPath: "u1/products/100%.png",
      viaPublicUrl: true,
    });
  });
});

describe("refreshSupabaseStorageUrl — public URL on an R2 miss", () => {
  it("returns the stored public URL byte-identical and never calls fetch", async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error("network must not be touched for a viaPublicUrl miss");
    });
    vi.stubGlobal("fetch", fetchSpy);
    const value = `${PROJECT}/storage/v1/object/public/${ARTIST_REFERENCES_BUCKET}/vaults/abc/pic.jpg`;
    await expect(refreshSupabaseStorageUrl(value)).resolves.toBe(value);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
