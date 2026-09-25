import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AttemptStore } from "../social-idempotency";
import type {
  ScheduledPost,
  SchedulerPlatform,
} from "@workspace/db";
import {
  __testHooks,
  SCHEDULER_MAX_ATTEMPTS,
  type SchedulerDeps,
} from "../scheduler-jobs";
import {
  sanitizeBestTime,
  scheduledPostSchema,
  SCHEDULER_POST_CREDITS,
} from "../../routes/scheduler";

const { fireScheduledPost, publishDueScheduledPosts, normalizePost, fullCaption } = __testHooks;

/* ── Fakes ─────────────────────────────────────────────────────────────── */

function makePost(overrides: Partial<ScheduledPost> = {}): ScheduledPost {
  return {
    id: "post-1",
    user_id: "user-1",
    status: "scheduled",
    media_url: "https://cdn.example.com/clip.mp4",
    media_type: "video",
    caption: "Bow down",
    hashtags: "#sharkking",
    platforms: ["instagram", "tiktok"] as SchedulerPlatform[],
    account_ids: { instagram: "acct-ig", tiktok: "acct-tt" },
    scheduled_at: new Date(Date.now() - 60_000),
    posted_at: null,
    attempts: 1,
    last_error: null,
    credits_charged: 1,
    credits_refunded: false,
    ai_best_time: null,
    results: [],
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  } as ScheduledPost;
}

/** In-memory AttemptStore honoring the claim/replay/in_progress state machine. */
function makeAttemptStore() {
  const rows = new Map<string, { id: string; status: string; result: unknown; creditsDeducted: boolean; updatedAt: Date }>();
  let seq = 0;
  const calls = { completed: 0, marked: 0, failed: 0 };
  const store: AttemptStore = {
    async insertAttempt(input) {
      const k = `${input.userId}:${input.idempotencyKey}`;
      if (rows.has(k)) return { inserted: false, id: null };
      seq += 1;
      const id = `att-${seq}`;
      rows.set(k, { id, status: "processing", result: null, creditsDeducted: false, updatedAt: new Date() });
      return { inserted: true, id };
    },
    async getAttempt(userId, k) {
      const r = rows.get(`${userId}:${k}`);
      return (r ? {
        id: r.id, user_id: userId, platform: "instagram", idempotency_key: k,
        account_id: null, status: r.status, credits_deducted: r.creditsDeducted,
        result: r.result, error: null, created_at: r.updatedAt, updated_at: r.updatedAt,
      } : null) as never;
    },
    async reclaimAttempt(input) {
      const r = [...rows.values()].find((x) => x.id === input.id);
      if (!r || r.status !== input.expectedStatus) return false;
      r.status = "processing";
      r.updatedAt = new Date();
      return true;
    },
    async claimStaleProcessing() { return []; },
    async markCreditsDeducted(id) {
      calls.marked += 1;
      const r = [...rows.values()].find((x) => x.id === id);
      if (r) r.creditsDeducted = true;
    },
    async completeAttempt(id, result) {
      calls.completed += 1;
      const r = [...rows.values()].find((x) => x.id === id);
      if (r) { r.status = "succeeded"; r.result = result; }
    },
    async failAttempt(id) {
      calls.failed += 1;
      const r = [...rows.values()].find((x) => x.id === id);
      if (r) r.status = "failed";
    },
  };
  return { store, calls, rows };
}

function makeDeps(overrides: Partial<SchedulerDeps> = {}) {
  const { store, calls } = makeAttemptStore();
  const updates: Array<{ id: string; patch: Partial<ScheduledPost> }> = [];
  const refunds: Array<{ userId: string; amount: number }> = [];
  let claimed: ScheduledPost[] = [];
  const { publishers: publisherOverrides, ...rest } = overrides;
  const deps: SchedulerDeps = {
    attemptStore: store,
    claimDue: async () => claimed,
    updatePost: async (id, patch) => { updates.push({ id, patch }); },
    refund: async (userId, amount) => { refunds.push({ userId, amount }); },
    now: () => new Date("2026-09-25T12:00:00Z"),
    loadAccount: async (_userId, platform, _accountId) => ({
      accessToken: "tok",
      igUserId: platform === "instagram" ? "ig-user-1" : null,
      pageId: platform === "facebook" ? "page-1" : null,
    }),
    downloadVideo: async () => Buffer.from("fake-video-bytes"),
    publishers: {
      instagram: async () => ({ mediaId: "ig-1", permalink: "https://ig/p/1" }),
      tiktok: async () => ({ publishId: "tt-1" }),
      facebook: async () => ({ videoId: "fb-1", permalink: "https://fb/v/1" }),
      ...(publisherOverrides ?? {}),
    },
    ...rest,
  };
  return {
    deps, updates, refunds, attemptCalls: calls,
    setClaimed: (posts: ScheduledPost[]) => { claimed = posts; },
  };
}

