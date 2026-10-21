/**
 * Catalog Import copy catalog (lib/catalog-import-i18n).
 *
 * Pins:
 *  - the en entry is BYTE-IDENTICAL to the copy the assistant shipped
 *    with (the literals below are the pre-catalog source of truth —
 *    if someone edits English copy, it happens here on purpose,
 *    never by accident);
 *  - every locale carries every string, non-empty;
 *  - no non-English locale quietly serves English (no allowlist —
 *    every string in this catalog translates);
 *  - no string carries interpolation placeholders (the header's
 *    claim, pinned so a future placeholder lands deliberately).
 */
import { describe, it, expect } from "vitest";
import { SERVER_LOCALES } from "../server-i18n";
import { CATALOG_IMPORT_COPY, catalogImportCopyFor, type CatalogImportCopy } from "../catalog-import-i18n";

const EN: CatalogImportCopy = {
  honesty: {
    movesLine:
      "Your work moves. Your followers don't — no platform lets anyone take an audience with them, and we won't pretend otherwise. What comes home is your content itself; your email list is how an audience becomes yours.",
    tiktokBlocked:
      "TikTok doesn't give apps a way to read or download your videos — the connection you granted covers posting only. Your TikTok catalog can't be pulled in automatically. Bring those files in with bulk upload below — that door always works.",
    linkOnly:
      "This is a display link you typed in, not a connected account — there's no connection that could read a catalog from it. Bulk upload below is the way in for this work.",
    noFileUrl:
      "The platform listed this post but wouldn't hand over the video file itself, so it can't be brought in automatically. Bulk upload the original file below and it comes home the same way.",
  },
  facebookNoPage:
    "This Facebook connection has no Page attached, and catalogs live on Pages. Reconnect in Settings and pick your Page.",
  fetchFailedNote:
    "The file couldn't be brought over. It may have expired on the platform — scan again to refresh it, then retry.",
  fileTooLarge:
    "That file is larger than the 800 MB import limit. Bring it in as a bulk upload instead — uploads don't pass through this server.",
  draftNotes: {
    chaptersNoTimedSections:
      "The transcript came back without timed sections, so there is nothing to hang chapters on.",
    captionsUnavailable: "Transcription wasn't available for this file.",
    chaptersNeedTranscript: "Chapters are built from the transcript — no transcript, no chapters.",
    thumbnailMissing: "No thumbnail came over with this file. You can set one after it's home.",
    seriesNoMarker:
      "No episode marker (like “Ep. 3” or “S2E3”) in the title, so no series grouping was suggested.",
  },
  transcriptTooLarge:
    "This file is too large to transcribe in one pass (200 MB), so captions and chapters were skipped — the rest of the rebuild still ran.",
  transcriptUnavailable:
    "Transcription wasn't available for this file, so captions and chapters were skipped — the rest of the rebuild still ran.",
  chapterFallback: "Chapter",
  untitledFallback: "Untitled",
};

function flatten(value: unknown, path = ""): Array<[string, string]> {
  if (typeof value === "string") return [[path, value]];
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => flatten(v, path ? `${path}.${k}` : k));
  }
  return [];
}

describe("Catalog Import copy catalog — en is byte-identical", () => {
  it("the en entry matches the shipped English exactly", () => {
    expect(CATALOG_IMPORT_COPY.en).toEqual(EN);
    expect(catalogImportCopyFor("en")).toEqual(EN);
  });

  it("carries exactly the ten site locales", () => {
    expect(Object.keys(CATALOG_IMPORT_COPY).sort()).toEqual([...SERVER_LOCALES].sort());
  });
});

describe("Catalog Import copy catalog — every locale complete", () => {
  const enFlat = flatten(EN);
  const enByPath = new Map(enFlat);

  it("every locale carries every key, non-empty", () => {
    for (const locale of SERVER_LOCALES) {
      const flat = flatten(CATALOG_IMPORT_COPY[locale]);
      expect(flat.map(([p]) => p).sort(), locale).toEqual(enFlat.map(([p]) => p).sort());
      for (const [path, value] of flat) {
        expect(value.trim().length, `${locale}:${path}`).toBeGreaterThan(0);
      }
    }
  });

  it("no untranslated English residue in any locale", () => {
    for (const locale of SERVER_LOCALES) {
      if (locale === "en") continue;
      for (const [path, value] of flatten(CATALOG_IMPORT_COPY[locale])) {
        expect(value, `${locale}:${path}`).not.toBe(enByPath.get(path));
      }
    }
  });

  it("no string carries an interpolation placeholder", () => {
    for (const locale of SERVER_LOCALES) {
      for (const [path, value] of flatten(CATALOG_IMPORT_COPY[locale])) {
        expect(value, `${locale}:${path}`).not.toMatch(/\{[a-zA-Z]+\}/);
      }
    }
  });
});
