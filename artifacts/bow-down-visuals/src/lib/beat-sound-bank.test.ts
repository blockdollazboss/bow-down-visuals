/* Sound bank registration pin — the rendered bank (316 original
 * synthesized sounds, Nov 5 2026) is registered into the beat-sound
 * registry with its shape intact: total count, per-category counts
 * against the bank ledger (drums 72 · 808 24 · bass 48 · melodic 144 ·
 * fx 28), kit grouping (6 kits × 12), tuned notes, and a real file on
 * disk behind every registered URL. If the bank is re-rendered with
 * different counts, this pin fails until the ledger + manifest are
 * regenerated together — that is the point of the pin. */
import { describe, it, expect, beforeEach } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import {
  clearRegisteredBeatSounds,
  getBeatSound,
  hasBankSounds,
  listBeatSounds,
  listBeatSoundsBySource,
} from "@/lib/beat-sounds";
import {
  BANK_CATEGORY_COUNTS,
  BANK_SOUND_COUNT,
  BANK_SOUND_MANIFEST,
  registerBankSounds,
} from "@/lib/beat-sound-bank";

const PUBLIC_DIR = resolve(import.meta.dirname, "../../public");

function countWavs(dir: string): number {
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) n += countWavs(join(dir, e.name));
    else if (e.name.endsWith(".wav")) n += 1;
  }
  return n;
}

beforeEach(() => {
  clearRegisteredBeatSounds();
});

describe("sound bank manifest (generated from the bank)", () => {
  it("carries exactly 316 sounds, ids and names unique", () => {
    expect(BANK_SOUND_COUNT).toBe(316);
    expect(BANK_SOUND_MANIFEST).toHaveLength(316);
    expect(new Set(BANK_SOUND_MANIFEST.map((e) => e.id)).size).toBe(316);
    expect(new Set(BANK_SOUND_MANIFEST.map((e) => e.name)).size).toBe(316);
    for (const e of BANK_SOUND_MANIFEST) {
      expect(e.source).toBe("bank");
      expect(e.id.startsWith("bank:")).toBe(true);
      expect(e.url.startsWith("/sound-bank/")).toBe(true);
      expect(e.url.endsWith(".wav")).toBe(true);
    }
  });

  it("category counts match the bank ledger exactly", () => {
    expect(BANK_CATEGORY_COUNTS).toEqual({
      drums: 72,
      "808": 24,
      bass: 48,
      melodic: 144,
      fx: 28,
    });
  });

  it("kit grouping is preserved: six drum kits × 12 sounds", () => {
    const drums = BANK_SOUND_MANIFEST.filter((e) => e.bankCategory === "drums");
    expect(drums).toHaveLength(72);
    const kits = new Map<string, number>();
    for (const d of drums) kits.set(d.kit ?? "", (kits.get(d.kit ?? "") ?? 0) + 1);
    expect([...kits.keys()].sort()).toEqual(
      ["afrobeats", "boombap", "core", "drill", "house", "trap"],
    );
    for (const n of kits.values()) expect(n).toBe(12);
  });

  it("tuned sets carry named notes + midi (808 / bass / melodic)", () => {
    const tuned = BANK_SOUND_MANIFEST.filter((e) => e.note != null);
    expect(tuned).toHaveLength(24 + 48 + 144); // 808 + bass + melodic
    for (const e of tuned) {
      expect(typeof e.midi).toBe("number");
      expect(e.name.endsWith(e.note!)).toBe(true);
    }
    expect(BANK_SOUND_MANIFEST.find((e) => e.id === "bank:808-C1")).toMatchObject({
      kind: "b808", note: "C1", midi: 24, bankCategory: "808",
    });
    expect(BANK_SOUND_MANIFEST.find((e) => e.id === "bank:bass-sub-C1")).toMatchObject({
      kind: "bass", note: "C1", midi: 24, instrument: "sub",
    });
    expect(BANK_SOUND_MANIFEST.find((e) => e.id === "bank:keys-C4")).toMatchObject({
      kind: "melodic", note: "C4", midi: 60, instrument: "keys",
    });
  });

  it("drums map to their true track kinds, kit attached", () => {
    expect(BANK_SOUND_MANIFEST.find((e) => e.id === "bank:drums-trap-snare")).toMatchObject({
      kind: "snare", kit: "trap", bankCategory: "drums",
    });
    expect(BANK_SOUND_MANIFEST.find((e) => e.id === "bank:drums-house-closed-hat")).toMatchObject({
      kind: "chat", kit: "house",
    });
    expect(BANK_SOUND_MANIFEST.find((e) => e.id === "bank:fx-riser-01")).toMatchObject({
      kind: "fx", bankCategory: "fx", instrument: "riser",
    });
  });
});

describe("sound bank registration (the picker data source)", () => {
  it("registers all 316 — the bank section is the real bank, not a placeholder", () => {
    expect(hasBankSounds()).toBe(false); // before the registration call
    expect(registerBankSounds()).toBe(316);
    expect(hasBankSounds()).toBe(true);
    expect(listBeatSoundsBySource("bank")).toHaveLength(316);
    expect(listBeatSounds()).toHaveLength(316 + 9); // bank + built-in voices
    const registered = new Map(listBeatSoundsBySource("bank").map((e) => [e.id, e]));
    for (const e of BANK_SOUND_MANIFEST) {
      expect(registered.get(e.id)).toMatchObject({
        name: e.name, kind: e.kind, url: e.url,
        bankCategory: e.bankCategory, defaultVolume: 1,
      });
    }
  });

  it("is idempotent — a second registration changes nothing", () => {
    registerBankSounds();
    expect(registerBankSounds()).toBe(316);
    expect(listBeatSoundsBySource("bank")).toHaveLength(316);
    expect(getBeatSound("bank:drums-core-kick")?.name).toBe("Core kick");
  });

  it("category counts survive registration (grouped by bankCategory)", () => {
    registerBankSounds();
    const counts: Record<string, number> = {};
    for (const e of listBeatSoundsBySource("bank")) {
      counts[e.bankCategory ?? "unknown"] = (counts[e.bankCategory ?? "unknown"] ?? 0) + 1;
    }
    expect(counts).toEqual(BANK_CATEGORY_COUNTS);
  });
});

describe("bank files on disk (what the URLs resolve to)", () => {
  it("every registered URL is a real WAV in public/sound-bank — all 316", () => {
    for (const e of BANK_SOUND_MANIFEST) {
      const p = join(PUBLIC_DIR, e.url);
      expect(existsSync(p), `${e.id} -> ${e.url}`).toBe(true);
    }
    expect(countWavs(join(PUBLIC_DIR, "sound-bank"))).toBe(316);
  });
});