beforeEach(() => vi.clearAllMocks());

describe("scheduler-jobs", () => {
  it("fires a due post across all platforms and marks it posted", async () => {
    const { deps, updates, setClaimed, attemptCalls } = makeDeps();
    setClaimed([makePost()]);
    const n = await publishDueScheduledPosts(deps);
    expect(n).toBe(1);
    expect(attemptCalls.completed).toBe(2); // instagram + tiktok
    expect(attemptCalls.marked).toBe(2); // credits were reserved at schedule time
    const terminal = updates.find((u) => u.patch.status === "posted");
    expect(terminal).toBeDefined();
    expect(terminal!.patch.posted_at).toBeInstanceOf(Date);
    expect(terminal!.patch.results).toHaveLength(2);
    expect(terminal!.patch.results!.every((r) => r.status === "posted")).toBe(true);
  });

  it("retries failed platforms on the next tick before giving up", async () => {
    const failing = makeDeps({
      publishers: {
        instagram: async () => { throw new Error("Meta exploded"); },
      },
    });
    failing.setClaimed([makePost({ attempts: 1 })]);
    await publishDueScheduledPosts(failing.deps);
    // attempts (1) < max (3): back to scheduled for retry, NO refund yet
    const retry = failing.updates.find((u) => u.patch.status === "scheduled");
    expect(retry).toBeDefined();
    expect(retry!.patch.scheduled_at).toBeInstanceOf(Date);
    expect(failing.refunds).toHaveLength(0);
    expect(failing.attemptCalls.failed).toBe(1);
  });

  it("does NOT refund on partial success — the post delivered to a platform", async () => {
    const failing = makeDeps({
      publishers: {
        instagram: async () => { throw new Error("Meta exploded"); },
        tiktok: async () => ({ publishId: "tt-ok" }),
      },
    });
    failing.setClaimed([makePost({ attempts: SCHEDULER_MAX_ATTEMPTS })]);
    await publishDueScheduledPosts(failing.deps);
    const terminal = failing.updates.find((u) => u.patch.status === "posted");
    expect(terminal).toBeDefined(); // tiktok posted → posted with partial results
    const results = terminal!.patch.results!;
    expect(results.find((r) => r.platform === "instagram")!.status).toBe("failed");
    expect(results.find((r) => r.platform === "tiktok")!.status).toBe("posted");
    // posted to tiktok → no refund
    expect(failing.refunds).toHaveLength(0);
  });

  it("refunds the 1-credit reservation when no platform posts", async () => {
    const failing = makeDeps({
      publishers: {
        instagram: async () => { throw new Error("nope"); },
        tiktok: async () => { throw new Error("nope"); },
      },
    });
    failing.setClaimed([makePost({ attempts: SCHEDULER_MAX_ATTEMPTS })]);
    await publishDueScheduledPosts(failing.deps);
    const terminal = failing.updates.find((u) => u.patch.status === "failed");
    expect(terminal).toBeDefined();
    expect(terminal!.patch.last_error).toContain("instagram");
    expect(failing.refunds).toEqual([{ userId: "user-1", amount: 1 }]);
  });

  it("replays an already-posted platform instead of posting twice (crash recovery)", async () => {
    const shared = makeAttemptStore();
    // Simulate a previous pass that completed the instagram attempt.
    const first = makeDeps({ attemptStore: shared.store });
    first.setClaimed([makePost({ platforms: ["instagram"] })]);
    await publishDueScheduledPosts(first.deps);
    expect(shared.calls.completed).toBe(1);

    // Second fire with the same deterministic key → replay, no new provider call.
    let providerCalls = 0;
    const second = makeDeps({
      attemptStore: shared.store,
      publishers: { instagram: async () => { providerCalls += 1; return { mediaId: "ig-2", permalink: null }; } },
    });
    const post = makePost({ platforms: ["instagram"] });
    await fireScheduledPost(post, second.deps);
    expect(providerCalls).toBe(0);
    const terminal = second.updates.find((u) => u.patch.status === "posted");
    expect(terminal).toBeDefined();
    expect(terminal!.patch.results![0].mediaId).toBe("ig-1"); // replayed result
  });

  it("skips a platform whose account is missing and reports it", async () => {
    const { deps, updates } = makeDeps();
    const post = makePost({ account_ids: { instagram: "acct-ig" } }); // tiktok missing
    await fireScheduledPost(post, deps);
    const terminal = updates.find((u) => u.patch.status === "posted");
    expect(terminal).toBeDefined();
    const tt = terminal!.patch.results!.find((r) => r.platform === "tiktok")!;
    expect(tt.status).toBe("skipped");
  });

  it("fails fast and refunds the 1-credit reservation when the media URL can't be resolved", async () => {
    const { deps, updates, refunds } = makeDeps();
    const post = makePost({ media_url: "not-a-url" });
    await fireScheduledPost(post, deps);
    const terminal = updates.find((u) => u.patch.status === "failed");
    expect(terminal).toBeDefined();
    expect(refunds).toEqual([{ userId: "user-1", amount: 1 }]);
  });

  it("never double-refunds a post already marked refunded", async () => {
    const { deps, refunds } = makeDeps();
    const post = makePost({ media_url: "not-a-url", credits_refunded: true });
    await fireScheduledPost(post, deps);
    expect(refunds).toHaveLength(0);
  });

  it("claims nothing when nothing is due", async () => {
    const { deps } = makeDeps();
    const n = await publishDueScheduledPosts(deps);
    expect(n).toBe(0);
  });
});

