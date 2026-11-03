import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(path.resolve(import.meta.dirname, rel), "utf8");

const aiAudio = read("../pages/ai-audio.tsx");
const editor = read("../components/beat-studio/BeatAutomationLane.tsx");
const beatProject = read("./beat-project.ts");
const beatMixer = read("./beat-mixer.ts");
const beatExport = read("./beat-export.ts");

describe("beat automation + sends wiring (W3a)", () => {
  it("automation lives in the ONE project shape, carried by clone/normalize/resize", () => {
    expect(beatProject).toContain("automation: BeatAutomationLane[]");
    expect(beatProject).toContain("automation: cloneBeatAutomation(p.automation)");
    expect(beatProject).toContain("automation: normalizeBeatAutomation(r.automation, steps, BEAT_MIXER_CHANNEL_IDS)");
    expect(beatProject).toContain("automation: resizeBeatAutomation(p.automation, steps)");
    expect(beatProject).toContain("automation: emptyBeatAutomation()");
  });

  it("the live scheduler writes automation per step; the render writes the bulk list before startRendering", () => {
    /* Live: scheduleStep applies this step's slice at the step's own time. */
    expect(aiAudio).toContain("applyAutomationStepLive(graph, pat, s, when)");
    expect(aiAudio).toContain("automationStepEvents(lane, s, stepsInPattern, when, stepDur, swingRef.current)");
    expect(aiAudio).toContain("writeBeatAutomationEvents(target, events, { cancel: s === 0 })");
    /* Export: the bulk event list is applied inside renderBeat, BEFORE
     * the offline context starts rendering. */
    const renderStart = aiAudio.indexOf("const renderBeat = async");
    const autoAt = aiAudio.indexOf("automationEventsForPlays(", renderStart);
    const startRenderingAt = aiAudio.indexOf("off.startRendering()", renderStart);
    expect(renderStart).toBeGreaterThan(-1);
    expect(autoAt).toBeGreaterThan(renderStart);
    expect(startRenderingAt).toBeGreaterThan(autoAt);
    /* Volume lanes scale by the effective fader base in BOTH paths. */
    expect(aiAudio).toContain("scaleBeatAutomationEvents(events, automationBaseGain(lane.channel, mixerBaseRef.current))");
    expect(aiAudio).toContain("automationBaseGain(channel, baseMixer)");
  });

  it("stems pass their own channel (or none for melody) into the render", () => {
    expect(aiAudio).toContain("await renderBeat(isolated, stemFx, autoChannel)");
    expect(aiAudio).toContain('stem.kind === "bass"');
    /* The FX isolation carries the shared buses (the stem's room). */
    expect(beatExport).toContain("buses: normalizeBusesConfig(fx.buses ?? defaultBusesConfig())");
  });

  it("the editor is mounted per pattern, edits through the pattern patch, and the toggle sits with the other sections", () => {
    expect(aiAudio).toContain('data-testid="beat-automation-toggle"');
    expect(aiAudio).toContain("automation={patterns[activePat]!.automation}");
    expect(aiAudio).toContain("onChange={(next) => patchActive((p) => ({ ...p, automation: next }))}");
    expect(editor).toContain("setBeatAutomationPoint");
    expect(editor).toContain("removeBeatAutomationPoint");
    expect(editor).toContain("clearBeatAutomationLane");
    expect(editor).toContain('data-testid="beat-automation-chart"');
  });

  it("sends are edited per channel in the FX panel and the buses on the master strip", () => {
    expect(aiAudio).toContain("fx.sends.delay");
    expect(aiAudio).toContain("fx.sends.reverb");
    expect(aiAudio).toContain("mixerFx.buses.delay.timeMs");
    expect(aiAudio).toContain("mixerFx.buses.reverb.durationSec");
    expect(beatMixer).toContain("buildBeatBus");
    expect(beatMixer).toContain("automationTargets");
  });

  it("the AI generation rail is untouched — editing stays free, the 300 VB charge stands", () => {
    expect(aiAudio).toContain('CREDIT_COSTS["/api/beat/generate"]?.cost ?? 300');
    /* No charge call sites appeared in the automation editor or module. */
    expect(editor).not.toContain("CREDIT_COSTS");
    expect(read("./beat-automation.ts")).not.toContain("CREDIT_COSTS");
  });
});
