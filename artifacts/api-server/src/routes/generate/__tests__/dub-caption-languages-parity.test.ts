/**
 * UI/API parity for the widened dub/caption language set.
 *
 * Every surface — video translator, video dub, caption translation —
 * must expose the SAME canonical catalog (lib/dub-caption-languages.ts):
 * same codes, same labels, and every widened language accepted by each
 * surface's own validator.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/credits", () => ({
  chargeCredits: vi.fn(),
  refundCredits: vi.fn(),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  LedgerWriteError: class LedgerWriteError extends Error {},
}));

vi.mock("../../../lib/objectStorage", () => ({
  uploadMediaToSupabaseStorage: vi.fn(),
  refreshSupabaseStorageUrl: vi.fn(),
}));

vi.mock("../../../lib/ai-clients", () => ({
  getOpenAI: vi.fn(),
  getTextModel: () => "gpt-6-sol",
}));

vi.mock("../../../lib/transcription", () => ({
  transcribeAudioTimed: vi.fn(),
}));

vi.mock("child_process", () => ({
  execFile: vi.fn(),
}));

import {
  DUB_CAPTION_LANGUAGES,
  DUB_CAPTION_LANGUAGE_CODES,
  isDubCaptionLanguage,
} from "../../../lib/dub-caption-languages";
import { TARGET_LANGUAGES, isSupportedLanguage } from "../video-translator";
import { DUB_LANGUAGES } from "../video-dub";
import { SUPPORTED_LANGUAGES } from "../translate-captions";

const canonicalCodes = [...DUB_CAPTION_LANGUAGE_CODES].sort();
const canonicalLabels = Object.fromEntries(DUB_CAPTION_LANGUAGES.map((l) => [l.code, l.label]));

describe("dub/caption language parity across routes", () => {
  it("video translator exposes exactly the canonical set", () => {
    expect(TARGET_LANGUAGES.map((l) => l.code).sort()).toEqual(canonicalCodes);
    for (const l of TARGET_LANGUAGES) {
      expect(l.label).toBe(canonicalLabels[l.code]);
      expect(l.elevenLabsCode).toBe(l.code);
    }
  });

  it("video dub exposes exactly the canonical set (11 → 15)", () => {
    expect(DUB_LANGUAGES).toHaveLength(15);
    expect(DUB_LANGUAGES.map((l) => l.code).sort()).toEqual(canonicalCodes);
    for (const l of DUB_LANGUAGES) expect(l.label).toBe(canonicalLabels[l.code]);
    // The four languages dub used to miss:
    for (const code of ["nl", "pl", "ru", "tr"]) {
      expect(DUB_LANGUAGES.some((l) => l.code === code)).toBe(true);
    }
  });

  it("caption translation exposes exactly the canonical set (10 → 15)", () => {
    expect(SUPPORTED_LANGUAGES).toHaveLength(15);
    expect(SUPPORTED_LANGUAGES.map((l) => l.code).sort()).toEqual(canonicalCodes);
    for (const l of SUPPORTED_LANGUAGES) expect(l.label).toBe(canonicalLabels[l.code]);
    // The five languages captions used to miss:
    for (const code of ["en", "nl", "pl", "ru", "tr"]) {
      expect(SUPPORTED_LANGUAGES.some((l) => l.code === code)).toBe(true);
    }
  });

  it("the translator validator accepts every widened language and rejects garbage", () => {
    for (const code of DUB_CAPTION_LANGUAGE_CODES) {
      expect(isSupportedLanguage(code)).toBe(true);
      expect(isDubCaptionLanguage(code)).toBe(true);
    }
    // English is the translator's widening gain (14 → 15):
    expect(isSupportedLanguage("en")).toBe(true);
    for (const bad of ["xx", "", "klingon", "zh-CN"]) {
      expect(isSupportedLanguage(bad)).toBe(false);
    }
  });
});
