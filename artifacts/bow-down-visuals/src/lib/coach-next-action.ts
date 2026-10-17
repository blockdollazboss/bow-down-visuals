/* ── Coach next action (DE-19) ─────────────────────────────────────────────
   The monetization coach's plan now carries ONE structured next
   action, derived server-side from the creator's real catalog state
   (songs → releases → store → memberships → promote). The page
   renders it as the plan's PRIMARY button; the old static trio
   becomes secondary. When a plan predates the field (or it goes
   missing), the primary falls back to the trio's historic lead —
   Distribute — so the plan always has exactly one primary move. */

export interface CoachNextAction {
  label: string;
  href: string;
}

export interface CoachCreatorState {
  songs: number;
  latestSongTitle: string | null;
  releases: number;
  submittedReleases: number;
  storeProducts: number;
  membershipTiers: number;
  earningsCents: number;
  tipsVb: number;
}

export const FALLBACK_PRIMARY_ACTION: CoachNextAction = {
  label: "Distribute music",
  href: "/distribute",
};

export function primaryActionFor(plan: {
  nextAction?: CoachNextAction | null;
} | null | undefined): CoachNextAction {
  const a = plan?.nextAction;
  if (a && typeof a.label === "string" && a.label.trim() && typeof a.href === "string" && a.href.startsWith("/")) {
    return { label: a.label, href: a.href };
  }
  return FALLBACK_PRIMARY_ACTION;
}

/* One honest line proving the coach read the catalog — rendered
   above the plan so the advice visibly comes from the creator's
   actual state, not a generic template. */
export function creatorStateSummary(state: CoachCreatorState | null | undefined): string | null {
  if (!state) return null;
  const dollars = (c: number) => `$${(c / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  const parts = [
    `${state.songs} song${state.songs === 1 ? "" : "s"} in your library`,
    `${state.releases} release${state.releases === 1 ? "" : "s"}`,
    `${state.storeProducts} store product${state.storeProducts === 1 ? "" : "s"}`,
    `${state.membershipTiers} membership tier${state.membershipTiers === 1 ? "" : "s"}`,
    `${dollars(state.earningsCents)} earned here`,
  ];
  return parts.join(" · ");
}
