/**
 * jewelry-bench — Stack-100 #74 pins.
 *
 * The Jewelry Bench is the Logo-to-Luxury Studio (pages/jewelry.tsx)
 * completed in-world: the catalog, prices, payloads and parsers mirror
 * the studio's own rails (routes/generate/jewelry.ts) — prices come
 * from GET /api/jewelry/status (registry figures only as the fallback
 * while it loads), every charge rides confirmedFetch, and the one
 * step the website itself hands off (ordering in the Jewelry Shop)
 * keeps the page's own localStorage handoff.
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  JEWELRY_DESIGN_COST_VISUAL_BUCS,
  JEWELRY_STL_COST_VISUAL_BUCS,
  JEWELRY_CONSULT_COST_VISUAL_BUCS,
  parseJewelryCatalog,
  parseJewelryGuide,
  guideSectionsFor,
  jewelryFormFields,
  buildJewelryEstimatePayload,
  parseJewelryEstimate,
  parseJewelryStl,
  parseJewelryDesignUrl,
  buildJewelryConsultPayload,
  parseJewelryConsultReply,
  buildJewelryShopHandoff,
  JEWELRY_HANDOFF_KEY,
  type JewelryOpts,
  type ApparelOpts,
} from "./jewelry-bench";
import { PALACE_STATIONS } from "./stations";

const STATUS = {
  previewCreditCost: 200,
  stlCreditCost: 400,
  consultCreditCost: 100,
  pieces: { "diamond-pendant": { label: "Diamond Pendant" }, chain: { label: "Chain" } },
  metals: { "yellow-14k": { label: "14k Yellow Gold" } },
  stones: { diamond: { label: "Diamond" } },
  styles: { "iced-out": { label: "Iced Out" } },
  apparel: { "t-shirt": { label: "T-Shirt" } },
  decoMethods: { print: { label: "Print" } },
  defaults: {
    jewelry: { piece: "diamond-pendant", metal: "yellow-14k", stone: "diamond", style: "iced-out", nfc: true, nfcUrl: "", notes: "" },
    apparel: { product: "t-shirt", deco: "print", color: "Black", notes: "" },
  },
};

const JOPTS: JewelryOpts = { piece: "chain", metal: "yellow-14k", stone: "diamond", style: "iced-out", nfc: false, nfcUrl: "", notes: " chunky " };
const AOPTS: ApparelOpts = { product: "t-shirt", deco: "print", color: "Black", notes: "" };

describe("jewelry bench — catalog + prices from the rail itself", () => {
  it("registry fallbacks are the credit registry's figures (200 / 400 / 100)", () => {
    expect(JEWELRY_DESIGN_COST_VISUAL_BUCS).toBe(200);
    expect(JEWELRY_STL_COST_VISUAL_BUCS).toBe(400);
    expect(JEWELRY_CONSULT_COST_VISUAL_BUCS).toBe(100);
    const registry = readFileSync(new URL("../../lib/credit-costs.ts", import.meta.url), "utf8");
    expect(registry).toContain('"/api/jewelry/design": { cost: 200');
    expect(registry).toContain('"/api/jewelry/export-stl": { cost: 400');
    expect(registry).toContain('"/api/jewelry/consult": { cost: 100');
  });

  it("the catalog parses option lists in order, with the rail's prices and defaults", () => {
    const c = parseJewelryCatalog(STATUS)!;
    expect(c.previewCreditCost).toBe(200);
    expect(c.stlCreditCost).toBe(400);
    expect(c.pieces.map((p) => p.key)).toEqual(["diamond-pendant", "chain"]);
    expect(c.pieces[0]!.label).toBe("Diamond Pendant");
    expect(c.defaults!.jewelry.piece).toBe("diamond-pendant");
    expect(c.defaults!.apparel.color).toBe("Black");
  });

  it("a catalog with no usable lists is an honest null, never an invented bench", () => {
    expect(parseJewelryCatalog({})).toBeNull();
    expect(parseJewelryCatalog({ pieces: {}, metals: {} })).toBeNull();
    expect(parseJewelryCatalog(null)).toBeNull();
  });

  it("the guide filter is the page's: apparel reads Apparel sections, jewelry the rest", () => {
    const sections = parseJewelryGuide({
      sections: [
        { title: "Casting a pendant", body: "…" },
        { title: "Apparel printing", body: "…" },
        { title: "", body: "dropped" },
      ],
    });
    expect(sections).toHaveLength(2);
    expect(guideSectionsFor(sections, "jewelry").map((s) => s.title)).toEqual(["Casting a pendant"]);
    expect(guideSectionsFor(sections, "apparel").map((s) => s.title)).toEqual(["Apparel printing"]);
  });
});

describe("jewelry bench — payloads mirror the studio page", () => {
  it("form fields: category first, then every option as a string (the page's append order)", () => {
    expect(jewelryFormFields("jewelry", JOPTS)).toEqual([
      ["category", "jewelry"],
      ["piece", "chain"],
      ["metal", "yellow-14k"],
      ["stone", "diamond"],
      ["style", "iced-out"],
      ["nfc", "false"],
      ["nfcUrl", ""],
      ["notes", " chunky "],
    ]);
  });

  it("the estimate body is the page's: category, options, the STL weight when built, qty", () => {
    expect(buildJewelryEstimatePayload({ category: "jewelry", opts: JOPTS, weightG: 12.5, qty: 24 })).toEqual({
      category: "jewelry",
      options: JOPTS,
      weightG: 12.5,
      qty: 24,
    });
  });

  it("the consult body carries the last 10 turns + the bench's current picks", () => {
    const history = Array.from({ length: 14 }, (_, i) => ({ role: "user" as const, content: `m${i}` }));
    const p = buildJewelryConsultPayload({ message: "now?", history, category: "jewelry", jewelry: JOPTS, apparel: AOPTS });
    expect((p["history"] as unknown[])).toHaveLength(10);
    expect(p["context"]).toEqual({ category: "jewelry", jewelry: JOPTS, apparel: AOPTS });
    expect(parseJewelryConsultReply({ reply: "Go 14k." })).toBe("Go 14k.");
    expect(parseJewelryConsultReply({})).toBeNull();
  });

  it("the shop handoff is the page's own record (bdv_jewelry_handoff)", () => {
    const handoff = buildJewelryShopHandoff({
      category: "jewelry",
      jewelry: JOPTS,
      apparel: AOPTS,
      estimate: {
        lines: [], totalLowUSD: 1200, totalHighUSD: 1800, weightG: 10, stoneCount: 3,
        turnaroundWeeks: [3, 5], disclaimer: "Estimate only.",
      },
      at: 123,
    });
    expect(JEWELRY_HANDOFF_KEY).toBe("bdv_jewelry_handoff");
    expect(handoff["estimate"]).toEqual({ total: "$1,200–$1,800", currency: "USD" });
    expect(handoff["at"]).toBe(123);
  });
});

describe("jewelry bench — response parsers tolerate the wire", () => {
  it("design + STL answers read their URLs; a missing URL is never a success", () => {
    expect(parseJewelryDesignUrl({ url: "https://x/preview.png" })).toBe("https://x/preview.png");
    expect(parseJewelryDesignUrl({})).toBeNull();
    const stl = parseJewelryStl({
      url: "https://x/p.stl", facetCount: 1200, weightG: 9.5, metal: "14k Yellow Gold",
      widthMm: 30, heightMm: 34, nfcPocket: true, pieceNote: "Cast thick.",
    });
    expect(stl).toMatchObject({ facetCount: 1200, weightG: 9.5, nfcPocket: true });
    expect(parseJewelryStl({ facetCount: 1 })).toBeNull();
  });

  it("the estimate parses lines, totals and turnaround; junk is null", () => {
    const est = parseJewelryEstimate({
      estimate: {
        lines: [{ label: "Gold", lowUSD: 800, highUSD: 1000, note: "At spot." }],
        totalLowUSD: 1200, totalHighUSD: 1800, weightG: 10, stoneCount: 3,
        turnaroundWeeks: [3, 5], disclaimer: "Estimate only.",
      },
    });
    expect(est!.lines).toHaveLength(1);
    expect(est!.turnaroundWeeks).toEqual([3, 5]);
    expect(parseJewelryEstimate({ estimate: {} })).toBeNull();
    expect(parseJewelryEstimate(null)).toBeNull();
  });
});

describe("jewelry bench — the desk stands in the Atelier, wired on the rails", () => {
  it("the station stands in the Branding Atelier as a business desk", () => {
    const station = PALACE_STATIONS.find((s) => s.id === "jewelry-bench");
    expect(station).toBeDefined();
    expect(station!.roomId).toBe("world:branding-atelier");
    expect(station!.panel).toEqual({ kind: "native", pattern: "business" });
    expect(station!.websitePath).toBe("/branding-kit?tab=jewelry");
  });

  it("StationPanel routes the station to the bench (source pin)", () => {
    const panel = readFileSync(new URL("../../components/world/StationPanel.tsx", import.meta.url), "utf8");
    expect(panel).toContain('station.id === "jewelry-bench"');
    expect(panel).toContain("<JewelryBench");
  });

  it("the bench rides confirmedFetch for every charge + the free rails plainly (source pins)", () => {
    const bench = readFileSync(new URL("../../components/world/native/JewelryBench.tsx", import.meta.url), "utf8");
    expect(bench).toContain('data-testid="world-jewelry-bench"');
    expect(bench).toContain('confirmedFetch("/api/jewelry/design"');
    expect(bench).toContain('confirmedFetch("/api/jewelry/export-stl"');
    expect(bench).toContain('confirmedFetch("/api/jewelry/consult"');
    expect(bench).toContain('fetch("/api/jewelry/status")');
    expect(bench).toContain('fetch("/api/jewelry/guide")');
    expect(bench).toContain('fetch("/api/jewelry/estimate"');
    expect(bench).toContain("overrideCost: catalog.previewCreditCost");
    expect(bench).toContain("overrideCost: catalog.stlCreditCost");
    expect(bench).toContain("overrideCost: catalog.consultCreditCost");
    expect(bench).toContain('data-testid="world-jewelry-logo-upload"');
    expect(bench).toContain('data-testid="world-jewelry-shop-handoff"');
    expect(bench).toContain("localStorage.setItem(");
  });
});
