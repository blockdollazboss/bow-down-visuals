/**
 * theme-row-state.ts — the ONE rendering decision for the Theme Song
 * row in the playlist widget (ThemePlayerRow, BowDownAIGuide).
 *
 * Why this exists (stack700): the row used to derive its pieces from
 * independent conditions, and they could contradict each other. The
 * header rendered "— coming soon" whenever the probe status was
 * "missing" (a label from before Lane T, when missing meant 'no song
 * chosen yet'), while the body rendered Lane T's "Tap to retry" card
 * whenever the status was unavailable — and missing ⊂ unavailable,
 * so a single failed probe showed BOTH at once (owner screenshot,
 * Oct 28 16:17: "THEME SONG — coming soon" over a "Tap to retry" card).
 *
 * Lane T settled what the statuses mean (see theme-probe.ts): the
 * theme song is ONE hard-coded track, and "missing" is the probe's
 * only failure bucket — 'not reachable right now', recoverable via
 * reprobe/backoff. There is no separate 'genuinely absent' signal
 * for the widget to render, so "coming soon" has no honest trigger
 * left and is gone. Precedence, by construction here:
 *
 *   - unavailable (missing | error) → the retry card is the state.
 *     The header adds at most the matching name for an element error
 *     ("couldnt-load"); a stale play-failure note never stacks on top.
 *   - otherwise → the normal controls; a rejected manual play() is
 *     the one suffix ("couldnt-play") plus its help line.
 *
 * Pure and DOM-free, like theme-probe.ts, so the full state matrix
 * is behaviour-tested in theme-row-state.test.ts.
 */
import type { ThemeAvailability } from "./theme-probe";

/** Which body the row renders — exactly one, always. */
export type ThemeRowCard = "controls" | "retry";

/** The header's single optional suffix — never two at once. */
export type ThemeRowSuffix = "couldnt-load" | "couldnt-play" | null;

export interface ThemeRowView {
  card: ThemeRowCard;
  suffix: ThemeRowSuffix;
  /** The "Couldn't start the theme song — tap play…" help line. */
  playHelp: boolean;
}

export interface ThemeRowInput {
  status: ThemeAvailability;
  /** The last user-initiated play() attempt was rejected. */
  playFailed: boolean;
  playing: boolean;
}

export function themeRowView({ status, playFailed, playing }: ThemeRowInput): ThemeRowView {
  const unavailable = status === "missing" || status === "error";
  if (unavailable) {
    /* The retry state owns the row. "error" names itself in the
       header; "missing" needs no suffix — the card's "Tap to retry"
       / "Checking again…" IS the state, and the old "coming soon"
       claim (nothing to do, track not out yet) would contradict it. */
    return {
      card: "retry",
      suffix: status === "error" ? "couldnt-load" : null,
      playHelp: false,
    };
  }
  const playProblem = playFailed && !playing;
  return {
    card: "controls",
    suffix: playProblem ? "couldnt-play" : null,
    playHelp: playProblem,
  };
}
