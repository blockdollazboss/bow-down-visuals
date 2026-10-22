/* ─── The Reverse Door — shared entry contract (owner, 2026-10-17) ──────
   "Every page on my website should have something to click to take you
   into the VR world."

   One door, two surfaces, both defined here so the wording, target and
   visibility rule can never drift apart:
   - the shell control (components/EnterWorldButton.tsx), mounted in
     AppShell beside the floating theme toggle — every route, guests
     included;
   - the contextual action on artist profiles ("Visit in the World",
     in the ProfileActions row beside Follow / Tip / Share).

   Both land the visitor in the World at /world — arriving on the
   King's Plaza in front of the palace (the front door since Open
   World Phase 1), with the King's Hall one walk through its open
   doors and Creator Rooms through the plaza's arch. */

export const WORLD_ROUTE = "/world";

export const ENTER_WORLD_LABEL = "Enter the World";

/* Approved wording for the contextual door on artist profiles. */
export const VISIT_WORLD_LABEL = "Visit in the World";

export const ENTER_WORLD_TEST_ID = "enter-world-button";
export const PROFILE_VISIT_WORLD_TEST_ID = "profile-visit-world";

/** True when `pathname` is the World route itself (query/hash tolerated). */
export function isWorldRoute(pathname: string): boolean {
  const path = pathname.split(/[?#]/)[0];
  return path === WORLD_ROUTE || path.startsWith(`${WORLD_ROUTE}/`);
}

/**
 * The shell door shows on EVERY route except the World itself — and it
 * is never auth-gated: the hall admits look-only guests, so signed-out
 * visitors get the door too. There is deliberately no other condition.
 */
export function shouldShowWorldEntry(pathname: string): boolean {
  return !isWorldRoute(pathname);
}

/* Shell furniture styling, mirroring the FloatingThemeToggle's classes
   (gold on smoked glass in dark; bronze on white glass in light) so the
   door reads as part of the shell in both themes. Fixed top-left,
   directly under the theme toggle's default spot. */
export const ENTER_WORLD_CLASSNAME =
  "fixed left-4 top-[4.25rem] z-[9998] flex items-center gap-2 rounded-full border border-primary/30 bg-black/60 px-4 py-2 text-sm font-bold text-primary shadow-lg backdrop-blur-md transition hover:scale-105 hover:bg-black/80 light:bg-white/80 light:text-[#7A5A12] light:hover:bg-white";
