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
  });
});
