/**
 * $0 verification suite for the Sync.so submit path hardening:
 *  - classifySubmitError: transient (429/plan-limit) vs transport vs permanent
 *  - submitDeferralBackoffMs: 5 → 10 → 20 → 40 min, capped
 *  - ensureSupabaseBucket: REST-pattern bucket ensure (fetch mocked)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LIP_SYNC_AUDIO_BUCKET,
  MAX_SUBMIT_DEFERRALS,
  SyncLabsError,
  classifySubmitError,
  ensureSupabaseBucket,
  submitDeferralBackoffMs,
} from "../sync-labs";

describe("classifySubmitError", () => {
  it("HTTP 429 is transient", () => {
    expect(classifySubmitError(new SyncLabsError("Sync Labs submit failed: HTTP 429 — x", 429))).toBe("transient");
  });

  it("plan-concurrency messages are transient even without a status", () => {
    expect(classifySubmitError(new Error("only 3 concurrent generations allowed on your plan"))).toBe("transient");
    expect(classifySubmitError(new Error("Plan limit reached, try again later"))).toBe("transient");
    expect(classifySubmitError(new Error("rate limit exceeded"))).toBe("transient");
  });

  it("5xx is transient", () => {
    expect(classifySubmitError(new SyncLabsError("Sync Labs submit failed: HTTP 503 — x", 503))).toBe("transient");
  });

  it("4xx other than 429 is permanent", () => {
    expect(classifySubmitError(new SyncLabsError("Sync Labs submit failed: HTTP 422 — bad payload", 422))).toBe("permanent");
    expect(classifySubmitError(new SyncLabsError("Sync Labs submit failed: HTTP 401 — bad key", 401))).toBe("permanent");
    expect(classifySubmitError(new SyncLabsError("Sync Labs returned no job ID.", null))).toBe("permanent");
  });

  it("network failures are transport (re-queue, don't defer or fail)", () => {
    expect(classifySubmitError(new Error("fetch failed"))).toBe("transport");
    expect(classifySubmitError(new Error("The operation was aborted"))).toBe("transport");
  });
});

describe("submitDeferralBackoffMs", () => {
  it("grows 5 → 10 → 20 → 40 minutes and caps", () => {
    expect(submitDeferralBackoffMs(0)).toBe(5 * 60_000);
    expect(submitDeferralBackoffMs(1)).toBe(10 * 60_000);
    expect(submitDeferralBackoffMs(2)).toBe(20 * 60_000);
    expect(submitDeferralBackoffMs(3)).toBe(40 * 60_000);
    expect(submitDeferralBackoffMs(35)).toBe(40 * 60_000);
  });

  it("clamps negative deferrals", () => {
    expect(submitDeferralBackoffMs(-1)).toBe(5 * 60_000);
  });

  it("the deferral cap covers roughly a day", () => {
    // 5+10+20+40*33 min ≈ 22.4h — a full day of provider congestion before failing.
    const totalMin = 5 + 10 + 20 + 40 * (MAX_SUBMIT_DEFERRALS - 3);
    expect(totalMin).toBeGreaterThan(20 * 60);
    expect(MAX_SUBMIT_DEFERRALS).toBe(36);
  });
});

describe("ensureSupabaseBucket", () => {
  type MockResp = { status: number; body?: unknown };
  interface Call {
    url: string;
    method: string;
    body?: string;
  }

  function mockFetchSequence(responses: MockResp[]): Call[] {
    const calls: Call[] = [];
    const queue = [...responses];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown, init?: { method?: string; body?: string }) => {
        const next = queue.shift();
        calls.push({ url: String(input), method: init?.method ?? "GET", body: init?.body });
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
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    process.env["SUPABASE_URL"] = "https://test.supabase.co";
    process.env["SUPABASE_SERVICE_ROLE_KEY"] = "test-service-key";
    delete process.env["VITE_SUPABASE_URL"];
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    vi.unstubAllGlobals();
  });

  it("returns early when the bucket already exists", async () => {
    const calls = mockFetchSequence([{ status: 200 }]);
    await ensureSupabaseBucket();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain(`/storage/v1/bucket/${LIP_SYNC_AUDIO_BUCKET}`);
  });

  it("creates then verifies a missing bucket", async () => {
    const calls = mockFetchSequence([{ status: 404 }, { status: 200 }, { status: 200 }]);
    await ensureSupabaseBucket();
    expect(calls).toHaveLength(3);
    const create = calls[1];
    expect(create.method).toBe("POST");
    const body = JSON.parse(create.body!);
    expect(body.id).toBe(LIP_SYNC_AUDIO_BUCKET);
    expect(body).not.toHaveProperty("file_size_limit");
  });

  it("tolerates 409 already-exists on create", async () => {
    const calls = mockFetchSequence([{ status: 404 }, { status: 409 }, { status: 200 }]);
    await ensureSupabaseBucket();
    expect(calls).toHaveLength(3);
  });

  it("throws loudly when creation fails", async () => {
    mockFetchSequence([{ status: 404 }, { status: 500, body: "boom" }]);
    await expect(ensureSupabaseBucket()).rejects.toThrow(/Failed to create Supabase bucket/);
  });

  it("throws when the bucket is still missing after create (silent-create regression)", async () => {
    // The old supabase-js bug: create "succeeds" but the bucket never appears.
    mockFetchSequence([{ status: 404 }, { status: 200 }, { status: 404 }]);
    await expect(ensureSupabaseBucket()).rejects.toThrow(/still missing after create attempt/);
  });

  it("throws when Supabase env is not configured", async () => {
    delete process.env["SUPABASE_URL"];
    delete process.env["SUPABASE_SERVICE_ROLE_KEY"];
    await expect(ensureSupabaseBucket()).rejects.toThrow(/not configured/);
  });
});
