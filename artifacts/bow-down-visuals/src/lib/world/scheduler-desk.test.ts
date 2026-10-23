/**
 * scheduler-desk — Stack-100 #45/#46.
 * The in-world Scheduler desk rides the 2D scheduler page's own
 * rails (POST/PATCH/DELETE /api/scheduler/posts, POST
 * /api/scheduler/best-time, GET /api/social/accounts). These tests
 * pin the shaping: compose → payload → scheduled post listed;
 * account resolution; validation in words; best-time slots.
 */
import { describe, expect, it } from "vitest";
import {
  SCHEDULER_BEST_TIME_COST_VISUAL_BUCS,
  SCHEDULER_POST_COST_VISUAL_BUCS,
  accountsForPlatform,
  bestTimeSlotWhen,
  buildBestTimePayload,
  buildSchedulerCreatePayload,
  buildSchedulerUpdatePayload,
  composeFromPost,
  emptySchedulerCompose,
  fromDatetimeLocalValue,
  isSchedulableWhen,
  parseBestTimeResult,
  parseSchedulerAccounts,
  parseSchedulerDeleteResult,
  parseSchedulerDeskPosts,
  parseSchedulerPostResponse,
  resolveAccountId,
  sortSchedulerDeskPosts,
  toDatetimeLocalValue,
  validateSchedulerCompose,
  type SchedulerAccount,
  type SchedulerComposeDraft,
} from "./scheduler-desk";

const ACCOUNTS: SchedulerAccount[] = [
  { id: "a-ig", platform: "instagram", label: "@king", expired: false },
  { id: "a-ig-old", platform: "instagram", label: "@old", expired: true },
  { id: "a-tt", platform: "tiktok", label: "@kingtt", expired: false },
];

const NOW = new Date("2026-10-22T12:00:00Z").getTime();

function draft(over: Partial<SchedulerComposeDraft> = {}): SchedulerComposeDraft {
  return {
    mediaUrl: "https://cdn.example/clip.mp4",
    mediaType: "video",
    caption: "New clip out",
    hashtags: "#bdv",
    platforms: ["instagram"],
    accountIds: {},
    whenLocal: "2026-10-23T18:30",
    ...over,
  };
}

describe("accounts — the composer's per-platform picks", () => {
  it("parses the /social/accounts shape and drops unknown platforms", () => {
    const parsed = parseSchedulerAccounts({
      accounts: [
        { id: "1", platform: "instagram", username: "king", pageName: null, expired: false },
        { id: "2", platform: "youtube", username: "nope", expired: false },
        { id: "3", platform: "facebook", username: null, pageName: "King Page", expired: true },
        { platform: "tiktok", username: "no-id" },
      ],
    });
    expect(parsed).toEqual([
      { id: "1", platform: "instagram", label: "king", expired: false },
      { id: "3", platform: "facebook", label: "King Page", expired: true },
    ]);
    expect(parseSchedulerAccounts(null)).toEqual([]);
    expect(parseSchedulerAccounts({})).toEqual([]);
  });

  it("resolves the explicit pick, else the first live account; expired never resolves", () => {
    expect(resolveAccountId(ACCOUNTS, "instagram", "a-ig")).toBe("a-ig");
    expect(resolveAccountId(ACCOUNTS, "instagram", undefined)).toBe("a-ig");
    expect(resolveAccountId(ACCOUNTS, "instagram", "a-ig-old")).toBe("a-ig");
    expect(resolveAccountId(ACCOUNTS, "facebook", undefined)).toBeNull();
    expect(accountsForPlatform(ACCOUNTS, "tiktok").map((a) => a.id)).toEqual(["a-tt"]);
  });
});

describe("compose → scheduled → listed (the #45 flow's shaping)", () => {
  it("a valid compose builds the rail's POST body with a resolved account and ISO time", () => {
    const payload = buildSchedulerCreatePayload(draft(), ACCOUNTS, true);
    expect(payload).toMatchObject({
      mediaUrl: "https://cdn.example/clip.mp4",
      mediaType: "video",
      caption: "New clip out",
      hashtags: "#bdv",
      platforms: ["instagram"],
      accountIds: { instagram: "a-ig" },
    });
    expect(typeof payload["scheduledAt"]).toBe("string");
    expect(new Date(payload["scheduledAt"] as string).getTime()).toBeGreaterThan(NOW);
  });

  it("saving without a time omits scheduledAt — the rail's free draft", () => {
    const payload = buildSchedulerCreatePayload(draft({ whenLocal: "" }), ACCOUNTS, false);
    expect("scheduledAt" in payload).toBe(false);
  });

  it("the created post parses back and lists as scheduled, soonest first", () => {
    const created = parseSchedulerPostResponse({
      post: {
        id: "p-new",
        caption: "New clip out",
        hashtags: "#bdv",
        platforms: ["instagram"],
        accountIds: { instagram: "a-ig" },
        mediaUrl: "https://cdn.example/clip.mp4",
        mediaType: "video",
        scheduledAt: "2026-10-23T22:30:00.000Z",
        status: "scheduled",
        creditsCharged: 100,
      },
    });
    expect(created?.status).toBe("scheduled");
    expect(created?.creditsCharged).toBe(100);

    const listed = parseSchedulerDeskPosts({
      posts: [
        { id: "d1", caption: "draft", platforms: [], scheduledAt: null, status: "draft" },
        { id: "p-late", caption: "later", platforms: ["tiktok"], scheduledAt: "2026-10-25T10:00:00Z", status: "scheduled" },
        created,
        { caption: "no id — dropped", status: "scheduled", scheduledAt: "2026-10-24T10:00:00Z" },
      ],
    });
    expect(listed.map((p) => p.id)).toEqual(["d1", "p-late", "p-new"]);
    expect(sortSchedulerDeskPosts(listed).map((p) => p.id)).toEqual(["p-new", "p-late", "d1"]);
    // A draft keeps its null time (the desk shows drafts too).
    expect(listed.find((p) => p.id === "d1")?.scheduledAt).toBeNull();
  });

  it("editing a post round-trips through compose and the PATCH body; unscheduling sends null", () => {
    const post = parseSchedulerDeskPosts({
      posts: [
        {
          id: "p1",
          caption: "c",
          hashtags: "h",
          platforms: ["tiktok"],
          accountIds: { tiktok: "a-tt" },
          mediaUrl: "https://cdn.example/v.mp4",
          mediaType: "video",
          scheduledAt: "2026-10-24T15:00:00.000Z",
          status: "scheduled",
        },
      ],
    })[0]!;
    const editing = composeFromPost(post);
    expect(editing.accountIds).toEqual({ tiktok: "a-tt" });
    expect(editing.whenLocal).toBe(toDatetimeLocalValue("2026-10-24T15:00:00.000Z"));
    const patch = buildSchedulerUpdatePayload(editing, ACCOUNTS, true);
    expect(patch["scheduledAt"]).toBe("2026-10-24T15:00:00.000Z");
    expect(buildSchedulerUpdatePayload(editing, ACCOUNTS, false)["scheduledAt"]).toBeNull();
  });

  it("delete results read honestly: canceled+refunded vs deleted", () => {
    expect(parseSchedulerDeleteResult({ canceled: true, refunded: 100 })).toEqual({ canceled: true, refunded: 100 });
    expect(parseSchedulerDeleteResult({ deleted: true })).toEqual({ canceled: false, refunded: 0 });
  });
});

