/**
 * setlist-desk — stack1500 world parity wave #3 item 35 pins.
 *
 * The Setlist desk is the builder's native form. These pins
 * hold: the flow price is the registry row AND the route's
 * SETLIST_FLOW_CREDIT_COST under the "AI Setlist Flow" ledger
 * action; the payload is the page's exact body; the flow guard
 * enforces the route parser's acceptance bar (every song
 * exactly once, the six slots, a note per placement, flow
 * notes present); the library picker drops titles already in
 * the set, the page's own rule.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SETLIST_FEATURE,
  SETLIST_FLOW_COST,
  SETLIST_FLOW_PATH,
  SETLIST_MAX_SONGS,
  SETLIST_SLOTS,
  buildFlowPayload,
  flowOfResponse,
  flowReady,
  libraryOfResponse,
  libraryPicks,
} from "./setlist-desk";
import { getCreditCost } from "../credit-costs";
import type { SetSong } from "../setlist";

const routeSrc = readFileSync(
  new URL("../../../../api-server/src/routes/generate/setlist.ts", import.meta.url),
  "utf8",
);

function song(title: string, extra: Partial<SetSong> = {}): SetSong {
  return { id: `id-${title}`, title, artist: "", durationSec: 0, energy: 0, stageNote: "", ...extra };
}

describe("price — registry == route, one ledger action", () => {
  it("100 in both sources, feature = the route's charge action", () => {
    expect(getCreditCost(SETLIST_FLOW_PATH)?.cost).toBe(100);
    expect(SETLIST_FLOW_COST).toBe(100);
    expect(routeSrc).toContain("SETLIST_FLOW_CREDIT_COST");
    expect(routeSrc).toMatch(/SETLIST_FLOW_CREDIT_COST[^=]*=\s*(?:Number\([^)]*\)\s*\|\|\s*)?100/);
    expect(SETLIST_FEATURE).toBe("AI Setlist Flow");
    expect(routeSrc).toContain('action: "AI Setlist Flow"');
    expect(routeSrc).toContain("MAX_SETLIST_SONGS = 40");
    expect(SETLIST_MAX_SONGS).toBe(40);
  });
});

describe("the payload — the page's exact body", () => {
  it("maps the builder fields and trims the show notes; stage notes stay home", () => {
    const body = buildFlowPayload(
      [song("One", { artist: " Thy ", durationSec: 210, energy: 4, stageNote: "dim the lights" })],
      "  small room  ",
    );
    expect(body).toEqual({
      songs: [{ title: "One", artist: " Thy ", durationSec: 210, energy: 4 }],
      showNotes: "small room",
    });
    expect("stageNote" in body.songs[0]!).toBe(false);
  });

  it("readiness is the schema's 1–40 window", () => {
    expect(flowReady([])).toBe(false);
    expect(flowReady([song("One")])).toBe(true);
    expect(flowReady(Array.from({ length: 41 }, (_, i) => song(`S${i}`)))).toBe(false);
  });
});

describe("the library picker", () => {
  it("reads id/title/duration_sec; drops malformed rows; a non-state body is failure", () => {
    const lib = libraryOfResponse({
      songs: [
        { id: "a", title: "Alpha", duration_sec: "3:30" },
        { id: "b", title: "Beta", duration_sec: null },
        { title: "No id" },
      ],
    })!;
    expect(lib).toHaveLength(2);
    expect(lib[0]).toEqual({ id: "a", title: "Alpha", durationSecRaw: "3:30" });
    expect(lib[1]!.durationSecRaw).toBeNull();
    expect(libraryOfResponse({})).toBeNull();
  });

  it("titles already in the set leave the picker (case-insensitive, the page's rule)", () => {
    const lib = libraryOfResponse({
      songs: [
        { id: "a", title: "Alpha", duration_sec: null },
        { id: "b", title: "Beta", duration_sec: null },
      ],
    })!;
    expect(libraryPicks(lib, [song("alpha")]).map((p) => p.id)).toEqual(["b"]);
  });
});

describe("the flow guard — the route parser's acceptance bar", () => {
  const good = {
    order: [
      { index: 1, slot: "opener", note: "Start warm." },
      { index: 0, slot: "closer", note: "End on the single." },
    ],
    flowNotes: "A slow burn into a big finish.",
    creditsUsed: 100,
  };

  it("accepts a complete flow (every song exactly once, valid slots)", () => {
    const flow = flowOfResponse(good, 2)!;
    expect(flow.order).toHaveLength(2);
    expect(flow.flowNotes).toContain("slow burn");
    expect(SETLIST_SLOTS).toEqual(["opener", "build", "peak", "breather", "closer", "encore"]);
  });

  it("a dropped song, a duplicate, a wild slot, a missing note, or no flow notes is failure", () => {
    expect(flowOfResponse({ ...good, order: [good.order[0]] }, 2)).toBeNull();
    expect(flowOfResponse({ ...good, order: [good.order[0], good.order[0]] }, 2)).toBeNull();
    expect(
      flowOfResponse({ ...good, order: [good.order[0], { index: 0, slot: "middle", note: "x" }] }, 2),
    ).toBeNull();
    expect(
      flowOfResponse({ ...good, order: [good.order[0], { index: 0, slot: "closer", note: "" }] }, 2),
    ).toBeNull();
    expect(flowOfResponse({ ...good, flowNotes: "" }, 2)).toBeNull();
    expect(flowOfResponse(null, 2)).toBeNull();
    expect(flowOfResponse({ error: "refunded" }, 2)).toBeNull();
  });
});
