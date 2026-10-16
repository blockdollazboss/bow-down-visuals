import { describe, it, expect } from "vitest";
import { statementFromPayload } from "./earnings-statement";

/* DTO guard batch #2 — a partial statement payload must reach the
   panel's honest error / "couldn't load" states, never a render throw
   or a $NaN total. */

describe("statementFromPayload", () => {
  it("normalizes a complete statement (wrapped or bare)", () => {
    const bare = statementFromPayload({
      sources: { store: { status: "ok", totalCents: 1250, count: 3 } },
      totalCents: 1250,
      partial: false,
    });
    expect(bare?.sources.store?.totalCents).toBe(1250);
    const wrapped = statementFromPayload({ statement: { sources: {}, totalCents: 0 } });
    expect(wrapped?.totalCents).toBe(0);
  });
  it("returns null when sources is missing or not a map", () => {
    expect(statementFromPayload({ totalCents: 5 })).toBeNull();
    expect(statementFromPayload({ statement: { sources: [1, 2] } })).toBeNull();
    expect(statementFromPayload(null)).toBeNull();
  });
  it("a source with a non-numeric total degrades to couldn't-load (null), never NaN", () => {
    const s = statementFromPayload({
      sources: { store: { status: "ok", totalCents: "lots", count: 2 } },
      totalCents: "lots",
    });
    expect(s?.sources.store?.totalCents).toBeNull();
    expect(s?.totalCents).toBeNull();
  });
});
