/**
 * dj-desk-components — stack1500 world parity wave #3 item 29
 * source-contract pins. The DJ Set Prep desk must sit in the My
 * Studio stack as a board desk ({ isLight }), with:
 * - the whole prep in-panel: library with per-track + bulk
 *   analyze, crates with create/select, membership + reorder,
 *   the proposal with apply/keep, both exports, delete;
 * - the seam's computations driving every save (chunking,
 *   membership, moves) — no inline re-derivation;
 * - no spend path at all (every rail is free);
 * - light/dark parity via the desk's isLight branches.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const desk = read("../../components/world/native/DjDesk.tsx");
const panel = read("../../components/world/StationPanel.tsx");

describe("the board-desk shape + the My Studio mount", () => {
  it("is a named board desk rooted at its testid", () => {
    expect(desk).toContain("export function DjDesk({ isLight }: { isLight: boolean })");
    expect(desk).toContain('data-testid="world-dj-desk"');
  });

  it("StationPanel stacks it at the My Studio board behind a DeskDoor", () => {
    expect(panel).toContain('const DjDesk = lazy(() => import("@/components/world/native/DjDesk")');
    expect(panel).toContain("<DjDesk isLight={isLight} />");
  });
});

describe("the whole prep in-panel", () => {
  it("library, analyze, crates, proposal, exports, delete", () => {
    for (const needle of [
      'data-testid="world-dj-desk-analyze-all"',
      /* Unit 39: button words ride the worldAudioDesk catalog. */
      't("worldAudioDesk.analyzeAllNew"',
      'data-testid="world-dj-desk-crate-create"',
      'data-testid="world-dj-desk-crate-detail"',
      'data-testid="world-dj-desk-propose"',
      't("worldAudioDesk.proposeOrderBtn")',
      'data-testid="world-dj-desk-proposal"',
      'data-testid="world-dj-desk-apply-proposal"',
      't("worldAudioDesk.useThisOrderBtn")',
      't("worldAudioDesk.keepMineBtn")',
      'data-testid="world-dj-desk-export-rekordbox"',
      'data-testid="world-dj-desk-export-m3u"',
      'data-testid="world-dj-desk-delete"',
      't("worldAudioDesk.tapAgainDeleteBtn")',
      't("worldAudioDesk.notAnalyzedYet")',
    ]) {
      expect(desk, needle).toContain(needle);
    }
  });

  it("every save computes through the seam", () => {
    for (const needle of [
      "chunkSongIds(ids)",
      "buildAnalyzePayload(chunk, force)",
      "applyAnalyzeOutcomes(prev, outcomes)",
      "withAdded(crateSongIds(selected), track.id)",
      "withoutId(ids, track.songId)",
      "moved(ids, i, -1)",
      "moved(ids, i, 1)",
      "proposalOfResponse",
    ]) {
      expect(desk, needle).toContain(needle);
    }
  });

  it("an empty crate can't be ordered or exported — the desk says so first", () => {
    expect(desk).toContain("disabled={proposing || selected.tracks.length < 2}");
    expect(desk).toContain("disabled={selected.tracks.length === 0}");
    /* Unit 39: the words ride the worldAudioDesk catalog. */
    expect(desk).toContain('t("worldAudioDesk.crateEmptyNote")');
  });
});

describe("free — no spend path exists in the desk", () => {
  it("plain fetches only, never confirmedFetch", () => {
    expect(desk).toContain("fetch(DJ_LIBRARY_PATH");
    expect(desk).toContain("fetch(DJ_ANALYZE_PATH");
    expect(desk).not.toContain("confirmedFetch");
  });
});

describe("light/dark parity — theme-switched surfaces", () => {
  it("the desk branches its surfaces on isLight", () => {
    expect(desk).toContain('isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"');
    expect(desk).toContain('isLight ? "text-[#6B5B36]" : "text-white/50"');
  });
});
