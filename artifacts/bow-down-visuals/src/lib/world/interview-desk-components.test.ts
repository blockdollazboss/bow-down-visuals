/**
 * interview-desk-components — stack1500 world parity wave #3
 * item 13 source-contract pins. The Interview Prep desk must sit
 * in the Promote Room stack as a board desk ({ isLight, isGuest },
 * guests gated), with:
 * - the whole coach in-panel: kind tabs, the form, the session
 *   (talking points + questions + tips), practice with its answer
 *   gate, and the scored feedback;
 * - spend discipline in source: both runs ride confirmedFetch
 *   with the registry constants as overrideCost — the 2D page's
 *   unconfirmed authedPost is NOT copied;
 * - light/dark parity via the desk's isLight branches.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const desk = read("../../components/world/native/InterviewDesk.tsx");
const panel = read("../../components/world/StationPanel.tsx");
const seam = read("./interview-desk.ts");

describe("the board-desk shape + the Promote Room mount", () => {
  it("is a named board desk with a guest gate", () => {
    expect(desk).toContain("export function InterviewDesk({ isLight, isGuest }");
    expect(desk).toContain('data-testid="world-interview-desk"');
    expect(desk).toContain('data-testid="world-interview-desk-guest"');
    expect(desk).toContain('href="/login"');
  });

  it("StationPanel stacks it in the Promote Room behind a DeskDoor", () => {
    expect(panel).toContain('const InterviewDesk = lazy(() => import("@/components/world/native/InterviewDesk")');
    expect(panel).toContain("<InterviewDesk isLight={isLight} isGuest={isGuest} />");
  });
});

describe("the whole coach in-panel", () => {
  it("kind tabs, the form, the session, practice, the score", () => {
    for (const needle of [
      'data-testid={`world-interview-desk-type-${type}`}',
      'data-testid="world-interview-desk-name"',
      'data-testid="world-interview-desk-build"',
      'data-testid="world-interview-desk-session"',
      "worldSponsorPress.ivTalkingPointsTitle", // "Your talking points — land these no matter what" — via the catalog (unit 47)
      "worldSponsorPress.ivCoachTip", // "Coach's tip: …" — via the catalog (unit 47)
      'data-testid="world-interview-desk-answer"',
      'data-testid="world-interview-desk-score"',
      'data-testid="world-interview-desk-feedback"',
      "interviewPrep.whatLanded", // "What landed" — the 2D page's own key (unit 47)
      "worldSponsorPress.ivTightenThis", // "Tighten this" — via the catalog (unit 47)
      "worldSponsorPress.ivModelAnswer", // "A model answer" — via the catalog (unit 47)
    ]) {
      expect(desk, needle).toContain(needle);
    }
  });

  it("the runs gate on the seam's readiness rules", () => {
    expect(desk).toContain("disabled={building || !interviewFormReady(form)}");
    expect(desk).toContain("disabled={feedbackBusy || !answerReady(answer)}");
  });
});

describe("spend discipline in source", () => {
  it("both runs ride confirmedFetch with the registry constants quoted", () => {
    expect(desk).toContain("overrideCost: INTERVIEW_SESSION_COST");
    expect(desk).toContain("overrideCost: INTERVIEW_FEEDBACK_COST");
    expect(desk).toContain("overrideFeature: INTERVIEW_FEATURE");
    expect(desk).not.toContain("authedPost");
  });

  it("printed prices come from the constants", () => {
    expect(desk).toContain('data-testid="world-interview-desk-cost"');
    expect(desk).toContain("INTERVIEW_SESSION_COST.toLocaleString(i18n.language)");
    expect(desk).toContain("INTERVIEW_FEEDBACK_COST.toLocaleString(i18n.language)");
    expect(seam).toContain("registryCost(INTERVIEW_SESSION_PATH)");
  });

  it("402 names the Treasury's packs desk", () => {
    expect(desk).toContain("worldSponsorPress.ivOutOfCredits"); // names the Visual Buc Packs desk in the Treasury — via the catalog (unit 47)
  });
});

describe("light/dark parity — theme-switched surfaces", () => {
  it("the desk branches its surfaces on isLight", () => {
    expect(desk).toContain('isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"');
    expect(desk).toContain('isLight ? "text-[#6B5B36]" : "text-white/50"');
  });
});
