/**
 * S27-40 / S27-41 / S27-48 — FE dead-path alignment pins.
 *
 * Three FE surfaces called API paths that don't exist, so they failed on
 * EVERY use (A2 audit):
 *   - AICopilotPanel POSTed /api/ai-copilot/analyze while the API only
 *     answered POST /api/analyze (bare mount). The API mount moved to
 *     router.use("/ai-copilot", …) — the FE path below is now the true
 *     route; this pin keeps the FE aimed at it.
 *   - EffectsSection POSTed /api/video-background-removal while the API
 *     answers POST /api/remove-video-background. The FE moved.
 *   - floating-admin-panel carried repair buttons POSTing
 *     /api/admin/schema-repair and /api/admin/schema-repair-0054 — zero
 *     matching API routes exist. The buttons (the DbRepairs block and the
 *     Bow Race TEMPORARY repair button, which shared the same dead
 *     endpoint) were removed; no other admin panel function was touched.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const copilotPanel = read("../editor/sections/AICopilotPanel.tsx");
const effectsSection = read("../editor/sections/EffectsSection.tsx");
const adminPanel = read("./floating-admin-panel.tsx");

describe("S27-40 — AI Copilot panel calls the mounted route", () => {
  it("POSTs /api/ai-copilot/analyze", () => {
    expect(copilotPanel).toContain('confirmedFetch("/api/ai-copilot/analyze"');
  });
});

describe("S27-41 — EffectsSection calls the mounted route", () => {
  it("POSTs /api/remove-video-background and never the dead noun path", () => {
    expect(effectsSection).toContain('confirmedFetch("/api/remove-video-background"');
    expect(effectsSection).not.toContain("/api/video-background-removal");
  });

  it("still confirms the rail's 500 Visual Bucs charge before spending", () => {
    expect(effectsSection).toContain("overrideCost: 500");
    expect(effectsSection).toContain('overrideFeature: "Video Background Removal"');
  });
});

describe("S27-48 — dead admin repair buttons are gone", () => {
  it("no source in the panel references the dead schema-repair endpoints", () => {
    expect(adminPanel).not.toContain("schema-repair");
    expect(adminPanel).not.toContain("schema-repair-0054");
  });

  it("the DbRepairs block and its buttons were removed", () => {
    expect(adminPanel).not.toContain("DbRepairs");
    expect(adminPanel).not.toContain("Database repairs");
    expect(adminPanel).not.toContain("Run schema repair");
    expect(adminPanel).not.toContain("Run 0054 DB repair");
  });

  it("every other admin panel function is untouched", () => {
    expect(adminPanel).toContain("<PromoReset");
    expect(adminPanel).toContain("<CopyArtists");
    expect(adminPanel).toContain("<BowRaceControls");
    expect(adminPanel).toContain("<JackpotCreator");
    expect(adminPanel).toContain('fetch("/api/admin/bow-challenge"');
  });
});
