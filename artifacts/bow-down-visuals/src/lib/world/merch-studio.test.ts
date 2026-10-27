import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  MERCH_DESIGN_COST_VISUAL_BUCS,
  MERCH_DROP_PLAN_COST_VISUAL_BUCS,
  MERCH_PRODUCTS,
  MERCH_STYLES,
  buildMerchDesignPayload,
  buildMerchDropPlanPayload,
  buildMerchDropSavePayload,
  buildMerchPatchPayload,
  buildMerchSavePayload,
  merchProductLabel,
  merchStyleLabel,
  nextMerchDropMondayISO,
  parseMerchDesignBatch,
  parseMerchDropPlan,
  parseMerchDropPlans,
  parseMerchOrderIntent,
  parseMerchStore,
} from "./merch-studio";
import { STATION_BY_ID } from "./stations";
import { BRANDING_ATELIER_ID } from "./palace-layout";

/* merch-studio (parity P3-C) — the Merch Bench's pure logic. The
   pins that matter: the two Buc prices are the registry's own
   figures (300 a design batch, 100 a drop plan) and the rails
   behind them auto-refund on failure; the product/style catalog
   mirrors the rail's pricing module figure for figure; the store
   reader takes the rail's margin math as-is and never invents a
   sale (paymentsLive rides through untouched); and no failed or
   foreign answer ever becomes an empty shelf or a phantom plan. */

const creditCostsSrc = readFileSync(new URL("../../lib/credit-costs.ts", import.meta.url), "utf8");
const pricingSrc = readFileSync(
  new URL("../../../../api-server/src/routes/generate/merch-pricing.ts", import.meta.url),
  "utf8",
);
const merchRouteSrc = readFileSync(
  new URL("../../../../api-server/src/routes/generate/merch.ts", import.meta.url),
  "utf8",
);
const dropRouteSrc = readFileSync(
  new URL("../../../../api-server/src/routes/wave8-merch-drop.ts", import.meta.url),
  "utf8",
);
const panelSrc = readFileSync(new URL("../../components/world/StationPanel.tsx", import.meta.url), "utf8");
const benchSrc = readFileSync(
  new URL("../../components/world/native/MerchBench.tsx", import.meta.url),
  "utf8",
);

describe("merch bench — prices come from the rails, never invented", () => {
  it("the registry carries the batch at 300 and the plan at 100 — the bench's constants match", () => {
    expect(creditCostsSrc).toContain('"/api/merch/design": { cost: 300');
    expect(creditCostsSrc).toContain('"/api/wave8/merch-drop/plan": { cost: 100');
    expect(MERCH_DESIGN_COST_VISUAL_BUCS).toBe(300);
    expect(MERCH_DROP_PLAN_COST_VISUAL_BUCS).toBe(100);
  });

  it("both rails auto-refund a failed generation — the bench's refund copy rests on it", () => {
    expect(merchRouteSrc).toContain("refundCredits");
    expect(merchRouteSrc).toContain("Merch Design Batch — Refund (generation failed)");
    expect(dropRouteSrc).toContain("MERCH_DROP_PLAN_CREDIT_COST");
    expect(dropRouteSrc).toContain("|| 100");
    expect(dropRouteSrc).toContain("refundCredits");
  });

  it("the catalog mirrors the rail's pricing module — products, base costs, styles", () => {
    for (const p of MERCH_PRODUCTS) {
      /* the rail's catalog is a record keyed by product (some keys quoted) */
      expect(pricingSrc).toMatch(new RegExp(`"?${p.key}"?: \\{ label: "${p.label}"`));
      expect(pricingSrc).toContain(`baseCostCents: ${p.baseCostCents}`);
      expect(merchProductLabel(p.key)).toBe(p.label);
    }
    for (const s of MERCH_STYLES) {
      expect(pricingSrc).toContain(`label: "${s.label}"`);
      expect(merchStyleLabel(s.key)).toBe(s.label);
    }
    expect(merchProductLabel("unknown-thing")).toBe("unknown-thing");
  });

  it("the paid calls go through the confirmation law — no skipConfirm on either spend", () => {
    for (const endpoint of ['"/api/merch/design"', '"/api/wave8/merch-drop/plan"']) {
      const at = benchSrc.indexOf(endpoint);
      expect(at).toBeGreaterThan(-1);
      expect(benchSrc.slice(at, at + 400)).not.toContain("skipConfirm");
    }
    expect(benchSrc).toContain('data-testid="world-merch-bench"');
    expect(benchSrc).toContain('data-testid="world-merch-photo-studio"');
    expect(benchSrc).toContain('data-testid="world-merch-drop-planner"');
    expect(benchSrc).toContain('data-testid="world-merch-store"');
  });
});

