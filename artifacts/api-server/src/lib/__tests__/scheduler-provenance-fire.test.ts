/* Provenance at fire time (Stack-100 #3, wave 3) — the worker fires a
   claimed post from the snapshot stamped on the row at schedule time:
   - Instagram/Facebook receive the caption WITH the AI-disclosure line
     appended (their publish calls take caption text — a real channel);
   - TikTok's publisher receives only video bytes (its draft upload has
     no caption/label field) and its result honestly records
     disclosure: "record_only" — nothing pretends the label posted;
   - a post with no snapshot fires exactly as before, with no
     disclosure field claimed on any result. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AttemptStore } from "../social-idempotency";
import type { ScheduledPost, SchedulerPlatform } from "@workspace/db";
import { __testHooks, type SchedulerDeps } from "../scheduler-jobs";

const { fireScheduledPost } = __testHooks;

const SNAPSHOT = {
  assetId: "gen:abc-123",
  title: "Shark Anthem",
  tool: "AI Video Clip",
  model: "Runway",
  aiGenerated: true,
  licence: "cc-by-4.0",
  disclosureLine:
    "This video was created with AI assistance using AI Video Clip (Runway) on Bow Down Visuals.",
  linkedAt: "2026-10-24T12:00:00.000Z",
};

function makePost(overrides: Partial<ScheduledPost> = {}): ScheduledPost {
  return {
    id: "post-1",
    user_id: "user-1",
    status: "publishing",
    media_url: "https://cdn.example.com/clip.mp4",
    media_type: "video",
    caption: "New drop",
    hashtags: "#shark",
    platforms: ["instagram", "tiktok", "facebook"] as SchedulerPlatform[],
    account_ids: { instagram: "acct-ig", tiktok: "acct-tt", facebook: "acct-fb" },
    scheduled_at: new Date(Date.now() - 60_000),
    posted_at: null,
    attempts: 1,
    last_error: null,
    credits_charged: 100,
    credits_refunded: false,
    release_id: null,
    provenance: SNAPSHOT,
    ai_best_time: null,
    results: [],
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  } as ScheduledPost;
}

function makeAttemptStore(): AttemptStore {
  let seq = 0;
  const done = new Map<string, any>();
  return {
    async insertAttempt(input: any) {
      const k = `${input.userId}:${input.idempotencyKey}`;
      if (done.has(k)) return { inserted: false, id: null };
      seq += 1;
      done.set(k, { id: `att-${seq}`, status: "processing", result: null });
      return { inserted: true, id: `att-${seq}` };
    },
    async getAttempt(userId: string, k: string) {
      const r = done.get(`${userId}:${k}`);
      return (r ? { id: r.id, status: r.status, result: r.result } : null) as never;
    },
    async reclaimAttempt() { return false; },
    async claimStaleProcessing() { return []; },
    async markCreditsDeducted() {},
    async completeAttempt(id: string, result: any) {
      const r = [...done.values()].find((x) => x.id === id);
      if (r) { r.status = "succeeded"; r.result = result; }
    },
    async failAttempt(id: string) {
      const r = [...done.values()].find((x) => x.id === id);
      if (r) r.status = "failed";
    },
  } as unknown as AttemptStore;
}

function makeDeps() {
  const seen = {
    igCaption: "", fbDescription: "", ttCalls: 0,
  };
  const updates: Array<{ id: string; patch: Partial<ScheduledPost> }> = [];
  const deps: SchedulerDeps = {
    attemptStore: makeAttemptStore(),
    claimDue: async () => [],
    updatePost: async (id, patch) => { updates.push({ id, patch }); },
    refund: async () => {},
    now: () => new Date("2026-10-24T12:00:00Z"),
    loadAccount: async (_u, platform) => ({
      accessToken: "tok",
      igUserId: platform === "instagram" ? "ig-1" : null,
      pageId: platform === "facebook" ? "page-1" : null,
    }),
    downloadVideo: async () => Buffer.from("bytes"),
    publishers: {
      instagram: async (input) => { seen.igCaption = input.caption; return { mediaId: "ig-1", permalink: null }; },
      instagramImage: async (input) => { seen.igCaption = input.caption; return { mediaId: "ig-1", permalink: null }; },
      tiktok: async () => { seen.ttCalls += 1; return { publishId: "tt-1" }; },
      facebook: async (input) => { seen.fbDescription = input.description; return { videoId: "fb-1", permalink: "https://fb/v/1" }; },
      facebookPhoto: async (input) => { seen.fbDescription = input.caption; return { photoId: "fb-1", permalink: "https://fb/p/1" }; },
    },
  };
  return { deps, seen, updates };
}

beforeEach(() => vi.clearAllMocks());

describe("fireScheduledPost with a provenance snapshot", () => {
  it("appends the disclosure line to the Instagram + Facebook captions and records caption delivery", async () => {
    const { deps, seen, updates } = makeDeps();
    const settled = await fireScheduledPost(makePost(), deps);
    expect(settled.status).toBe("posted");
    expect(seen.igCaption).toBe(`New drop\n#shark\n\n${SNAPSHOT.disclosureLine}`);
    expect(seen.fbDescription).toBe(`New drop\n#shark\n\n${SNAPSHOT.disclosureLine}`);
    const results = updates.find((u) => u.patch.status === "posted")!.patch.results!;
    expect(results.find((r) => r.platform === "instagram")!.disclosure).toBe("caption");
    expect(results.find((r) => r.platform === "facebook")!.disclosure).toBe("caption");
  });

  it("TikTok gets NO disclosure claim — result records record_only and the publisher took bytes only", async () => {
    const { deps, seen, updates } = makeDeps();
    await fireScheduledPost(makePost(), deps);
    expect(seen.ttCalls).toBe(1);
    const results = updates.find((u) => u.patch.status === "posted")!.patch.results!;
    const tt = results.find((r) => r.platform === "tiktok")!;
    expect(tt.status).toBe("posted");
    expect(tt.disclosure).toBe("record_only");
  });

  it("a non-AI snapshot fires with not_applicable and untouched captions", async () => {
    const { deps, seen, updates } = makeDeps();
    await fireScheduledPost(
      makePost({ provenance: { ...SNAPSHOT, aiGenerated: false, disclosureLine: "" } }),
      deps,
    );
    expect(seen.igCaption).toBe("New drop\n#shark");
    const results = updates.find((u) => u.patch.status === "posted")!.patch.results!;
    expect(results.every((r) => r.disclosure === "not_applicable")).toBe(true);
  });

  it("no snapshot → results carry no disclosure field at all (nothing claimed)", async () => {
    const { deps, seen, updates } = makeDeps();
    await fireScheduledPost(makePost({ provenance: null }), deps);
    expect(seen.igCaption).toBe("New drop\n#shark");
    const results = updates.find((u) => u.patch.status === "posted")!.patch.results!;
    expect(results.every((r) => !("disclosure" in r))).toBe(true);
  });
});