describe("normalizePost / fullCaption", () => {
  it("parses stringified jsonb columns", () => {
    const row = { ...makePost(), platforms: '["facebook"]', account_ids: '{"facebook":"a1"}', results: "[]" } as unknown as ScheduledPost;
    const p = normalizePost(row);
    expect(p.platforms).toEqual(["facebook"]);
    expect(p.account_ids).toEqual({ facebook: "a1" });
  });

  it("joins caption and hashtags with a newline", () => {
    expect(fullCaption(makePost())).toBe("Bow down\n#sharkking");
    expect(fullCaption(makePost({ hashtags: "" }))).toBe("Bow down");
  });
});

describe("sanitizeBestTime", () => {
  const platforms = ["instagram", "tiktok"] as ("instagram" | "tiktok")[];

  it("keeps valid slots and drops garbage", () => {
    const slots = sanitizeBestTime(
      [
        { date: "2026-09-28", time: "18:00", platform: "instagram", reason: "Evening scroll" },
        { date: "not-a-date", time: "18:00", platform: "tiktok" },
        { date: "2026-09-29", time: "9am", platform: "tiktok" },
        { date: "2026-09-29", time: "12:30", platform: "youtube", reason: "x".repeat(500) },
        null,
        "junk",
      ],
      platforms,
    );
    expect(slots).toHaveLength(2);
    expect(slots[0]).toMatchObject({ date: "2026-09-28", time: "18:00", platform: "instagram" });
    // unknown platform falls back to the first selected platform
    expect(slots[1].platform).toBe("instagram");
    expect(slots[1].reason.length).toBeLessThanOrEqual(160);
  });

  it("returns [] for non-arrays", () => {
    expect(sanitizeBestTime(null, platforms)).toEqual([]);
    expect(sanitizeBestTime({ slots: [] }, platforms)).toEqual([]);
  });
});

describe("scheduledPostSchema", () => {
  const base = {
    mediaUrl: "https://cdn.example.com/v.mp4",
    platforms: ["instagram"],
    accountIds: { instagram: "123e4567-e89b-12d3-a456-426614174000" },
  };

  it("accepts a valid scheduled post", () => {
    const r = scheduledPostSchema.safeParse({ ...base, scheduledAt: new Date(Date.now() + 3600_000).toISOString() });
    expect(r.success).toBe(true);
  });

  it("rejects empty platforms", () => {
    const r = scheduledPostSchema.safeParse({ ...base, platforms: [] });
    expect(r.success).toBe(false);
  });

  it("rejects unknown platforms", () => {
    const r = scheduledPostSchema.safeParse({ ...base, platforms: ["myspace"] });
    expect(r.success).toBe(false);
  });

  it("rejects empty mediaUrl", () => {
    const r = scheduledPostSchema.safeParse({ ...base, mediaUrl: "" });
    expect(r.success).toBe(false);
  });
});

describe("scheduler pricing constants", () => {
  it("scheduling costs 1 credit per post, regardless of platform count", () => {
    expect(SCHEDULER_POST_CREDITS).toBe(1);
  });
});
