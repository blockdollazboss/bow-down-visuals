/**
 * Canonical dub/caption language catalog — the ONE list every
 * translator / dubbing / caption surface validates against.
 *
 * Pins: the widened 15-language set, its provenance (union of the three
 * pre-existing rail lists; covers every repo i18n locale), acceptance
 * of every widened code, and rejection of garbage.
 */
import { describe, expect, it } from "vitest";
import {
  DUB_CAPTION_LANGUAGES,
  DUB_CAPTION_LANGUAGE_CODES,
  isDubCaptionLanguage,
  findDubCaptionLanguage,
  dubCaptionLanguageLabel,
  unsupportedDubCaptionLanguages,
} from "../dub-caption-languages";

/** The three divergent lists as they existed before unification. */
const BEFORE_TRANSLATOR = ["es", "fr", "pt", "de", "it", "nl", "pl", "ja", "ko", "zh", "hi", "ar", "ru", "tr"];
const BEFORE_DUB = ["es", "fr", "de", "pt", "it", "ja", "ko", "zh", "ar", "hi", "en"];
const BEFORE_CAPTIONS = ["es", "fr", "de", "pt", "it", "ja", "ko", "zh", "ar", "hi"];

/** Repo i18n locale catalogs (artifacts/bow-down-visuals/src/locales/*.json). */
const REPO_LOCALES = ["ar", "de", "en", "es", "fr", "hi", "it", "ja", "ko", "pt"];

describe("canonical dub/caption language catalog", () => {
  it("holds exactly the widened 15-language set", () => {
    expect(DUB_CAPTION_LANGUAGES).toHaveLength(15);
    expect([...DUB_CAPTION_LANGUAGE_CODES].sort()).toEqual(
      ["ar", "de", "en", "es", "fr", "hi", "it", "ja", "ko", "nl", "pl", "pt", "ru", "tr", "zh"].sort(),
    );
  });

  it("has unique codes and a display + native name + TTS hint for every language", () => {
    expect(new Set(DUB_CAPTION_LANGUAGE_CODES).size).toBe(15);
    for (const lang of DUB_CAPTION_LANGUAGES) {
      expect(lang.label.length).toBeGreaterThan(0);
      expect(lang.nativeLabel.length).toBeGreaterThan(0);
      expect(lang.elevenLabsCode).toBe(lang.code);
    }
  });

  it("is a superset of every pre-existing rail list (widening, nothing dropped)", () => {
    for (const before of [BEFORE_TRANSLATOR, BEFORE_DUB, BEFORE_CAPTIONS]) {
      for (const code of before) expect(isDubCaptionLanguage(code)).toBe(true);
    }
  });

  it("covers every repo i18n locale", () => {
    for (const code of REPO_LOCALES) expect(isDubCaptionLanguage(code)).toBe(true);
  });

  it("accepts every widened code — including the ones each surface used to miss", () => {
    // translator gained en; dub gained nl/pl/ru/tr; captions gained en/nl/pl/ru/tr
    for (const code of DUB_CAPTION_LANGUAGE_CODES) {
      expect(isDubCaptionLanguage(code)).toBe(true);
      expect(findDubCaptionLanguage(code)?.code).toBe(code);
    }
  });

  it("rejects garbage codes", () => {
    for (const bad of ["xx", "", "english", "EN", "Es", "e", "eng", "zh-CN", "pt-BR", "  es", "es "]) {
      expect(isDubCaptionLanguage(bad)).toBe(false);
    }
    expect(unsupportedDubCaptionLanguages(["es", "xx", "nl", "klingon"])).toEqual(["xx", "klingon"]);
    expect(unsupportedDubCaptionLanguages(["es", "fr"])).toEqual([]);
  });

  it("labels known languages (canonical zh label is Chinese (Mandarin)) and passes through unknown codes", () => {
    expect(dubCaptionLanguageLabel("es")).toBe("Spanish");
    expect(dubCaptionLanguageLabel("zh")).toBe("Chinese (Mandarin)");
    expect(dubCaptionLanguageLabel("en")).toBe("English");
    expect(dubCaptionLanguageLabel("xx")).toBe("xx");
  });

  it("carries per-language native display names", () => {
    expect(findDubCaptionLanguage("es")?.nativeLabel).toBe("Español");
    expect(findDubCaptionLanguage("ja")?.nativeLabel).toBe("日本語");
    expect(findDubCaptionLanguage("ar")?.nativeLabel).toBe("العربية");
  });
});
