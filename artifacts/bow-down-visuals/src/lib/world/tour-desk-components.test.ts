import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const desk = readFileSync(
  resolve(process.cwd(), "src/components/world/native/TourDesk.tsx"),
  "utf-8",
);
const panel = readFileSync(
  resolve(process.cwd(), "src/components/world/StationPanel.tsx"),
  "utf-8",
);

describe("TourDesk — the native Tour Planner desk (stack1600 wave 4, desk #97)", () => {
  it("is mounted at the My Studio board through a DeskDoor, beside the Setlist desk", () => {
    expect(panel).toContain('import("@/components/world/native/TourDesk")');
    const setlistAt = panel.indexOf("<SetlistDesk isLight={isLight} />");
    const tourAt = panel.indexOf("<TourDesk isLight={isLight} />");
    expect(setlistAt).toBeGreaterThan(-1);
    expect(tourAt).toBeGreaterThan(setlistAt);
    expect(panel.slice(tourAt - 400, tourAt)).toContain("DeskDoor");
  });

  it("exposes the desk's testids across every honest state", () => {
    for (const id of [
      "world-tour-desk",
      "world-tour-desk-failed",
      "world-tour-desk-empty",
      "world-tour-desk-composer",
      "world-tour-desk-city",
      "world-tour-desk-venue",
      "world-tour-desk-show-date",
      "world-tour-desk-notes",
      "world-tour-desk-save",
      "world-tour-desk-optimizer",
      "world-tour-desk-home-base",
      "world-tour-desk-crew",
      "world-tour-desk-optimize",
      "world-tour-desk-plan",
    ]) {
      expect(desk, id).toContain(`data-testid="${id}"`);
    }
    expect(desk).toContain("data-testid={`world-tour-desk-item-${d.id}`}");
    // A failed read is an honest failure with a way back — never
    // the empty-tour words.
    expect(desk).toContain("worldDeskRemainder.tourLoadFailed");
    expect(desk).toContain("worldDeskRemainder.tourEmpty");
  });

  it("rides the shared CRUD rails with the page's verbs", () => {
    expect(desk).toContain("TOUR_DATES_PATH");
    expect(desk).toContain('method: editingId ? "PUT" : "POST"');
    expect(desk).toContain('method: "DELETE"');
    expect(desk).toContain("buildTourDatePayload(draft)");
    expect(desk).toContain("useDeskAuthHeaders");
  });

  it("optimizes only through the confirmed spend path at the registry quote", () => {
    expect(desk).toContain("useConfirmedApi");
    expect(desk).toContain("confirmedFetch(TOUR_OPTIMIZE_PATH");
    expect(desk).toContain("overrideCost: TOUR_OPTIMIZE_COST");
    expect(desk).toContain("overrideFeature: TOUR_OPTIMIZE_FEATURE");
    expect(desk).toContain("buildOptimizePayload(dates");
    // The price is never a desk-local literal — it renders from
    // the seam constant everywhere it appears.
    expect(desk).not.toMatch(/overrideCost:\s*\d/);
    expect(desk).not.toMatch(/\b300\s*(Visual Bucs|Bucs)/);
    expect(desk).toContain("TOUR_OPTIMIZE_COST.toLocaleString(i18n.language)");
    // Out of Bucs names the way back: the Treasury packs desk.
    expect(desk).toContain("worldDeskRemainder.tourOutOfCredits");
  });

  it("carries the page's estimate honesty + plan discipline", () => {
    expect(desk).toContain("worldDeskRemainder.tourDisclaimer");
    expect(desk).toContain("worldDeskRemainder.tourDisclaimer");
    expect(desk).toContain("loadTourPlan");
    expect(desk).toContain("saveTourPlan");
    expect(desk).toContain("clearTourPlan");
    expect(desk).toContain("planOfResponse(data, dates.map((d) => d.id))");
  });

  it("renders in both theme branches and never links out of the World", () => {
    expect(desk).toContain('isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"');
    expect(desk).toContain("bdv-touch-target");
    expect(desk).not.toMatch(/<a\s/);
    expect(desk).not.toContain("window.open");
    expect(desk).not.toContain('href="/tour"');
    expect(desk).not.toContain('to="/tour"');
  });
});
