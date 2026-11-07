/**
 * Hub project starters — the registry pins (stack200 upgrade
 * group 6).
 *
 * Pinned:
 * - the learn and business shelves each carry three starters —
 *   the two originals plus the stack200 additions `skill-sprint`
 *   (learn) and `client-welcome-kit` (business) — resolved
 *   through the same getTemplates / getTemplate seam the Hub
 *   module renders from;
 * - every starter on those shelves is well-formed in the
 *   family's own shape: a name, a blurb, an icon, a preloaded
 *   project name, a real creative brief, and at least one
 *   preloaded per-step hint with both halves filled.
 */
import { describe, it, expect } from "vitest";
import { getTemplate, getTemplates, type HubTemplate } from "./hub-templates";

function expectWellFormed(t: HubTemplate) {
  expect(t.key).toBeTruthy();
  expect(t.name).toBeTruthy();
  expect(t.blurb).toBeTruthy();
  expect(t.icon).toBeTruthy();
  expect(t.projectName).toBeTruthy();
  expect(t.concept.length).toBeGreaterThan(40);
  expect(t.preload.length).toBeGreaterThan(0);
  for (const p of t.preload) {
    expect(p.step).toBeTruthy();
    expect(p.hint).toBeTruthy();
  }
}

describe("the learn shelf", () => {
  it("carries three starters: the two originals plus skill-sprint", () => {
    expect(getTemplates("learn").map((t) => t.key)).toEqual([
      "creator-basics",
      "copyright-crash",
      "skill-sprint",
    ]);
  });

  it("skill-sprint is a 7-day course starter preloaded into Academy + Guides", () => {
    const sprint = getTemplate("learn", "skill-sprint")!;
    expectWellFormed(sprint);
    expect(sprint.name).toBe("Skill Sprint");
    expect(sprint.concept).toContain("7-day");
    expect(sprint.preload.map((p) => p.step)).toEqual(["academy", "guides"]);
  });
});

describe("the business shelf", () => {
  it("carries three starters: the two originals plus client-welcome-kit", () => {
    expect(getTemplates("business").map((t) => t.key)).toEqual([
      "llc-pack",
      "presskit-build",
      "client-welcome-kit",
    ]);
  });

  it("client-welcome-kit preloads the welcome video, the press kit, and the booking paperwork", () => {
    const kit = getTemplate("business", "client-welcome-kit")!;
    expectWellFormed(kit);
    expect(kit.name).toBe("Client Welcome Kit");
    expect(kit.preload.map((p) => p.step)).toEqual(["video", "presskit", "contracts"]);
    expect(kit.preload[0]!.hint).toContain("welcome");
    expect(kit.preload[2]!.hint).toContain("Booking");
  });
});

describe("every starter on both shelves is well-formed", () => {
  it("no blank briefs, no empty preloads, no missing icons", () => {
    for (const t of [...getTemplates("learn"), ...getTemplates("business")]) {
      expectWellFormed(t);
    }
  });
});
