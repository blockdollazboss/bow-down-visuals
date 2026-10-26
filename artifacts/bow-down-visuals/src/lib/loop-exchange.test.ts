import { describe, it, expect } from "vitest";
import {
  buildProposedSplits,
  loopMetaLine,
  parseLoopDetailResponse,
  parseLoopsResponse,
  parseMineResponse,
  parseSaleResponse,
  termsLine,
  type LoopExchangeLoop,
} from "./loop-exchange";

const POSTER = "11111111-1111-4111-8111-111111111111";
const BUILDER = "22222222-2222-4222-8222-222222222222";
const COLLAB = "33333333-3333-4333-8333-333333333333";

const loop: LoopExchangeLoop = {
  id: "loop-1",
  posterUserId: POSTER,
  posterProfileId: null,
  title: "Midnight Hook",
  description: "Dark piano hook",
  audioUrl: "https://cdn/hook.mp3",
  bpm: 142,
  musicalKey: "G minor",
  durationSeconds: 16,
  posterSharePct: 25,
  status: "open",
  createdAt: "2026-10-25T00:00:00.000Z",
};

const build = {
  id: "build-1",
  loopId: "loop-1",
  builderUserId: BUILDER,
  builderProfileId: null,
  title: "Midnight Anthem",
  audioUrl: null,
  splits: [
    { userId: BUILDER, sharePct: 75 },
    { userId: POSTER, sharePct: 25 },
  ],
  status: "agreed",
  agreedAt: "2026-10-25T01:00:00.000Z",
  createdAt: "2026-10-25T00:30:00.000Z",
};

describe("loop-exchange frontend helpers", () => {
  it("parsers accept the routes' shapes and refuse anything else", () => {
    expect(parseLoopsResponse({ loops: [loop] })?.[0]?.id).toBe("loop-1");
    expect(parseLoopsResponse({ loops: "nope" })).toBeNull();
    expect(parseLoopsResponse(null)).toBeNull();
    expect(parseLoopsResponse({ loops: [{ ...loop, posterSharePct: "25" }] })).toBeNull();

    const detail = parseLoopDetailResponse({ loop, builds: [build] });
    expect(detail?.builds[0]?.status).toBe("agreed");
    expect(parseLoopDetailResponse({ loop, builds: [{ id: "x" }] })).toBeNull();

    const mine = parseMineResponse({ loops: [loop], builds: [build], earnings: [], totalEarnedVb: 0 });
    expect(mine?.loops).toHaveLength(1);
    expect(parseMineResponse({ loops: [], builds: [], earnings: [] })).toBeNull();

    const sale = parseSaleResponse({
      outcome: "recorded",
      sale: { id: "s1", saleRef: "order-1", grossVb: 1000, feeVb: 50, netVb: 950 },
      allocations: [{ userId: POSTER, role: "loop_poster", sharePct: 25, amountVb: 238 }],
    });
    expect(sale?.sale.netVb).toBe(950);
    expect(parseSaleResponse({ outcome: "maybe", sale: {}, allocations: [] })).toBeNull();
  });

  it("buildProposedSplits gives the builder the remainder and the poster their posted terms", () => {
    const splits = buildProposedSplits({ builderUserId: BUILDER, posterUserId: POSTER, posterSharePct: 25 });
    expect(splits).toEqual([
      { userId: BUILDER, sharePct: 75 },
      { userId: POSTER, sharePct: 25 },
    ]);
    expect(splits!.reduce((s, x) => s + x.sharePct, 0)).toBe(100);
  });

  it("buildProposedSplits carries collaborators and refuses impossible lists", () => {
    const splits = buildProposedSplits({
      builderUserId: BUILDER,
      posterUserId: POSTER,
      posterSharePct: 25,
      collaborators: [{ userId: COLLAB, sharePct: 15 }],
    });
    expect(splits).toEqual([
      { userId: BUILDER, sharePct: 60 },
      { userId: POSTER, sharePct: 25 },
      { userId: COLLAB, sharePct: 15 },
    ]);
    // Collaborators eating the whole pie leave the builder nothing:
    expect(
      buildProposedSplits({
        builderUserId: BUILDER,
        posterUserId: POSTER,
        posterSharePct: 25,
        collaborators: [{ userId: COLLAB, sharePct: 75 }],
      }),
    ).toBeNull();
    // Duplicate accounts are refused (the rail would refuse them too):
    expect(
      buildProposedSplits({
        builderUserId: BUILDER,
        posterUserId: POSTER,
        posterSharePct: 25,
        collaborators: [{ userId: POSTER, sharePct: 10 }],
      }),
    ).toBeNull();
  });

  it("the terms line states the poster's posted share — never recomputed, never a price", () => {
    expect(termsLine(loop)).toBe("Original poster gets 25% of every downstream sale's net");
    expect(termsLine({ posterSharePct: 12.5 })).toContain("12.5%");
  });

  it("the meta line only lists what the poster actually listed", () => {
    expect(loopMetaLine(loop)).toBe("142 BPM · G minor · 16s");
    expect(loopMetaLine({ bpm: null, musicalKey: null, durationSeconds: null })).toBe("");
    expect(loopMetaLine({ bpm: 90, musicalKey: null, durationSeconds: null })).toBe("90 BPM");
  });
});
