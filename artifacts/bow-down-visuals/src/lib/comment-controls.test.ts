/**
 * Client helper tests for creator comment controls (#27): the inline
 * owner actions offered per comment state, and the held/hidden copy
 * contract (a hold is a delay, never a silent deletion).
 */
import { describe, it, expect } from "vitest";
import { ownerActionsFor, HELD_COPY, HIDDEN_COPY } from "./comment-controls";

describe("ownerActionsFor", () => {
  it("public + unpinned: pin and hide", () => {
    expect(ownerActionsFor({ id: "1", body: "x", status: "public", pinned: false })).toEqual(["pin", "hide"]);
  });
  it("public + pinned: unpin and hide", () => {
    expect(ownerActionsFor({ id: "1", body: "x", status: "public", is_pinned: true })).toEqual(["unpin", "hide"]);
  });
  it("held: approve and reject (reject hides — never deletes)", () => {
    expect(ownerActionsFor({ id: "1", body: "x", status: "held" })).toEqual(["approve", "reject"]);
  });
  it("hidden: unhide only", () => {
    expect(ownerActionsFor({ id: "1", body: "x", status: "hidden" })).toEqual(["unhide"]);
  });
  it("a legacy comment with no status reads as public", () => {
    expect(ownerActionsFor({ id: "1", body: "x" })).toEqual(["pin", "hide"]);
  });
});

describe("copy contract", () => {
  it("held copy promises a delay, not a deletion", () => {
    expect(HELD_COPY).toContain("delay, not a deletion");
  });
  it("hidden copy says who can still see it", () => {
    expect(HIDDEN_COPY).toContain("only you and the creator can see");
  });
});
