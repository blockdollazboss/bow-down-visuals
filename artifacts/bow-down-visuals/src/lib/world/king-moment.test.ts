/**
 * The King's daily moment — client words (lib/world/king-moment)
 * + the page/strip/board wiring pins.
 *
 * The state is server truth (the hall's kingMoment); this module
 * only phrases it. Pinned: a moment past its deadline renders
 * nothing anywhere; the gift amount is never restated by the
 * client (the server's announcement + witnessed claim lines carry
 * the number); a refusal reads in the member's words, never as a
 * raw server token; guests witness and get the sign-in line — no
 * claim affordance.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  isKingMomentLive,
  kingClaimView,
  kingMomentHeadline,
  kingMomentLine,
  kingStripLine,
  kingClaimedLine,
  kingDeniedLine,
} from "./king-moment";
import type { WorldKingMomentState } from "./world-client";

const MOMENT: WorldKingMomentState = {
  date: "2026-10-17",
  claimDeadlineMs: 10_000,
  claimed: false,
};

describe("liveness + the claim view", () => {
  it("a moment is live until its deadline and not a tick past", () => {
    expect(isKingMomentLive(MOMENT, 9_999)).toBe(true);
    expect(isKingMomentLive(MOMENT, 10_000)).toBe(true);
    expect(isKingMomentLive(MOMENT, 10_001)).toBe(false);
    expect(isKingMomentLive(null, 0)).toBe(false);
  });

  it("the view is guest / claimed / open — in that order of truth", () => {
    expect(kingClaimView(MOMENT, true)).toBe("guest");
    expect(kingClaimView({ ...MOMENT, claimed: true }, true)).toBe("guest");
    expect(kingClaimView({ ...MOMENT, claimed: true }, false)).toBe("claimed");
    expect(kingClaimView(MOMENT, false)).toBe("open");
  });
});

describe("the words", () => {
  it("the headline + line name the pool rule and the guest truth", () => {
    expect(kingMomentHeadline(MOMENT, false)).toBe("The King holds court");
    expect(kingMomentLine(MOMENT, false)).toContain("week's quest pool");
    expect(kingMomentLine(MOMENT, true)).toContain("sign in");
    const claimed = { ...MOMENT, claimed: true };
    expect(kingMomentHeadline(claimed, false)).toContain("your gift is claimed");
    expect(kingMomentLine(claimed, false)).toContain("next day-turn");
  });

  it("the strip line names the hall and the claim state; silent when no live moment", () => {
    expect(kingStripLine(MOMENT, 5_000, false)).toContain("Throne Hall");
    expect(kingStripLine(MOMENT, 5_000, false)).toContain("claim today's gift");
    expect(kingStripLine({ ...MOMENT, claimed: true }, 5_000, false)).toContain("claimed for today");
    expect(kingStripLine(MOMENT, 5_000, true)).toContain("members claim a daily gift");
    expect(kingStripLine(MOMENT, 10_001, false)).toBeNull();
    expect(kingStripLine(null, 5_000, false)).toBeNull();
  });

  it("the witnessed line carries the server's name + amount verbatim", () => {
    expect(kingClaimedLine({ name: "Nova", amountVb: 25 })).toBe(
      "Nova claimed the King's gift — 25 VB.",
    );
  });

  it("every refusal reads in plain words; unknown reasons get the generic line, never the token", () => {
    for (const reason of ["guests", "no-moment", "closed", "already", "pool", "error"]) {
      const line = kingDeniedLine(reason);
      expect(line.length).toBeGreaterThan(10);
      expect(line).not.toBe(reason);
    }
    expect(kingDeniedLine("pool")).toContain("quest pool");
    expect(kingDeniedLine("already")).toContain("already");
    expect(kingDeniedLine("weird-token")).toContain("didn't land");
  });
});

describe("wiring pins", () => {
  const page = readFileSync(resolve(__dirname, "../../pages/world.tsx"), "utf8");
  const strip = readFileSync(
    resolve(__dirname, "../../components/world/ObjectiveStrip.tsx"),
    "utf8",
  );
  const board = readFileSync(
    resolve(__dirname, "../../components/world/native/KingdomBoardBlocks.tsx"),
    "utf8",
  );

  it("the page renders the hall card + claim control and wires all three king handlers", () => {
    expect(page).toContain('data-testid="world-king-card"');
    expect(page).toContain('data-testid="world-king-claim"');
    expect(page).toContain('data-testid="world-king-claimed"');
    expect(page).toContain("client.onKingMoment");
    expect(page).toContain("client.onKingClaimed");
    expect(page).toContain("client.onKingDenied");
    expect(page).toContain("claimKingGift()");
  });

  it("the strip carries the king chip and the board leads its today rows with the moment", () => {
    expect(strip).toContain('data-testid="world-objective-king"');
    expect(strip).toContain("kingStripLine");
    expect(board).toContain("The King's daily moment");
    expect(board).toContain("kingLine");
  });
});
