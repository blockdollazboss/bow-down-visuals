/**
 * sound-fit.test.ts — pure fit logic. Pins the honesty contract:
 * unanalysed items (missing BPM or an unreadable key) score NULL, are
 * dropped from rankings, and are never slotted into a stack; scores are
 * explained by their breakdown; stack slots stay empty rather than
 * being filled with a clash.
 */
import { describe, it, expect } from "vitest";
import {
  parseMusicalKey,
  keyFromCamelot,
  isAnalysed,
  scoreFit,
  classifyRole,
  rankFits,
  buildStarterStack,
  coverageOf,
  type FitCandidate,
  type FitProfile,
} from "../sound-fit";

const src: FitProfile = { bpm: 140, camelot: "8A", keyLabel: "A minor", genre: "trap", tags: ["dark", "hard"] };
function cand(p: Partial<FitCandidate>): FitCandidate {
  return {
    kind: "beat", id: "x", title: "X", audioUrl: "https://x/a.mp3", basicPriceCents: 2999,
    bpm: 140, camelot: "8A", keyLabel: "A minor", genre: "trap", tags: ["dark", "hard"], ...p,
  };
}

describe("parseMusicalKey — producer free-text keys", () => {
  it("parses the formats beat listings actually carry", () => {
    expect(parseMusicalKey("C min")?.camelot).toBe("5A");
    expect(parseMusicalKey("F# maj")?.camelot).toBe("2B");
    expect(parseMusicalKey("Am")?.label).toBe("A minor");
    expect(parseMusicalKey("A minor")?.camelot).toBe("8A");
    expect(parseMusicalKey("C")?.camelot).toBe("8B");
    expect(parseMusicalKey("Eb minor")?.root).toBe(3);
    expect(parseMusicalKey("8A")?.label).toBe("A minor");
    expect(parseMusicalKey("G#m")?.camelot).toBe("1A");
  });
  it("refuses what it cannot read — no invented keys", () => {
    expect(parseMusicalKey("")).toBeNull();
    expect(parseMusicalKey(null)).toBeNull();
    expect(parseMusicalKey("dark vibes")).toBeNull();
    expect(parseMusicalKey("C dorian")).toBeNull();
    expect(parseMusicalKey("H major")).toBeNull();
  });
  it("keyFromCamelot round-trips camelotFor", () => {
    expect(keyFromCamelot("8B")?.label).toBe("C major");
    expect(keyFromCamelot("nope")).toBeNull();
  });
});

describe("honesty: unanalysed never scores", () => {
  it("isAnalysed requires BOTH bpm and a parseable camelot", () => {
    expect(isAnalysed(src)).toBe(true);
    expect(isAnalysed({ ...src, bpm: null })).toBe(false);
    expect(isAnalysed({ ...src, camelot: null })).toBe(false);
    expect(isAnalysed({ ...src, camelot: "??" })).toBe(false);
  });
  it("scoreFit is null when either side is unanalysed", () => {
    expect(scoreFit(src, cand({}))).not.toBeNull();
    expect(scoreFit(src, cand({ bpm: null }))).toBeNull();
    expect(scoreFit(src, cand({ camelot: null }))).toBeNull();
    expect(scoreFit({ ...src, bpm: null }, cand({}))).toBeNull();
  });
  it("rankFits drops unanalysed candidates entirely", () => {
    const ranked = rankFits(src, [cand({ id: "ok" }), cand({ id: "no-bpm", bpm: null }), cand({ id: "no-key", camelot: null })]);
    expect(ranked.map((r) => r.id)).toEqual(["ok"]);
  });
  it("coverage counts analysed vs unanalysed truthfully", () => {
    expect(coverageOf([src, { ...src, bpm: null }, { ...src, camelot: null }])).toEqual({ total: 3, analysed: 1, unanalysed: 2 });
  });
});

