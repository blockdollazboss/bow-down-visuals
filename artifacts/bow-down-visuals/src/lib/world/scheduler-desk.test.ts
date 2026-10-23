/**
 * scheduler-desk — Stack-100 #45/#46.
 * The in-world Scheduler desk rides the 2D scheduler page's own
 * rails (POST/PATCH/DELETE /api/scheduler/posts, POST
 * /api/scheduler/best-time, GET /api/social/accounts). These tests
 * pin the shaping: compose → payload → scheduled post listed;
 * account resolution; validation in words; best-time slots.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SCHEDULER_BEST_TIME_COST_VISUAL_BUCS,
  SCHEDULER_POST_COST_VISUAL_BUCS,
  SOCIAL_CONNECT_PLATFORMS,
  accountsForPlatform,
  buildReschedulePayload,
  calendarMonthCells,
  calendarMonthLabel,
  calendarPostsByDay,
  calendarToday,
  composeWhenForDay,
  parseSchedulerAccountStates,
  parseSocialAuthUrl,
  planDeskReschedule,
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
  schedulerSavedReceipt,
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

describe("the desk component rides the real rails (source pins)", () => {
  const desk = readFileSync(
    new URL("../../components/world/native/SchedulerDesk.tsx", import.meta.url),
    "utf8",
  );
  const shared = readFileSync(
    new URL("../../components/world/native/CreateDeskShared.tsx", import.meta.url),
    "utf8",
  );
  const thumb = readFileSync(
    new URL("../../components/world/native/ThumbnailBenches.tsx", import.meta.url),
    "utf8",
  );

  it("compose/list/edit/delete/best-time all call the scheduler rails, charged calls confirmed", () => {
    expect(desk).toContain('fetch("/api/scheduler/posts"');
    expect(desk).toContain("`/api/scheduler/posts/${editing.id}`");
    expect(desk).toContain("`/api/scheduler/posts/${post.id}`");
    expect(desk).toContain('method: "DELETE"');
    expect(desk).toContain('confirmedFetch("/api/scheduler/best-time"');
    expect(desk).toContain('fetch("/api/social/accounts"');
    expect(desk).toContain('data-testid="world-scheduler-compose"');
    expect(desk).toContain('data-testid="world-scheduler-post-edit"');
    expect(desk).toContain('data-testid="world-scheduler-post-delete"');
    expect(desk).toContain('data-testid="world-scheduler-best-time-use"');
  });

  it("no world surface exits to the 2D scheduler anymore (#46)", () => {
    for (const src of [desk, shared, thumb]) {
      expect(src).not.toContain("scheduleHrefForMedia");
      expect(src).not.toContain("/scheduler?schedule=1");
    }
    // The chip is a button opening the compose in place.
    expect(shared).toContain('data-testid="world-create-chip-schedule"');
    expect(shared).toContain("<SchedulerComposeStandalone");
    expect(shared).not.toContain("scheduleHref");
    expect(thumb).toContain('data-testid="world-thumbnail-schedule"');
    expect(thumb).toContain("schedulePrefillForMedia(winner");
  });
});

describe("full surface (#57) — calendar, reschedule, connect", () => {
  const post = (over: Partial<import("./scheduler-desk").SchedulerDeskPost> = {}) => ({
    id: "p1",
    caption: "Drop day",
    hashtags: "",
    platforms: ["instagram" as const],
    accountIds: {},
    mediaUrl: "https://cdn.example/clip.mp4",
    mediaType: "video" as const,
    scheduledAt: "2026-10-24T18:30:00.000Z",
    status: "scheduled",
    creditsCharged: 100,
    ...over,
  });

  it("groups only scheduled posts by local day, in time order", () => {
    const byDay = calendarPostsByDay([
      post({ id: "late", scheduledAt: new Date(2026, 9, 24, 20, 0).toISOString() }),
      post({ id: "early", scheduledAt: new Date(2026, 9, 24, 9, 0).toISOString() }),
      post({ id: "draft", status: "draft", scheduledAt: null }),
      post({ id: "other", scheduledAt: new Date(2026, 9, 25, 9, 0).toISOString() }),
    ]);
    const key24 = [...byDay.keys()].find((k) => k.endsWith("-24"))!;
    expect(byDay.get(key24)?.map((p) => p.id)).toEqual(["early", "late"]);
    expect([...byDay.values()].flat().some((p) => p.id === "draft")).toBe(false);
  });

  it("month cells carry leading blanks and real dates; label names the month", () => {
    const cells = calendarMonthCells(2026, 9); // October 2026 starts on a Thursday
    expect(cells.filter((c) => c.date === null)).toHaveLength(4);
    expect(cells.find((c) => c.date)?.date).toBe("2026-10-01");
    expect(cells.filter((c) => c.date !== null)).toHaveLength(31);
    expect(calendarMonthLabel(2026, 9)).toBe("October 2026");
    expect(calendarToday(new Date(2026, 9, 22, 15, 0).getTime())).toBe("2026-10-22");
    expect(composeWhenForDay("2026-10-25")).toBe("2026-10-25T12:00");
  });

  it("reschedule plans mirror the 2D calendar: move keeps time of day, same-day noops, past refuses", () => {
    const now = new Date(2026, 9, 22, 12, 0).getTime();
    const p = post({ scheduledAt: new Date(2026, 9, 24, 18, 30).toISOString() });
    const move = planDeskReschedule(p, "2026-10-26", now);
    expect(move.kind).toBe("move");
    if (move.kind === "move") {
      const d = new Date(move.scheduledAt);
      expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 9, 26, 18, 30]);
      expect(buildReschedulePayload(move.scheduledAt)).toEqual({ scheduledAt: move.scheduledAt });
    }
    expect(planDeskReschedule(p, "2026-10-24", now).kind).toBe("noop");
    expect(planDeskReschedule(p, "2026-10-21", now).kind).toBe("past");
    expect(planDeskReschedule(post({ scheduledAt: null }), "2026-10-26", now).kind).toBe("invalid");
  });

  it("account states read connected / expired / none from the raw payload — never conflated", () => {
    const states = parseSchedulerAccountStates({
      accounts: [
        { platform: "instagram", username: "@king", expired: false },
        { platform: "tiktok", username: "@old", expired: true },
      ],
    });
    expect(states.find((s) => s.platform === "instagram")?.state).toBe("connected");
    expect(states.find((s) => s.platform === "tiktok")?.state).toBe("expired");
    expect(states.find((s) => s.platform === "facebook")?.state).toBe("none");
    expect(parseSchedulerAccountStates(null).every((s) => s.state === "none")).toBe(true);
  });

  it("connect rails are the website's auth-url paths; the auth URL parses defensively", () => {
    expect(SOCIAL_CONNECT_PLATFORMS.map((p) => p.authPath)).toEqual([
      "/api/social/instagram/auth-url",
      "/api/social/tiktok/auth-url",
      "/api/social/facebook/auth-url",
    ]);
    expect(parseSocialAuthUrl({ authUrl: "https://oauth.example/start" })).toBe("https://oauth.example/start");
    expect(parseSocialAuthUrl({})).toBeNull();
    expect(parseSocialAuthUrl(null)).toBeNull();
  });

});

describe("schedule-success receipt (Stack-100 #2 item 71)", () => {
  const post = (over: Record<string, unknown> = {}) => ({
    id: "p1",
    caption: "New clip out Friday",
    hashtags: "",
    platforms: ["instagram", "tiktok"],
    accountIds: {},
    mediaUrl: "https://cdn.example/clip.mp4",
    mediaType: "video" as const,
    scheduledAt: "2026-10-24T17:30:00.000Z",
    status: "scheduled",
    creditsCharged: 100,
    ...over,
  });

  it("names the title, the when and the channels from the server's post", () => {
    const line = schedulerSavedReceipt(post(), draft(), true);
    expect(line).toContain("Scheduled — “New clip out Friday”");
    expect(line).toContain("Oct"); // the formatted when (prettyDateTime)
    expect(line).toContain("Instagram and TikTok");
    expect(line).toContain("calendar below");
  });

  it("falls back to the just-saved draft when the response didn't parse — never inventing a when it lacks", () => {
    const line = schedulerSavedReceipt(null, draft({ whenLocal: "2026-10-25T09:15", platforms: ["facebook"] }), true);
    expect(line).toContain("“New clip out”");
    expect(line).toContain("Facebook");
    const bare = schedulerSavedReceipt(null, draft({ whenLocal: "", platforms: [] }), true);
    expect(bare).toContain("Scheduled — “New clip out”.");
    expect(bare).not.toContain(" for ");
    expect(bare).not.toContain("Instagram");
  });

  it("a draft's receipt is honest that nothing is scheduled yet", () => {
    const line = schedulerSavedReceipt(null, draft(), false);
    expect(line).toContain("Saved as a draft");
    expect(line).toContain("free");
    expect(line).not.toContain("Scheduled —");
  });

  it("long captions truncate; an empty caption reads as the post itself", () => {
    const long = schedulerSavedReceipt(post({ caption: "x".repeat(90) }), draft(), true);
    expect(long).toContain("…");
    expect(long.length).toBeLessThan(220);
    expect(schedulerSavedReceipt(post({ caption: "  " }), draft({ caption: "" }), true)).toContain("“Your post”");
  });

  it("the desk renders the receipt through the helper (source pin)", () => {
    const desk = readFileSync(
      new URL("../../components/world/native/SchedulerDesk.tsx", import.meta.url),
      "utf8",
    );
    expect(desk).toContain("setSavedLine(schedulerSavedReceipt(post, draft, willSchedule))");
    expect(desk).toContain('data-testid="world-scheduler-saved"');
  });
});

describe("full surface (#57) — the desk component (source pins)", () => {
  it("the desk renders the calendar, drag/move and connect surfaces (source pins)", () => {
    const desk = readFileSync(
      new URL("../../components/world/native/SchedulerDesk.tsx", import.meta.url),
      "utf8",
    );
    expect(desk).toContain('data-testid="world-scheduler-calendar"');
    expect(desk).toContain('data-testid="world-scheduler-cal-chip"');
    expect(desk).toContain("draggable");
    expect(desk).toContain('data-testid="world-scheduler-post-move"');
    expect(desk).toContain('data-testid="world-scheduler-accounts"');
    expect(desk).toContain("window.location.href = url");
    expect(desk).toContain("`/api/social/accounts/${account.id}`");
    expect(desk).toContain("buildReschedulePayload(plan.scheduledAt)");
  });
});
