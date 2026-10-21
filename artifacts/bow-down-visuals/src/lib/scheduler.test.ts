import { describe, it, expect } from "vitest";
import {
  combineLocalDateTime,
  countdownLabel,
  groupPostsByDay,
  isFutureLocal,
  monthGridDays,
  movePostToDate,
  normalizeHashtags,
  planReschedule,
  postingAccountStates,
  prettyDateTime,
  scheduleCost,
  timeLocal,
  todayLocal,
  toLocalDate,
  type PostingAccountLike,
  type ScheduledPostShape,
} from "./scheduler";

function post(overrides: Partial<ScheduledPostShape> = {}): ScheduledPostShape {
  return {
    id: "p1",
    status: "scheduled",
    mediaUrl: "supabase://generated-clips/x.mp4",
    mediaType: "video",
    caption: "hi",
    hashtags: "#a",
    platforms: ["instagram"],
    accountIds: { instagram: "a1" },
    scheduledAt: "2026-09-28T18:00:00.000Z",
    postedAt: null,
    attempts: 1,
    lastError: null,
    creditsCharged: 1,
    releaseId: null,
    results: [],
    createdAt: "2026-09-25T00:00:00.000Z",
    updatedAt: "2026-09-25T00:00:00.000Z",
    ...overrides,
  };
}

describe("toLocalDate / todayLocal / timeLocal", () => {
  it("formats a date in local time", () => {
    const d = new Date(2026, 8, 28, 9, 5); // Sep 28 2026, local
    expect(toLocalDate(d)).toBe("2026-09-28");
    expect(timeLocal(d)).toBe("09:05");
  });

  it("todayLocal matches the real today", () => {
    const now = new Date();
    expect(todayLocal()).toBe(toLocalDate(now));
  });
});

describe("combineLocalDateTime / isFutureLocal", () => {
  it("combines date and time into a local Date", () => {
    const d = combineLocalDateTime("2026-09-28", "18:30");
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(8);
    expect(d!.getDate()).toBe(28);
    expect(d!.getHours()).toBe(18);
    expect(d!.getMinutes()).toBe(30);
  });

  it("rejects malformed input", () => {
    expect(combineLocalDateTime("09/28/2026", "18:30")).toBeNull();
    expect(combineLocalDateTime("2026-09-28", "6pm")).toBeNull();
    expect(combineLocalDateTime("", "")).toBeNull();
  });

  it("isFutureLocal requires at least a minute ahead", () => {
    const past = new Date(Date.now() - 60_000);
    expect(isFutureLocal(toLocalDate(past), timeLocal(past))).toBe(false);
    const future = new Date(Date.now() + 2 * 3_600_000);
    expect(isFutureLocal(toLocalDate(future), timeLocal(future))).toBe(true);
  });
});

describe("movePostToDate", () => {
  it("keeps the local time-of-day when moving days", () => {
    // 2026-09-28T18:30 local → build from a local datetime to avoid TZ drift
    const local = combineLocalDateTime("2026-09-28", "18:30")!;
    const moved = movePostToDate(local.toISOString(), "2026-10-02");
    expect(moved).not.toBeNull();
    const d = new Date(moved!);
    expect(toLocalDate(d)).toBe("2026-10-02");
    expect(d.getHours()).toBe(18);
    expect(d.getMinutes()).toBe(30);
  });

  it("returns null for bad input", () => {
    expect(movePostToDate("not-a-date", "2026-10-02")).toBeNull();
    expect(movePostToDate(new Date().toISOString(), "10/02/2026")).toBeNull();
  });
});

describe("planReschedule", () => {
  const at = (date: string, time: string) => combineLocalDateTime(date, time)!.toISOString();
  const nowSep27Noon = combineLocalDateTime("2026-09-27", "12:00")!.getTime();

  it("plans a move to the target day, keeping the local time-of-day", () => {
    const plan = planReschedule(post({ scheduledAt: at("2026-09-28", "18:30") }), "2026-10-02", nowSep27Noon);
    expect(plan.kind).toBe("move");
    if (plan.kind === "move") {
      const d = new Date(plan.scheduledAt);
      expect(toLocalDate(d)).toBe("2026-10-02");
      expect(timeLocal(d)).toBe("18:30");
    }
  });

  it("is a noop when dropped on the day the post already sits on", () => {
    expect(planReschedule(post({ scheduledAt: at("2026-09-28", "18:30") }), "2026-09-28", nowSep27Noon))
      .toEqual({ kind: "noop" });
  });

  it("refuses a move that would land in the past (the server's 60-second rule)", () => {
    const now = combineLocalDateTime("2026-09-28", "17:59")!.getTime() + 30_000;
    expect(planReschedule(post({ scheduledAt: at("2026-09-28", "18:30") }), "2026-09-27", now))
      .toEqual({ kind: "past" });
    /* Dropping tomorrow's 9am post onto today at 3pm also lands in the past. */
    const nowAfternoon = combineLocalDateTime("2026-09-28", "15:00")!.getTime();
    expect(planReschedule(post({ scheduledAt: at("2026-09-29", "09:00") }), "2026-09-28", nowAfternoon))
      .toEqual({ kind: "past" });
  });

  it("is invalid without a scheduled time or with an unparseable target", () => {
    expect(planReschedule(post({ scheduledAt: null }), "2026-10-02", nowSep27Noon)).toEqual({ kind: "invalid" });
    expect(planReschedule(post({ scheduledAt: at("2026-09-28", "18:30") }), "10/02/2026", nowSep27Noon))
      .toEqual({ kind: "invalid" });
  });
});

