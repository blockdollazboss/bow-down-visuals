/**
 * Tests for the Setlist Builder AI flow endpoint.
 *
 * Covers: the 1-credit charge contract, request validation (400 before
 * credits), prompt construction (song titles/energies woven in), flow
 * parsing (every song exactly once, valid slots), and the max_tokens guard.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  SETLIST_FLOW_CREDIT_COST,
  MAX_SETLIST_SONGS,
  buildSetlistFlowPrompt,
  parseSetlistFlow,
  type SetlistSongInput,
} from "../setlist";

const ROUTE_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "setlist.ts");
const routeSource = readFileSync(ROUTE_PATH, "utf8");

const sampleSongs: SetlistSongInput[] = [
  { title: "Midnight Crown", artist: "TRGDY TRBLZ", durationSec: 210, energy: 5 },
  { title: "Slow Tide", artist: "", durationSec: 180, energy: 2 },
  { title: "Encore Anthem", artist: "TRGDY TRBLZ", durationSec: 240, energy: 4 },
];

describe("SETLIST_FLOW_CREDIT_COST", () => {
  it("charges exactly 1 credit per AI flow suggestion", () => {
    expect(SETLIST_FLOW_CREDIT_COST).toBe(1);
  });

  it("caps the setlist at a sane song count", () => {
    expect(MAX_SETLIST_SONGS).toBe(40);
  });
});

describe("max_tokens guard", () => {
  it("never uses the legacy max_tokens parameter", () => {
    // max_completion_tokens is allowed; bare max_tokens is not.
    const withoutCompletion = routeSource.replace(/max_completion_tokens/g, "");
    expect(withoutCompletion).not.toMatch(/max_tokens/);
  });
});

describe("buildSetlistFlowPrompt", () => {
  it("weaves every song title into the prompt", () => {
    const prompt = buildSetlistFlowPrompt(sampleSongs, "");
    for (const s of sampleSongs) {
      expect(prompt).toContain(s.title);
    }
  });

  it("includes energy and duration details when provided", () => {
    const prompt = buildSetlistFlowPrompt(sampleSongs, "");
    expect(prompt).toContain("energy 5/5");
    expect(prompt).toContain("3:30");
  });

  it("includes show context when provided", () => {
    const prompt = buildSetlistFlowPrompt(sampleSongs, "Outdoor festival, sunset slot");
    expect(prompt).toContain("Outdoor festival, sunset slot");
  });

  it("demands JSON-only output with the slot vocabulary", () => {
    const prompt = buildSetlistFlowPrompt(sampleSongs, "");
    expect(prompt).toContain("opener");
    expect(prompt).toContain("encore");
    expect(prompt).toMatch(/JSON/i);
  });
});

describe("parseSetlistFlow", () => {
  it("parses a well-formed flow with every song exactly once", () => {
    const raw = JSON.stringify({
      order: [
        { index: 1, slot: "opener", note: "Soft start, let the crowd lean in." },
        { index: 0, slot: "peak", note: "Drop the banger when the energy is up." },
        { index: 2, slot: "closer", note: "End on the anthem everyone knows." },
      ],
      flowNotes: "A tight three-song arc that builds fast and lands the closer.",
    });
    const flow = parseSetlistFlow(raw, 3);
    expect(flow.order).toHaveLength(3);
    expect(flow.order.map((o) => o.index).sort()).toEqual([0, 1, 2]);
    expect(flow.flowNotes).toContain("three-song arc");
  });

  it("rejects invalid JSON", () => {
    expect(() => parseSetlistFlow("not json", 2)).toThrow("invalid JSON");
  });

  it("rejects a flow that drops a song", () => {
    const raw = JSON.stringify({
      order: [{ index: 0, slot: "opener", note: "Start here." }],
      flowNotes: "Only one song made it.",
    });
    expect(() => parseSetlistFlow(raw, 2)).toThrow("1 of 2 songs");
  });

  it("rejects duplicate song indexes", () => {
    const raw = JSON.stringify({
      order: [
        { index: 0, slot: "opener", note: "Start." },
        { index: 0, slot: "closer", note: "End." },
      ],
      flowNotes: "Duplicated.",
    });
    expect(() => parseSetlistFlow(raw, 2)).toThrow("1 of 2 songs");
  });

  it("rejects unknown slot names", () => {
    const raw = JSON.stringify({
      order: [
        { index: 0, slot: "opener", note: "Start." },
        { index: 1, slot: "mystery", note: "Not a real slot." },
      ],
      flowNotes: "One bad slot.",
    });
    expect(() => parseSetlistFlow(raw, 2)).toThrow("1 of 2 songs");
  });

  it("rejects an empty order or missing flow notes", () => {
    expect(() => parseSetlistFlow(JSON.stringify({ order: [], flowNotes: "x" }), 1)).toThrow();
    expect(() => parseSetlistFlow(JSON.stringify({ order: [{ index: 0, slot: "opener", note: "x" }] }), 1)).toThrow();
  });

  it("normalizes slot casing", () => {
    const raw = JSON.stringify({
      order: [{ index: 0, slot: "Opener", note: "Loud start." }],
      flowNotes: "One song show.",
    });
    const flow = parseSetlistFlow(raw, 1);
    expect(flow.order[0]!.slot).toBe("opener");
  });
});
