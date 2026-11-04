/**
 * World shared primitives + play surfaces i18n pins (Stack 100 locale
 * unit 51, manifest [D18]).
 *
 * Scope — the seven manifest files, verified in the tree at
 * components/world/native/: NativeCard, NativeShelf, NativeStates,
 * NativePlaceholder, GamesPanels, ShelfPlayer, TransferFooter. These
 * are SHARED primitives other families' desks render through; only the
 * files' OWN literals were extracted into the flat worldPrimitives
 * namespace (126 keys). Copy extraction only — zero behavior changes.
 * No overlap with units 36–50 (Admin, Create, Audio, Coach/Money,
 * Commerce, Catalog/Library, Social, Live/Promo, Schedule/Release,
 * Team/Legal, Sponsor/Press, Creator Rooms, Identity/Misc, Boards).
 *
 * Extraction facts pinned here:
 *  - NativeCard and NativeShelf own NO literals (all copy arrives via
 *    props) — they reference no keys and were not modified.
 *  - TransferFooter's only label is the shared TRANSFER_BUTTON_LABEL
 *    constant, defined in lib/world/station-panel.ts and also used by
 *    BusinessDesks + pinned by lib tests — NOT owned by the primitive,
 *    deliberately left as the shared seam (follow-on if ever moved).
 *  - Shared lib seams that render INSIDE these surfaces were left in
 *    place (lib-owned, other units' scope): shelfThreadWindowNote,
 *    formatShelfClock, contestStatusLine, partySummonsHeadline,
 *    partyTableHomeLine, PARTY_GAME_META and ARCADE_CABINETS titles.
 *  - The join-code placeholder "ABC234" is a sample room-code format
 *    (data shape), not prose — never catalogued. Scores, counts,
 *    names, titles and codes are data — never catalogued.
 *
 * MONEY KEYS (6) — byte-identical English in ALL 10 catalogs by the
 * standing money-copy law (lines stating a charge/amount are never
 * agent-drafted; figures move by interpolation):
 *   gmDropOffer, gmDropClaim, gmDropClaimed,
 *   gmPlayingForAmount, gmPrizeTakes, gmPrizeMeta.
 *
 * TRANSLATION STATUS: en is final (the files' original wording,
 * verbatim). The other nine catalogs' values are AGENT-DRAFTED and
 * UNREVIEWED.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) =>
  readFileSync(new URL(rel, import.meta.url), "utf8");
const readJson = (rel: string) => JSON.parse(read(rel)) as Record<string, any>;

const LOCALES = ["en", "ar", "de", "es", "fr", "hi", "it", "ja", "ko", "pt"];
const NATIVE = "../../components/world/native";
const FILES = [
  "NativeCard",
  "NativeShelf",
  "NativeStates",
  "NativePlaceholder",
  "GamesPanels",
  "ShelfPlayer",
  "TransferFooter",
] as const;
const sources: Record<string, string> = {};
for (const f of FILES) sources[f] = read(`${NATIVE}/${f}.tsx`);
const allSource = FILES.map((f) => sources[f]).join("\n");

const en = readJson("../../locales/en.json");
const enNs = (en.worldPrimitives ?? {}) as Record<string, string>;
const enKeys = Object.keys(enNs).sort();

const MONEY_KEYS = [
  "gmDropOffer",
  "gmDropClaim",
  "gmDropClaimed",
  "gmPlayingForAmount",
  "gmPrizeTakes",
  "gmPrizeMeta",
];

const tokens = (v: string) => (v.match(/\{\{[^}]+\}\}/g) ?? []).sort();

describe("unit 51 extraction (worldPrimitives)", () => {
  it("the four literal-owning components render through useTranslation", () => {
    for (const f of ["NativeStates", "NativePlaceholder", "GamesPanels", "ShelfPlayer"]) {
      expect(sources[f], f).toContain('import { useTranslation } from "react-i18next"');
      expect(sources[f], f).toContain("useTranslation()");
    }
  });

  it("NativeCard/NativeShelf own no literals and reference no keys", () => {
    for (const f of ["NativeCard", "NativeShelf"]) {
      expect(sources[f], f).not.toContain("worldPrimitives");
      expect(sources[f], f).not.toContain("useTranslation");
    }
  });

  it("TransferFooter still rides the shared TRANSFER_BUTTON_LABEL seam (not extracted)", () => {
    expect(sources.TransferFooter).toContain("TRANSFER_BUTTON_LABEL");
    expect(sources.TransferFooter).not.toContain("worldPrimitives");
  });

  it("en namespace holds exactly 126 keys; referenced keys == catalog keys (zero orphans, zero missing)", () => {
    expect(enKeys.length).toBe(126);
    const referenced = new Set<string>();
    for (const m of allSource.matchAll(/worldPrimitives\.([A-Za-z0-9_]+)/g)) {
      referenced.add(m[1]);
    }
    expect([...referenced].sort()).toEqual(enKeys);
  });

  it("no bare locale formatting remains in the seven files (i18n.language everywhere the files format)", () => {
    expect(allSource).not.toMatch(/\.toLocaleString\(\)/);
    expect(allSource).not.toMatch(/\.toLocaleDateString\(\)/);
    expect(allSource).not.toContain('"en-US"');
  });

  it("spot raw literals are gone from source (they live in the catalog now)", () => {
    expect(sources.GamesPanels).not.toContain('title="The cabinets"');
    expect(sources.GamesPanels).not.toContain("Room codes are 6 letters and numbers");
    expect(sources.GamesPanels).not.toContain('aria-label="Dismiss the summons"');
    expect(sources.ShelfPlayer).not.toContain('aria-label="Seek"');
    expect(sources.NativePlaceholder).not.toContain("This desk is being built");
  });

  it("en copy is the files' original wording, verbatim", () => {
    expect(enNs.stLoadingDefault).toBe("Loading…");
    expect(enNs.stErrorTitleDefault).toBe("This panel hit a snag");
    expect(enNs.stTryAgain).toBe("Try again");
    expect(enNs.phTitle).toBe("This desk is being built");
    expect(enNs.phBody).toBe(
      "{{name}} is being finished for the World — the full desk lands here soon, in the palace, without leaving for the website.",
    );
    expect(enNs.spNowPlaying).toBe("Now playing");
    expect(enNs.spCommentsSignIn).toBe(
      "Sign in to join the conversation — reading is open to everyone here.",
    );
    expect(enNs.gmContestTitle).toBe("This week's contest");
    expect(enNs.gmDropOffer).toBe(
      "The King dropped you {{amount}} Visual Bucs for that run.",
    );
    expect(enNs.gmSummonsSeatWaiting).toBe(". Your seat is waiting.");
    expect(enNs.gmRecordLabel).toBe("Your record:");
    expect(enNs.gmOpenTableCta).toBe("Open a table & take the host seat");
    expect(enNs.gmWinnersCircleTitle).toBe("The Winners' Circle");
  });
});

describe("unit 51 catalog parity (worldPrimitives)", () => {
  it("all 10 locales carry exactly the extracted key set, no empty values", () => {
    for (const loc of LOCALES) {
      const cat = readJson(`../../locales/${loc}.json`);
      expect(Object.keys(cat.worldPrimitives ?? {}).sort(), loc).toEqual(enKeys);
      for (const key of enKeys) {
        const value = cat.worldPrimitives[key];
        expect(typeof value, `${loc}.${key}`).toBe("string");
        expect(value.trim().length, `${loc}.${key}`).toBeGreaterThan(0);
        expect(value, `${loc}.${key}`).not.toBe(key);
      }
    }
  });

  it("the 6 money keys are byte-identical English in every catalog", () => {
    for (const loc of LOCALES) {
      const cat = readJson(`../../locales/${loc}.json`);
      for (const key of MONEY_KEYS) {
        expect(cat.worldPrimitives[key], `${loc}.${key}`).toBe(enNs[key]);
      }
    }
  });

  it("interpolation tokens survive in every locale for every key", () => {
    for (const loc of LOCALES) {
      const cat = readJson(`../../locales/${loc}.json`);
      for (const key of enKeys) {
        expect(tokens(cat.worldPrimitives[key]), `${loc}.${key}`).toEqual(
          tokens(enNs[key]),
        );
      }
    }
  });
});
