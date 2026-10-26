import { describe, expect, it } from "vitest";
import {
  SUPPORTER_BOARD_COPY,
  supportBreakdown,
  supporterBoardBySlugPath,
  supporterBoardViewState,
  supporterDisplayName,
  type SupporterBoardDto,
  type SupporterBoardEntryDto,
} from "./supporter-board";

function entry(over: Partial<SupporterBoardEntryDto> = {}): SupporterBoardEntryDto {
  return {
    rank: 1,
    userId: "fan-1",
    displayName: "Fan One",
    profileSlug: "fan-one",
    avatarUrl: null,
    totalSupport: 0,
    spentVb: 0,
    spentUsdCents: 0,
    ticketVb: 0,
    purchaseCount: 0,
    attendanceCount: 0,
    firstSupportAt: null,
    lastSupportAt: null,
    badge: null,
    ...over,
  };
}

function board(over: Partial<SupporterBoardDto> = {}): SupporterBoardDto {
  return {
    creator: { slug: "thy-cheat-code", displayName: "Thy Cheat Code", avatarUrl: null },
    enabled: true,
    period: "month",
    periodLabel: "This month",
    basis: "Top supporters by tips + purchases this month",
    perksText: "",
    entries: [entry()],
    empty: false,
    emptyCopy: "No qualifying support yet this month.",
    viewer: null,
    ...over,
  };
}

describe("supporter board — view state", () => {
  it("loading and error are their own states, never fake-empty", () => {
    expect(supporterBoardViewState({ status: "loading", board: null, isOwner: false })).toBe("loading");
    expect(supporterBoardViewState({ status: "error", board: null, isOwner: false })).toBe("error");
    expect(supporterBoardViewState({ status: "ready", board: null, isOwner: false })).toBe("error");
  });

  it("a board the creator turned OFF is hidden from visitors and 'off' for the owner", () => {
    const off = board({ enabled: false, entries: [] });
    expect(supporterBoardViewState({ status: "ready", board: off, isOwner: false })).toBe("hidden");
    expect(supporterBoardViewState({ status: "ready", board: off, isOwner: true })).toBe("off");
  });

  it("opt-out honored: an opted-out viewer has no standing shown", () => {
    const b = board({
      viewer: { userId: "fan-9", isCreator: false, standing: null, optedOut: true },
    });
    expect(b.viewer?.optedOut).toBe(true);
    expect(b.viewer?.standing).toBeNull();
  });

  it("enabled + nobody qualified yet = honest empty; with entries = ready", () => {
    expect(supporterBoardViewState({ status: "ready", board: board({ entries: [] }), isOwner: false })).toBe("empty");
    expect(supporterBoardViewState({ status: "ready", board: board(), isOwner: false })).toBe("ready");
  });
});

describe("supporter board — plain-words breakdown", () => {
  it("breaks a total into its real parts and omits zero parts", () => {
    const parts = supportBreakdown(
      entry({ spentUsdCents: 1250, spentVb: 300, ticketVb: 200, attendanceCount: 2 }),
    );
    expect(parts).toEqual(["$12.50 in purchases", "300 VB in tips", "200 VB in show tickets", "2 ticketed shows attended"]);
    expect(supportBreakdown(entry({ attendanceCount: 1 }))).toEqual(["1 ticketed show attended"]);
    expect(supportBreakdown(entry())).toEqual([]);
  });

  it("names fall back honestly — never an invented person", () => {
    expect(supporterDisplayName(entry({ displayName: null }))).toBe("A supporter");
    expect(supporterDisplayName(entry({ displayName: "  " }))).toBe("A supporter");
    expect(supporterDisplayName(entry())).toBe("Fan One");
  });

  it("paths carry the period and copy matches the API's honesty strings", () => {
    expect(supporterBoardBySlugPath("thy-cheat-code", "month")).toBe(
      "/api/supporter-board/by-slug/thy-cheat-code?period=month",
    );
    expect(SUPPORTER_BOARD_COPY.rankedFromRealSupport).toContain("Follows alone never rank");
    expect(SUPPORTER_BOARD_COPY.optOut).toContain("still counts for the creator privately");
  });
});
