/* Beat persistence — page wiring contract: components/audio-studio/AiAudio.tsx is
 * actually connected to the durable sample library (declare/PUT/
 * confirm on upload, rehydration on mount, honest session-only
 * outcomes, library removal). Source-contract style, matching
 * beat-sounds-wiring.test.ts — the library's behavior itself is
 * covered in beat-sample-library.test.ts and the rail in the API
 * suite. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const page = readFileSync(
  resolve(import.meta.dirname, "../components/audio-studio/AiAudio.tsx"),
  "utf8",
);

describe("upload → durable save wiring", () => {
  it("uploads persist through the library after the session decode", () => {
    expect(page).toContain("persistBeatSample({ token, file, name: entry.name, kind: entry.kind })");
    expect(page).toContain("validateBeatSampleFile(file)");
    // The session contract from W2-L2 still stands — decode first.
    expect(page).toContain("decodeAndRegisterUpload(file, TRACKS[ti]!.id, ctx)");
  });

  it("a saved upload swaps the track assignment to the durable id", () => {
    expect(page).toContain("registerUploadSound({ id: record.soundId");
    expect(page).toContain("prev.map((s) => (s === entry.id ? durable.id : s))");
    expect(page).toContain("setDurableSoundIds");
  });

  it("failure is honest: session-only marking + notice, never a claimed save", () => {
    expect(page).toContain("setSessionOnlyIds");
    expect(page).toContain("couldn't be saved to your library, so it won't be here after a reload");
    expect(page).toContain("over the 20 MB library limit, so it isn't saved to your library");
    expect(page).toContain("is saved to your sound library — it will be here next time");
    expect(page).toContain('data-testid="beat-sound-notice"');
    expect(page).toContain('defaultValue: "this session only"');
  });
});

describe("rehydration wiring", () => {
  it("the library loads on mount and registers through the seam", () => {
    expect(page).toContain("fetchBeatSamples(token)");
    expect(page).toContain("registerBeatSampleLibrary(records)");
    expect(page).toContain("beatSampleEntries(records)");
  });

  it("assigned saved sounds load their buffers; exports preload them too", () => {
    expect(page).toContain("hasSampleBuffer(entry)");
    expect(page).toContain('e.source === "upload" && e.url');
  });
});

describe("library removal wiring", () => {
  it("a saved sound on a track offers removal, riding the rail", () => {
    expect(page).toContain("isPersistedBeatSoundId(soundId)");
    expect(page).toContain("beat-sound-remove-${tr.id}");
    expect(page).toContain("deleteBeatSample(token, sampleId)");
    expect(page).toContain("couldn't be removed from your library");
  });
});

describe("lane boundaries", () => {
  it("no charges were introduced for saving sounds", () => {
    const lib = readFileSync(resolve(import.meta.dirname, "./beat-sample-library.ts"), "utf8");
    expect(lib).not.toContain("chargeCredits");
    expect(lib).not.toContain("CREDIT_COSTS");
  });
});