describe("scoreFit — explained, deterministic", () => {
  it("a perfect match scores 100 with a full breakdown", () => {
    const f = scoreFit(src, cand({}))!;
    expect(f.score).toBe(100);
    expect(f).toMatchObject({ keyPoints: 50, bpmPoints: 30, tagPoints: 20, keyDistance: 0, bpmGap: 0, genreMatch: true });
    expect(f.reasons.join(" ")).toContain("Same key");
  });
  it("half/double-time tempo counts as close", () => {
    const f = scoreFit(src, cand({ bpm: 70 }))!;
    expect(f.bpmGap).toBe(0);
    expect(f.bpmPoints).toBe(30);
  });
  it("a key clash loses all key points but keeps tempo/tag points", () => {
    const f = scoreFit(src, cand({ camelot: "3B" }))!;
    expect(f.keyDistance).toBe(3);
    expect(f.keyPoints).toBe(0);
    expect(f.score).toBe(50); // 0 key + 30 tempo + 20 tag (genre + 2 shared tags)
  });
  it("ranking orders by score, ties by title", () => {
    const ranked = rankFits(src, [
      cand({ id: "clash", title: "Clash", camelot: "3B", bpm: 90, genre: "house", tags: [] }),
      cand({ id: "perfect", title: "Perfect" }),
      cand({ id: "near", title: "Near", camelot: "9A", bpm: 142 }),
    ]);
    expect(ranked.map((r) => r.id)).toEqual(["perfect", "near", "clash"]);
  });
});

describe("classifyRole — reads listing words, labelled as such", () => {
  it("classifies from title/tags keywords", () => {
    expect(classifyRole("Heavy 808 Bass Loop", []).role).toBe("bass");
    expect(classifyRole("Trap Drum Kit", []).role).toBe("drums");
    expect(classifyRole("Soulful Piano Melody", []).role).toBe("melodic");
    expect(classifyRole("Midnight Run", ["dark"]).role).toBe("full");
    expect(classifyRole("Midnight Run", ["dark"]).matchedTerm).toBeNull();
  });
});

describe("buildStarterStack — slots stay empty rather than clash", () => {
  const pool: FitCandidate[] = [
    cand({ id: "drums-ok", title: "Trap Drum Loop", bpm: 141, camelot: "8A" }),
    cand({ id: "bass-ok", title: "Sub Bass Loop", bpm: 139, camelot: "9A" }),
    cand({ id: "mel-ok", title: "Dark Piano Melody", bpm: 140, camelot: "8A" }),
    cand({ id: "full-ok", title: "Midnight Beat", bpm: 142, camelot: "8A" }),
    cand({ id: "drums-clash", title: "Clash Drum Loop", bpm: 90, camelot: "3B", genre: "house", tags: [] }),
  ];
  it("assembles mutually-fitting layers + foundation", () => {
    const stack = buildStarterStack(src, pool);
    expect(stack.slots.map((s) => s.role)).toEqual(["drums", "bass", "melodic", "full"]);
    expect(stack.missing).toEqual([]);
    expect(stack.fillSuggestion).toBeNull();
  });
  it("leaves a slot missing when only a clash exists, and suggests the sample-pack fill in the source key/tempo", () => {
    const stack = buildStarterStack(src, pool.filter((c) => c.id !== "drums-ok"));
    expect(stack.slots.map((s) => s.role)).not.toContain("drums");
    expect(stack.missing).toHaveLength(1);
    expect(stack.missing[0]!.role).toBe("drums");
    expect(stack.missing[0]!.reason).toContain("rather than filled with a clash");
    expect(stack.fillSuggestion).toEqual({ genre: "trap", bpm: 140, musicalKey: "A" });
  });
  it("never slots an unanalysed sound", () => {
    const stack = buildStarterStack(src, [cand({ id: "ghost-drums", title: "Drum Loop", bpm: null })]);
    expect(stack.slots).toEqual([]);
    expect(stack.missing.map((m) => m.role)).toEqual(["drums", "bass", "melodic"]);
  });
});
