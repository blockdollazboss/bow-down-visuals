/**
 * Public Results Wall (#177) — the honesty law, pinned at the pure layer.
 *
 * The wall's promise: a number appears ONLY when the platform's own
 * records prove it, at the REAL moment it happened, for a creator who
 * opted in. These tests pin that law with no DB:
 *
 *  - countCrossings: an event exists per crossed threshold, stamped with
 *    the threshold-th record's own timestamp — absent records stay absent;
 *  - firstSaleEvent: one completed sale = exactly one first-sale event;
 *  - vbCrossings: only ledger GRANTS (creditsUsed < 0) accumulate;
 *    spends never earn and never net against earnings;
 *  - chartPlacementEvent: only a real integer rank inside the Top-50
 *    cutoff becomes an event — null/NaN/0/51 invent nothing;
 *  - shapePublicWall: opted-out creators, hidden kinds and private
 *    profiles NEVER reach a public screen, however real the event is.
 */
import { describe, expect, it } from "vitest";
import {
  chartPlacementEvent,
  countCrossings,
  firstSaleEvent,
  shapePublicWall,
  vbCrossings,
  type WallEventWire,
} from "../results-wall";

const day = (d: number) => new Date(Date.UTC(2026, 0, d, 12, 0, 0));
const days = (n: number) => Array.from({ length: n }, (_, i) => day(i + 1));

describe("countCrossings — real records, real moments", () => {
  it("stamps each crossed threshold with the threshold-th record's time", () => {
    const events = countCrossings("followers", "follows", days(25), [10, 25, 50]);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ kind: "followers", threshold: 10, value: 10 });
    expect(events[0]!.occurredAt).toEqual(day(10));
    expect(events[1]!.occurredAt).toEqual(day(25));
    expect(events[0]!.detail).toEqual({ source: "follows" });
  });

  it("absent records produce absent events — 9 sales is not a 10-sale milestone", () => {
    expect(countCrossings("sales", "digital_sales", days(9), [10, 25])).toEqual([]);
    expect(countCrossings("sales", "digital_sales", [], [10])).toEqual([]);
  });

  it("ignores invalid timestamps instead of dating an event with garbage", () => {
    const stamps = [...days(9), new Date(Number.NaN)];
    expect(countCrossings("followers", "follows", stamps, [10])).toEqual([]);
  });
});

describe("firstSaleEvent", () => {
  it("the first completed sale is an event at that sale's moment", () => {
    const ev = firstSaleEvent([day(3), day(9)]);
    expect(ev).toMatchObject({ kind: "first_sale", threshold: 1, value: 1 });
    expect(ev!.occurredAt).toEqual(day(3));
    expect(ev!.detail.source).toBe("digital_sales");
  });

  it("no sales, no event — never a projected first sale", () => {
    expect(firstSaleEvent([])).toBeNull();
  });
});

describe("vbCrossings — ledger grants only", () => {
  it("accumulates grants and stamps the crossing grant's time", () => {
    const rows = [
      { creditsUsed: -60, createdAt: day(1) },
      { creditsUsed: -40, createdAt: day(2) }, // cumulative 100 → crosses 100
      { creditsUsed: -900, createdAt: day(5) }, // cumulative 1000 → crosses 500 + 1000
    ];
    const events = vbCrossings(rows);
    expect(events.map((e) => e.threshold)).toEqual([100, 500, 1000]);
    expect(events[0]!.occurredAt).toEqual(day(2));
    expect(events[1]!.occurredAt).toEqual(day(5));
    expect(events.every((e) => e.detail.source === "credit_usage")).toBe(true);
  });

  it("spend rows never earn and never net against earnings", () => {
    const rows = [
      { creditsUsed: -150, createdAt: day(1) },
      { creditsUsed: 400, createdAt: day(2) }, // a spend — ignored entirely
      { creditsUsed: 0, createdAt: day(3) },
    ];
    expect(vbCrossings(rows).map((e) => e.threshold)).toEqual([100]);
  });

  it("no grants, no milestones", () => {
    expect(vbCrossings([{ creditsUsed: 250, createdAt: day(1) }])).toEqual([]);
    expect(vbCrossings([])).toEqual([]);
  });
});

describe("chartPlacementEvent — only real ranks inside the cutoff", () => {
  it("a Top-50 rank becomes an event with its track + window evidence", () => {
    const ev = chartPlacementEvent(7, "Midnight Run", day(4));
    expect(ev).toMatchObject({ kind: "chart_placement", threshold: 7, value: 7 });
    expect(ev!.detail).toEqual({ source: "play_events_chart", window: "week", trackTitle: "Midnight Run" });
  });

  it("null, NaN, zero, fractional and beyond-cutoff ranks invent nothing", () => {
    for (const rank of [null, undefined, Number.NaN, 0, -3, 7.5, 51, 500]) {
      expect(chartPlacementEvent(rank, "X", day(1))).toBeNull();
    }
  });
});

describe("shapePublicWall — opt-in is the gate", () => {
  const baseProfile = { id: "p1", slug: "nova", displayName: "Nova", avatarUrl: null, isPublic: true };
  const ev = (id: string, kind: string, occurredAt: Date) => ({
    id, kind, threshold: 10, value: 10,
    detail: { source: "follows" as const },
    occurredAt, verifiedAt: day(28),
  });
  const row = (over: Partial<{ optedIn: boolean; hiddenKinds: string[] }> & { event: ReturnType<typeof ev>; profile?: typeof baseProfile }) => ({
    optedIn: true,
    hiddenKinds: [] as string[],
    profile: baseProfile,
    ...over,
  });

  it("shows opted-in, public, non-hidden events newest first", () => {
    const out: WallEventWire[] = shapePublicWall([
      row({ event: ev("a", "followers", day(2)) }),
      row({ event: ev("b", "sales", day(5)) }),
    ]);
    expect(out.map((e) => e.id)).toEqual(["b", "a"]);
    expect(out[0]!.creator).toEqual({ profileId: "p1", slug: "nova", displayName: "Nova", avatarUrl: null });
  });

  it("an opted-out creator never appears — revocation is absolute", () => {
    expect(shapePublicWall([row({ optedIn: false, event: ev("a", "followers", day(2)) })])).toEqual([]);
  });

  it("a hidden kind is removed for that creator only", () => {
    const out = shapePublicWall([
      row({ hiddenKinds: ["vb_earned"], event: ev("a", "vb_earned", day(3)) }),
      row({ hiddenKinds: ["vb_earned"], event: ev("b", "followers", day(2)) }),
    ]);
    expect(out.map((e) => e.id)).toEqual(["b"]);
  });

  it("a private profile never appears even when opted in", () => {
    const out = shapePublicWall([
      row({ event: ev("a", "followers", day(2)), profile: { ...baseProfile, isPublic: false } }),
    ]);
    expect(out).toEqual([]);
  });

  it("unknown kinds never reach the screen", () => {
    expect(shapePublicWall([row({ event: ev("a", "lottery_win", day(2)) })])).toEqual([]);
  });

  it("respects the wall limit", () => {
    const rows = Array.from({ length: 10 }, (_, i) => row({ event: ev(`e${i}`, "followers", day(i + 1)) }));
    expect(shapePublicWall(rows, 3)).toHaveLength(3);
  });
});
