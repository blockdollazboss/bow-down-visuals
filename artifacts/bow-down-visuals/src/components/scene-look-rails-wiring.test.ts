import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/* Source pins for the Director's Look Rails wiring: the panel is docked in
   the Scene Studio scene card, generation composes through the ONE shared
   composer, and an AI Director proposal can only reach the scene through
   the explicit accept handlers — never automatically. */

const sceneStudio = readFileSync(join(__dirname, "SceneStudio.tsx"), "utf8");
const panel = readFileSync(join(__dirname, "SceneStudio", "LookRailsPanel.tsx"), "utf8");
const promptImprove = readFileSync(join(__dirname, "..", "lib", "prompt-improve.ts"), "utf8");

describe("Scene Studio wiring", () => {
  it("docks the LookRailsPanel in the scene card", () => {
    expect(sceneStudio).toContain("LookRailsPanel");
    expect(sceneStudio).toContain("<LookRailsPanel scene={scene} onPick={handleUpdate} />");
  });

  it("buildFinalPrompt composes through the shared composer", () => {
    expect(sceneStudio).toContain('import { composeScenePrompt } from "@/lib/scene-look"');
    expect(sceneStudio).toContain("const basePrompt = composeScenePrompt(scene);");
  });

  it("the improve seed + scene context carry the look through the same composer path", () => {
    expect(promptImprove).toContain("composeSceneSeedPrompt(scene)");
    expect(promptImprove).toContain("look: scene.look ?? undefined");
  });
});

describe("LookRailsPanel — proposal acceptance discipline", () => {
  it("renders all five rails from the shared vocabularies", () => {
    expect(panel).toContain("LOOK_RAIL_ORDER.map");
    expect(panel).toContain("LOOK_RAIL_OPTIONS[rail]");
    expect(panel).toContain("Director's Look");
  });

  it("asks the AI Director route and holds the reply in local state only", () => {
    expect(panel).toContain('fetch("/api/director-look"');
    expect(panel).toContain("setProposal(data.proposal)");
    // The proposal state is never written to the scene by an effect or by
    // the fetch itself — the only onPick calls live in the accept/pick
    // handlers below.
    expect(panel).not.toMatch(/useEffect\([\s\S]{0,200}onPick/);
  });

  it("scene writes happen only in the pick handler and the two accept handlers", () => {
    const onPickCalls = panel.match(/onPick\(/g) ?? [];
    expect(onPickCalls).toHaveLength(3);
    expect(panel).toContain("onPick({ look: next });");
    expect(panel).toContain("onPick({ look: applyLookProposal(scene.look, proposal.picks, [rail]) });");
    expect(panel).toContain("onPick({ look: applyLookProposal(scene.look, proposal.picks, rails) });");
  });

  it("surfaces the free-text precedence + what-will-be-woven honesty lines", () => {
    expect(panel).toContain("suppressedLookPicks");
    expect(panel).toContain("applicableLookClauses");
    expect(panel).toContain("wins — this pick stays saved but won't be added");
    expect(panel).toContain("nothing applied yet");
  });
});
