/**
 * monument-board — board item 16: the monument letters REAL
 * board headlines.
 *
 * Pins:
 * - the shaping reads the panel's own sources: who's here from
 *   the directory (busiest first, capped), today from the slate
 *   through eventsToday (live first), standings through
 *   kingdomStandings over the real leaderboard shape;
 * - honesty: an absent leaderboard (guest) letters the members'
 *   line — never rows; empty reads letter their empty lines;
 * - the painter letters at 1024×1408, writes the section
 *   headings and the actual headline text onto the canvas, and
 *   never draws the old grey "ruled, never lettered" rectangles;
 * - hall-scene hangs the plate on ALL FOUR faces and exposes
 *   setMonumentBoardData (source pins).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  MONUMENT_PLATE_H,
  MONUMENT_PLATE_W,
  drawMonumentBoardPlate,
  monumentBoardData,
  monumentBoardSignature,
  monumentPlateSections,
  monumentPlateEmissiveIntensity,
  type MonumentPlateCtx,
} from "./monument-board";
import type { Leaderboard } from "./treasury-quests";
import type { PalaceDirectoryEntry } from "./world-client";
import type { PalaceSlateEvent } from "./objective-strip";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const NOW = Date.parse("2026-10-22T19:00:00");
const iso = (h: number, m = 0) => new Date(2026, 9, 22, h, m).toISOString();

const DIRECTORY: PalaceDirectoryEntry[] = [
  { id: "world:kings-hall", name: "The King's Hall", count: 3, members: ["Ana", "Bo", "Cy", "Di"], live: false },
  { id: "world:courtyard", name: "The King's Plaza", count: 5, members: ["Ed", "Fi"], live: false },
  { id: "world:music-hall", name: "Music Hall", count: 0, members: [], live: false },
];

const EVENTS: PalaceSlateEvent[] = [
  { id: "e1", kind: "stage_show", title: "Open Stage Night", roomId: "world:kings-hall", hostName: "Ana", startsAt: iso(20), endsAt: iso(21), status: "scheduled" },
  { id: "e2", kind: "drop", title: "Golden Drop", roomId: "world:courtyard", hostName: "", startsAt: iso(18), endsAt: iso(19, 30), status: "live" },
  { id: "e3", kind: "stage_show", title: "Tomorrow's Show", roomId: "world:kings-hall", hostName: "", startsAt: new Date(2026, 9, 23, 20).toISOString(), endsAt: new Date(2026, 9, 23, 21).toISOString(), status: "scheduled" },
];

const LEADERBOARD: Leaderboard = {
  weekStart: "2026-10-19",
  rows: [
    { rank: 1, name: "Ana", creations: 9, exports: 4, score: 13, isYou: false },
    { rank: 2, name: "Bo", creations: 5, exports: 2, score: 7, isYou: false },
  ],
  viewerRank: null,
  viewerScore: 0,
};

describe("monument-board shaping", () => {
  it("letters who's here, today, and standings from the real reads", () => {
    const data = monumentBoardData({ directory: DIRECTORY, leaderboard: LEADERBOARD, events: EVENTS, nowMs: NOW });
    /* Busiest first; the empty room is not lettered. */
    expect(data.here.map((r) => r.room)).toEqual(["The King's Plaza", "The King's Hall"]);
    expect(data.here[0]).toMatchObject({ count: 5 });
    /* Live first; tomorrow's show is not today's headline. */
    expect(data.today.map((e) => e.title)).toEqual(["Golden Drop", "Open Stage Night"]);
    expect(data.today[0]!.meta).toContain("LIVE now");
    expect(data.standings).toEqual([
      { rank: 1, name: "Ana", score: 13 },
      { rank: 2, name: "Bo", score: 7 },
    ]);
    const sections = monumentPlateSections(data);
    expect(sections.map((s) => s.heading)).toEqual(["WHO'S HERE", "TODAY AT THE PALACE", "STANDINGS — THIS WEEK"]);
    expect(sections[0]!.lines[0]).toContain("The King's Plaza: 5 here");
    expect(sections[2]!.lines[0]).toBe("#1  Ana — 13");
  });

  it("is honest when the reads are empty or members-only", () => {
    const guest = monumentBoardData({ directory: [], leaderboard: null, events: [], nowMs: NOW });
    const sections = monumentPlateSections(guest);
    expect(sections[0]!.lines).toEqual(["The palace is quiet just now."]);
    expect(sections[1]!.lines).toEqual(["Nothing on today's slate at the palace."]);
    expect(sections[2]!.lines.join(" ")).toContain("members' business");
    const noRows = monumentBoardData({ directory: [], leaderboard: { ...LEADERBOARD, rows: [] }, events: [], nowMs: NOW });
    expect(monumentPlateSections(noRows)[2]!.lines.join(" ")).toContain("No creations on the board yet");
    /* The signature moves when the words do. */
    expect(monumentBoardSignature(guest)).not.toBe(monumentBoardSignature(
      monumentBoardData({ directory: DIRECTORY, leaderboard: LEADERBOARD, events: EVENTS, nowMs: NOW }),
    ));
  });
});

