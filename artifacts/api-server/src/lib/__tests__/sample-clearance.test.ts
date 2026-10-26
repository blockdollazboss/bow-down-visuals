/**
 * sample-clearance.test.ts — Stack-200 N2, the Sample Clearance Lane
 * against an in-memory store.
 *
 * Pins:
 * - FLAG RULES in plain words: licensed / public-domain = no flag but
 *   the claim is labelled creator-stated, never verified; unsure =
 *   caution; not-cleared + recognizable = high; not-cleared +
 *   unrecognizable = caution.
 * - OWNERSHIP: declarations only on the caller's own tracks; edits,
 *   deletes and acknowledgements are owner-only too.
 * - ACK GATE: a flagged, unacknowledged declaration blocks the
 *   pre-ship check; acknowledging unblocks it; EDITING a declaration
 *   clears its acknowledgement (flags must be re-seen).
 * - ALTERNATIVES: ranked from the beats catalog on the track's real
 *   genre only; offers link to the marketplace, carry a clearance
 *   note, and never claim a field the data doesn't have (no BPM/key
 *   matching — songs carry neither).
 * - CREDITS SUMMARY (N1 join surface): honest absence when nothing is
 *   declared; lines labelled creator-declared; worst flag computed.
 * - NO MONEY: no wire shape carries a price/credit/charge field.
 */