describe("validation — the desk refuses in words before the rail can", () => {
  it("requires media, a platform, a live account per platform, and a future time to schedule", () => {
    expect(validateSchedulerCompose(draft({ mediaUrl: " " }), ACCOUNTS, { forSchedule: true, nowMs: NOW })).toContain("video or image");
    expect(validateSchedulerCompose(draft({ platforms: [] }), ACCOUNTS, { forSchedule: true, nowMs: NOW })).toContain("at least one platform");
    expect(validateSchedulerCompose(draft({ platforms: ["facebook"] }), ACCOUNTS, { forSchedule: true, nowMs: NOW })).toContain("Connect a Facebook account");
    expect(validateSchedulerCompose(draft({ whenLocal: "2026-10-22T08:00" }), ACCOUNTS, { forSchedule: true, nowMs: NOW })).toContain("at least a minute from now");
    expect(validateSchedulerCompose(draft(), ACCOUNTS, { forSchedule: true, nowMs: NOW })).toBeNull();
    // A draft skips the time gate entirely.
    expect(validateSchedulerCompose(draft({ whenLocal: "" }), ACCOUNTS, { forSchedule: false, nowMs: NOW })).toBeNull();
  });

  it("the time helpers agree with the rail's >1-minute rule", () => {
    expect(isSchedulableWhen("2026-10-22T08:00", NOW)).toBe(false);
    expect(fromDatetimeLocalValue("")).toBeNull();
    expect(fromDatetimeLocalValue("not-a-date")).toBeNull();
    expect(toDatetimeLocalValue("not-a-date")).toBe("");
  });

  it("a prefill (a desk's finished creation) seeds the compose — #46's chips", () => {
    const seeded = emptySchedulerCompose({ mediaUrl: "https://cdn.example/card.png", mediaType: "image", caption: "Card" });
    expect(seeded).toMatchObject({ mediaUrl: "https://cdn.example/card.png", mediaType: "image", caption: "Card", platforms: [] });
    expect(emptySchedulerCompose().mediaUrl).toBe("");
  });
});

describe("best time — payload, slots, and the honest price constants", () => {
  it("builds the rail's payload with postsPerWeek clamped to its schema", () => {
    expect(buildBestTimePayload({ niche: " Music ", platforms: ["tiktok"], postsPerWeek: 99, timezone: "America/Chicago" })).toEqual({
      niche: "Music",
      platforms: ["tiktok"],
      postsPerWeek: 14,
      timezone: "America/Chicago",
    });
  });

  it("parses slots, drops malformed ones, and a slot fills the composer's time", () => {
    const { slots, note } = parseBestTimeResult({
      slots: [
        { date: "2026-10-24", time: "18:00", platform: "tiktok", reason: "Evening scroll peak" },
        { date: "2026-10-25", time: "11:30", platform: "myspace", reason: "bad platform" },
        { date: "x", platform: "instagram" },
      ],
      note: "Pattern-based.",
    });
    expect(slots).toEqual([{ date: "2026-10-24", time: "18:00", platform: "tiktok", reason: "Evening scroll peak" }]);
    expect(note).toBe("Pattern-based.");
    expect(bestTimeSlotWhen(slots[0]!)).toBe("2026-10-24T18:00");
    expect(parseBestTimeResult(null)).toEqual({ slots: [], note: null });
  });

  it("prices are the rails' own — shown before anything runs, never invented here", () => {
    // scheduler.ts: SCHEDULER_POST_CREDITS / SCHEDULER_BEST_TIME_CREDITS
    // default to 100; the 2D page's costNote says the same in words.
    expect(SCHEDULER_POST_COST_VISUAL_BUCS).toBe(100);
    expect(SCHEDULER_BEST_TIME_COST_VISUAL_BUCS).toBe(100);
  });
});
