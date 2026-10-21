import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  statementFromPayload,
  statementIsEmpty,
  statementLineRows,
  statementLineText,
  statementMoney,
  statementTotalLabel,
} from "./earnings-statement";

const trustPanelsSrc = readFileSync(new URL("../components/trust/TrustPanels.tsx", import.meta.url), "utf8");

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

/* The shared lines both in-page viewers render (the Earnings page's
   documents panel + the World Earnings Board): the PDF route's own
   labels, order, money format and total wording — one list, so an
   in-page statement can never drift from the PDF beside it. */
describe("statementLineRows — the PDF's lines, shared by both in-page viewers", () => {
  const stmt = statementFromPayload({
    sources: {
      royalties: { status: "ok", totalCents: 1234, count: 1 },
      storeSales: { status: "ok", totalCents: 5000, count: 2 },
      shopSales: { status: "error", totalCents: null, count: 0 },
      memberships: { status: "ok", totalCents: 1500, count: 1 },
      brandDeals: { status: "ok", totalCents: 0, count: 0 },
    },
    totalCents: 7734,
    partial: true,
  })!;

  it("carries the PDF route's labels in the PDF's order, whatever order the payload used", () => {
    expect(statementLineRows(stmt).map((r) => r.label)).toEqual([
      "Store sales",
      "Shop sales",
      "Memberships",
      "Brand deals",
      "Royalties (recorded)",
    ]);
    expect(statementLineRows(stmt).map((r) => r.key)).toEqual([
      "storeSales",
      "shopSales",
      "memberships",
      "brandDeals",
      "royalties",
    ]);
  });

  it("line text is the shared format; an errored source says couldn't load, never $0.00", () => {
    const rows = statementLineRows(stmt);
    expect(statementLineText(rows[0]!)).toBe("$50.00 · 2 records");
    expect(statementLineText(rows[1]!)).toBe("couldn't load");
    expect(statementLineText(rows[4]!)).toBe("$12.34 · 1 records");
  });

  it("money is the PDF's format — two decimals, no grouping; a missing total is couldn't load", () => {
    expect(statementMoney(123456)).toBe("$1234.56");
    expect(statementMoney(0)).toBe("$0.00");
    expect(statementMoney(null)).toBe("couldn't load");
  });

  it("the total label follows partial, in both renderers' exact words", () => {
    expect(statementTotalLabel(true)).toBe("Total of the sources that loaded");
    expect(statementTotalLabel(false)).toBe("Total");
  });

  it("a canonical source the payload doesn't carry is skipped, never invented", () => {
    const short = statementFromPayload({ sources: { storeSales: { status: "ok", totalCents: 100, count: 1 } }, totalCents: 100 })!;
    expect(statementLineRows(short).map((r) => r.key)).toEqual(["storeSales"]);
  });
});

describe("statementIsEmpty — the honest empty statement", () => {
  const zero = { status: "ok", totalCents: 0, count: 0 };
  it("every line loaded with zero recorded activity is empty", () => {
    const s = statementFromPayload({
      sources: { storeSales: zero, shopSales: zero, memberships: zero, brandDeals: zero, royalties: zero },
      totalCents: 0,
      partial: false,
    })!;
    expect(statementIsEmpty(s)).toBe(true);
  });
  it("any recorded activity — or any failed source — is NOT empty", () => {
    const active = statementFromPayload({
      sources: { storeSales: { status: "ok", totalCents: 100, count: 1 }, shopSales: zero, memberships: zero, brandDeals: zero, royalties: zero },
      totalCents: 100,
    })!;
    expect(statementIsEmpty(active)).toBe(false);
    const partial = statementFromPayload({
      sources: { storeSales: { status: "error", totalCents: null, count: 0 }, shopSales: zero, memberships: zero, brandDeals: zero, royalties: zero },
      totalCents: 0,
      partial: true,
    })!;
    expect(statementIsEmpty(partial)).toBe(false);
  });
});

describe("the Earnings page documents panel (source pins)", () => {
  it("renders the shared lines — no raw source keys as labels anymore", () => {
    expect(trustPanelsSrc).toContain("statementLineRows(stmt)");
    expect(trustPanelsSrc).toContain("statementLineText(row)");
    expect(trustPanelsSrc).toContain("statementTotalLabel(stmt.partial)");
    expect(trustPanelsSrc).not.toContain("Object.entries(stmt.sources)");
  });
  it("picking another year clears the viewed statement — view and PDF can never point at different years", () => {
    expect(trustPanelsSrc).toContain("setStmt(null)");
  });
  it("an empty year says so on the page", () => {
    expect(trustPanelsSrc).toContain("statementIsEmpty(stmt)");
    expect(trustPanelsSrc).toContain("this statement is empty");
  });
});
