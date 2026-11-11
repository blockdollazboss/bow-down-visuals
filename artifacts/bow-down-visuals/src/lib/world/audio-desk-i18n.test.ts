/**
 * AudioDesk family i18n pins (stack100 locale unit 39).
 *
 * The World's Audio desk family — AudioDesk, AudioDeskTabs,
 * SongDeskTabs, BeatsDesk, DjDesk, ListeningBooth, JukeboxPanel —
 * rendered hard-coded English inside a 10-locale product (zero
 * useTranslation at base 23a636903). Its own copy now lives in the
 * locale catalogs under worldAudioDesk.* (620 keys — 573 at the
 * Stack-100 unit-39 extraction, +44 for Stack-400's B-07 voice
 * clone bench and B-21 media-utility benches, +1 banked by a later
 * desk fix without its count pin being bumped, +2 for the deep-pins
 * tranche-3 SongMashupBench failed-load state), plus a set of
 * beats.* keys the 2D beats page already carried whose en values
 * are byte-identical to the desk's (the commission line, the
 * payment note, tier names/blurbs, license-row template). These
 * pins hold both halves:
 *
 *  - extraction: every family file renders through useTranslation,
 *    and every catalog key in the namespace is actually referenced
 *    by the family (components + the seams they feed string
 *    bundles to) — no orphan keys, no unextracted remainder;
 *  - parity: all 10 locales carry the full key set with the same
 *    interpolation tokens per key, so no locale can silently fall
 *    back to English or break a composed sentence;
 *  - en fidelity: the en catalog values equal the seams' English
 *    default bundles field for field (en rendering identical, key
 *    for key — a strings move, not a redesign);
 *  - money law: the two lines that state a charge outcome
 *    (aiTagsUnreadable — the refund line — and aiTagsCreditsNote)
 *    ride ENGLISH VERBATIM in every catalog; figures arrive by
 *    interpolation, never by agent-drafted copy.
 *
 * Deliberately NOT extracted (documented per component):
 * registry-verbatim option vocabularies whose label IS the posted
 * value (genre / intensity / loudness / emotion lists, license
 * formats), spend-confirm feature names, payload defaults
 * ("Audio Studio bench", "My podcast", projectType), and the
 * shared lib/beat-license-terms describeTermsInline line (shared
 * with the 2D beats page — another family's surface).
 *
 * TRANSLATION STATUS: en is final. The other nine catalogs' values
 * are AGENT-DRAFTED and UNREVIEWED (standing stack600 practice).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AUDIO_BENCH_RESULT_STRINGS_EN, audioBenchResultStrings } from "./audio-benches";
import {
  BEAT_AI_TAGS_OUTCOME_STRINGS_EN,
  BEAT_LISTING_PROBLEM_STRINGS_EN,
  BEAT_TEMPLATE_PROBLEM_STRINGS_EN,
} from "./money-desks-2";
import { DJ_ANALYSIS_LINE_STRINGS_EN } from "./dj-desk";
import { JUKEBOX_DENIED_STRINGS_EN } from "./jukebox-sync";
import { LISTENING_PARTY_STRINGS_EN } from "./listening-party";
import { DOWNLOAD_MINT_COPY_STRINGS_EN } from "./shelf";

const read = (rel: string) =>
  readFileSync(new URL(rel, import.meta.url), "utf8");
const readJson = (rel: string) => JSON.parse(read(rel)) as Record<string, any>;

const LOCALES = ["en", "ar", "de", "es", "fr", "hi", "it", "ja", "ko", "pt"];
const COMPONENTS = [
  "AudioDesk.tsx",
  "AudioDeskTabs.tsx",
  "SongDeskTabs.tsx",
  "BeatsDesk.tsx",
  "DjDesk.tsx",
  "ListeningBooth.tsx",
  "JukeboxPanel.tsx",
];
const SEAMS = [
  "audio-benches.ts",
  "audio-ab.ts",
  "money-desks-2.ts",
  "dj-desk.ts",
  "jukebox-sync.ts",
  "listening-party.ts",
  "shelf.ts",
];
const componentSrc = COMPONENTS.map((f) =>
  read(`../../components/world/native/${f}`),
);
const familySrc =
  componentSrc.join("\n") + "\n" + SEAMS.map((f) => read(`./${f}`)).join("\n");

const en = readJson("../../locales/en.json");
const enNs = (en.worldAudioDesk ?? {}) as Record<string, string>;
const enKeys = Object.keys(enNs).sort();

const tokens = (v: string): string[] =>
  [...v.matchAll(/\{\{[A-Za-z]+\}\}/g)].map((m) => m[0]).sort();

/** A plural base (stemFilesReady) covers its _one/_other leaves. */
const referenced = (key: string): boolean => {
  if (familySrc.includes(`worldAudioDesk.${key}`)) return true;
  for (const suf of ["_one", "_other"]) {
    if (key.endsWith(suf) && familySrc.includes(`worldAudioDesk.${key.slice(0, -suf.length)}`)) {
      return true;
    }
  }
  return false;
};

