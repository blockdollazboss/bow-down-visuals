/**
 * Regression tests for ensureSupabaseClipsBucket() (the video-editor upload
 * path). The old supabase-js implementation could report success without the
 * bucket actually being created, so the follow-up upload failed with
 * "Bucket not found: generated-clips". The rewrite uses the Storage REST API
 * directly and re-reads the bucket after create, throwing loudly if it is
 * still missing.
 *
 * fetch is mocked; no network, no Supabase project needed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ensureSupabaseClipsBucket,
  SUPABASE_CLIPS_BUCKET,
  ensureShopProductsBucket,
  SHOP_PRODUCTS_BUCKET,
} from "../objectStorage";

type MockResp = { status: number; body?: unknown };

interface Call {
  url: string;
  method: string;
  body?: string;
}

/** Queue canned fetch responses; returns the recorded calls. */
function mockFetchSequence(responses: MockResp[]): Call[] {
  const calls: Call[] = [];
  const queue = [...responses];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: { method?: string; body?: string }) => {
      const next = queue.shift();
      calls.push({
        url: String(input),
        method: init?.method ?? "GET",
        body: init?.body,
      });
      if (!next) throw new Error(`unexpected fetch call #${calls.length}`);
      return {
        ok: next.status >= 200 && next.status < 300,
        status: next.status,
        text: async () =>
          typeof next.body === "string" ? next.body : JSON.stringify(next.body ?? ""),
      };
    }),
  );
  return calls;
}

const ENV_KEYS = ["SUPABASE_URL", "VITE_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  process.env["SUPABASE_URL"] = "https://example.supabase.co";
  process.env["SUPABASE_SERVICE_ROLE_KEY"] = "service-role-key";
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe("ensureSupabaseClipsBucket", () => {
  it("returns early when the bucket already exists (no create call)", async () => {
    const calls = mockFetchSequence([{ status: 200, body: { id: SUPABASE_CLIPS_BUCKET } }]);
    await ensureSupabaseClipsBucket();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain(`/storage/v1/bucket/${SUPABASE_CLIPS_BUCKET}`);
    expect(calls[0].method).toBe("GET");
  });

  it("creates the bucket when missing and verifies it afterwards", async () => {
    const calls = mockFetchSequence([
      { status: 404, body: { message: "Bucket not found" } }, // getBucket
      { status: 200, body: { id: SUPABASE_CLIPS_BUCKET } }, // create
      { status: 200, body: { id: SUPABASE_CLIPS_BUCKET } }, // verify
    ]);
    await ensureSupabaseClipsBucket();
    expect(calls).toHaveLength(3);
    const createCall = calls[1];
    expect(createCall.method).toBe("POST");
    expect(createCall.url).toContain("/storage/v1/bucket");
    const createBody = JSON.parse(createCall.body ?? "{}");
    expect(createBody.id).toBe(SUPABASE_CLIPS_BUCKET);
    expect(createBody.public).toBe(false);
    // No file_size_limit — Supabase rejected it with 413 (PR #5).
    expect(createBody).not.toHaveProperty("file_size_limit");
  });

  it("treats 409 / 'already exists' from create as success", async () => {
    const calls = mockFetchSequence([
      { status: 404, body: { message: "Bucket not found" } },
      { status: 409, body: { message: "Bucket already exists" } },
      { status: 200, body: { id: SUPABASE_CLIPS_BUCKET } },
    ]);
    await ensureSupabaseClipsBucket();
    expect(calls).toHaveLength(3);
  });

  it("throws when the create request fails", async () => {
    const calls = mockFetchSequence([
      { status: 404, body: { message: "Bucket not found" } },
      { status: 500, body: { message: "internal error" } },
    ]);
    await expect(ensureSupabaseClipsBucket()).rejects.toThrow(/Failed to create Supabase bucket/);
    expect(calls).toHaveLength(2);
  });

  it("throws when the bucket is still missing after create (silent-create failure)", async () => {
    // The exact production failure: create reported no error, but the bucket
    // was never actually created. The verify step must catch this.
    const calls = mockFetchSequence([
      { status: 404, body: { message: "Bucket not found" } },
      { status: 200, body: { id: SUPABASE_CLIPS_BUCKET } },
      { status: 404, body: { message: "Bucket not found" } }, // verify
    ]);
    await expect(ensureSupabaseClipsBucket()).rejects.toThrow(/still missing after create attempt/);
    expect(calls).toHaveLength(3);
  });

  it("throws when SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured", async () => {
    delete process.env["SUPABASE_URL"];
    delete process.env["VITE_SUPABASE_URL"];
    delete process.env["SUPABASE_SERVICE_ROLE_KEY"];
    await expect(ensureSupabaseClipsBucket()).rejects.toThrow(/not configured/);
  });
});

describe("ensureShopProductsBucket", () => {
  it("returns early when the bucket already exists (no create call)", async () => {
    const calls = mockFetchSequence([{ status: 200, body: { id: SHOP_PRODUCTS_BUCKET } }]);
    await ensureShopProductsBucket();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain(`/storage/v1/bucket/${SHOP_PRODUCTS_BUCKET}`);
  });

  it("creates the bucket PUBLIC (product images serve on public storefronts)", async () => {
    const calls = mockFetchSequence([
      { status: 404, body: { message: "Bucket not found" } },
      { status: 200, body: { id: SHOP_PRODUCTS_BUCKET } },
      { status: 200, body: { id: SHOP_PRODUCTS_BUCKET } },
    ]);
    await ensureShopProductsBucket();
    expect(calls).toHaveLength(3);
    const createBody = JSON.parse(calls[1].body ?? "{}");
    expect(createBody.id).toBe(SHOP_PRODUCTS_BUCKET);
    expect(createBody.public).toBe(true);
  });

  it("throws when the bucket is still missing after create (silent-create failure)", async () => {
    mockFetchSequence([
      { status: 404, body: { message: "Bucket not found" } },
      { status: 200, body: { id: SHOP_PRODUCTS_BUCKET } },
      { status: 404, body: { message: "Bucket not found" } }, // verify
    ]);
    await expect(ensureShopProductsBucket()).rejects.toThrow(/still missing after create attempt/);
  });

  it("throws when SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured", async () => {
    delete process.env["SUPABASE_URL"];
    delete process.env["VITE_SUPABASE_URL"];
    delete process.env["SUPABASE_SERVICE_ROLE_KEY"];
    await expect(ensureShopProductsBucket()).rejects.toThrow(/not configured/);
  });
});
