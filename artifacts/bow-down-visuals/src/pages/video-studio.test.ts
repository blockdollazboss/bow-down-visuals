/**
 * S27-42 — Video Studio dead-path alignment pins.
 *
 * The page is routed at /video-studio, but its generate action POSTed
 * /api/generate-video via callGenerateApi — no such API route exists, so
 * generation ALWAYS threw. The page now drives the real video rail:
 * POST /api/generate-runway-clip (submit, gen4.5 — flat 400 Visual Bucs,
 * charged server-side only on success) + GET
 * /api/generate-runway-clip/:taskId (poll), the same submit+poll pattern
 * as Cartoon Studio and Scene Studio. The price promise is unchanged:
 * the page's CostBadge (400), the registry entry for
 * /api/generate-runway-clip (400) and the rail's GEN45_CREDIT_COST (400)
 * all agree.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const page = read("./video-studio.tsx");
const registry = read("../lib/credit-costs.ts");

describe("S27-42 — Video Studio calls the real video rail", () => {
  it("never calls the dead /api/generate-video endpoint", () => {
    expect(page).not.toContain('"/api/generate-video"');
    expect(page).not.toContain("callGenerateApi");
  });

  it("submits through the confirmed-charge rail to /api/generate-runway-clip", () => {
    expect(page).toContain('confirmedFetch("/api/generate-runway-clip"');
    expect(page).toContain("promptText: fullPrompt");
    expect(page).toContain('model: "gen4.5"');
    expect(page).toContain('aspect === "9:16" ? "720:1280" : "1280:720"');
    expect(page).toContain("referenceImageUrl: mode === \"image\"");
  });

  it("polls the submitted task to completion on the same rail", () => {
    expect(page).toContain("/api/generate-runway-clip/${submitData.taskId}");
    expect(page).toContain('pollData.status === "succeeded"');
    expect(page).toContain('pollData.status === "failed"');
  });

  it("records the rail's real clip duration in the hub, not the picker value", () => {
    expect(page).toContain("const clipDurationSec = submitData.durationSec ?? 5;");
    expect(page).toContain("duration: String(clipDurationSec)");
  });

  it("the displayed price still matches the registry + rail price (400)", () => {
    expect(page).toContain("<CostBadge cost={400}");
    expect(registry).toContain('"/api/generate-runway-clip": { cost: 400, feature: "Generate Video Clip" }');
  });
});
