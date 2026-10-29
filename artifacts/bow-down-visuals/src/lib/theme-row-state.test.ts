/**
 * theme-row-state.test.ts — stack700: the Theme Song row renders
 * exactly ONE state at a time. Full matrix over the probe status
 * (probing / ready / missing / error) × the playback flags
 * (playFailed × playing). The leaking combination from the owner's
 * Oct 28 16:17 screenshot — status "missing", which used to render
 * "— coming soon" in the header AND the "Tap to retry" card in the
 * body — is pinned by name below.
 */
import { describe, it, expect } from "vitest";
import { themeRowView, type ThemeRowView } from "./theme-row-state";
import type { ThemeAvailability } from "./theme-probe";

const STATUSES: ThemeAvailability[] = ["probing", "ready", "missing", "error"];
const FLAGS = [false, true] as const;

type Row = [ThemeAvailability, boolean, boolean, ThemeRowView];

/* The complete expected matrix. "controls" rows are identical for
   probing and ready; unavailable rows ignore the playback flags
   entirely (the retry state outranks a stale play-failure note). */
const MATRIX: Row[] = [
  // probing — controls; play() rejection is the only suffix
  ["probing", false, false, { card: "controls", suffix: null, playHelp: false }],
  ["probing", false, true,  { card: "controls", suffix: null, playHelp: false }],
  ["probing", true,  false, { card: "controls", suffix: "couldnt-play", playHelp: true }],
  ["probing", true,  true,  { card: "controls", suffix: null, playHelp: false }],
  // ready — same as probing
  ["ready", false, false, { card: "controls", suffix: null, playHelp: false }],
  ["ready", false, true,  { card: "controls", suffix: null, playHelp: false }],
  ["ready", true,  false, { card: "controls", suffix: "couldnt-play", playHelp: true }],
  ["ready", true,  true,  { card: "controls", suffix: null, playHelp: false }],
  // missing — THE LEAK: retry card, and NO header suffix at all
  ["missing", false, false, { card: "retry", suffix: null, playHelp: false }],
  ["missing", false, true,  { card: "retry", suffix: null, playHelp: false }],
  ["missing", true,  false, { card: "retry", suffix: null, playHelp: false }],
  ["missing", true,  true,  { card: "retry", suffix: null, playHelp: false }],
  // error — retry card; the header names the same one state
  ["error", false, false, { card: "retry", suffix: "couldnt-load", playHelp: false }],
  ["error", false, true,  { card: "retry", suffix: "couldnt-load", playHelp: false }],
  ["error", true,  false, { card: "retry", suffix: "couldnt-load", playHelp: false }],
  ["error", true,  true,  { card: "retry", suffix: "couldnt-load", playHelp: false }],
];

describe("themeRowView — full state matrix", () => {
  it.each(MATRIX)(
    "status=%s playFailed=%s playing=%s → %o",
    (status, playFailed, playing, expected) => {
      expect(themeRowView({ status, playFailed, playing })).toEqual(expected);
    },
  );

  it("covers every probe state × playback-flag combination exactly once", () => {
    expect(MATRIX).toHaveLength(STATUSES.length * FLAGS.length * FLAGS.length);
    const keys = new Set(MATRIX.map(([s, pf, pl]) => `${s}|${pf}|${pl}`));
    expect(keys.size).toBe(MATRIX.length);
  });
});

describe("themeRowView — single-state invariants over the whole matrix", () => {
  const all = STATUSES.flatMap((status) =>
    FLAGS.flatMap((playFailed) =>
      FLAGS.map((playing) => ({ status, playFailed, playing })),
    ),
  );

  it("every combination yields exactly one card and at most one suffix", () => {
    for (const input of all) {
      const view = themeRowView(input);
      expect(["controls", "retry"]).toContain(view.card);
      expect([null, "couldnt-load", "couldnt-play"]).toContain(view.suffix);
    }
  });

  it("no combination can express a 'coming soon' claim alongside the retry card", () => {
    /* The view type has no coming-soon outcome at all; this pins the
       runtime side: whenever the retry card renders, the suffix is
       either empty (missing) or names that same failure (error). */
    for (const input of all) {
      const view = themeRowView(input);
      if (view.card === "retry") {
        expect(view.suffix).not.toBe("couldnt-play");
        expect(view.playHelp).toBe(false);
      }
    }
  });

  it("the leaking combination (missing + retry) carries no second state", () => {
    const view = themeRowView({ status: "missing", playFailed: false, playing: false });
    expect(view.card).toBe("retry");
    expect(view.suffix).toBeNull();
    expect(view.playHelp).toBe(false);
  });

  it("a play failure never stacks on an unavailable state", () => {
    for (const status of ["missing", "error"] as const) {
      const view = themeRowView({ status, playFailed: true, playing: false });
      expect(view.suffix).not.toBe("couldnt-play");
      expect(view.playHelp).toBe(false);
    }
  });
});
