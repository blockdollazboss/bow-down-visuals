/* W2-L2 — sequencer wiring contract: the sound registry is actually
 * connected to pages/ai-audio.tsx — picker per track row, playback
 * through playTrackHit in BOTH the live scheduler and the offline
 * render, project persistence of the assignments, the honest empty
 * bank section, and the reload fallback notice. Source-contract style
 * (the house pattern for page wiring) — behavior of the registry
 * itself is covered in beat-sounds.test.ts. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const page = readFileSync(
  resolve(import.meta.dirname, "../pages/ai-audio.tsx"),
  "utf8",
);
const project = readFileSync(resolve(import.meta.dirname, "./beat-project.ts"), "utf8");

describe("sound picker wiring", () => {
  it("every track row carries a sound picker + its own file input", () => {
    expect(page).toContain("beat-sound-picker-${tr.id}");
    expect(page).toContain("assignTrackSound(ti, e.target.value)");
    expect(page).toContain('accept="audio/*,.wav,.mp3,.ogg,.m4a,.flac"');
    expect(page).toContain("onUploadSoundFile(ti, f)");
    expect(page).toContain("fileInputRefs.current[ti]?.click()");
  });

  it("the picker lists built-ins, an honestly empty bank, and your sounds", () => {
    expect(page).toContain("BUILTIN_BEAT_SOUNDS.map");
    expect(page).toContain('listBeatSoundsBySource("bank")');
    expect(page).toContain("Coming with the sound bank");
    expect(page).toContain("sessionUploads.map");
    expect(page).toContain("No sounds loaded yet");
  });

  it("uploads require sign-in and decode through the registry helper", () => {
    expect(page).toContain("decodeAndRegisterUpload(file, TRACKS[ti]!.id, ctx)");
    expect(page).toContain("Sign in to load your own sounds onto a track.");
    expect(page).toContain("That file couldn't be loaded as a sound");
  });
});

describe("playback wiring", () => {
  it("playTrackHit resolves through the registry and falls back to synthHit", () => {
    expect(page).toContain("function playTrackHit(");
    expect(page).toContain("resolveTrackSound(soundId, ti)");
    expect(page).toContain("playSampleBuffer(ctx, entry, t, g)");
    expect(page).toContain("entry.synthKey ?? trackId");
  });

  it("the live scheduler plays assigned sounds (not raw synthHit)", () => {
    expect(page).toContain(
      "playTrackHit(ctx, tr.id, ti, trackSoundsRef.current[ti], when, drums[ti]!",
    );
  });

  it("the offline render plays assigned sounds and preloads bank buffers", () => {
    expect(page).toContain(
      "playTrackHit(off, tr.id, ti, trackSoundsRef.current[ti], tt, drums[ti]!",
    );
    expect(page).toContain("ensureBeatSampleBuffer(e, off)");
  });

  it("samples share the per-track mixer gain path (dest = drums[ti])", () => {
    // playTrackHit's sample gain connects into `dest`, and both call
    // sites pass the per-track mixer gain node as dest — same as synth.
    expect(page).toContain("g.connect(dest)");
  });
});

describe("persistence + honest fallback wiring", () => {
  it("assignments ride the beat project (build, apply, auto-save deps)", () => {
    expect(page).toContain("trackSounds,");
    expect(page).toContain("setTrackSounds([...p.trackSounds])");
    expect(page).toContain("setTrackSoundNames([...p.trackSoundNames])");
    expect(project).toContain("trackSounds: string[]");
    expect(project).toContain("normalizeTrackSoundId");
  });

  it("a missing session file shows the fallback notice, per track", () => {
    expect(page).toContain("isUnavailableSampleAssignment(soundId, ti)");
    expect(page).toContain("beat-sound-fallback-${tr.id}");
    expect(page).toContain("isn't loaded in this session, so the built-in");
  });
});

describe("lane boundaries", () => {
  it("no charges and no provider calls were introduced for sounds", () => {
    const soundsLib = readFileSync(resolve(import.meta.dirname, "./beat-sounds.ts"), "utf8");
    expect(soundsLib).not.toContain("chargeCredits");
    expect(soundsLib).not.toContain("CREDIT_COSTS");
    expect(soundsLib).toContain("NO bank entries ship");
  });
});
