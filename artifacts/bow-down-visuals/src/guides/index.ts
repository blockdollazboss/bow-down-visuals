import type { PageGuide } from "./types";
import { dashboardGuide } from "./dashboard";
import { makeVideoGuide } from "./make-video";
import { makeSongGuide } from "./make-song";
import { artistVaultGuide } from "./artist-vault";
import { promoClipGuide } from "./promo-clip";
import { thumbnailGuide } from "./thumbnail";
import { videoEditorGuide } from "./video-editor";
import { pricingGuide } from "./pricing";
import { showFinderGuide } from "./show-finder";
import { brandDealFinderGuide } from "./brand-deals";
export { ONBOARDING_TOUR } from "./onboarding";
export type { GuideStep, PageGuide, OnboardingStop } from "./types";

const GUIDES: PageGuide[] = [
  dashboardGuide,
  makeVideoGuide,
  makeSongGuide,
  artistVaultGuide,
  promoClipGuide,
  thumbnailGuide,
  videoEditorGuide,
  pricingGuide,
  showFinderGuide,
  brandDealFinderGuide,
];

/** Normalize a path for matching: strip trailing slash, ignore query/hash. */
function normalize(path: string): string {
  return path.split("?")[0].split("#")[0].replace(/\/+$/, "") || "/";
}

/** Find the guide for a route, or null if this page has no dedicated guide. */
export function getGuideForRoute(path: string): PageGuide | null {
  const n = normalize(path);
  return GUIDES.find((g) => normalize(g.route) === n) ?? null;
}
