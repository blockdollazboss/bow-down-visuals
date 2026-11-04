/**
 * coach-plan-ladder — Stack-100 Wave 5 #31 (audit A14) seam pins.
 *
 * The Coach desk's plan ladder must be the SAME ladder the
 * creator-pricing page sells: CREATOR_PLANS from lib/pricing-plans
 * (the one pricing source), with live configuration overlaid from
 * GET /api/creator-tiers/plans in the page's own semantics. These
 * tests pin the seam behaviorally — every display field is
 * asserted against the shared source itself, so a drift in either
 * direction fails here — and structurally (the seam holds no
 * price literal of its own).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CREATOR_PLANS } from "@/lib/pricing-plans";
import { paidPlanCta, pricingCardCta } from "@/lib/pricing-card-state";
import {
  COACH_LADDER_TIER_STALL_MS,
  buildLadderPlans,
  ladderPriceLabel,
  parsePlanConfigOverlay,
  type CreatorTierId,
  type PlanConfigOverlay,
} from "./coach-plan-ladder";

const seam = readFileSync(new URL("./coach-plan-ladder.ts", import.meta.url), "utf8");

describe("buildLadderPlans — the ladder IS the shared pricing source", () => {
  it("mirrors CREATOR_PLANS field for field, in order, with no overlay", () => {
    const views = buildLadderPlans({});
    expect(views).toHaveLength(CREATOR_PLANS.length);
    for (const [i, row] of CREATOR_PLANS.entries()) {
      const view = views[i];
      expect(view.tier).toBe(row.tier);
      expect(view.name).toBe(row.name);
      expect(view.tagline).toBe(row.tagline);
      expect(view.priceUsdPerMonth).toBe(row.priceUsdPerMonth);
      expect(view.feePct).toBe(row.feePct);
      expect(view.feeBps).toBe(row.feeBps);
      expect(view.aiBoostsPerMonth).toBe(row.aiBoostsPerMonth);
      /* Inclusions are the shared source's labels, verbatim and
         in order — the detailsUrl page anchors never cross into
         the World (no page pull-ups). */
      expect(view.features).toEqual(row.features.map((f) => f.label));
    }
  });

  it("seeds priceConfigured exactly like the creator-pricing page", () => {
    const views = buildLadderPlans({});
    for (const view of views) {
      expect(view.priceConfigured).toBe(view.tier === "free");
    }
  });

  it("an overlay row moves config ONLY — never names, prices, boosts or features", () => {
    const overlay: Partial<Record<CreatorTierId, PlanConfigOverlay>> = {
      pro: { priceConfigured: true, feeBps: 700, feePct: "7%" },
    };
    const views = buildLadderPlans(overlay);
    const pro = views.find((v) => v.tier === "pro")!;
    const src = CREATOR_PLANS.find((p) => p.tier === "pro")!;
    expect(pro.priceConfigured).toBe(true);
    expect(pro.feeBps).toBe(700);
    expect(pro.feePct).toBe("7%");
    expect(pro.name).toBe(src.name);
    expect(pro.priceUsdPerMonth).toBe(src.priceUsdPerMonth);
    expect(pro.aiBoostsPerMonth).toBe(src.aiBoostsPerMonth);
    expect(pro.features).toEqual(src.features.map((f) => f.label));
    /* Tiers the overlay doesn't carry keep the seeded state. */
    expect(views.find((v) => v.tier === "elite")!.priceConfigured).toBe(false);
    expect(views.find((v) => v.tier === "free")!.priceConfigured).toBe(true);
  });

  it("a malformed overlay row (empty fee fields) leaves the shared fee standing", () => {
    const views = buildLadderPlans({
      elite: { priceConfigured: true, feeBps: 0, feePct: "" },
    });
    const elite = views.find((v) => v.tier === "elite")!;
    const src = CREATOR_PLANS.find((p) => p.tier === "elite")!;
    expect(elite.priceConfigured).toBe(true);
    expect(elite.feePct).toBe(src.feePct);
    expect(elite.feeBps).toBe(src.feeBps);
  });
});