describe("Audio family extraction (unit 39)", () => {
  it("every family component renders through useTranslation", () => {
    for (const [i, f] of COMPONENTS.entries()) {
      expect(componentSrc[i], f).toContain("useTranslation");
      expect(componentSrc[i], f).toContain("worldAudioDesk.");
    }
  });

  it("the namespace carries exactly 620 keys", () => {
    expect(enKeys.length).toBe(620);
  });

  it("every catalog key is referenced by the family (no orphans)", () => {
    for (const key of enKeys) {
      expect(referenced(key), `worldAudioDesk.${key}`).toBe(true);
    }
  });

  it("every referenced key exists in the catalog (no missing)", () => {
    const refs = new Set(
      [...familySrc.matchAll(/worldAudioDesk\.([A-Za-z0-9_]+)/g)].map((m) => m[1]!),
    );
    for (const ref of refs) {
      const ok =
        ref in enNs || `${ref}_one` in enNs || `${ref}_other` in enNs;
      expect(ok, `worldAudioDesk.${ref}`).toBe(true);
    }
  });

  it("numbers and dates format in the walker's language, never hard-coded en-US", () => {
    for (const [i, f] of COMPONENTS.entries()) {
      expect(componentSrc[i], f).not.toContain('"en-US"');
    }
    expect(familySrc).toContain("i18n.language");
  });

  it("en catalog values equal the seams' English defaults, field for field", () => {
    const fromCatalog = audioBenchResultStrings(
      (key: string) => enNs[key.replace("worldAudioDesk.", "")]!,
    );
    expect(fromCatalog).toEqual(AUDIO_BENCH_RESULT_STRINGS_EN);

    expect(enNs.listingNeedsTitleUrl).toBe(BEAT_LISTING_PROBLEM_STRINGS_EN.needsTitleUrl);
    expect(enNs.listingPriceLine).toBe(BEAT_LISTING_PROBLEM_STRINGS_EN.priceLine);
    expect(en.beats.tierBasicLabel).toBe(BEAT_LISTING_PROBLEM_STRINGS_EN.tierBasic);
    expect(en.beats.tierPremiumLabel).toBe(BEAT_LISTING_PROBLEM_STRINGS_EN.tierPremium);
    expect(en.beats.tierExclusiveLabel).toBe(BEAT_LISTING_PROBLEM_STRINGS_EN.tierExclusive);

    expect(enNs.templateNeedsName).toBe(BEAT_TEMPLATE_PROBLEM_STRINGS_EN.needsName);
    expect(enNs.templatePriceInvalid).toBe(BEAT_TEMPLATE_PROBLEM_STRINGS_EN.priceInvalid);

    expect(enNs.aiTagsUnreadable).toBe(BEAT_AI_TAGS_OUTCOME_STRINGS_EN.unreadable);
    expect(enNs.aiTagsRunFailed).toBe(BEAT_AI_TAGS_OUTCOME_STRINGS_EN.runFailed);

    expect(enNs.notAnalyzedYet).toBe(DJ_ANALYSIS_LINE_STRINGS_EN.notAnalyzed);
    expect(enNs.bpmValue).toBe(DJ_ANALYSIS_LINE_STRINGS_EN.bpm);
    expect(enNs.analysisNoTempoOrKey).toBe(DJ_ANALYSIS_LINE_STRINGS_EN.noTempoOrKey);

    expect(enNs.deniedGuests).toBe(JUKEBOX_DENIED_STRINGS_EN.guests);
    expect(enNs.deniedUnplayable).toBe(JUKEBOX_DENIED_STRINGS_EN.unplayable);
    expect(enNs.deniedQueueFull).toBe(JUKEBOX_DENIED_STRINGS_EN.queueFull);
    expect(enNs.deniedListeningParty).toBe(JUKEBOX_DENIED_STRINGS_EN.listeningParty);
    expect(enNs.deniedNotYours).toBe(JUKEBOX_DENIED_STRINGS_EN.notYours);
    expect(enNs.deniedFallback).toBe(JUKEBOX_DENIED_STRINGS_EN.fallback);

    const partyMap: Record<string, string> = {
      nameFirst: "partyErrNameFirst",
      nameTooLong: "partyErrNameTooLong",
      queueEmpty: "partyErrQueueEmpty",
      queueTooLong: "partyErrQueueTooLong",
      notCatalog: "partyErrNotCatalog",
      slotTooShort: "partyErrSlotTooShort",
      slotTooLong: "partyErrSlotTooLong",
      pickStart: "partyErrPickStart",
      startPast: "partyErrStartPast",
      tooFarAhead: "partyErrTooFarAhead",
      slotTaken: "partyErrSlotTaken",
      invalidWindow: "partyErrInvalidWindow",
      invalidPayload: "partyErrInvalidPayload",
      roomMismatch: "partyErrRoomMismatch",
      signIn: "partyErrSignIn",
      didntLand: "bookingDidntLand",
    };
    for (const [field, key] of Object.entries(partyMap)) {
      expect(enNs[key], key).toBe(
        (LISTENING_PARTY_STRINGS_EN as Record<string, string>)[field],
      );
    }

    expect(enNs.mintCopyStart).toBe(DOWNLOAD_MINT_COPY_STRINGS_EN.start);
    expect(enNs.mintUsesCount).toBe(DOWNLOAD_MINT_COPY_STRINGS_EN.usesCount);
    expect(enNs.mintUsesLimited).toBe(DOWNLOAD_MINT_COPY_STRINGS_EN.usesLimited);
    expect(enNs.mintExpiresPart).toBe(DOWNLOAD_MINT_COPY_STRINGS_EN.expiresPart);
    expect(enNs.mintCopyEnd).toBe(DOWNLOAD_MINT_COPY_STRINGS_EN.end);
    expect(enNs.receiptLabel).toBe("Receipt {{id}}");
  });

  it("en bench labels are the AUDIO_BENCHES registry wording, verbatim", () => {
    expect(enNs.benchMaster).toBe("Mix & master — one song");
    expect(enNs.benchHum).toBe("Hum to song");
    expect(enNs.fullBenchTitle).toBe("The full workbench — the Audio Studio’s benches, in here");
    expect(enNs.aiTagsCreditsNote).toBe(
      "Not enough Visual Bucs for AI tags — it costs {{cost}}. Top up at the Treasury; nothing was charged.",
    );
  });
});

