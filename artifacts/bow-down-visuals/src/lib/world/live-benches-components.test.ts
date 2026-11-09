/**
 * Source-contract pins for the Live Desk benches (Stack 400
 * world parity, census B-11 + B-15): the benches ride the
 * 2D twins' rails through confirmedFetch at the registry
 * price, the NativeStates trio is wired on every bench, both
 * benches ride the pages' own catalog namespaces, and they
 * are mounted in the members-only Live Desks panel under
 * GamersDesk. If a future edit swaps in a raw fetch, drops a
 * state, or unmounts a bench, this file turns red before the
 * World drifts from the pages.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const FE = join(__dirname, "..", "..");

function read(rel: string): string {
  return readFileSync(join(FE, rel), "utf8");
}

const benches = read("components/world/native/LiveBenches.tsx");
const panel = read("components/world/native/LiveDesksPanel.tsx");

describe("live benches — confirmed-spend rails (World law)", () => {
  it("every charge rides confirmedFetch with the registry-priced override", () => {
    expect(benches).toContain("useConfirmedApi");
    expect(benches).toContain('confirmedFetch(SHOW_FINDER_PATH');
    expect(benches).toContain("overrideCost: cost");
    expect(benches).toContain('overrideFeature: "Show Finder"');
    expect(benches).toContain('confirmedFetch(SHOW_FINDER_PITCH_PATH');
    expect(benches).toContain("overrideCost: pitchCost");
    expect(benches).toContain('overrideFeature: "Show Pitch Draft"');
    expect(benches).toContain('confirmedFetch(GUEST_QUESTIONS_PATH');
    expect(benches).toContain('overrideFeature: t("podcast.guestQuestions.form.title")');
    // A spend confirmation declined runs nothing on any rail.
    expect(benches).toContain("if (!res) return; // spend confirmation declined");
  });

  it("402 / out_of_credits shows the Treasury line on both benches", () => {
    expect(benches).toContain('res.status === 402');
    expect(benches).toContain('"out_of_credits"');
    expect(benches).toContain('t("worldBenches300.outOfBucs", { feature: "Show Finder" })');
    expect(benches).toContain('t("worldBenches300.outOfBucs", { feature: "Guest Questions" })');
  });

  it("payloads come from the seam builders, never hand-shaped in the component", () => {
    expect(benches).toContain("buildShowFinderPayload(");
    expect(benches).toContain("buildShowPitchPayload(");
    expect(benches).toContain("buildGuestQuestionsPayload(");
    expect(benches).toContain("showOpportunitiesOf(");
    expect(benches).toContain("showPitchOf(");
    expect(benches).toContain("guestQuestionsOf(");
  });
});

describe("live benches — NativeStates trio wired on every bench", () => {
  it("imports the trio", () => {
    expect(benches).toContain("NativeEmptyState, NativeErrorState, NativeLoadingState");
  });

  it("Show Finder: loading, error-with-retry, and the zero-match empty state", () => {
    expect(benches).toContain("<NativeLoadingState isLight={isLight} message={t(\"shows.huntingLoading\")} />");
    expect(benches).toContain("<NativeErrorState isLight={isLight} message={loadError} onRetry={() => void findShows()} />");
    expect(benches).toContain("<NativeEmptyState isLight={isLight} message={t(\"shows.noMatches\")} />");
    // The pitch sub-flow carries its own loading + error states.
    expect(benches).toContain("<NativeLoadingState isLight={isLight} message={t(\"shows.draftingPitch\")} />");
    expect(benches).toContain("onRetry={() => void draftPitch(i, opp)}");
  });

  it("Guest Questions: loading, error-with-retry, and the honesty note as the empty state", () => {
    expect(benches).toContain('<NativeLoadingState isLight={isLight} message={t("podcast.guestQuestions.form.generating")} />');
    expect(benches).toContain("<NativeErrorState isLight={isLight} message={loadError} onRetry={() => void generate()} />");
    expect(benches).toContain('<NativeEmptyState isLight={isLight} message={t("podcast.guestQuestions.form.honestyNote")} />');
  });
});

describe("live benches — the pages' own copy (no drift)", () => {
  it("Show Finder rides shows.*, Guest Questions rides podcast.guestQuestions.*", () => {
    expect(benches).toContain('t("shows.findStagesButton", { cost })');
    expect(benches).toContain('t("shows.draftPitchButton", { cost: pitchCost })');
    expect(benches).toContain('t("podcast.guestQuestions.results.copyAll")');
    expect(benches).toContain('t("podcast.guestQuestions.results.downloadTxt")');
    expect(benches).toContain("guestQuestionsPlainText(");
  });

  it("both benches carry their testid + run button", () => {
    expect(benches).toContain('data-testid="world-show-finder-bench"');
    expect(benches).toContain('data-testid="world-show-finder-run"');
    expect(benches).toContain('data-testid="world-guest-questions-bench"');
    expect(benches).toContain('data-testid="world-guest-questions-run"');
  });
});

describe("live benches — mounted in the Live Desks panel", () => {
  it("the panel imports and renders both benches after GamersDesk", () => {
    expect(panel).toContain('import { GuestQuestionsBench, ShowFinderBench } from "./LiveBenches";');
    expect(panel).toContain("<ShowFinderBench isLight={isLight} />");
    expect(panel).toContain("<GuestQuestionsBench isLight={isLight} />");
    expect(panel.indexOf("<GamersDesk isLight={isLight} />")).toBeLessThan(
      panel.indexOf("<ShowFinderBench isLight={isLight} />"),
    );
    expect(panel.indexOf("<ShowFinderBench isLight={isLight} />")).toBeLessThan(
      panel.indexOf("<GuestQuestionsBench isLight={isLight} />"),
    );
  });
});