describe("merch bench — the photo studio", () => {
  it("the design payload is the website's body", () => {
    expect(
      buildMerchDesignPayload({ product: "hoodie", style: "vintage", description: "A crown", title: "Crown Hoodie" }),
    ).toEqual({ product: "hoodie", style: "vintage", description: "A crown", title: "Crown Hoodie" });
  });

  it("a batch counts only when it succeeded AND photos came back", () => {
    const batch = parseMerchDesignBatch({
      status: "succeeded",
      mockups: [{ url: "https://x/1.png", path: "merch/1.png" }, { url: "https://x/2.png" }],
      product: "hoodie",
      style: "vintage",
      title: "Crown Hoodie",
      baseCostCents: 2800,
      suggestedPriceCents: 6600,
      commissionPct: 15,
      creditsRemaining: 900,
    });
    expect(batch).toMatchObject({ baseCostCents: 2800, suggestedPriceCents: 6600, commissionPct: 15 });
    expect(batch!.mockups).toEqual([
      { url: "https://x/1.png", path: "merch/1.png" },
      { url: "https://x/2.png", path: "" },
    ]);
    expect(parseMerchDesignBatch({ status: "failed", mockups: [{ url: "https://x/1.png" }] })).toBeNull();
    expect(parseMerchDesignBatch({ status: "succeeded", mockups: [] })).toBeNull();
    expect(parseMerchDesignBatch({ status: "succeeded", mockups: [{ path: "no-url" }] })).toBeNull();
    expect(parseMerchDesignBatch(null)).toBeNull();
  });

  it("saving a photo files it as a priced draft, field for field", () => {
    expect(
      buildMerchSavePayload({
        title: "Crown Hoodie",
        product: "hoodie",
        style: "vintage",
        prompt: "A crown",
        mockup: { url: "https://x/1.png", path: "merch/1.png" },
        priceCents: 6600,
      }),
    ).toEqual({
      title: "Crown Hoodie",
      product: "hoodie",
      style: "vintage",
      prompt: "A crown",
      imageUrl: "https://x/1.png",
      imagePath: "merch/1.png",
      priceCents: 6600,
      status: "draft",
    });
  });
});

describe("merch bench — the store", () => {
  it("designs read with the rail's own margins — and paymentsLive rides through untouched", () => {
    const store = parseMerchStore({
      designs: [
        {
          id: "d1",
          title: "Crown Hoodie",
          product: "hoodie",
          style: "vintage",
          prompt: "A crown",
          image_url: "https://x/1.png",
          price_cents: 6600,
          base_cost_cents: 2800,
          status: "listed",
          margin: { profitCents: 2810, marginPct: 43, commissionCents: 990 },
          created_at: "2026-10-01T00:00:00Z",
        },
        { id: "d2", title: "Unpriced", price_cents: 0, margin: null },
        { title: "no id, no row" },
      ],
      commissionPct: 15,
      paymentsLive: false,
    });
    expect(store!.designs).toHaveLength(2);
    expect(store!.designs[0]).toMatchObject({
      id: "d1",
      priceCents: 6600,
      margin: { profitCents: 2810, marginPct: 43, commissionCents: 990 },
    });
    expect(store!.designs[1]!.margin).toBeNull();
    expect(store!.commissionPct).toBe(15);
    expect(store!.paymentsLive).toBe(false);
    expect(parseMerchStore({ designs: "nope" })).toBeNull();
    expect(parseMerchStore(null)).toBeNull();
  });

  it("a patch carries only the fields being changed", () => {
    expect(buildMerchPatchPayload({ priceCents: 5000 })).toEqual({ priceCents: 5000 });
    expect(buildMerchPatchPayload({ status: "listed" })).toEqual({ status: "listed" });
    expect(buildMerchPatchPayload({})).toEqual({});
  });

  it("an order intent is the rail's own words — coming_soon until payments open", () => {
    expect(
      parseMerchOrderIntent({
        status: "coming_soon",
        message: "Merch checkout is coming soon — your interest is recorded.",
        paymentsLive: false,
      }),
    ).toEqual({
      status: "coming_soon",
      message: "Merch checkout is coming soon — your interest is recorded.",
      paymentsLive: false,
    });
    expect(parseMerchOrderIntent({ status: "coming_soon" })).toBeNull();
    expect(parseMerchOrderIntent(null)).toBeNull();
  });
});

