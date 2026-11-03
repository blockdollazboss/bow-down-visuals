/**
 * movies-desk-components — stack1400 world parity wave #2 item 4
 * source-contract pins. The Movies Desk (the census's ABSENT
 * `movies`) must exist as ONE native desk in the Create Wing:
 * - both 2D modes are present as focusable tabs (Concept
 *   Generator / Stream Clip Detector) with the page's format
 *   chips and Advanced fields, controller/keyboard navigable as
 *   native buttons + selects like every Create Wing desk;
 * - results render IN the panel — concept package (episodes,
 *   character bible, pilot hook, comparables) and detection
 *   (clips, posting strategy, the server's note) — never a
 *   website pull-up of /movies;
 * - light/dark parity rides the desk's isLight branches like its
 *   sibling desks (every surface class pair is theme-switched).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const desk = read("../../components/world/native/MoviesDesk.tsx");
const seam = read("./movies-desk.ts");

describe("both modes, focusable and complete", () => {
  it("mode tabs + format chips are real buttons with testids", () => {
    expect(desk).toContain('data-testid={`world-movies-desk-mode-${key}`}');
    expect(desk).toContain('role="tablist"');
    expect(desk).toContain("MOVIES_FORMATS.map");
    expect(desk).toContain("world-movies-desk-format-");
    expect(desk).toContain("aria-pressed={format === f}");
  });

  it("the run button is one per mode, gated on the seam's readiness", () => {
    expect(desk).toContain('data-testid="world-movies-desk-run"');
    expect(desk).toContain("disabled={busy || !ready}");
    expect(desk).toContain("moviesDeskInputReady(mode, { idea, description })");
    expect(desk).toContain("need 50+");
  });

  it("Advanced fields dock behind the shared expander (episode count / stream length / clip count)", () => {
    expect(desk).toContain("AdvancedExpander");
    expect(desk).toContain("Episodes (series formats)");
    expect(desk).toContain("Stream length");
    expect(desk).toContain("Clips wanted");
    expect(desk).toContain("Genre (optional)");
    expect(desk).toContain("Stream / VOD URL (optional)");
  });
});

describe("results render in-panel — the full packages", () => {
  it("concept result: title, logline, episodes/scenes, character bible, pilot hook, comparables", () => {
    for (const needle of [
      "Three-Act Structure",
      "Episode Breakdown",
      "Character Bible",
      "Pilot Hook",
      "Comparables",
      "Saved to your hub project as a script asset",
      "Develop another concept",
    ]) {
      expect(desk, needle).toContain(needle);
    }
  });

  it("detection result: summary, clip moments with meta, posting strategy, server note verbatim", () => {
    for (const needle of [
      "Stream Summary",
      "Clip-Worthy Moments",
      "Posting Strategy",
      "Virality",
      "detectNote",
      "Analyze another stream",
    ]) {
      expect(desk, needle).toContain(needle);
    }
  });

  it("no 2D pull-up: no Link, no window.open, no /movies href in the desk or the seam", () => {
    expect(desk).not.toContain("wouter");
    expect(desk).not.toContain("window.open");
    expect(desk).not.toContain('href="/movies"');
    expect(seam).not.toContain("window.open");
  });
});

describe("theme parity + honest states", () => {
  it("surfaces switch on isLight (gold-on-cream light, gold-on-black dark)", () => {
    expect(desk).toContain('"border-[#C9A84C]/40 bg-white/50"');
    expect(desk).toContain('"border-white/10 bg-white/5"');
    expect(desk).toContain("deskInputCls(isLight)");
  });

  it("out-of-credits and failure notes are plain sentences, distinct from empty", () => {
    expect(desk).toContain("out of Visual Bucs — top up at the Visual Buc Packs desk");
    expect(desk).toContain("a failed make is refunded");
    expect(desk).toContain("came back empty — a failed make is refunded");
  });

  it("the session strip is labelled session-only — no saved-projects claim anywhere", () => {
    expect(desk).toContain("This session");
    expect(seam).toContain("SAVED PROJECTS — THE GAP, VERBATIM");
    expect(desk).not.toContain("Saved projects");
    expect(desk).not.toContain("My Movies");
  });
});
