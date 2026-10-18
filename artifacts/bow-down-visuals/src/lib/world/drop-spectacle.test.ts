/**
 * Drop spectacles — client words + claim bookkeeping
 * (lib/world/drop-spectacle) + the page wiring pins.
 *
 * The spectacle is server truth (the room's drop state; the room
 * enforces members-only / in-room / first-come; the route layer
 * pays from the shared weekly pool). Pinned here: the claim view
 * is guest / claimed / out / open in that order of truth; my
 * claim bookkeeping is keyed by the chest's event id, so a swept
 * or previous chest never leaks into the next one; another
 * member's witnessed claim never resolves or marks MY claim; a
 * refusal reads in the member's words, with the weekly pool named
 * where the pool is the reason — never a raw server token.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  EMPTY_DROP_BOOK,
  DROP_WEEKLY_POOL_VB,
  dropBookForDrop,
  dropBookClaimSent,
  dropBookClaimed,
  dropBookDenied,
  dropClaimInFlight,
  dropClaimView,
  dropHeadline,
  dropLine,
  dropClaimedLine,
  dropDeniedLine,
  type DropClaimBook,
} from "./drop-spectacle";
import type { WorldDropState } from "./world-client";

const DROP: WorldDropState = {
  eventId: "evt-drop-1",
  title: "Midnight Gold Drop",
  roomId: "world:courtyard",
  roomName: "Courtyard",
  amountVb: 200,
  claimCap: 3,
  claimsLeft: 2,
};

const NEXT_DROP: WorldDropState = { ...DROP, eventId: "evt-drop-2", title: "Dawn Drop" };

describe("the claim view", () => {
  it("is guest / claimed / out / open — in that order of truth", () => {
    expect(dropClaimView(DROP, true, EMPTY_DROP_BOOK)).toBe("guest");
    const claimed: DropClaimBook = { claimedId: DROP.eventId, sentId: null };
    expect(dropClaimView(DROP, true, claimed)).toBe("guest");
    expect(dropClaimView(DROP, false, claimed)).toBe("claimed");
    expect(dropClaimView({ ...DROP, claimsLeft: 0 }, false, claimed)).toBe("claimed");
    expect(dropClaimView({ ...DROP, claimsLeft: 0 }, false, EMPTY_DROP_BOOK)).toBe("out");
    expect(dropClaimView(DROP, false, EMPTY_DROP_BOOK)).toBe("open");
  });

  it("a claim marked on a DIFFERENT chest never reads as claimed here", () => {
    const other: DropClaimBook = { claimedId: NEXT_DROP.eventId, sentId: null };
    expect(dropClaimView(DROP, false, other)).toBe("open");
  });
});

describe("the claim book", () => {
  it("a sent claim is in flight on its chest only, until it resolves", () => {
    const sent = dropBookClaimSent(EMPTY_DROP_BOOK, DROP);
    expect(dropClaimInFlight(DROP, sent)).toBe(true);
    expect(dropClaimInFlight(NEXT_DROP, sent)).toBe(false);
    // Another member's witnessed claim does NOT resolve mine.
    const afterOther = dropBookClaimed(sent, { ...DROP, claimsLeft: 1 }, false);
    expect(afterOther).toBe(sent);
    expect(dropClaimInFlight(DROP, afterOther)).toBe(true);
  });

  it("MY witnessed claim marks the chest claimed and lands the out-claim", () => {
    const sent = dropBookClaimSent(EMPTY_DROP_BOOK, DROP);
    const landed = dropBookClaimed(sent, { ...DROP, claimsLeft: 1 }, true);
    expect(landed).toEqual({ claimedId: DROP.eventId, sentId: null });
    expect(dropClaimView(DROP, false, landed)).toBe("claimed");
  });

  it("a refusal resolves the out-claim; already-claimed also proves the claim", () => {
    const sent = dropBookClaimSent(EMPTY_DROP_BOOK, DROP);
    expect(dropBookDenied(sent, DROP, "claimed-out")).toEqual({
      claimedId: null,
      sentId: null,
    });
    expect(dropBookDenied(sent, DROP, "already-claimed")).toEqual({
      claimedId: DROP.eventId,
      sentId: null,
    });
    expect(dropBookDenied(sent, DROP, "budget")).toEqual({ claimedId: null, sentId: null });
  });

  it("a different chest — or no chest — retires the old bookkeeping (cleanup)", () => {
    const claimed: DropClaimBook = { claimedId: DROP.eventId, sentId: DROP.eventId };
    expect(dropBookForDrop(claimed, NEXT_DROP)).toEqual(EMPTY_DROP_BOOK);
    expect(dropBookForDrop(claimed, null)).toEqual(EMPTY_DROP_BOOK);
    // The same chest standing (a state frame ticking claims down)
    // keeps the book — and returns it untouched.
    const ticked = { ...DROP, claimsLeft: 1 };
    expect(dropBookForDrop(claimed, ticked)).toBe(claimed);
    expect(dropBookForDrop(EMPTY_DROP_BOOK, DROP)).toBe(EMPTY_DROP_BOOK);
    expect(dropBookForDrop(EMPTY_DROP_BOOK, null)).toBe(EMPTY_DROP_BOOK);
  });
});

describe("the words", () => {
  it("the headline is the spectacle's booked title, verbatim", () => {
    expect(dropHeadline(DROP)).toBe("Midnight Gold Drop");
  });

  it("the line names the rules per view: members here, first come, the weekly pool", () => {
    expect(dropLine(DROP, "guest")).toContain("members standing here");
    expect(dropLine(DROP, "guest")).toContain("Sign in");
    const open = dropLine(DROP, "open");
    expect(open).toContain("200 VB a claim");
    expect(open).toContain("2 of 3 claims stand");
    expect(open).toContain("1,000 VB a week");
    expect(dropLine(DROP, "claimed")).toContain("Your claim landed");
    expect(dropLine(DROP, "out")).toContain("chest stands empty");
    expect(DROP_WEEKLY_POOL_VB).toBe(1_000);
  });

  it("the witnessed line carries the server's name + amount verbatim", () => {
    expect(dropClaimedLine({ name: "Nova", amountVb: 200 })).toBe(
      "Nova claimed the drop — 200 VB.",
    );
  });

  it("every refusal reads in plain words; the budget line names the weekly pool", () => {
    for (const reason of [
      "guests",
      "no-drop",
      "already-claimed",
      "claimed-out",
      "budget",
      "error",
    ]) {
      const line = dropDeniedLine(reason);
      expect(line.length).toBeGreaterThan(10);
      expect(line).not.toBe(reason);
    }
    expect(dropDeniedLine("budget")).toContain("1,000 VB weekly pool");
    expect(dropDeniedLine("budget")).toContain("week turns");
    expect(dropDeniedLine("already-claimed")).toContain("one claim per member");
    expect(dropDeniedLine("claimed-out")).toContain("first come");
    expect(dropDeniedLine("guests")).toContain("sign in");
    expect(dropDeniedLine("weird-token")).toContain("didn't land");
    expect(dropDeniedLine("weird-token")).not.toContain("weird-token");
  });
});

describe("wiring pins", () => {
  const page = readFileSync(resolve(__dirname, "../../pages/world.tsx"), "utf8");

  it("the page wires all four drop handlers and the claim intent", () => {
    expect(page).toContain("client.onDropLanded =");
    expect(page).toContain("client.onDrop =");
    expect(page).toContain("client.onDropClaimed =");
    expect(page).toContain("client.onDropDenied =");
    expect(page).toContain("claimDrop()");
    expect(page).toContain("dropBookClaimSent");
    expect(page).toContain("dropBookClaimed");
    expect(page).toContain("dropBookDenied");
  });

  it("the page renders the drop card with the claim control behind the open view", () => {
    expect(page).toContain('data-testid="world-drop-card"');
    expect(page).toContain('data-testid="world-drop-claim"');
    expect(page).toContain('data-testid="world-drop-claimed"');
    expect(page).toContain('data-testid="world-drop-out"');
    expect(page).toContain('dropView === "open"');
    expect(page).toContain("dropClaimView");
    expect(page).toContain("dropDeniedLine");
  });

  it("the welcome snapshot reconciles through the one writer (station-tick anchor)", () => {
    expect(page).toContain("client.drop !== dropAnchorRef.current");
    expect(page).toContain("applyDropState(client.drop)");
    expect(page).toContain("applyDropState(landed)");
    expect(page).toContain("dropBookForDrop");
  });
});
