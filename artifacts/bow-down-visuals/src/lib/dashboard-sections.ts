/* ─── Section resilience seam (owner-approved fix, Oct 19 2026) ─────
   The dashboard loads four sections from four endpoints — projects,
   sponsor deals, credit history (usage), and the streak off the bonus
   status. The old loader settled them in ONE Promise.allSettled and
   flipped a single page-wide `loadError` if ANY of them rejected or
   answered non-OK: one flaky endpoint (the staging box waking, one
   slow query) replaced the ENTIRE dashboard with a "Couldn't load
   your dashboard." card, throwing away the sections that had loaded
   fine. All four endpoints were verified alive the day the owner hit
   it — the page design was the bug.

   This module is the seam those pages drive: each section carries its
   own loading/ok/failed state, settles independently, and retries
   independently. The laws it encodes:

   - A failed section is NEVER an empty section. It renders its own
     failure note, in its own area, with its own Retry — the
     error-vs-empty discipline that made the old code fail closed
     stays, just scoped to the section that actually failed.
   - The full-page error card is reserved for a TOTAL failure: every
     section failed (e.g. the server is unreachable). Anything less
     renders the page with per-section notes.
   - A retry refetches only what it names: one section's Retry
     refetches that section alone; the full-page card's Try again
     refetches the failed set.

   The core below is generic over the section-key union; the dashboard
   specialization at the bottom is the original four-key API the
   dashboard page and its tests drive. Sibling pages (beats,
   store-dashboard) drive the SAME core with their own key sets —
   there is exactly one seam, never a copy. */

/* ── Generic core ─────────────────────────────────────────────────── */

export type SectionStatus = "loading" | "ok" | "failed";

export type SectionStates<K extends string> = Record<K, SectionStatus>;

/** Every section starts in flight — the page shows skeletons until
 *  each section settles on its own. */
export function initialSectionStates<K extends string>(keys: readonly K[]): SectionStates<K> {
  const out = {} as SectionStates<K>;
  for (const k of keys) out[k] = "loading";
  return out;
}

/** Mark one section in flight again (its Retry was tapped). The other
 *  sections' states — and their already-rendered data — are untouched.
 *  (NoInfer on the key: K is inferred from the state map alone, so a
 *  literal key widens to the page's full key union instead of
 *  narrowing the map's type.) */
export function markSectionLoading<K extends string>(
  states: SectionStates<K>,
  key: NoInfer<K>,
): SectionStates<K> {
  return { ...states, [key]: "loading" };
}

/** Fold one section's outcome into the state map. Only that section's
 *  entry changes; a sibling's success or failure is never rewritten. */
export function settleSection<K extends string>(
  states: SectionStates<K>,
  key: NoInfer<K>,
  ok: boolean,
): SectionStates<K> {
  return { ...states, [key]: ok ? "ok" : "failed" };
}

/** The per-section verdict for a settled fetch, in the exact terms the
 *  old page-wide check used: a rejected fetch OR a non-OK response is
 *  a failure; anything else is a load. (Body PARSING never downgrades
 *  a section — an OK answer whose payload is malformed shapes to the
 *  section's empty data, exactly as the page always parsed it.) */
export function sectionStatusFromSettled(
  result: PromiseSettledResult<{ ok: boolean }>,
): SectionStatus {
  return result.status === "fulfilled" && result.value.ok ? "ok" : "failed";
}

/** True while any section is still in flight. */
export function anySectionLoading<K extends string>(
  keys: readonly K[],
  states: SectionStates<K>,
): boolean {
  return keys.some((k) => states[k] === "loading");
}

/** The ONLY state in which a full-page "couldn't load" card may
 *  render: every section failed. Anything less renders the page with
 *  per-section notes instead. */
export function allSectionsFailed<K extends string>(
  keys: readonly K[],
  states: SectionStates<K>,
): boolean {
  return keys.every((k) => states[k] === "failed");
}

/** Which sections a retry must refetch. Naming one section refetches
 *  that section alone — never its siblings. Naming none refetches the
 *  failed set (on a total-failure path that is all of them). */
export function sectionsToRefetch<K extends string>(
  keys: readonly K[],
  states: SectionStates<K>,
  only?: NoInfer<K>,
): K[] {
  if (only) return [only];
  return keys.filter((k) => states[k] === "failed");
}

/* ── Dashboard specialization (the original four sections) ────────── */

export type DashboardSectionKey = "projects" | "deals" | "usage" | "streak";

export const DASHBOARD_SECTION_KEYS: readonly DashboardSectionKey[] = [
  "projects",
  "deals",
  "usage",
  "streak",
];

export type DashboardSectionStatus = SectionStatus;

export type DashboardSectionStates = SectionStates<DashboardSectionKey>;

/** Every section starts in flight — the page shows skeletons until
 *  each section settles on its own. */
export function initialDashboardSectionStates(): DashboardSectionStates {
  return initialSectionStates(DASHBOARD_SECTION_KEYS);
}

/** Mark one section in flight again (its Retry was tapped). The other
 *  sections' states — and their already-rendered data — are untouched. */
export function markDashboardSectionLoading(
  states: DashboardSectionStates,
  key: DashboardSectionKey,
): DashboardSectionStates {
  return markSectionLoading(states, key);
}

/** Fold one section's outcome into the state map. Only that section's
 *  entry changes; a sibling's success or failure is never rewritten. */
export function settleDashboardSection(
  states: DashboardSectionStates,
  key: DashboardSectionKey,
  ok: boolean,
): DashboardSectionStates {
  return settleSection(states, key, ok);
}

/** The per-section verdict for a settled fetch, in the exact terms the
 *  old page-wide check used: a rejected fetch OR a non-OK response is
 *  a failure; anything else is a load. (Body PARSING never downgrades
 *  a section — an OK answer whose payload is malformed shapes to the
 *  section's empty data, exactly as the page always parsed it.) */
export function dashboardSectionStatusFromSettled(
  result: PromiseSettledResult<{ ok: boolean }>,
): DashboardSectionStatus {
  return sectionStatusFromSettled(result);
}

/** True while any section is still in flight. The skeleton rule the
 *  page has always had: while ALL sections are loading, every section
 *  area shows its skeleton — nothing renders half-shaped. */
export function anyDashboardSectionLoading(states: DashboardSectionStates): boolean {
  return anySectionLoading(DASHBOARD_SECTION_KEYS, states);
}

/** The ONLY state in which the full-page "Couldn't load your
 *  dashboard." card may render: every section failed. One, two or
 *  three failures render the page with per-section notes instead. */
export function allDashboardSectionsFailed(states: DashboardSectionStates): boolean {
  return allSectionsFailed(DASHBOARD_SECTION_KEYS, states);
}

/** Which sections a retry must refetch. Naming one section refetches
 *  that section alone — never its siblings. Naming none refetches the
 *  failed set (on the full-page card's path that is all four). */
export function dashboardSectionsToRefetch(
  states: DashboardSectionStates,
  only?: DashboardSectionKey,
): DashboardSectionKey[] {
  return sectionsToRefetch(DASHBOARD_SECTION_KEYS, states, only);
}
