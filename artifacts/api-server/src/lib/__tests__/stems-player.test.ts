/**
 * N14 Stems Player — server lib pins.
 *
 *  - normalize: only the Stem Splitter's own key set survives, in
 *    canonical order; partial sets stay exactly partial; junk is dropped.
 *  - descriptors (the track DTO shape) carry keys + labels ONLY —
 *    no refs, no URLs ever leave through a track payload.
 *  - job attachment reads the splitter job's stemRefs, never stemUrls.
 *  - raw storage refs are never sendable playback URLs.
 */
import { describe, it, expect } from "vitest";
import {
  normalizeTrackStemRefs,
  stemDescriptors,
  stemRefsFromJob,
  isSendablePlaybackUrl,
  STEM_PLAYER_KEYS,
} from "../stems-player";

describe("normalizeTrackStemRefs", () => {
  it("keeps exactly the splitter key set, in canonical order", () => {
    const out = normalizeTrackStemRefs({
      other: "r2://generated-clips/stems/u/j/other.wav",
      vocals: "r2://generated-clips/stems/u/j/vocals.wav",
      drums: "r2://generated-clips/stems/u/j/drums.wav",
    });
    expect(out.map((s) => s.key)).toEqual(["vocals", "drums", "other"]);
    expect(out.map((s) => s.label)).toEqual(["Vocals", "Drums", "Melody / Other"]);
  });

  it("partial stems stay partial — exactly those stems, no invention", () => {
    const out = normalizeTrackStemRefs({ bass: "supabase://generated-clips/stems/u/j/bass.wav" });
    expect(out).toHaveLength(1);
    expect(out[0]!.key).toBe("bass");
  });

  it("drops unknown keys, empty and non-string refs", () => {
    const out = normalizeTrackStemRefs({
      vocals: "",
      drums: 42,
      kazoo: "r2://generated-clips/stems/u/j/kazoo.wav",
      piano: "r2://generated-clips/stems/u/j/piano.wav",
    });
    expect(out.map((s) => s.key)).toEqual(["piano"]);
  });

  it("returns [] for absent / malformed values (honest absence)", () => {
    expect(normalizeTrackStemRefs(null)).toEqual([]);
    expect(normalizeTrackStemRefs(undefined)).toEqual([]);
    expect(normalizeTrackStemRefs("stems")).toEqual([]);
    expect(normalizeTrackStemRefs([])).toEqual([]);
    expect(normalizeTrackStemRefs({})).toEqual([]);
  });

  it("the key set is the splitter's: classic four + pro guitar/piano", () => {
    expect(STEM_PLAYER_KEYS).toEqual(["vocals", "drums", "bass", "other", "guitar", "piano"]);
  });
});

describe("stemDescriptors — DTO shape carries no audio address", () => {
  it("emits keys + labels only, never refs", () => {
    const out = stemDescriptors({
      vocals: "r2://generated-clips/stems/u/j/vocals.wav",
      drums: "r2://generated-clips/stems/u/j/drums.wav",
    });
    expect(out).toEqual([
      { key: "vocals", label: "Vocals" },
      { key: "drums", label: "Drums" },
    ]);
    expect(JSON.stringify(out)).not.toContain("r2://");
    expect(JSON.stringify(out)).not.toContain("stems/u/j");
  });

  it("is null when a track carries no stems", () => {
    expect(stemDescriptors(null)).toBeNull();
    expect(stemDescriptors({})).toBeNull();
    expect(stemDescriptors({ vocals: "" })).toBeNull();
  });
});

describe("stemRefsFromJob", () => {
  it("reads stemRefs (stable refs) from a finished splitter job", () => {
    const refs = stemRefsFromJob({
      stemRefs: {
        vocals: "r2://generated-clips/stems/u/j/vocals.wav",
        bass: "r2://generated-clips/stems/u/j/bass.wav",
      },
    });
    expect(refs).toEqual({
      vocals: "r2://generated-clips/stems/u/j/vocals.wav",
      bass: "r2://generated-clips/stems/u/j/bass.wav",
    });
  });

  it("ignores a job's signed stemUrls entirely — refs only", () => {
    const refs = stemRefsFromJob({
      stemRefs: null,
      // @ts-expect-error — stemUrls must never be a carrier source
      stemUrls: { vocals: "https://signed.example/vocals.wav" },
    });
    expect(refs).toBeNull();
  });

  it("is null for missing jobs / empty refs", () => {
    expect(stemRefsFromJob(null)).toBeNull();
    expect(stemRefsFromJob(undefined)).toBeNull();
    expect(stemRefsFromJob({ stemRefs: {} })).toBeNull();
  });
});

describe("isSendablePlaybackUrl", () => {
  it("accepts only http(s) URLs", () => {
    expect(isSendablePlaybackUrl("https://signed.example/x.wav?token=1")).toBe(true);
    expect(isSendablePlaybackUrl("http://cdn.example/x.wav")).toBe(true);
  });

  it("rejects raw storage refs — a failed signing must never leak one", () => {
    expect(isSendablePlaybackUrl("supabase://generated-clips/stems/u/j/vocals.wav")).toBe(false);
    expect(isSendablePlaybackUrl("r2://generated-clips/stems/u/j/vocals.wav")).toBe(false);
    expect(isSendablePlaybackUrl("")).toBe(false);
    expect(isSendablePlaybackUrl(null)).toBe(false);
    expect(isSendablePlaybackUrl(undefined)).toBe(false);
  });
});
