/**
 * dub-caption-languages.ts — THE canonical language catalog for every
 * dubbing / caption-translation / video-translation surface.
 *
 * Before this module the rail carried THREE divergent lists:
 *   - video-translator TARGET_LANGUAGES: 14 (no English)
 *   - video-dub DUB_LANGUAGES:            11 (no nl/pl/ru/tr)
 *   - translate-captions SUPPORTED:      10 (no en/nl/pl/ru/tr, and no
 *     validation — unknown codes were silently skipped after charging)
 *
 * The canonical set is the UNION of those three lists: 15 languages.
 * Every language any part of the rail already supported is now supported
 * everywhere, and no surface can drift from the others again — the
 * routes re-export this list and the frontend mirrors it (parity is
 * pinned by tests on both sides).
 *
 * Source of the set: the provider rail's supported languages are not
 * pinned in code/config (the ElevenLabs TTS model is env-overridable
 * via ELEVENLABS_TTS_MODEL and translation runs through GPT, which
 * takes no language list), so the set is sourced from the repo itself:
 * the union above contains all 10 repo i18n locales
 * (ar de en es fr hi it ja ko pt) plus the five additional codes the
 * translator rail already shipped (nl pl zh ru tr). Nothing here is
 * invented, and nothing previously supported was dropped.
 *
 * Display names: `label` is the English name, `nativeLabel` is the
 * language's own name for itself (autonym) for picker display.
 * Mode words: the AI-mode words (Turbo / Advanced) stay as loanwords
 * in every locale catalog in this repo, so they are intentionally NOT
 * per-language here either.
 */

export interface DubCaptionLanguage {
  /** ISO 639-1 code, lowercase — the only form validation accepts. */
  code: string;
  /** English display name. */
  label: string;
  /** The language's own name for itself (autonym). */
  nativeLabel: string;
  /** BCP-47 hint passed to the multilingual TTS rail (ElevenLabs). */
  elevenLabsCode: string;
}

export const DUB_CAPTION_LANGUAGES: readonly DubCaptionLanguage[] = [
  { code: "en", label: "English", nativeLabel: "English", elevenLabsCode: "en" },
  { code: "es", label: "Spanish", nativeLabel: "Español", elevenLabsCode: "es" },
  { code: "fr", label: "French", nativeLabel: "Français", elevenLabsCode: "fr" },
  { code: "pt", label: "Portuguese", nativeLabel: "Português", elevenLabsCode: "pt" },
  { code: "de", label: "German", nativeLabel: "Deutsch", elevenLabsCode: "de" },
  { code: "it", label: "Italian", nativeLabel: "Italiano", elevenLabsCode: "it" },
  { code: "nl", label: "Dutch", nativeLabel: "Nederlands", elevenLabsCode: "nl" },
  { code: "pl", label: "Polish", nativeLabel: "Polski", elevenLabsCode: "pl" },
  { code: "ja", label: "Japanese", nativeLabel: "日本語", elevenLabsCode: "ja" },
  { code: "ko", label: "Korean", nativeLabel: "한국어", elevenLabsCode: "ko" },
  { code: "zh", label: "Chinese (Mandarin)", nativeLabel: "中文", elevenLabsCode: "zh" },
  { code: "hi", label: "Hindi", nativeLabel: "हिन्दी", elevenLabsCode: "hi" },
  { code: "ar", label: "Arabic", nativeLabel: "العربية", elevenLabsCode: "ar" },
  { code: "ru", label: "Russian", nativeLabel: "Русский", elevenLabsCode: "ru" },
  { code: "tr", label: "Turkish", nativeLabel: "Türkçe", elevenLabsCode: "tr" },
] as const;

export const DUB_CAPTION_LANGUAGE_CODES: readonly string[] =
  DUB_CAPTION_LANGUAGES.map((l) => l.code);

/** Exact-match validation: codes are ISO 639-1 lowercase, as the UI sends. */
export function isDubCaptionLanguage(code: string): boolean {
  return DUB_CAPTION_LANGUAGES.some((l) => l.code === code);
}

export function findDubCaptionLanguage(code: string): DubCaptionLanguage | undefined {
  return DUB_CAPTION_LANGUAGES.find((l) => l.code === code);
}

export function dubCaptionLanguageLabel(code: string): string {
  return findDubCaptionLanguage(code)?.label ?? code;
}

/** The subset of `codes` that is NOT in the canonical catalog (order kept). */
export function unsupportedDubCaptionLanguages(codes: readonly string[]): string[] {
  return codes.filter((c) => !isDubCaptionLanguage(c));
}
