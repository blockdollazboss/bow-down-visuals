/* ─── Dashboard section resilience (owner-approved fix, Oct 19 2026) ──
   The dashboard loads four sections from four endpoints — projects,
   sponsor deals, credit history (usage), and the streak off the bonus
   status. The old loader settled them in ONE Promise.allSettled and
   flipped a single page-wide `loadError` if ANY of them rejected or
   answered non-OK: one flaky endpoint (the staging box waking, one
   slow query) replaced the ENTIRE dashboard with a "Couldn't load
   your dashboard." card, throwing away the sections that had loaded
   fine. All four endpoints were verified alive the day the owner hit
   it — the page design was the bug.

   This module is the seam the page drives: each section carries its
   own loading/ok/failed state, settles independently, and retries
   independently. The laws it encodes:

   - A failed section is NEVER an empty section. It renders its own
     failure note, in its own area, with its own Retry — the
     error-vs-empty discipline that made the old code fail closed
     stays, just scoped to the section that actually failed.
   - The full-page error card is reserved for a TOTAL failure: all
     four sections failed (e.g. the server is unreachable). Anything
     less renders the page with per-section notes.
   - A retry refetches only what it names: one section's Retry
     refetches that section alone; the full-page card's Try again
     refetches the failed set (which, on that path, is all four). */

export type DashboardSectionKey = "projects" | "deals" | "usage" | "streak";

export const DASHBOARD_SECTION_KEYS: readonly DashboardSectionKey[] = [
  "projects",
  "deals",
  "usage",
  "streak",
];

export type DashboardSectionStatus = "loading" | "ok" | "failed";

export type DashboardSectionStates = Record<DashboardSectionKey, DashboardSectionStatus>;

/** Every section starts in flight — the page shows skeletons until
 *  each section settles on its own. */
export function initialDashboardSectionStates(): DashboardSectionStates {
  return { projects: "loading", deals: "loading", usage: "loading", streak: "loading" };
}

/** Mark one section in flight again (its Retry was tapped). The other
 *  sections' states — and their already-rendered data — are untouched. */
export function markDashboardSectionLoading(
  states: DashboardSectionStates,
  key: DashboardSectionKey,
): DashboardSectionStates {
  return { ...states, [key]: "loading" };
}

/** Fold one section's outcome into the state map. Only that section's
 *  entry changes; a sibling's success or failure is never rewritten. */
export function settleDashboardSection(
  states: DashboardSectionStates,
  key: DashboardSectionKey,
  ok: boolean,
): DashboardSectionStates {
  return { ...states, [key]: ok ? "ok" : "failed" };
}

/** The per-section verdict for a settled fetch, in the exact terms the
 *  old page-wide check used: a rejected fetch OR a non-OK response is
 *  a failure; anything else is a load. (Body PARSING never downgrades
 *  a section — an OK answer whose payload is malformed shapes to the
 *  section's empty data, exactly as the page always parsed it.) */
export function dashboardSectionStatusFromSettled(
  result: PromiseSettledResult<{ ok: boolean }>,
): DashboardSectionStatus {
  return result.status === "fulfilled" && result.value.ok ? "ok" : "failed";
}

/** True while any section is still in flight. The skeleton rule the
 *  page has always had: while ALL sections are loading, every section
 *  area shows its skeleton — nothing renders half-shaped. */
export function anyDashboardSectionLoading(states: DashboardSectionStates): boolean {
  return DASHBOARD_SECTION_KEYS.some((k) => states[k] === "loading");
}

/** The ONLY state in which the full-page "Couldn't load your
 *  dashboard." card may render: every section failed. One, two or
 *  three failures render the page with per-section notes instead. */
export function allDashboardSectionsFailed(states: DashboardSectionStates): boolean {
  return DASHBOARD_SECTION_KEYS.every((k) => states[k] === "failed");
}

/** Which sections a retry must refetch. Naming one section refetches
 *  that section alone — never its siblings. Naming none refetches the
 *  failed set (on the full-page card's path that is all four). */
export function dashboardSectionsToRefetch(
  states: DashboardSectionStates,
  only?: DashboardSectionKey,
): DashboardSectionKey[] {
  if (only) return [only];
  return DASHBOARD_SECTION_KEYS.filter((k) => states[k] === "failed");
}
