/**
 * "Your First 10 Minutes" — the client half (lib/world/tutorial,
 * Ring 3, Phase 6).
 *
 * Pinned contract:
 * - The status DTO parses strictly (DTO discipline): a malformed
 *   shape reads null — never a fabricated "step 1 of 7".
 * - The strip line names the current step from the server's step
 *   keys; an unknown key falls back to a plain "next step".
 * - Completed + unclaimed keeps the claim line; claimed reads
 *   null (the strip falls back to the quest summary).
 * - Source pins: the strip carries the tutorial chip (leading the
 *   quest chip) and the page fetches + claims through the member
 *   route, refreshing at the moments a step can land.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseTutorialStatus,
  tutorialStripLine,
  tutorialGuidance,
  currentTutorialStep,
  tutorialStepDisplay,
  type TutorialStatus,
} from "../tutorial";

const body = (
  over: Partial<{
    currentStep: number | null;
    completed: boolean;
    claimed: boolean;
    amountVb: number;
  }> = {},
) => ({
  tutorial: {
    currentStep: over.currentStep === undefined ? 3 : over.currentStep,
    completed: over.completed ?? false,
    reward: { amountVb: over.amountVb ?? 30, claimed: over.claimed ?? false },
    steps: [
      { n: 1, key: "meet-the-king", done: true },
      { n: 2, key: "claim-daily-drop", done: true },
      { n: 3, key: "quest-board", done: false },
      { n: 4, key: "make-a-song", done: false },
      { n: 5, key: "publish", done: false },
      { n: 6, key: "applaud", done: false },
      { n: 7, key: "claim-quest-reward", done: false },
    ],
  },
});

const src = (rel: string) =>
  readFileSync(join(process.cwd(), "src", rel), "utf8");

describe("parseTutorialStatus", () => {
  it("parses a well-formed status", () => {
    const s = parseTutorialStatus(body());
    expect(s).not.toBeNull();
    expect(s!.currentStep).toBe(3);
    expect(s!.completed).toBe(false);
    expect(s!.steps).toHaveLength(7);
    expect(s!.reward).toEqual({ amountVb: 30, claimed: false });
  });

  it("refuses malformed shapes — no fabricated progress", () => {
    expect(parseTutorialStatus(null)).toBeNull();
    expect(parseTutorialStatus({})).toBeNull();
    expect(parseTutorialStatus({ tutorial: null })).toBeNull();
    expect(parseTutorialStatus({ tutorial: { steps: [] } })).toBeNull();
    expect(
      parseTutorialStatus({
        tutorial: {
          currentStep: 1,
          completed: false,
          reward: { amountVb: 30, claimed: false },
          steps: [{ n: "1", key: "meet-the-king", done: false }],
        },
      }),
    ).toBeNull();
    // In progress with no current step is incoherent — refuse it.
    expect(
      parseTutorialStatus(body({ currentStep: null })),
    ).toBeNull();
  });

  it("a completed status carries currentStep null even if the body says otherwise", () => {
    const s = parseTutorialStatus(body({ completed: true, currentStep: 7 }));
    expect(s!.completed).toBe(true);
    expect(s!.currentStep).toBeNull();
  });
});

describe("the strip line", () => {
  it("names the current step: Tutorial 3 of 7 — Read the Quest Board", () => {
    const s = parseTutorialStatus(body())!;
    expect(tutorialStripLine(s)).toBe("Tutorial 3 of 7 — Read the Quest Board");
    expect(currentTutorialStep(s)?.key).toBe("quest-board");
    expect(tutorialGuidance(s)).toContain("Treasury");
  });

  it("completed + unclaimed keeps the claim line; claimed falls back to null", () => {
    const open = parseTutorialStatus(body({ completed: true }))!;
    expect(tutorialStripLine(open)).toBe("Tutorial complete — claim your 30 Bucs");
    const claimed = parseTutorialStatus(body({ completed: true, claimed: true }))!;
    expect(tutorialStripLine(claimed)).toBeNull();
    expect(tutorialStripLine(null)).toBeNull();
  });

  it("every ruled step key has display copy; an unknown key degrades honestly", () => {
    for (const key of [
      "meet-the-king",
      "claim-daily-drop",
      "quest-board",
      "make-a-song",
      "publish",
      "applaud",
      "claim-quest-reward",
    ]) {
      expect(tutorialStepDisplay(key), key).not.toBeNull();
    }
    expect(tutorialStepDisplay("mystery-step")).toBeNull();
    const weird: TutorialStatus = {
      currentStep: 1,
      completed: false,
      steps: [{ n: 1, key: "mystery-step", done: false }],
      reward: { amountVb: 30, claimed: false },
    };
    expect(tutorialStripLine(weird)).toBe("Tutorial 1 of 1 — Your next step");
  });
});

describe("source pins", () => {
  it("the strip leads with the tutorial chip and hides the quest chip while the line stands", () => {
    const strip = src("components/world/ObjectiveStrip.tsx");
    expect(strip).toContain('data-testid="world-objective-tutorial"');
    expect(strip).toContain('data-testid="world-objective-tutorial-claim"');
    expect(strip).toContain("slots.quest && !tutorialLine");
    expect(strip).toContain("!isGuest && tutorialLine");
  });

  it("the page fetches the member route and claims through it", () => {
    const page = src("pages/world.tsx");
    expect(page).toContain('fetch("/api/world/tutorial"');
    expect(page).toContain('fetch("/api/world/tutorial/claim"');
    expect(page).toContain("parseTutorialStatus");
    expect(page).toContain("tutorialStripLine(tutorialStatus)");
    expect(page).toContain('data-testid="world-tutorial-guidance"');
    // Refresh at the moments a step can land: entering, room
    // change, and a station panel closing.
    expect(page).toContain("[status, roomId, refreshTutorial]");
    expect(page).toContain("void refreshTutorial();");
  });
});
