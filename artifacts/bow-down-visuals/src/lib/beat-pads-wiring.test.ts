/* W3b — pads/slicing/pack-load wiring contract for pages/ai-audio.tsx:
 * the pad grid plays through the same playTrackHit seam as steps, the
 * slice argument rides BOTH scheduling call sites (live transport and
 * offline render — that sameness is what makes live, WAV and stems
 * agree), slices persist in the one project shape, and the pack drop
 * reports every file. Source-contract style, the house pattern for
 * page wiring; behavior lives in beat-pads.test.ts /
 * beat-project-slices.test.ts. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const page = readFileSync(
  resolve(import.meta.dirname, "../pages/ai-audio.tsx"),
  "utf8",
);
const project = readFileSync(resolve(import.meta.dirname, "./beat-project.ts"), "utf8");
const padsLib = readFileSync(resolve(import.meta.dirname, "./beat-pads.ts"), "utf8");
const soundsLib = readFileSync(resolve(import.meta.dirname, "./beat-sounds.ts"), "utf8");

describe("pad view wiring", () => {
  it("the pads panel, grid and per-track pads exist behind a toggle", () => {
    expect(page).toContain('data-testid="beat-pads-toggle"');
    expect(page).toContain('data-testid="beat-pads-panel"');
    expect(page).toContain('data-testid="beat-pad-grid"');
    expect(page).toContain("beat-pad-${tr.id}");
  });

  it("a pad hit plays through playTrackHit (the step seam), never a side path", () => {
    expect(page).toContain("playTrackHit(ctx, tr.id, ti, trackSounds[ti], ctx.currentTime, chain.input, vel, trackSlices[ti])");
    expect(page).toContain("padHitVelocity(padVelMode, ratioFromTop, padFixedVel)");
  });

  it("velocity modes are offered: from hit position, or a fixed control", () => {
    expect(page).toContain('data-testid="beat-pad-vel-hit"');
    expect(page).toContain('data-testid="beat-pad-vel-fixed"');
    expect(page).toContain("setPadFixedVel(Number(e.target.value) / 100)");
  });
});

describe("slice wiring — live and render share the slice", () => {
  it("playTrackHit resolves the slice region from the live buffer", () => {
    expect(page).toContain("resolveSliceRegion(slice, soundId, getSampleBuffer(entry.id)?.duration)");
    expect(page).toContain("playSampleBuffer(ctx, entry, t, g, region)");
    expect(soundsLib).toContain("src.start(t, region.offset, region.duration)");
  });

  it("BOTH scheduling call sites pass the track's slice", () => {
    expect(page).toContain(
      "playTrackHit(ctx, tr.id, ti, trackSoundsRef.current[ti], when, chain.input, gain, trackSlicesRef.current[ti])",
    );
    expect(page).toContain(
      "playTrackHit(off, tr.id, ti, trackSoundsRef.current[ti], tt, drums[ti]!, gain, trackSlicesRef.current[ti])",
    );
  });

  it("changing a track's sound clears its slice in the page state", () => {
    expect(page).toContain("sl.soundId !== soundId ? null : sl");
  });

  it("the slice spread is planned in the lib and applied per pad", () => {
    expect(page).toContain("planSliceSpread(sliceStartSel, sliceCountSel)");
    expect(page).toContain('data-testid="beat-slice-apply"');
    expect(page).toContain("beat-pad-slice-clear-${tr.id}");
  });
});

describe("pack-load wiring — every file gets a reported outcome", () => {
  it("drop lands on the sequencer card; the picker takes many files", () => {
    expect(page).toContain('data-testid="beat-sequencer"');
    expect(page).toContain("handlePackFiles(Array.from(e.dataTransfer.files ?? []))");
    expect(page).toContain('data-testid="beat-pack-drop-overlay"');
    expect(page).toContain('data-testid="beat-pack-load-button"');
    expect(page).toContain("multiple");
  });

  it("the plan is computed in the lib before any decoding", () => {
    expect(page).toContain("planPackLoad(files, trackSoundsRef.current, trackSlicesRef.current)");
    expect(page).toContain("decodeAndRegisterUpload(f, TRACKS[entry.trackIndex]!.id, ctx)");
  });

  it("results render one line per file, loaded or rejected with a reason", () => {
    expect(page).toContain('data-testid="beat-pack-results"');
    expect(page).toContain("packReasonText(r.reason ?? \"decode\")");
    expect(padsLib).toContain("nothing is silently dropped");
  });
});

describe("persistence — slices ride the ONE project shape", () => {
  it("the project type carries trackSlices and the page builds/applies/saves it", () => {
    expect(project).toContain("trackSlices: (BeatTrackSlice | null)[]");
    expect(project).toContain("normalizeTrackSlices");
    expect(page).toContain("setTrackSlices([...p.trackSlices])");
    expect(page).toContain("trackSlicesRef");
  });

  it("post-reload honesty is inherited: an unloaded sliced upload shows not loaded", () => {
    // The pad renders the same isUnavailableSampleAssignment notice
    // source as the track rows — the synth fallback is named, not silent.
    expect(page).toContain("isUnavailableSampleAssignment(soundId, ti)");
  });
});

describe("lane boundaries", () => {
  it("no charges, no provider calls, no bundled audio in the pads lane", () => {
    expect(padsLib).not.toContain("chargeCredits");
    expect(padsLib).not.toContain("CREDIT_COSTS");
    expect(padsLib).not.toContain("createObjectURL");
    expect(padsLib).toContain("No audio files are generated or bundled here");
  });

  it("the AI rail price is untouched by this lane", () => {
    expect(page).toContain('CREDIT_COSTS["/api/beat/generate"]');
  });
});
