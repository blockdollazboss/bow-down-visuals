/**
 * theme-player-resilience.test.ts — Lane T (stack500), theme-song player
 * resilience. Source-pin pattern (node harness cannot mount the
 * components), same as export-failure-ux.test.ts. The probe state
 * machine itself is behaviour-tested in src/lib/theme-probe.test.ts;
 * these pins lock the WIRING that puts it in front of the user:
 *
 *   1. the context drives availability through ThemeProbe (no one-shot
 *      HEAD fetch deciding the whole session, no setStatus("missing"));
 *   2. the guide reports its open state so an unavailable theme is
 *      re-probed on open + backoff while open;
 *   3. the row's unavailable state renders a tap-to-retry affordance
 *      instead of hiding every control (the old dead end).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ctx = readFileSync(
  join(__dirname, "..", "contexts", "ThemePlayerContext.tsx"),
  "utf8",
);
const guide = readFileSync(join(__dirname, "BowDownAIGuide.tsx"), "utf8");

describe("ThemePlayerContext — availability comes from ThemeProbe", () => {
  it("constructs and starts the probe controller at boot", () => {
    expect(ctx).toContain("new ThemeProbe(");
    expect(ctx).toContain("probe.start()");
  });

  it("has no one-shot status writes left (the old terminal probe)", () => {
    expect(ctx).not.toContain("setStatus(");
    expect(ctx).not.toContain('setStatus("missing")');
  });

  it("routes element errors into the probe and reloads on recovery", () => {
    expect(ctx).toContain("reportElementError()");
    expect(ctx).toContain("audio.load()");
  });

  it("exposes reprobe / setWidgetOpen / checking to the widget", () => {
    expect(ctx).toContain("reprobe");
    expect(ctx).toContain("setWidgetOpen");
    expect(ctx).toContain("checking: snap.checking");
  });
});

describe("BowDownAIGuide — widget open drives recovery", () => {
  it("reports its open state to the theme player", () => {
    expect(guide).toContain("setWidgetOpen(open)");
  });

  it("row renders a tap-to-retry affordance when unavailable", () => {
    expect(guide).toContain('aria-label="Retry theme song"');
    expect(guide).toContain("onClick={reprobe}");
    expect(guide).toContain("Tap to retry");
  });

  it("row no longer hides all controls behind the unavailable flag", () => {
    expect(guide).not.toContain("{!unavailable && (");
    /* stack700: the ternary is now the single themeRowView decision —
       its retry branch is the same always-something-to-press rule. */
    expect(guide).toContain('{view.card === "retry" ? (');
  });

  it("retry affordance shows its in-flight state while checking", () => {
    expect(guide).toContain("Checking again…");
  });
});

describe("BowDownAIGuide — the row renders exactly ONE state at a time", () => {
  /* stack700: the owner's Oct 28 16:17 screenshot showed "THEME SONG
     — coming soon" AND a "Tap to retry" card simultaneously. Cause:
     the header's "— coming soon" suffix (added pre-Lane-T, when
     "missing" meant 'no song chosen yet') is keyed on `missing`,
     while Lane T's retry card is keyed on `unavailable` — and
     missing ⊂ unavailable, so a failed probe rendered both claims.
     Lane T redefined `missing` as 'the probe just failed, recoverable'
     (see theme-probe.ts settle()); the row must derive everything it
     renders from that one state decision (lib/theme-row-state.ts). */
  it("no longer renders a 'coming soon' state for the theme row", () => {
    expect(guide).not.toContain("— coming soon</span>");
  });

  it("derives card + suffix from the single themeRowView decision", () => {
    expect(guide).toContain("themeRowView(");
    expect(guide).toContain('view.card === "retry"');
  });

  it("header suffixes are not independent additive spans keyed on raw status", () => {
    expect(guide).not.toContain("{missing && <span");
    expect(guide).not.toContain("{failed && <span");
    expect(guide).not.toContain("{playFailed && !playing && <span");
  });
});

describe("play() failures surface instead of being swallowed", () => {
  it("user-initiated play goes through attemptPlay and records rejection", () => {
    expect(ctx).toContain("attemptPlay");
    expect(ctx).toContain("setPlayFailed(true)");
    expect(ctx).toContain("playFailed");
  });

  it("the old optimistic swallow is gone from togglePlay/toggleMute", () => {
    expect(ctx).not.toContain(
      "audio.play().then(() => attachThemeAnalyser(audio)).catch(() => {});",
    );
  });

  it("the row names the failure and points at the retry", () => {
    expect(guide).toContain("— couldn't play");
    expect(guide).toContain(
      "Couldn't start the theme song — tap play to try again.",
    );
  });
});