describe("merch bench — the drop planner", () => {
  const planWire = {
    plan: {
      concepts: [
        { name: "Crown Tee", product: "T-Shirt", description: "d", pricePoint: "$35", why: "w" },
        { name: "Palace Hoodie", product: "Hoodie", description: "d", pricePoint: "$65", why: "w" },
        { name: "Throne Cap", product: "Cap", description: "d", pricePoint: "$30", why: "w" },
        { name: "Fourth Wheel", product: "Poster", description: "d", pricePoint: "$20", why: "w" },
      ],
      launchPosts: [0, 1, 2, 3, 4, 5].map((n) => ({ dayOffset: n, title: `Post ${n}`, caption: "c", cta: "go" })),
    },
    creditsUsed: 100,
    creditsRemaining: 800,
  };

  it("the plan payload is the website's body", () => {
    expect(buildMerchDropPlanPayload({ niche: "drill beats", audience: "producers", priceBand: "mid" })).toEqual({
      niche: "drill beats",
      audience: "producers",
      priceBand: "mid",
    });
  });

  it("the plan clamps to the contract — exactly 3 concepts, 5 posts — and carries its charge", () => {
    const plan = parseMerchDropPlan(planWire);
    expect(plan!.concepts).toHaveLength(3);
    expect(plan!.concepts.map((c) => c.name)).toEqual(["Crown Tee", "Palace Hoodie", "Throne Cap"]);
    expect(plan!.launchPosts).toHaveLength(5);
    expect(plan!.creditsUsed).toBe(100);
    expect(plan!.creditsRemaining).toBe(800);
  });

  it("a plan with no named concept is not a plan", () => {
    expect(parseMerchDropPlan({ plan: { concepts: [{ name: "" }], launchPosts: [] } })).toBeNull();
    expect(parseMerchDropPlan({ plan: { concepts: "nope", launchPosts: [] } })).toBeNull();
    expect(parseMerchDropPlan({})).toBeNull();
  });

  it("saving files the plan with its launch week", () => {
    const plan = parseMerchDropPlan(planWire)!;
    const payload = buildMerchDropSavePayload({ planName: "Beats Drop", plan, weekStart: "2026-11-02" });
    expect(payload["planName"]).toBe("Beats Drop");
    expect(payload["weekStart"]).toBe("2026-11-02");
    expect(payload["concepts"]).toBe(plan.concepts);
    expect(payload["launchPosts"]).toBe(plan.launchPosts);
  });

  it("the launch week anchors to next Monday, never today", () => {
    /* Tuesday Oct 27 2026 → Monday Nov 2; a Monday anchors to the NEXT Monday. */
    expect(nextMerchDropMondayISO(new Date("2026-10-27T12:00:00Z"))).toBe("2026-11-02");
    expect(nextMerchDropMondayISO(new Date("2026-11-02T12:00:00Z"))).toBe("2026-11-09");
  });

  it("saved plans read back with their concepts and queued posts", () => {
    const plans = parseMerchDropPlans({
      plans: [
        {
          id: "p1",
          plan_name: "Beats Drop",
          concepts: [{ name: "Crown Tee", product: "T-Shirt", description: "d", pricePoint: "$35", why: "w" }],
          launch_posts: [{ dayOffset: 0, title: "T", caption: "c", cta: "go" }],
          status: "active",
          created_at: "2026-10-20T00:00:00Z",
        },
        { plan_name: "no id" },
      ],
    });
    expect(plans).toHaveLength(1);
    expect(plans![0]).toMatchObject({ id: "p1", planName: "Beats Drop", status: "active" });
    expect(plans![0]!.concepts[0]!.name).toBe("Crown Tee");
    expect(parseMerchDropPlans({ plans: "nope" })).toBeNull();
  });
});

describe("merch bench — the bench is wired natively", () => {
  it("the station stands in the Branding Atelier as a native business panel", () => {
    const s = STATION_BY_ID.get("merch-bench");
    expect(s).toBeDefined();
    expect(s!.roomId).toBe(BRANDING_ATELIER_ID);
    expect(s!.panel).toEqual({ kind: "native", pattern: "business" });
    expect(s!.websitePath).toBe("/branding-kit?tab=shop&subtab=merch");
  });

  it("StationPanel routes the bench to its native panel", () => {
    expect(panelSrc).toContain('station.id === "merch-bench"');
    expect(panelSrc).toContain("<MerchBench");
  });
});
