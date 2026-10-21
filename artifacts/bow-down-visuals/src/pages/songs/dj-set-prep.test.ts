/**
 * dj-set-prep.test.ts — source pins for the DJ Set-Prep Pack UI.
 *
 * The contract pinned here:
 *  (a) set prep docks INSIDE the song library as its third tab —
 *      no standalone page, no new route;
 *  (b) every song card carries the DJ read (BPM · key · Camelot via
 *      DjChips) or the free "DJ analysis" action;
 *  (c) the honesty labels are wired: low-confidence reads render the
 *      "rough guess" label and missing reads render "no key/tempo
 *      found" — the chips never dress an estimate up as a fact;
 *  (d) the harmonic order is a DRAFT: the panel proposes via
 *      propose-order and only a PATCH (the creator tapping "Use this
 *      order") can move the saved crate;
 *  (e) exports download through the authenticated export endpoint in
 *      both formats.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const songsPage = readFileSync(new URL("../songs.tsx", import.meta.url), "utf8");
const panel = readFileSync(new URL("./dj-set-prep.tsx", import.meta.url), "utf8");
const en = JSON.parse(
  readFileSync(new URL("../../locales/en.json", import.meta.url), "utf8"),
) as { djSets?: Record<string, string> };

describe("DJ set prep — docking", () => {
  it("is the library's third tab, not a standalone page", () => {
    expect(songsPage).toContain('type LibraryTab = "songs" | "albums" | "dj"');
    expect(songsPage).toContain('["songs", "albums", "dj"]');
    expect(songsPage).toContain("<DjSetPrep authHeaders={authHeaders} />");
    expect(songsPage).toContain('t("djSets.tab")');
  });

  it("song cards show DjChips or the analysis action", () => {
    expect(songsPage).toContain("<DjChips analysis={djAnalysisById[s.id]!} />");
    expect(songsPage).toContain("analyzeSongForDj(s.id)");
    expect(songsPage).toContain('"/api/dj/analyze"');
    expect(songsPage).toContain('"/api/dj/library"');
  });
});

describe("DJ set prep — honesty labels", () => {
  it("low-confidence reads are labeled a rough guess; missing reads say so", () => {
    expect(panel).toContain('analysis.keyConfidence === "low"');
    expect(panel).toContain('t("djSets.roughGuess")');
    expect(panel).toContain('t("djSets.keyUnknown")');
    expect(panel).toContain('t("djSets.bpmUnknown")');
    expect(panel).toContain('t("djSets.estimatesNote")');
  });

  it("the en copy carries the honesty strings", () => {
    expect(en.djSets?.roughGuess).toBe("rough guess");
    expect(en.djSets?.keyUnknown).toBe("no key found");
    expect(en.djSets?.bpmUnknown).toBe("no tempo found");
    expect(en.djSets?.freeNote).toContain("free");
  });
});

describe("DJ set prep — draft order + export", () => {
  it("the proposal is a draft until the creator saves it via PATCH", () => {
    expect(panel).toContain("/propose-order");
    expect(panel).toContain('t("djSets.draftTitle")');
    expect(panel).toContain("useDraft");
    expect(panel).toContain("patchCrate(draft.crateId, { songIds: draft.proposal.order })");
    expect(panel).toContain('method: "PATCH"');
  });

  it("exports stream from the crate export endpoint in both formats", () => {
    expect(panel).toContain("/export?format=${format}");
    expect(panel).toContain('exportCrate("rekordbox")');
    expect(panel).toContain('exportCrate("m3u")');
  });

  it("crate edits never include another member's tracks — adds come from the caller's library list", () => {
    expect(panel).toContain("crateSongIds.has(tr.id)");
    expect(panel).toContain("selectedCrate.tracks.map((x) => x.songId)");
  });
});
