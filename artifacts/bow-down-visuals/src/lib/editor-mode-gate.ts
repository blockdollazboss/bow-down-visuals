/**
 * Editor mode-gate decisions — Stack-100 #3 Lane 6 (mode gating).
 *
 * The editor's one honest gate rule: whatever a mode hides or locks must
 * be VISIBLE as a mode/tier gate with its reason, never a silently
 * missing feature; and switching to the mode that unlocks a gate must
 * actually unlock it. These pure helpers are the single decision point
 * the page, rails, and Music Studio all consult, so the rule cannot
 * drift between surfaces.
 *
 * Mode here is the Turbo ("simple") / Advanced display preference from
 * UserModeContext — a user pick, not a plan tier. The one rank-flavoured
 * exception is the editor's own Pro switch, which follows gate stars
 * (lib/creator-level.ts §3); proSwitchShowsUnlocked pins its behaviour.
 */

/** "advanced" when the tab is gated behind Advanced mode, else null. */
export function modeGateForTab(
  isSimple: boolean,
  tab: string,
  simpleVisibleTabs: readonly string[],
): "advanced" | null {
  return isSimple && !simpleVisibleTabs.includes(tab) ? "advanced" : null;
}

export type MusicStudioMode = "auto" | "manual" | "lipsync";

/**
 * The mode Music Studio actually renders. Simple (Turbo) renders the
 * AI Auto Mix surface, but the STORED mode is never rewritten — this is
 * a presentation overlay only, so returning to Advanced restores the
 * stored mode (and the user's music workflow) exactly as left.
 */
export function effectiveMusicMode(isSimple: boolean, storedMode: MusicStudioMode): MusicStudioMode {
  return isSimple ? "auto" : storedMode;
}

/** A music mode button is locked exactly when it isn't the effective one in Simple. */
export function musicModeLocked(isSimple: boolean, mode: MusicStudioMode): boolean {
  return isSimple && mode !== "auto";
}

/**
 * The top-bar Pro segment renders as a working radio when the user's
 * gate stars reach the Advanced band (Creator Level 4+) — OR when the
 * user is already in Advanced: never lock someone out of the mode they
 * are in (their Turbo segment stays clickable to leave).
 */
export function proSwitchShowsUnlocked(gateStars: number, isSimple: boolean): boolean {
  return gateStars >= 4 || !isSimple;
}