import { describe, expect, it } from "vitest";
import {
  SampleClearanceError,
  acknowledgeDeclaration,
  computeRiskFlag,
  declareSample,
  getAlternatives,
  listMyDeclarations,
  needsAcknowledgement,
  preShipCheck,
  rankAlternatives,
  removeDeclaration,
  summarizeForCredits,
  updateDeclaration,
  type BeatCandidate,
  type DeclarationRow,
  type SampleClearanceStore,
} from "../sample-clearance";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const SONG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SONG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function memoryStore(): SampleClearanceStore & { beats: BeatCandidate[] } {
  const rows = new Map<string, DeclarationRow>();
  let seq = 0;
  const songs: Record<string, { userId: string; title: string; genre: string | null }> = {
    [SONG_A]: { userId: USER_A, title: "My Track", genre: "hip-hop" },
    [SONG_B]: { userId: USER_B, title: "Their Track", genre: "soul" },
  };
  const beats: BeatCandidate[] = [
    { id: "beat-1", title: "Boom Bap Loop", genre: "hip-hop", bpm: 92, musicalKey: "C min", moodTags: ["dark"], previewUrl: null, audioUrl: "https://x/1.mp3" },
    { id: "beat-2", title: "Soul Flip", genre: "soul", bpm: 84, musicalKey: null, moodTags: [], previewUrl: null, audioUrl: "https://x/2.mp3" },
    { id: "beat-3", title: "Trap Kit", genre: "trap", bpm: 140, musicalKey: null, moodTags: [], previewUrl: null, audioUrl: "https://x/3.mp3" },
  ];
  return {
    beats,
    async getSongOwner(songId) {
      return songs[songId] ?? null;
    },
    async insertDeclaration(row) {
      const full: DeclarationRow = {
        ...row,
        id: `decl-${++seq}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      rows.set(full.id, full);
      return full;
    },
    async listDeclarationsForSong(songId) {
      return [...rows.values()].filter((r) => r.songId === songId);
    },
    async getDeclaration(id) {
      return rows.get(id) ?? null;
    },
    async updateDeclaration(id, patch) {
      const cur = rows.get(id);
      if (!cur) return null;
      const next = { ...cur, ...patch, updatedAt: new Date().toISOString() };
      rows.set(id, next);
      return next;
    },
    async deleteDeclaration(id) {
      return rows.delete(id);
    },
    async listBeats() {
      return beats;
    },
    async getReleaseSongIds() {
      return null;
    },
  };
}

const NOT_CLEARED_RECOGNIZABLE = {
  sourceDescription: "The hook from a 1972 soul record",
  useKind: "loop" as const,
  clearanceStatus: "not_cleared" as const,
  recognizable: true,
};

describe("flag rules", () => {
  it("licensed = no flag, labelled creator-stated, never verified", () => {
    const flag = computeRiskFlag({ clearanceStatus: "licensed", recognizable: true, useKind: "loop" });
    expect(flag.level).toBe("none");
    expect(flag.creatorStated).toBe(true);
    expect(flag.reason).toMatch(/your statement/i);
    expect(flag.reason).toMatch(/not verified/i);
    expect(JSON.stringify(flag)).not.toMatch(/verified clearance|platform-verified/i);
  });

  it("public domain / original = no flag, creator-stated", () => {
    const flag = computeRiskFlag({ clearanceStatus: "public_domain_or_original", recognizable: false, useKind: "one_shot" });
    expect(flag.level).toBe("none");
    expect(flag.reason).toMatch(/your statement/i);
  });

  it("unsure = caution with the reason in plain words", () => {
    const flag = computeRiskFlag({ clearanceStatus: "unsure", recognizable: true, useKind: "loop" });
    expect(flag.level).toBe("caution");
    expect(flag.headline).toMatch(/not sure/i);
    expect(flag.reason).toMatch(/taken down/i);
  });

  it("not cleared + recognizable = high", () => {
    const flag = computeRiskFlag({ clearanceStatus: "not_cleared", recognizable: true, useKind: "loop" });
    expect(flag.level).toBe("high");
    expect(flag.headline).toMatch(/high risk/i);
    expect(flag.reason).toMatch(/takedown/i);
  });

  it("not cleared + unrecognizable = caution, and says it is still not cleared", () => {
    const flag = computeRiskFlag({ clearanceStatus: "not_cleared", recognizable: false, useKind: "one_shot" });
    expect(flag.level).toBe("caution");
    expect(flag.reason).toMatch(/does not make the sample cleared/i);
  });

  it("needsAcknowledgement only for flagged + unacknowledged", () => {
    const high = computeRiskFlag({ clearanceStatus: "not_cleared", recognizable: true, useKind: "loop" });
    const none = computeRiskFlag({ clearanceStatus: "licensed", recognizable: true, useKind: "loop" });
    expect(needsAcknowledgement(high, false)).toBe(true);
    expect(needsAcknowledgement(high, true)).toBe(false);
    expect(needsAcknowledgement(none, false)).toBe(false);
  });
});

describe("declarations", () => {
  it("declares on own track and returns the flag + creator-stated label", async () => {
    const store = memoryStore();
    const d = await declareSample(store, USER_A, SONG_A, NOT_CLEARED_RECOGNIZABLE);
    expect(d.flag.level).toBe("high");
    expect(d.needsAcknowledgement).toBe(true);
    expect(d.clearanceLabel).toMatch(/not verified/i);
  });

  it("refuses another creator's track and a missing track", async () => {
    const store = memoryStore();
    await expect(declareSample(store, USER_A, SONG_B, NOT_CLEARED_RECOGNIZABLE)).rejects.toMatchObject({ code: "not_owner" });
    await expect(declareSample(store, USER_A, "cccccccc-cccc-4ccc-8ccc-cccccccccccc", NOT_CLEARED_RECOGNIZABLE)).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("refuses an empty description", async () => {
    const store = memoryStore();
    await expect(declareSample(store, USER_A, SONG_A, { ...NOT_CLEARED_RECOGNIZABLE, sourceDescription: " x " })).rejects.toBeInstanceOf(
      SampleClearanceError,
    );
  });

  it("lists only for the owner", async () => {
    const store = memoryStore();
    await declareSample(store, USER_A, SONG_A, NOT_CLEARED_RECOGNIZABLE);
    expect(await listMyDeclarations(store, USER_A, SONG_A)).toHaveLength(1);
    await expect(listMyDeclarations(store, USER_B, SONG_A)).rejects.toMatchObject({ code: "not_owner" });
  });

  it("edit + delete are owner-only; editing clears the acknowledgement", async () => {
    const store = memoryStore();
    const d = await declareSample(store, USER_A, SONG_A, NOT_CLEARED_RECOGNIZABLE);
    const acked = await acknowledgeDeclaration(store, USER_A, d.id, new Date("2026-10-26T00:00:00Z"));
    expect(acked.riskAcknowledged).toBe(true);
    expect(acked.needsAcknowledgement).toBe(false);
    await expect(updateDeclaration(store, USER_B, d.id, { recognizable: false })).rejects.toMatchObject({ code: "not_owner" });
    const edited = await updateDeclaration(store, USER_A, d.id, { clearanceStatus: "unsure" });
    expect(edited.riskAcknowledged).toBe(false);
    expect(edited.needsAcknowledgement).toBe(true);
    await expect(removeDeclaration(store, USER_B, d.id)).rejects.toMatchObject({ code: "not_owner" });
    await removeDeclaration(store, USER_A, d.id);
    expect(await listMyDeclarations(store, USER_A, SONG_A)).toHaveLength(0);
  });
});

describe("pre-ship check", () => {
  it("blocks on a flagged unacknowledged declaration; acknowledgement unblocks", async () => {
    const store = memoryStore();
    const d = await declareSample(store, USER_A, SONG_A, NOT_CLEARED_RECOGNIZABLE);
    const before = await preShipCheck(store, [SONG_A]);
    expect(before.ok).toBe(false);
    expect(before.blocking.map((b) => b.id)).toEqual([d.id]);
    await acknowledgeDeclaration(store, USER_A, d.id);
    const after = await preShipCheck(store, [SONG_A]);
    expect(after.ok).toBe(true);
    expect(after.warnings.map((w) => w.id)).toEqual([d.id]);
  });

  it("a licensed declaration never blocks and never warns", async () => {
    const store = memoryStore();
    await declareSample(store, USER_A, SONG_A, { ...NOT_CLEARED_RECOGNIZABLE, clearanceStatus: "licensed" });
    const result = await preShipCheck(store, [SONG_A]);
    expect(result).toEqual({ ok: true, blocking: [], warnings: [] });
  });

  it("no declarations = clean ship", async () => {
    const store = memoryStore();
    expect((await preShipCheck(store, [SONG_A])).ok).toBe(true);
  });
});

describe("alternatives", () => {
  it("ranks the same-genre beat first and states the real basis", () => {
    const store = memoryStore();
    const offers = rankAlternatives("hip-hop", store.beats);
    expect(offers[0]!.beatId).toBe("beat-1");
    expect(offers[0]!.matchBasis.join(" ")).toMatch(/same genre/i);
    expect(offers[0]!.href).toBe("/beats");
    expect(offers[0]!.clearanceNote).toMatch(/offer, not a swap/i);
    /* Non-matching beats are labelled catalog picks, never fits. */
    const trap = offers.find((o) => o.beatId === "beat-3")!;
    expect(trap.matchBasis.join(" ")).toMatch(/catalog/i);
    expect(trap.matchBasis.join(" ")).not.toMatch(/same genre/i);
  });

  it("no genre on the track = honest catalog basis, no invented match", async () => {
    const store = memoryStore();
    const offers = rankAlternatives(null, store.beats);
    expect(offers.every((o) => o.matchBasis.join(" ").match(/catalog/i))).toBe(true);
    const viaService = await getAlternatives(store, USER_B, SONG_B);
    expect(viaService.basedOn).toMatch(/genre \(soul\)/i);
    expect(viaService.offers[0]!.beatId).toBe("beat-2");
  });

  it("empty catalog = empty offers, said plainly by shape", () => {
    expect(rankAlternatives("hip-hop", [])).toEqual([]);
  });
});

describe("credits summary (N1 join surface)", () => {
  it("honest absence when nothing is declared", () => {
    const s = summarizeForCredits(SONG_A, []);
    expect(s.samplesDeclared).toBe(false);
    expect(s.lines).toEqual([]);
    expect(s.worstFlagLevel).toBe("none");
  });

  it("lines are creator-declared and the worst flag wins", async () => {
    const store = memoryStore();
    await declareSample(store, USER_A, SONG_A, { ...NOT_CLEARED_RECOGNIZABLE, clearanceStatus: "licensed" });
    await declareSample(store, USER_A, SONG_A, NOT_CLEARED_RECOGNIZABLE);
    const wires = await listMyDeclarations(store, USER_A, SONG_A);
    const s = summarizeForCredits(SONG_A, wires);
    expect(s.samplesDeclared).toBe(true);
    expect(s.worstFlagLevel).toBe("high");
    expect(s.lines).toHaveLength(2);
    expect(s.lines.every((l) => l.clearanceLabel.match(/not verified/i))).toBe(true);
    expect(s.lines[1]!.text).toMatch(/Sample:/);
  });
});

describe("no money", () => {
  it("no wire shape carries a price, credit or charge field", async () => {
    const store = memoryStore();
    const d = await declareSample(store, USER_A, SONG_A, NOT_CLEARED_RECOGNIZABLE);
    const offers = rankAlternatives("hip-hop", store.beats);
    const blob = JSON.stringify({ d, offers, summary: summarizeForCredits(SONG_A, [d]) }).toLowerCase();
    expect(blob).not.toMatch(/price|creditscost|charge|amount_cents|fee/);
  });
});