/* A recording 2D-context fake: measureText at ~0.5em per char. */
function fakeCtx() {
  const texts: string[] = [];
  const rects: Array<[number, number, number, number]> = [];
  const ctx = {
    canvas: { width: MONUMENT_PLATE_W, height: MONUMENT_PLATE_H },
    fillStyle: null as unknown,
    strokeStyle: null as unknown,
    lineWidth: 1,
    font: "10px Georgia",
    textAlign: "center",
    textBaseline: "middle",
    createLinearGradient: () => ({ addColorStop: () => undefined }),
    fillRect: (x: number, y: number, w: number, h: number) => { rects.push([x, y, w, h]); },
    strokeRect: () => undefined,
    beginPath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    closePath: () => undefined,
    fill: () => undefined,
    arc: () => undefined,
    fillText: (t: string) => { texts.push(t); },
    measureText: (t: string) => {
      const size = Number(/(\d+(?:\.\d+)?)px/.exec(ctx.font)?.[1] ?? 10);
      return { width: t.length * size * 0.52 };
    },
  } as unknown as MonumentPlateCtx & { texts: string[]; rects: Array<[number, number, number, number]> };
  (ctx as { texts: string[] }).texts = texts;
  (ctx as { rects: unknown }).rects = rects;
  return ctx as typeof ctx & { texts: string[]; rects: Array<[number, number, number, number]> };
}

describe("monument-board painter", () => {
  it("letters the real headlines at 1024×1408, in both themes", () => {
    expect(MONUMENT_PLATE_W).toBe(1024);
    expect(MONUMENT_PLATE_H).toBe(1408);
    const data = monumentBoardData({ directory: DIRECTORY, leaderboard: LEADERBOARD, events: EVENTS, nowMs: NOW });
    for (const theme of ["dark", "light"] as const) {
      const ctx = fakeCtx();
      drawMonumentBoardPlate(ctx, theme, data);
      const all = ctx.texts.join("\n");
      expect(all).toContain("THE KINGDOM BOARD");
      expect(all).toContain("WHO'S HERE");
      expect(all).toContain("TODAY AT THE PALACE");
      expect(all).toContain("STANDINGS — THIS WEEK");
      expect(all).toContain("#1  Ana — 13");
      expect(all).toContain("Golden Drop");
      /* Only the crown band + borders are rects — never the six
       * grey posting rectangles of the old plate. */
      expect(ctx.rects.length).toBeLessThanOrEqual(3);
    }
  });

  it("hall-scene hangs the plate on all four faces with a data seam (source pins)", () => {
    const src = read("./hall-scene.ts");
    expect(src).toContain("setMonumentBoardData");
    expect(src).toContain("drawMonumentBoardPlate");
    expect(src).toContain("MONUMENT_PLATE_W");
    for (const rot of ["Math.PI / 2", "-Math.PI / 2"]) expect(src).toContain(rot);
    /* The old unlettered plate is gone. */
    expect(src).not.toContain("ruled, never lettered");
    expect(src).not.toContain("lineWidths");
  });

  it("monument finish (Stack-100 #2): the plate is lit PBR with a night emissive, and repaints on data change", () => {
    const src = readFileSync(new URL("./hall-scene.ts", import.meta.url), "utf8");
    /* Facet B-G1 said the plate never re-renders: stale — the data
     * seam exists and re-maps BOTH the colour and emissive maps. */
    expect(src).toContain("setMonumentBoardData");
    expect(src).toContain("mat.emissiveMap = tex");
    expect(src).toContain("emissiveMap: plateTex");
    expect(src).toContain("monumentPlateEmissiveIntensity(look.theme)");
    expect(monumentPlateEmissiveIntensity("dark")).toBeGreaterThan(0.4);
    expect(monumentPlateEmissiveIntensity("light")).toBeLessThan(0.15);
    expect(monumentPlateEmissiveIntensity("dark")).toBeGreaterThan(monumentPlateEmissiveIntensity("light"));
    /* No hardcoded gold-plaque scalar survives (facet B-G2/G5 —
     * the 0.64 plaque scalar does not exist in the current tree). */
    expect(src).not.toContain("plaqueScalar");
  });

  it("monument finish: the relief wraps all four faces and the hero gold is per-metre", () => {
    const src = readFileSync(new URL("./hall-scene.ts", import.meta.url), "utf8");
    expect(src).toContain("ALL FOUR faces");
    expect(src).toContain("mats.goldFor(wAt + 0.1, 0.11)");
    expect(src).toContain("mats.goldFor(dAt + 0.1, 0.11)");
    expect(src).toContain("mats.goldDarkFor(faceW, 0.62)");
    expect(src).toContain("mats.goldFor(M.crown.capR * 2");
  });
});
