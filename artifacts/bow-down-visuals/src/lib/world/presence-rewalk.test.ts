/**
 * PRESENCE lane re-walk (Stack-100 #2 items 63–64) — the facet-C
 * presence claims verified against the CURRENT tree, pinned either
 * as fixed behaviour (63) or as already-true behaviour (64).
 *
 * Item 63 (FIXED): the voice footer's honest state had a silent
 * gap — in voice with nobody else in voice, the summary is "empty"
 * and the headline was "", so NO chip rendered: in a mixed room
 * (2+ people present, everyone else text-only) a member in voice
 * got no signal the room was voice-quiet. The headline now takes
 * the room's occupant count and the empty state reads the quiet
 * caption BY ROOM STATE at any count; the page passes its live
 * peopleCount. The context-free call keeps its old "" (the
 * voice.test.ts pin stands untouched).
 *
 * Item 64 (PINNED — facet stale): "jewellery cases partially
 * blocked: blockers at 5/8 positions; 3 unblocked." The world's
 * only display cases are the Ateliers vitrines ("glass display
 * cases… the case is solid", ateliers.ts). No set of 8 exists in
 * the tree (at the audit commit or now): there are 6 vitrines and
 * every one already carries its rect in ATELIERS_BLOCKED. These
 * pins lock exactly that: blocked-rect membership per vitrine at
 * VITRINE.blockHalf, count parity, unwalkable centres AND faces,
 * and the scene building its cases from the same list.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  summarizeVoiceConnections,
  voiceConnectionHeadline,
  type VoicePeerConnectionState,
} from "./voice";
import { ATELIER_VITRINES, ATELIERS_BLOCKED, VITRINE } from "./ateliers";
import { isWalkable } from "./palace-layout";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("item 63 — the quiet caption renders by room state", () => {
  const S = (entries: Array<[string, VoicePeerConnectionState]>) => new Map(entries);
  const empty = summarizeVoiceConnections(S([]));

  it("the summary of an empty voice mesh is the empty state", () => {
    expect(empty.state).toBe("empty");
    expect(empty.total).toBe(0);
  });

  it("with room context, the quiet caption renders at ANY occupant count — solo and mixed alike", () => {
    for (const occupants of [1, 2, 3, 12, 30]) {
      expect(voiceConnectionHeadline(empty, occupants)).toBe(
        "Quiet in here — you're the only one in voice right now",
      );
    }
  });

  it("without room context the headline stays empty (the pre-existing pin's shape)", () => {
    expect(voiceConnectionHeadline(empty)).toBe("");
  });

  it("room context never rewrites a non-empty state", () => {
    const connected = summarizeVoiceConnections(S([["a", "connected"]]));
    expect(voiceConnectionHeadline(connected, 5)).toBe("Voice connected");
    const failed = summarizeVoiceConnections(S([["a", "failed"]]));
    expect(voiceConnectionHeadline(failed, 5)).toContain("Voice couldn't connect");
  });

  it("the world page passes its live people count into the headline", () => {
    const page = read("../../pages/world.tsx");
    expect(page).toContain("voiceConnectionHeadline(voiceConnSummary, peopleCount)");
    /* …and the chip that renders it keys on the headline, so the
     * quiet caption reaches the footer whenever it is non-empty. */
    expect(page).toContain("voiceSwitch.inVoice && voiceConnHeadline");
    expect(page).toContain('data-testid="world-voice-conn-state"');
  });
});

describe("item 64 — every display case (Ateliers vitrine) is in the blocked spec", () => {
  it("the case set is the authored six — the facet's '8 cases' matches nothing in the tree", () => {
    expect(ATELIER_VITRINES).toHaveLength(6);
  });

  it("every vitrine carries its exact blocked rect at VITRINE.blockHalf", () => {
    for (const v of ATELIER_VITRINES) {
      expect(ATELIERS_BLOCKED).toContainEqual({
        minX: v.x - VITRINE.blockHalf,
        maxX: v.x + VITRINE.blockHalf,
        minZ: v.z - VITRINE.blockHalf,
        maxZ: v.z + VITRINE.blockHalf,
      });
    }
  });

  it("no vitrine centre or face is walkable — zero unblocked cases", () => {
    for (const v of ATELIER_VITRINES) {
      expect(isWalkable(v.x, v.z), `centre ${v.x},${v.z}`).toBe(false);
      /* Points just inside each face of the case's footprint. */
      const inset = VITRINE.blockHalf - 0.05;
      expect(isWalkable(v.x + inset, v.z), `east face ${v.x},${v.z}`).toBe(false);
      expect(isWalkable(v.x - inset, v.z), `west face ${v.x},${v.z}`).toBe(false);
      expect(isWalkable(v.x, v.z + inset), `south face ${v.x},${v.z}`).toBe(false);
      expect(isWalkable(v.x, v.z - inset), `north face ${v.x},${v.z}`).toBe(false);
    }
  });

  it("the scene builds its display cases from the same ATELIER_VITRINES list the blocked spec derives from", () => {
    const scene = read("./hall-scene.ts");
    expect(scene).toContain("ATELIER_VITRINES");
    expect(scene).toContain("The display vitrines");
    const ateliers = read("./ateliers.ts");
    expect(ateliers).toContain(
      "...ATELIER_VITRINES.map((p) => rectAround(p.x, p.z, VITRINE.blockHalf, VITRINE.blockHalf))",
    );
  });
});
