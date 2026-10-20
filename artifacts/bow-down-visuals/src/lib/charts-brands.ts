/* ─── Charts "For Brands" tab — the shaping seam ────────────────────────
   The /charts page's For Brands tab is the brand-facing view of the
   charts: GET /api/discovery/brands returns the top public creators
   by audience PLUS the scouting fields a brand actually hires on —
   each creator's top genre and how much published work stands behind
   the audience (track_count / video_count). The generic CreatorLite
   card type does not carry those fields, so the tab used to drop
   them on the floor; this seam types them and shapes the one stats
   line the cards render, kept out of the page so the DTO discipline
   is unit-testable:
   - only fields the server actually sent are rendered — a missing
     genre or count is omitted, never zero-filled or guessed (a real
     0 count the server sent DOES render: no published tracks yet is
     scouting information, not an absence);
   - outreach rides rails that already exist (the doors below); the
     tab builds no messaging or payment system of its own, and the
     briefs board's no-money note (lib/ugc-ads UGC_PAYMENT_NOTE)
     travels with the doors. */

import type { CreatorLite } from "@/components/discovery/cards";

/** A /api/discovery/brands row: the chart card's fields plus the
 *  endpoint's scouting fields (all optional — read defensively). */
export interface BrandCreatorLite extends CreatorLite {
  top_genre?: string | null;
  track_count?: number | null;
  video_count?: number | null;
}

/** The scouting stats line for one brand card, in reading order:
 *  top genre, published tracks, published videos. Empty when the
 *  server sent none of them — the card then shows no strip at all. */
export function brandScoutStats(creator: BrandCreatorLite): string[] {
  const parts: string[] = [];
  if (typeof creator.top_genre === "string" && creator.top_genre.trim()) {
    parts.push(creator.top_genre.trim());
  }
  if (typeof creator.track_count === "number" && Number.isFinite(creator.track_count)) {
    parts.push(`${creator.track_count} ${creator.track_count === 1 ? "track" : "tracks"}`);
  }
  if (typeof creator.video_count === "number" && Number.isFinite(creator.video_count)) {
    parts.push(`${creator.video_count} ${creator.video_count === 1 ? "video" : "videos"}`);
  }
  return parts;
}

/** The link doors of the tab's outreach panel — every one an
 *  existing, member-locked rail (the site's gate sends guests to
 *  sign-in first, exactly like the tab's original Brand Deals CTA):
 *  the Brand Deals hub (finder + pitch kit + sponsors marketplace)
 *  and the Promote page's UGC briefs board. The takeover doors are
 *  not links — they open the shared inquiry modals (SpotlightModal /
 *  LoadingScreenModal) right on the tab, prices fetched from the
 *  server's own offer endpoints by the modals themselves. */
export const BRAND_OUTREACH_DOORS = [
  {
    key: "brand-deals",
    href: "/brand-deals",
    title: "Brand Deals hub",
    blurb: "Find brands with creator programs, draft outreach, and browse the sponsors marketplace.",
    cta: "Open Brand Deals",
  },
  {
    key: "briefs",
    href: "/promote",
    title: "Post a UGC brief",
    blurb: "Put a brief on the board in Promote — creators claim it, make the ad, and you approve the delivery.",
    cta: "Go to Promote",
  },
] as const;
