/**
 * scene-studio-price-wiring.test.ts — Scene Studio's Gen4.5 price pin.
 *
 * Price audit #1 (2026-11-02, the worst lie in the audit): SceneStudio
 * quoted "Generate costs 5 Visual Bucs" for the Gen4.5 Standard clip and
 * handed the same 5 to the spend-confirm dialog as overrideCost, while
 * the rail charges 400 VB flat (GEN45_CREDIT_COST in the server's
 * clip-pricing.ts). The fix derives clipCost's Gen4.5 branch from the FE
 * credit registry (credit-costs.ts, "/api/generate-runway-clip" = 400) —
 * the established registry-mirror pattern (cf. LipSyncStudio's still-clip
 * cost). Both customer-facing surfaces read that one clipCost value:
 * the "Generate costs …" line renders it and confirmedFetch receives it
 * as overrideCost.
 *
 * These pins hold all three sides together — displayed figure ==
 * registry == rail — re-deriving the rail constant from the server
 * source so none of them can drift silently again.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CREDIT_COSTS, getCreditCost } from "../lib/credit-costs";

const studio = readFileSync(new URL("./SceneStudio.tsx", import.meta.url), "utf8");
const clipPricing = readFileSync(
  new URL("../../../api-server/src/routes/generate/clip-pricing.ts", import.meta.url),
  "utf8",
);

function railGen45Cost(): number {
  const m = clipPricing.match(/export\s+const\s+GEN45_CREDIT_COST\s*=\s*(\d+)\b/);
  expect(m, "GEN45_CREDIT_COST in clip-pricing.ts").toBeTruthy();
  return Number(m![1]);
}

describe("Scene Studio Gen4.5 price — displayed == registry == rail", () => {
  it("the rail charges 400 flat (GEN45_CREDIT_COST)", () => {
    expect(railGen45Cost()).toBe(400);
  });

  it("the FE registry records the rail charge for /api/generate-runway-clip", () => {
    expect(CREDIT_COSTS["/api/generate-runway-clip"]?.cost).toBe(railGen45Cost());
    expect(getCreditCost("/api/generate-runway-clip")?.cost).toBe(railGen45Cost());
  });

  it("SceneStudio derives its Gen4.5 cost from the registry, not a hard-coded figure", () => {
    expect(studio).toContain('import { getCreditCost } from "@/lib/credit-costs";');
    expect(studio).toContain(
      'const GEN45_CLIP_COST_CLIENT = getCreditCost("/api/generate-runway-clip")?.cost ?? 400;',
    );
    expect(studio).toContain(": GEN45_CLIP_COST_CLIENT;");
    // The old lie: clipCost's fallback branch was the hard-coded 5.
    expect(studio).not.toContain(": 5;");
  });

  it("the displayed 'Generate costs …' line renders the same clipCost", () => {
    expect(studio).toContain(
      'Generate costs {clipCost.toLocaleString("en-US")} Visual Bucs.',
    );
  });

  it("the spend-confirm dialog override hands over the same clipCost", () => {
    expect(studio).toContain("overrideCost: isEnhance ? enhanceCost : clipCost,");
    expect(studio).toContain(
      'overrideFeature: isEnhance ? "Enhance Draft to 1080p" : "Generate Video Clip"',
    );
  });
});
