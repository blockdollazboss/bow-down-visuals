import { describe, it, expect } from "vitest";
import {
  coverageLine, listedPrice, parseFitResponse, parseStackResponse, studioUrlFor,
  type SoundFitItem,
} from "./sound-fit";

const item: SoundFitItem = {
  kind: "beat", id: "b1", title: "Beat", audioUrl: "https://cdn/x y.mp3",
  bpm: 140, keyLabel: "A minor", camelot: "8A", genre: "trap", tags: ["dark"],
  basicPriceCents: 2999, role: { role: "full", matchedTerm: null },
  fit: { score: 95, keyPoints: 50, bpmPoints: 30, tagPoints: 15, keyDistance: 0, bpmGap: 0, sharedTags: ["dark"], genreMatch: true, reasons: ["Same key (8A) — seamless blend"] },
};

describe("sound-fit frontend helpers", () => {
  it("coverage line states analysed of total — the honesty sentence", () => {
    expect(coverageLine({ total: 10, analysed: 6, unanalysed: 4, beats: { total: 8, analysed: 5, unanalysed: 3 }, ownSongs: { total: 2, analysed: 1, unanalysed: 1 } })).toBe("6 of 10 sounds analysed");
  });
  it("listed price renders the beat's basic price exactly as listed; songs have none", () => {
    expect(listedPrice(item)).toBe("Basic license $29.99 — as listed");
    expect(listedPrice({ ...item, kind: "song", basicPriceCents: null })).toBeNull();
  });
  it("studio deep-link follows the house audioUrl protocol", () => {
    expect(studioUrlFor(item)).toBe("/audio-studio?tab=master&audioUrl=https%3A%2F%2Fcdn%2Fx%20y.mp3");
  });
  it("parsers accept the route's shape and refuse anything else", () => {
    const fit = { source: { label: "S", bpm: 140, camelot: "8A", keyLabel: "A minor", genre: "trap", tags: [] }, method: "m", coverage: { total: 1, analysed: 1, unanalysed: 0, beats: { total: 1, analysed: 1, unanalysed: 0 }, ownSongs: { total: 0, analysed: 0, unanalysed: 0 } }, results: [item] };
    expect(parseFitResponse(fit)?.results[0]?.id).toBe("b1");
    expect(parseFitResponse({ results: "nope" })).toBeNull();
    expect(parseFitResponse(null)).toBeNull();
    const stack = { ...fit, stack: { slots: [{ role: "full", item }], missing: [], fillSuggestion: null } };
    expect(parseStackResponse(stack)?.stack.slots[0]?.item.id).toBe("b1");
    expect(parseStackResponse({ stack: { slots: "no" } })).toBeNull();
  });
});
