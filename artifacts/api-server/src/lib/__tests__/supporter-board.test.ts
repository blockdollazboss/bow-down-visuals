import { describe, expect, it } from "vitest";
import {
  SUPPORTER_BOARD_COPY,
  badgeForRank,
  buildSupporterBoard,
  sanitizePerksText,
  type SupporterFanFact,
  type SupporterTicketFact,
} from "../supporter-board";

function fan(over: Partial<SupporterFanFact> = {}): SupporterFanFact {
  return {
    fanId: "u:fan-1",
    userId: "fan-1",
    displayName: "Fan One",
    profileSlug: "fan-one",
    avatarUrl: null,
    spentUsdCents: 0,
    spentVb: 0,
    purchaseCount: 0,
    lastActivityAt: "2026-10-01T00:00:00.000Z",
    ...over,
  };
}

const noCards = new Map();
const noneOut = new Set<string>();

describe("supporter board — ranked from real support only", () => {
  it("ranks by total support on the x100 scale (VB and cents meet 1:1)", () => {
    const board = buildSupporterBoard({
      fans: [
        fan({ userId: "a", displayName: "A", spentVb: 500 }),
        fan({ userId: "b", displayName: "B", spentUsdCents: 900, purchaseCount: 2 }),
        fan({ userId: "c", displayName: "C", spentVb: 100, spentUsdCents: 100 }),
      ],
      tickets: [],
      profileCards: noCards,
      optedOutUserIds: noneOut,
      creatorUserId: "creator",
    });
    expect(board.map((e) => e.userId)).toEqual(["b", "a", "c"]);
    expect(board[0]!.totalSupport).toBe(900);
    expect(board[0]!.badge?.tier).toBe("front_row");
  });

  it("counts ticketed attendance: price counts once, attendance is its own fact", () => {
    const tickets: SupporterTicketFact[] = [
      { buyerUserId: "a", priceVb: 300, attendedAt: "2026-09-01T00:00:00Z" },
      { buyerUserId: "a", priceVb: 300, attendedAt: "2026-10-01T00:00:00Z" },
    ];
    const board = buildSupporterBoard({
      fans: [fan({ userId: "a", spentVb: 0 })],
      tickets,
      profileCards: noCards,
      optedOutUserIds: noneOut,
      creatorUserId: "creator",
    });
    expect(board).toHaveLength(1);
    expect(board[0]!.ticketVb).toBe(600);
    expect(board[0]!.totalSupport).toBe(600); // not 600 + attendance bonus
    expect(board[0]!.attendanceCount).toBe(2);
  });

  it("a ticket-only fan with no Fan Graph row still boards, with their card", () => {
    const cards = new Map([["solo", { displayName: "Solo Fan", slug: "solo-fan", avatarUrl: null }]]);
    const board = buildSupporterBoard({
      fans: [],
      tickets: [{ buyerUserId: "solo", priceVb: 200, attendedAt: "2026-10-02T00:00:00Z" }],
      profileCards: cards,
      optedOutUserIds: noneOut,
      creatorUserId: "creator",
    });
    expect(board[0]!.displayName).toBe("Solo Fan");
    expect(board[0]!.profileSlug).toBe("solo-fan");
  });

  it("excludes follows-only fans, email-only nodes, the creator, and opt-outs", () => {
    const board = buildSupporterBoard({
      fans: [
        fan({ userId: "fan-1", spentVb: 0, spentUsdCents: 0 }), // follow only — no support
        fan({ fanId: "e:a@b.c", userId: null, spentUsdCents: 5000 }), // email-only node
        fan({ userId: "creator", spentVb: 9999 }), // the creator themselves
        fan({ userId: "shy", displayName: "Shy", spentVb: 800 }), // opted out
        fan({ userId: "real", displayName: "Real", spentVb: 100 }),
      ],
      tickets: [],
      profileCards: noCards,
      optedOutUserIds: new Set(["shy"]),
      creatorUserId: "creator",
    });
    expect(board.map((e) => e.userId)).toEqual(["real"]);
  });

  it("breaks ties by earliest first support, deterministically", () => {
    const board = buildSupporterBoard({
      fans: [
        fan({ userId: "late", displayName: "Late", spentVb: 500, lastActivityAt: "2026-10-10T00:00:00.000Z" }),
        fan({ userId: "early", displayName: "Early", spentVb: 500, lastActivityAt: "2026-08-01T00:00:00.000Z" }),
      ],
      tickets: [],
      profileCards: noCards,
      optedOutUserIds: noneOut,
      creatorUserId: "creator",
    });
    expect(board.map((e) => e.userId)).toEqual(["early", "late"]);
  });

  it("badges: 1–3 Front Row, 4–10 Top Supporter, none past 10", () => {
    expect(badgeForRank(1)?.label).toContain("#1");
    expect(badgeForRank(3)?.tier).toBe("front_row");
    expect(badgeForRank(4)?.tier).toBe("top_supporter");
    expect(badgeForRank(10)?.tier).toBe("top_supporter");
    expect(badgeForRank(11)).toBeNull();
  });

  it("perks are the creator's own words — trimmed, capped, never invented", () => {
    expect(sanitizePerksText("  Front row gets   a shout-out\n\nand a monthly call  ")).toBe(
      "Front row gets a shout-out\nand a monthly call",
    );
    expect(sanitizePerksText(42)).toBe("");
    expect(sanitizePerksText("x".repeat(5000)).length).toBeLessThanOrEqual(600);
  });

  it("carries the anti-fake honesty copy", () => {
    expect(SUPPORTER_BOARD_COPY.rankedFromRealSupport).toContain("Follows alone never rank");
  aggregateSupporterEvents,
  badgeForRank,
  buildSupporterBoard,
  filterTicketsForPeriod,
  isWithinSupporterPeriod,
  resolveSupporterBoardSettings,
  sanitizePerksText,
  supporterPeriodWindow,
  type SupporterFanFact,
  type SupporterTicketFact,
} from "../supporter-board";

function fan(over: Partial<SupporterFanFact> = {}): SupporterFanFact {
  return {
    fanId: "u:fan-1",
    userId: "fan-1",
    displayName: "Fan One",
    profileSlug: "fan-one",
    avatarUrl: null,
    spentUsdCents: 0,
    spentVb: 0,
    purchaseCount: 0,
    lastActivityAt: "2026-10-01T00:00:00.000Z",
    ...over,
  };
}

const noCards = new Map();
const noneOut = new Set<string>();

describe("supporter board — ranked from real support only", () => {
  it("ranks by total support on the x100 scale (VB and cents meet 1:1)", () => {
    const board = buildSupporterBoard({
      fans: [
        fan({ userId: "a", displayName: "A", spentVb: 500 }),
        fan({ userId: "b", displayName: "B", spentUsdCents: 900, purchaseCount: 2 }),
        fan({ userId: "c", displayName: "C", spentVb: 100, spentUsdCents: 100 }),
      ],
      tickets: [],
      profileCards: noCards,
      optedOutUserIds: noneOut,
      creatorUserId: "creator",
    });
    expect(board.map((e) => e.userId)).toEqual(["b", "a", "c"]);
    expect(board[0]!.totalSupport).toBe(900);
    expect(board[0]!.badge?.tier).toBe("front_row");
  });

  it("counts ticketed attendance: price counts once, attendance is its own fact", () => {
    const tickets: SupporterTicketFact[] = [
      { buyerUserId: "a", priceVb: 300, attendedAt: "2026-09-01T00:00:00Z" },
      { buyerUserId: "a", priceVb: 300, attendedAt: "2026-10-01T00:00:00Z" },
    ];
    const board = buildSupporterBoard({
      fans: [fan({ userId: "a", spentVb: 0 })],
      tickets,
      profileCards: noCards,
      optedOutUserIds: noneOut,
      creatorUserId: "creator",
    });
    expect(board).toHaveLength(1);
    expect(board[0]!.ticketVb).toBe(600);
    expect(board[0]!.totalSupport).toBe(600); // not 600 + attendance bonus
    expect(board[0]!.attendanceCount).toBe(2);
  });

  it("a ticket-only fan with no Fan Graph row still boards, with their card", () => {
    const cards = new Map([["solo", { displayName: "Solo Fan", slug: "solo-fan", avatarUrl: null }]]);
    const board = buildSupporterBoard({
      fans: [],
      tickets: [{ buyerUserId: "solo", priceVb: 200, attendedAt: "2026-10-02T00:00:00Z" }],
      profileCards: cards,
      optedOutUserIds: noneOut,
      creatorUserId: "creator",
    });
    expect(board[0]!.displayName).toBe("Solo Fan");
    expect(board[0]!.profileSlug).toBe("solo-fan");
  });

  it("excludes follows-only fans, email-only nodes, the creator, and opt-outs", () => {
    const board = buildSupporterBoard({
      fans: [
        fan({ userId: "fan-1", spentVb: 0, spentUsdCents: 0 }), // follow only — no support
        fan({ fanId: "e:a@b.c", userId: null, spentUsdCents: 5000 }), // email-only node
        fan({ userId: "creator", spentVb: 9999 }), // the creator themselves
        fan({ userId: "shy", displayName: "Shy", spentVb: 800 }), // opted out
        fan({ userId: "real", displayName: "Real", spentVb: 100 }),
      ],
      tickets: [],
      profileCards: noCards,
      optedOutUserIds: new Set(["shy"]),
      creatorUserId: "creator",
    });
    expect(board.map((e) => e.userId)).toEqual(["real"]);
  });

  it("breaks ties by earliest first support, deterministically", () => {
    const board = buildSupporterBoard({
      fans: [
        fan({ userId: "late", displayName: "Late", spentVb: 500, lastActivityAt: "2026-10-10T00:00:00.000Z" }),
        fan({ userId: "early", displayName: "Early", spentVb: 500, lastActivityAt: "2026-08-01T00:00:00.000Z" }),
      ],
      tickets: [],
      profileCards: noCards,
      optedOutUserIds: noneOut,
      creatorUserId: "creator",
    });
    expect(board.map((e) => e.userId)).toEqual(["early", "late"]);
  });

  it("badges: 1–3 Front Row, 4–10 Top Supporter, none past 10", () => {
    expect(badgeForRank(1)?.label).toContain("#1");
    expect(badgeForRank(3)?.tier).toBe("front_row");
    expect(badgeForRank(4)?.tier).toBe("top_supporter");
    expect(badgeForRank(10)?.tier).toBe("top_supporter");
    expect(badgeForRank(11)).toBeNull();
  });

  it("perks are the creator's own words — trimmed, capped, never invented", () => {
    expect(sanitizePerksText("  Front row gets   a shout-out\n\nand a monthly call  ")).toBe(
      "Front row gets a shout-out\nand a monthly call",
    );
    expect(sanitizePerksText(42)).toBe("");
    expect(sanitizePerksText("x".repeat(5000)).length).toBeLessThanOrEqual(600);
  });

  it("carries the anti-fake honesty copy", () => {
    expect(SUPPORTER_BOARD_COPY.rankedFromRealSupport).toContain("Follows alone never rank");
  });
});

describe("supporter board — periods (Wave-4 #49 delta)", () => {
  const now = new Date("2026-10-26T12:00:00.000Z");

  it("month window is the half-open UTC calendar month containing now", () => {
    const w = supporterPeriodWindow("month", now);
    expect(w.startAt).toBe("2026-10-01T00:00:00.000Z");
    expect(w.endAt).toBe("2026-11-01T00:00:00.000Z");
    expect(w.basis).toBe("Top supporters by tips + purchases this month");
    const all = supporterPeriodWindow("all", now);
    expect(all.startAt).toBeNull();
    expect(all.basis).toContain("all time");
  });

  it("period boundaries: first instant of the month counts, first instant of next month does not", () => {
    const w = supporterPeriodWindow("month", now);
    expect(isWithinSupporterPeriod("2026-10-01T00:00:00.000Z", w)).toBe(true);
    expect(isWithinSupporterPeriod("2026-09-30T23:59:59.999Z", w)).toBe(false);
    expect(isWithinSupporterPeriod("2026-10-31T23:59:59.999Z", w)).toBe(true);
    expect(isWithinSupporterPeriod("2026-11-01T00:00:00.000Z", w)).toBe(false);
    expect(isWithinSupporterPeriod("2020-01-01T00:00:00.000Z", supporterPeriodWindow("all", now))).toBe(true);
    expect(isWithinSupporterPeriod("not-a-date", w)).toBe(false);
  });

  it("aggregates ledger events inside the window only, sums per fan, tracks first + last", () => {
    const w = supporterPeriodWindow("month", now);
    const facts = aggregateSupporterEvents(
      [
        { userId: "a", spentVb: 300, at: "2026-10-03T00:00:00Z" },
        { userId: "a", spentUsdCents: 200, purchaseCount: 1, at: "2026-10-20T00:00:00Z" },
        { userId: "a", spentVb: 9999, at: "2026-09-15T00:00:00Z" }, // last month — excluded
        { userId: "b", spentUsdCents: 700, purchaseCount: 2, at: "2026-10-05T00:00:00Z" },
      ],
      w,
    );
    expect(facts).toHaveLength(2);
    const a = facts.find((f) => f.userId === "a")!;
    expect(a.spentVb).toBe(300);
    expect(a.spentUsdCents).toBe(200);
    expect(a.firstActivityAt).toBe("2026-10-03T00:00:00.000Z");
    expect(a.lastActivityAt).toBe("2026-10-20T00:00:00.000Z");
    // And the board built from those facts ranks this month's support only.
    const board = buildSupporterBoard({
      fans: facts,
      tickets: filterTicketsForPeriod(
        [{ buyerUserId: "a", priceVb: 500, attendedAt: "2026-09-01T00:00:00Z" }],
        w,
      ),
      profileCards: noCards,
      optedOutUserIds: noneOut,
      creatorUserId: "creator",
    });
    expect(board.map((e) => e.userId)).toEqual(["b", "a"]);
    expect(board.find((e) => e.userId === "a")!.ticketVb).toBe(0);
  });

  it("settings default ON with no perks; an explicit off row is honored", () => {
    expect(resolveSupporterBoardSettings(null)).toEqual({ enabled: true, perksText: "" });
    expect(resolveSupporterBoardSettings(undefined).enabled).toBe(true);
    expect(resolveSupporterBoardSettings({ enabled: false, perksText: "  hi  " })).toEqual({
      enabled: false,
      perksText: "hi",
    });
  });

  it("empty-state copy is honest in both periods — no invented supporters", () => {
    expect(SUPPORTER_BOARD_COPY.emptyMonth).toContain("No qualifying support yet this month");
    expect(SUPPORTER_BOARD_COPY.emptyAll).toContain("nothing is back-filled or invented");
    const board = buildSupporterBoard({
      fans: aggregateSupporterEvents([], supporterPeriodWindow("month", now)),
      tickets: [],
      profileCards: noCards,
      optedOutUserIds: noneOut,
      creatorUserId: "creator",
    });
    expect(board).toEqual([]);
  });
});