describe("Audio family catalog parity (unit 39)", () => {
  /* JOIN AMENDMENT (Stack-100 phase-2 join): the family's 6 count
     families (partySongsCount, playlistFoldSkipped, playlistFoldSongs,
     playlistItemCount, proposalUnanalyzed, stemFilesReady) fall under
     the catalog-wide plural law (i18n-plural-categories): ar carries
     all six CLDR forms and es/fr/pt/it carry _many, so those locales
     legitimately carry MORE than the en set. Parity is therefore:
     every locale carries at least the en set; the only extras are
     the plural-law forms of the 6 families. */
  const PLURAL_FAMILIES = [
    "partySongsCount", "playlistFoldSkipped", "playlistFoldSongs",
    "playlistItemCount", "proposalUnanalyzed", "stemFilesReady",
  ];
  const PLURAL_EXTRAS: Record<string, string[]> = {
    ar: PLURAL_FAMILIES.flatMap((f) => [`${f}_zero`, `${f}_two`, `${f}_few`, `${f}_many`]),
    es: PLURAL_FAMILIES.map((f) => `${f}_many`),
    fr: PLURAL_FAMILIES.map((f) => `${f}_many`),
    pt: PLURAL_FAMILIES.map((f) => `${f}_many`),
    it: PLURAL_FAMILIES.map((f) => `${f}_many`),
  };

  it("all 10 locales carry the extracted key set (plus the plural-law forms where CLDR requires them)", () => {
    for (const loc of LOCALES) {
      const cat = readJson(`../../locales/${loc}.json`);
      const expected = [...enKeys, ...(PLURAL_EXTRAS[loc] ?? [])].sort();
      expect(Object.keys(cat.worldAudioDesk ?? {}).sort(), loc).toEqual(expected);
    }
  });

  it("no locale's value is empty or an untranslated copy of the key name", () => {
    for (const loc of LOCALES) {
      const cat = readJson(`../../locales/${loc}.json`);
      for (const key of enKeys) {
        const value = cat.worldAudioDesk[key];
        expect(typeof value, `${loc}.${key}`).toBe("string");
        // A few values are legitimately space-led or space-trailed
        // sentence parts (mintExpiresPart, creatorPart) — emptiness
        // is judged on the raw string, not the trimmed one.
        expect(value.length, `${loc}.${key}`).toBeGreaterThan(0);
        expect(value, `${loc}.${key}`).not.toBe(key);
      }
    }
  });

  it("interpolation tokens survive identically in every locale, per key", () => {
    for (const loc of LOCALES) {
      const cat = readJson(`../../locales/${loc}.json`);
      for (const key of enKeys) {
        expect(tokens(cat.worldAudioDesk[key]), `${loc}.${key}`).toEqual(
          tokens(enNs[key]!),
        );
      }
    }
  });

  it("money lines ride English verbatim in every catalog (money law)", () => {
    for (const loc of LOCALES) {
      const cat = readJson(`../../locales/${loc}.json`);
      expect(cat.worldAudioDesk.aiTagsUnreadable, loc).toBe(enNs.aiTagsUnreadable);
      expect(cat.worldAudioDesk.aiTagsCreditsNote, loc).toBe(enNs.aiTagsCreditsNote);
    }
  });
});
