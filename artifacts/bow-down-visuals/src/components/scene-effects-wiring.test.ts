/**
 * scene-effects-wiring.test.ts — source pins for the Viral Effects rail
 * (Higgsfield G7) in Scene Studio:
 *  (a) the rail is docked in the generator's idle controls and the picks
 *      persist onto the scene record;
 *  (b) generation sends the picks as effectIds (server weaves them);
 *  (c) the matcher is approval-only: proposals render an Apply button
 *      and the rail never applies a proposal on its own;
 *  (d) a finished clip hands off to the Promo Clips desk (CREATE →
 *      PROMOTE) from the clip-ready state;
 *  (e) the conflict warning surface exists in the rail.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const studio = readFileSync(new URL("./SceneStudio.tsx", import.meta.url), "utf8");
const rail = readFileSync(new URL("./SceneStudio/EffectsRail.tsx", import.meta.url), "utf8");

describe("viral effects wiring — docking + persistence", () => {
  it("SceneStudio renders the EffectsRail in the generator", () => {
    expect(studio).toContain('from "@/components/SceneStudio/EffectsRail"');
    expect(studio).toContain("<EffectsRail");
    expect(studio).toContain("pickedIds={pickedEffectIds}");
  });

  it("picks persist onto the scene record via onUpdate", () => {
    expect(studio).toContain("onUpdate({ effectIds: ids })");
    expect(studio).toContain("useState<string[]>(scene.effectIds ?? [])");
  });

  it("generation sends effectIds to /generate-runway-clip", () => {
    expect(studio).toContain("effectIds: pickedEffectIds.length > 0 ? pickedEffectIds : undefined");
  });
});

describe("viral effects wiring — matcher approval + conflicts", () => {
  it("the rail calls the match endpoint and renders proposals with Apply buttons", () => {
    expect(rail).toContain('"/api/scene-effects/match"');
    expect(rail).toContain('"/api/scene-effects/recipes"');
    expect(rail).toContain("btn-apply-effect-");
    expect(rail).toContain("applyProposal");
  });

  it("trend reasons render with the proposal when present", () => {
    expect(rail).toContain("p.trendReason");
    expect(rail).toContain("loadTrackedTrendSignals()");
  });

  it("the conflict warning surface is wired to the client seam", () => {
    expect(rail).toContain("effectConflictsClient(");
    expect(rail).toContain('data-testid="effect-conflict-warning"');
  });

  it("the stack cap is enforced in the rail before it can reach the server", () => {
    expect(rail).toContain("pickedIds.length >= maxStack");
    expect(rail).toContain('data-testid="effects-cap-hint"');
  });
});

describe("viral effects wiring — CREATE → PROMOTE handoff", () => {
  it("the clip-ready state offers the Promo Clips handoff", () => {
    expect(studio).toContain('data-testid="link-make-promo-clip"');
    expect(studio).toContain('href="/promo-clip"');
    expect(studio).toContain("Make a Promo Clip");
  });
});
