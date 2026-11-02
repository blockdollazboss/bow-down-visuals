/**
 * Stage shoutouts — client words (lib/world/stage-shoutout) + i18n
 * pins (Ring 3, item 3.3 remainder).
 *
 * The purchase is server truth; this module only carries the seat
 * control's pieces. Pinned:
 *  - the message bound mirrors the room's SAY_MAX_CHARS (300) —
 *    the composer refuses over-long messages itself, because a
 *    paid message is never silently truncated on either side;
 *  - the offer parser is tolerant but never inventive: unreadable
 *    payloads are null (the bar shows load-failed + retry), a
 *    not-offered answer never leaks a price;
 *  - every refusal reason maps to its catalog key, unknown
 *    reasons to the generic line — never a raw server token;
 *  - extraction + parity (the gift-desk discipline): every key in
 *    worldStageShoutout is referenced by the page or this module,
 *    and all 10 catalogs carry the full set;
 *  - the money lines (priceButton, freeButton, witnessed,
 *    witnessedFree, deniedInsufficient, deniedError) carry the
 *    English source in EVERY catalog — money copy is never
 *    agent-drafted. The other keys' non-English values are
 *    AGENT-DRAFTED and UNREVIEWED (standing practice).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  STAGE_SHOUTOUT_MESSAGE_MAX,
  parseShoutoutOffer,
  stageShoutoutDeniedKey,
  stageShoutoutMessageProblem,
} from "./stage-shoutout";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const readJson = (rel: string) => JSON.parse(read(rel)) as Record<string, any>;

const LOCALES = ["en", "ar", "de", "es", "fr", "hi", "it", "ja", "ko", "pt"];
const MONEY_KEYS = [
  "priceButton",
  "freeButton",
  "witnessed",
  "witnessedFree",
  "deniedInsufficient",
  "deniedError",
];

describe("the message bound", () => {
  it("mirrors the room's say bound (300)", () => {
    expect(STAGE_SHOUTOUT_MESSAGE_MAX).toBe(300);
  });

  it("blank is empty; 301 is too-long; 300 exactly is fine", () => {
    expect(stageShoutoutMessageProblem("")).toBe("empty");
    expect(stageShoutoutMessageProblem("   ")).toBe("empty");
    expect(stageShoutoutMessageProblem("x".repeat(301))).toBe("too-long");
    expect(stageShoutoutMessageProblem("x".repeat(300))).toBeNull();
    expect(stageShoutoutMessageProblem("Play the anthem!")).toBeNull();
  });
});

describe("the offer parser", () => {
  it("an offered answer carries the price at face value — 0 is a real (free) offer", () => {
    expect(parseShoutoutOffer({ offered: true, priceVb: 250 })).toEqual({
      state: "offered",
      priceVb: 250,
    });
    expect(parseShoutoutOffer({ offered: true, priceVb: 0 })).toEqual({
      state: "offered",
      priceVb: 0,
    });
  });

  it("a not-offered answer never leaks a price", () => {
    expect(parseShoutoutOffer({ offered: false, priceVb: 500 })).toEqual({ state: "not-offered" });
    expect(parseShoutoutOffer({ offered: false, priceVb: null })).toEqual({ state: "not-offered" });
  });

  it("unreadable payloads are null — never a guessed offer", () => {
    for (const junk of [
      null,
      undefined,
      "offered",
      {},
      { offered: true },
      { offered: true, priceVb: -5 },
      { offered: true, priceVb: "250" },
      { offered: "yes", priceVb: 250 },
    ]) {
      expect(parseShoutoutOffer(junk)).toBeNull();
    }
  });
});

describe("the refusal map", () => {
  it("every room/rail reason maps to its own key; unknown reasons get the generic line", () => {
    const expected: Record<string, string> = {
      guests: "worldStageShoutout.deniedGuests",
      "no-stage": "worldStageShoutout.deniedNoStage",
      self: "worldStageShoutout.deniedSelf",
      message: "worldStageShoutout.deniedMessage",
      "too-fast": "worldStageShoutout.deniedTooFast",
      "not-offered": "worldStageShoutout.deniedNotOffered",
      insufficient: "worldStageShoutout.deniedInsufficient",
      disabled: "worldStageShoutout.deniedDisabled",
      error: "worldStageShoutout.deniedError",
    };
    for (const [reason, key] of Object.entries(expected)) {
      expect(stageShoutoutDeniedKey(reason)).toBe(key);
    }
    expect(stageShoutoutDeniedKey("weird-token")).toBe("worldStageShoutout.deniedError");
  });
});

describe("worldStageShoutout catalog pins", () => {
  const en = readJson("../../locales/en.json");
  const enNs = (en.worldStageShoutout ?? {}) as Record<string, string>;
  const enKeys = Object.keys(enNs).sort();
  const page = read("../../pages/world.tsx");
  const moduleSrc = read("./stage-shoutout.ts");

  it("en carries the full key set", () => {
    expect(enKeys).toEqual(
      [
        "composerPlaceholder",
        "deniedDisabled",
        "deniedError",
        "deniedGuests",
        "deniedInsufficient",
        "deniedMessage",
        "deniedNoStage",
        "deniedNotOffered",
        "deniedSelf",
        "deniedTooFast",
        "freeButton",
        "offerLoadFailed",
        "priceButton",
        "send",
        "tryAgain",
        "witnessed",
        "witnessedFree",
      ].sort(),
    );
  });

  it("every key is referenced by the page or the module (no orphans, no remainder)", () => {
    const surface = page + moduleSrc;
    for (const key of enKeys) {
      expect(surface, `worldStageShoutout.${key}`).toContain(`worldStageShoutout.${key}`);
    }
  });

  it("all 10 catalogs carry the full key set", () => {
    for (const loc of LOCALES) {
      const cat = readJson(`../../locales/${loc}.json`);
      const ns = (cat.worldStageShoutout ?? {}) as Record<string, string>;
      expect(Object.keys(ns).sort(), loc).toEqual(enKeys);
    }
  });

  it("the money lines stay English in every catalog", () => {
    for (const loc of LOCALES) {
      const cat = readJson(`../../locales/${loc}.json`);
      const ns = cat.worldStageShoutout as Record<string, string>;
      for (const key of MONEY_KEYS) {
        expect(ns[key], `${loc}.${key}`).toBe(enNs[key]);
      }
    }
  });

  it("the insufficient line promises the truth the server keeps", () => {
    expect(enNs.deniedInsufficient).toContain("balance hasn't changed");
  });
});