describe("parsePlanConfigOverlay — the page's overlay read", () => {
  it("reads config per tier from a real-shaped payload", () => {
    const overlay = parsePlanConfigOverlay({
      plans: [
        { tier: "free", priceConfigured: true, feeBps: 500, feePct: "5%" },
        { tier: "pro", priceConfigured: true, feeBps: 500, feePct: "5%" },
        { tier: "elite", priceConfigured: false, feeBps: 500, feePct: "5%" },
      ],
      note: "…",
    });
    expect(overlay.pro).toEqual({ priceConfigured: true, feeBps: 500, feePct: "5%" });
    expect(overlay.elite!.priceConfigured).toBe(false);
  });

  it("derives the fee label from feeBps when the payload omits feePct", () => {
    const overlay = parsePlanConfigOverlay({
      plans: [{ tier: "pro", priceConfigured: true, feeBps: 700 }],
    });
    expect(overlay.pro!.feePct).toBe("7%");
  });

  it("an absent priceConfigured flag on a present row reads as not configured", () => {
    const overlay = parsePlanConfigOverlay({
      plans: [{ tier: "pro", feeBps: 500, feePct: "5%" }],
    });
    expect(overlay.pro!.priceConfigured).toBe(false);
  });

  it("unusable payloads yield no overlay — never an invented configuration", () => {
    expect(parsePlanConfigOverlay(null)).toEqual({});
    expect(parsePlanConfigOverlay("nope")).toEqual({});
    expect(parsePlanConfigOverlay({})).toEqual({});
    expect(parsePlanConfigOverlay({ plans: "nope" })).toEqual({});
    expect(parsePlanConfigOverlay({ plans: [] })).toEqual({});
    expect(
      parsePlanConfigOverlay({ plans: [{ tier: "gold", priceConfigured: true }] }),
    ).toEqual({});
    expect(parsePlanConfigOverlay({ plans: [null, 42, { tier: "pro", priceConfigured: true, feeBps: 500, feePct: "5%" }] }).pro)
      .toEqual({ priceConfigured: true, feeBps: 500, feePct: "5%" });
  });
});

describe("ladder CTA derivation — the pricing pages' own state machine", () => {
  it("a configured paid tier buys; unconfigured + clean load is coming-soon; unconfigured + failed load retries", () => {
    const pro = buildLadderPlans({}).find((v) => v.tier === "pro")!;
    expect(paidPlanCta(true, false)).toBe("buy");
    expect(paidPlanCta(pro.priceConfigured, false)).toBe("coming-soon");
    expect(paidPlanCta(pro.priceConfigured, true)).toBe("retry-load");
  });

  it("the Free card: your-plan for a free member, no door at all for a paid member", () => {
    expect(pricingCardCta("free", "free")).toBe("your-plan");
    expect(pricingCardCta("free", "pro")).toBe("none");
    expect(pricingCardCta("free", "elite")).toBe("none");
  });
});

describe("ladderPriceLabel — formatted from the source figure", () => {
  it("labels every tier from its CREATOR_PLANS price", () => {
    for (const view of buildLadderPlans({})) {
      const src = CREATOR_PLANS.find((p) => p.tier === view.tier)!;
      expect(ladderPriceLabel(view)).toBe(
        src.priceUsdPerMonth === 0 ? "Free" : `$${src.priceUsdPerMonth}/mo`,
      );
    }
  });
});

describe("the tier-read grace window", () => {
  it("sits well past useCreatorTier's own retry budget (~1.6s of backoff)", () => {
    expect(COACH_LADDER_TIER_STALL_MS).toBeGreaterThanOrEqual(10_000);
  });
});

describe("the seam holds no price of its own (structural)", () => {
  it("imports the ladder from the ONE pricing source", () => {
    expect(seam).toContain('from "@/lib/pricing-plans"');
    expect(seam).toContain("CREATOR_PLANS");
  });

  it("contains no dollar literal and no hard-coded plan figure", () => {
    expect(seam).not.toMatch(/\$\d/);
    expect(seam).not.toMatch(/priceUsdPerMonth:\s*\d/);
    expect(seam).not.toMatch(/aiBoostsPerMonth:\s*\d/);
  });
});
