/**
 * Fan Art review desk — the creator's half of the Fan Art Wall
 * (Stack-200 #157), frontend coverage (stack800 lane 10).
 *
 * The desk shipped with server tests only; this suite is the FE
 * half. vitest here runs in node with jsx:preserve, so per the
 * repo's established split (social-proof-strip.test.ts) the suite
 * tests the pure decision table the desk renders from
 * (fanArtActionsFor in lib/profile-website) and pins the desk's
 * wiring by source.
 *
 * The law:
 *  - every decision is PER PIECE and the creator's alone: pending
 *    can be approved or rejected, approved can be taken down, a
 *    taken-down piece can be put back up, rejected is final here;
 *  - a 404 (no creator profile yet) is an honest empty desk; any
 *    other failed load is an error + retry — never a fake-empty
 *    queue that hides waiting fans;
 *  - a failed DECISION surfaces as an alert and changes nothing;
 *  - artist credit rides every row in every state.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fanArtActionsFor } from "@/lib/profile-website";

describe("fanArtActionsFor — the legal decisions from each state (mirrors the API transition table)", () => {
  it("a pending piece can be approved or rejected — and nothing else", () => {
    expect(fanArtActionsFor("pending")).toEqual(["approve", "reject"]);
  });

  it("an approved piece can only be taken down", () => {
    expect(fanArtActionsFor("approved")).toEqual(["revoke"]);
  });

  it("a taken-down piece can be put back up (the undo)", () => {
    expect(fanArtActionsFor("revoked")).toEqual(["approve"]);
  });

  it("a rejected piece offers no further decisions", () => {
    expect(fanArtActionsFor("rejected")).toEqual([]);
  });
});

describe("FanArtReviewDesk — component wiring (source pins)", () => {
  const src = readFileSync(join(__dirname, "FanArtReviewDesk.tsx"), "utf8");

  it("renders nothing until the queue has answered", () => {
    expect(src).toContain("if (pieces === null) return null;");
    expect(src).toContain('data-testid="fan-art-review-desk"');
  });

  it("loads the creator's queue from the fan-art queue door", () => {
    expect(src).toContain("const queue = await fetchFanArtQueue();");
    expect(src).toContain("setPendingCount(queue.pendingCount);");
  });

  it("a 404 is an honest empty desk (no creator profile yet); any other failure is error + retry", () => {
    expect(src).toContain('(e as { status?: number })?.status === 404');
    expect(src).toContain("Your fan art queue couldn't load right now.");
    expect(src).toContain("onClick={() => setRetryNonce((n) => n + 1)}");
    expect(src).toContain("}, [retryNonce]);");
  });

  it("an empty queue says so plainly — no fake rows, no spinner", () => {
    expect(src).toContain("No fan art yet. When a fan submits a piece from your profile's Gallery, it waits here for");
  });

  it("every row carries the artist's credit and the piece's live status", () => {
    expect(src).toContain('data-testid="fan-art-queue-piece"');
    expect(src).toContain("piece.artistName");
    expect(src).toContain("fanArtStatusLabel(piece.status)");
  });

  it("the buttons on a row are exactly the legal decisions for that piece's state", () => {
    expect(src).toContain("fanArtActionsFor(piece.status).map((action) => {");
    expect(src).toContain('approve: { label: "Approve — hang it on my wall"');
    expect(src).toContain('reject: { label: "Reject"');
    expect(src).toContain('revoke: { label: "Take down"');
    /* approving a taken-down piece is the undo, and says so */
    expect(src).toContain('"Put it back up"');
  });

  it("a decision goes to the review door with the piece id and the action, and the row updates from the answer", () => {
    expect(src).toContain("const updated = await reviewFanArtPiece(piece.id, action);");
    expect(src).toContain("prev.map((p) => (p.id === updated.id ? updated : p))");
  });

  it("the waiting badge and the post-decision recount both count pending pieces only", () => {
    expect(src).toContain("{pendingCount} waiting");
    expect(src).toContain("setPendingCount(next.filter((p) => p.status === \"pending\").length);");
  });

  it("while a decision is saving, that piece's buttons are disabled — no double-decisions", () => {
    expect(src).toContain("disabled={busyId === piece.id}");
    expect(src).toContain("setBusyId(piece.id);");
    expect(src).toContain("setBusyId(null);");
  });

  it("a failed decision surfaces as an alert and is never swallowed", () => {
    expect(src).toContain("setActionError(plainErrorText(e, \"That decision didn't save. Please try again.\"));");
    expect(src).toContain('role="alert"');
  });
});

describe("the desk's server contract (lib/profile-website fetchers)", () => {
  const lib = readFileSync(join(__dirname, "..", "..", "lib", "profile-website.ts"), "utf8");

  it("reads the queue and sends decisions to the creator's fan-art doors", () => {
    expect(lib).toContain('fetch("/api/creator-profiles/me/fan-art")');
    expect(lib).toContain("fetch(`/api/creator-profiles/me/fan-art/${encodeURIComponent(pieceId)}`, {");
    expect(lib).toContain('method: "PATCH"');
    expect(lib).toContain("body: JSON.stringify({ action })");
  });

  it("the pending count falls back to counting the queue itself when the server omits it", () => {
    expect(lib).toContain('wall.pieces.filter((p) => p.status === "pending").length');
  });
});
