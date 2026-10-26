/* Site launch promo — the standing "grand opening" promotion.
   Owner-locked launch date: New Year's Day, January 1, 2027
   (2026-10-12). This constant is the promo source of truth in the
   same pattern as SPOTLIGHT_OFFER (spotlight.ts) and
   LOADING_SCREEN_OFFER (loading-screen.ts): surfaces that promote
   the launch (the hero mic band via GET /api/mic-band/promos, the
   email-list copy) read the date from here — no surface hard-codes
   its own copy of the date or the launch wording.

   launchAt is midnight at the owner's home timezone
   (America/New_York): 2027-01-01T00:00:00-05:00. */

export const SITE_LAUNCH_PROMO = {
  name: "Bow Down Visuals Launch",
  launchAt: "2027-01-01T05:00:00.000Z",
  href: "/signup",
} as const;