describe("postingAccountStates", () => {
  const acct = (over: Partial<PostingAccountLike> = {}): PostingAccountLike => ({
    platform: "instagram",
    username: "trgdy",
    pageName: null,
    usernameMasked: "tr•••",
    expired: false,
    ...over,
  });

  it("reports all three platforms in order, none connected by default", () => {
    const states = postingAccountStates([]);
    expect(states.map((s) => s.platform)).toEqual(["instagram", "tiktok", "facebook"]);
    expect(states.every((s) => s.state === "none" && s.accountLabel === null)).toBe(true);
  });

  it("marks a usable account connected, labeled by its masked username", () => {
    const states = postingAccountStates([acct()]);
    expect(states[0]).toEqual({ platform: "instagram", state: "connected", accountLabel: "tr•••" });
  });

  it("prefers the usable account when an expired twin also exists", () => {
    const states = postingAccountStates([
      acct({ usernameMasked: "old•••", expired: true }),
      acct({ usernameMasked: "new•••", expired: false }),
    ]);
    expect(states[0]).toEqual({ platform: "instagram", state: "connected", accountLabel: "new•••" });
  });

  it("calls an all-expired platform expired — never 'none'", () => {
    const states = postingAccountStates([acct({ expired: true })]);
    expect(states[0]).toEqual({ platform: "instagram", state: "expired", accountLabel: "tr•••" });
  });

  it("labels a Facebook account by its page name when it has one", () => {
    const states = postingAccountStates([
      acct({ platform: "facebook", pageName: "Bow Down Visuals", usernameMasked: null }),
    ]);
    expect(states[2]).toEqual({ platform: "facebook", state: "connected", accountLabel: "Bow Down Visuals" });
  });

  it("falls back to the raw username when no masked form exists", () => {
    const states = postingAccountStates([acct({ platform: "tiktok", usernameMasked: null, username: "trgdy" })]);
    expect(states[1]).toEqual({ platform: "tiktok", state: "connected", accountLabel: "trgdy" });
  });
});

describe("groupPostsByDay", () => {
  it("groups by local date and sorts by time", () => {
    const a = post({ id: "a", scheduledAt: combineLocalDateTime("2026-09-28", "18:00")!.toISOString() });
    const b = post({ id: "b", scheduledAt: combineLocalDateTime("2026-09-28", "09:00")!.toISOString() });
    const c = post({ id: "c", scheduledAt: combineLocalDateTime("2026-09-29", "12:00")!.toISOString() });
    const draft = post({ id: "d", status: "draft", scheduledAt: null });
    const map = groupPostsByDay([a, b, c, draft]);
    expect(map.get("2026-09-28")!.map((p) => p.id)).toEqual(["b", "a"]);
    expect(map.get("2026-09-29")!.map((p) => p.id)).toEqual(["c"]);
    expect(map.size).toBe(2);
  });
});

describe("countdownLabel", () => {
  const now = new Date("2026-09-25T12:00:00Z").getTime();
  it("formats minutes, hours, and days", () => {
    expect(countdownLabel(new Date(now + 20 * 60_000).toISOString(), now)).toBe("in 20m");
    expect(countdownLabel(new Date(now + 3 * 3_600_000).toISOString(), now)).toBe("in 3h");
    expect(countdownLabel(new Date(now + 3.5 * 3_600_000).toISOString(), now)).toBe("in 3h 30m");
    expect(countdownLabel(new Date(now + 50 * 3_600_000).toISOString(), now)).toBe("in 2d 2h");
  });

  it("says due now for past times", () => {
    expect(countdownLabel(new Date(now - 1_000).toISOString(), now)).toBe("due now");
  });
});

describe("prettyDateTime", () => {
  it("renders a readable local label", () => {
    const label = prettyDateTime(combineLocalDateTime("2026-09-28", "18:00")!.toISOString());
    expect(label).toContain("Sep 28");
    expect(label).toContain("6:00 PM");
  });
});

describe("scheduleCost", () => {
  it("costs a flat 1 credit per post, regardless of platform count", () => {
    expect(scheduleCost([])).toBe(0);
    expect(scheduleCost(["instagram"])).toBe(1);
    expect(scheduleCost(["instagram", "tiktok", "facebook"])).toBe(1);
  });
});

describe("normalizeHashtags", () => {
  it("adds #, dedupes, and drops empties", () => {
    expect(normalizeHashtags("sharkking, #music video  #sharkking")).toBe("#sharkking #music #video");
    expect(normalizeHashtags("")).toBe("");
  });
});

describe("monthGridDays", () => {
  it("pads leading blanks so day 1 lands on its weekday", () => {
    // Sep 2026: Sep 1 is a Tuesday → 2 leading blanks
    const cells = monthGridDays(2026, 8);
    expect(cells[0]!.date).toBeNull();
    expect(cells[1]!.date).toBeNull();
    expect(cells[2]!.date).toBe("2026-09-01");
    expect(cells[cells.length - 1]!.date).toBe("2026-09-30");
  });
});
