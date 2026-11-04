/**
 * grants-desk-components — stack1500 world parity wave #3
 * item 41 source-contract pins. The Community Grants desk
 * must sit in the Community Hall stack as a
 * ({ isLight, isGuest }) desk, with:
 * - the whole member loop in-panel: rounds + candidates
 *   rendered from the surface, the submit form (submissions
 *   phase), vote + withdraw (voting phase), and the owed
 *   report-back form for the funded viewer;
 * - guests reading everything with actions gated on
 *   sign-in; past rounds rendered with results + report-
 *   backs; the no-round state said plainly;
 * - state re-read after every action and no spend/admin
 *   path anywhere (VB pool — the desk never charges; admin
 *   rounds stay on the website benches);
 * - light/dark parity via the desk's isLight branches.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const desk = read("../../components/world/native/GrantsDesk.tsx");
const panel = read("../../components/world/StationPanel.tsx");

describe("the desk shape + the Hall mount", () => {
  it("is a named ({ isLight, isGuest }) desk rooted at its testid", () => {
    expect(desk).toContain("export function GrantsDesk({ isLight, isGuest }: { isLight: boolean; isGuest: boolean })");
    expect(desk).toContain('data-testid="world-grants-desk"');
  });

  it("StationPanel stacks it at the Community Hall board behind a DeskDoor", () => {
    expect(panel).toContain('const GrantsDesk = lazy(() => import("@/components/world/native/GrantsDesk")');
    expect(panel).toContain("<GrantsDesk isLight={isLight} isGuest={isGuest} />");
  });
});

describe("the member loop in-panel", () => {
  it("submit, vote, withdraw, report-back — all wired to the seam", () => {
    for (const needle of [
      'data-testid="world-grants-desk-submit"',
      "buildGrantProjectPayload(title, description)",
      "grantsProjectsPath(current.round.id)",
      'data-testid="world-grants-desk-withdraw"',
      'send("DELETE", grantsVotePath(round.round.id))',
      'data-testid="world-grants-desk-reportback-form"',
      "buildGrantReportBackPayload(reportBack)",
      "grantsReportBackPath(round.round.id)",
      "myOwedReportBack(s, user?.id ?? null)",
      "await load();",
    ]) {
      expect(desk, needle).toContain(needle);
    }
    expect(desk).toContain("monthLabel(s.round.monthKey)");
    expect(desk).toContain("formatVb(s.round.poolVb)");
  });

  it("guests read; actions gate on sign-in; no-round is plain", () => {
    expect(desk).toContain('data-testid="world-grants-desk-signin"');
    expect(desk).toContain('data-testid="world-grants-desk-noround"');
    expect(desk).toContain("worldSponsorPress.grNoRound"); // "No round is open right now" — via the catalog (unit 47)
  });

  it("no spend path and no admin path", () => {
    expect(desk).not.toContain("confirmedFetch");
    expect(desk).not.toContain("/admin/");
  });
});

describe("light/dark parity — theme-switched surfaces", () => {
  it("the desk branches its surfaces on isLight", () => {
    expect(desk).toContain('isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"');
    expect(desk).toContain('isLight ? "text-[#6B5B36]" : "text-white/50"');
  });
});
