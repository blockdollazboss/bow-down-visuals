/**
 * AI Guide Mode — guide definition types.
 *
 * A PageGuide is an ordered list of coach steps for one page. Each step can
 * point at a target element two ways:
 *  - `target`: a CSS selector (e.g. 'main h1', '[aria-label="Inspector"]')
 *  - `targetText`: visible text to find (e.g. "Song Setup") — the runtime
 *    searches headings, buttons, labels and links for a case-insensitive
 *    substring match. This survives restyling better than selectors.
 *
 * If no target resolves, the step still shows — the coach card centers on
 * screen instead of spotlighting an element.
 */

export interface GuideStep {
  /** CSS selector for the element to spotlight. Optional. */
  target?: string;
  /** Visible text to find on the page ("Song Setup"). Optional. */
  targetText?: string;
  /** Short coaching headline shown on the card. */
  title: string;
  /** What this section does and what to do here — 1-3 sentences. */
  body: string;
  /** Optional pro tip shown in a gold callout. */
  tip?: string;
  /** Prefilled question for "Ask Thy Cheat Code". Defaults to title-based. */
  askPrompt?: string;
  /** If true, navigating to this route starts this guide's tour. */
  navigateTo?: string;
}

export interface PageGuide {
  /** Route path this guide belongs to, e.g. "/dashboard". */
  route: string;
  /** Friendly page name used in progress + welcome copy. */
  pageName: string;
  /** One-line description for the generic fallback card. */
  summary: string;
  /** Ordered coaching steps. */
  steps: GuideStep[];
}

/** Cross-page onboarding tour step — a PageGuide step plus the route to visit. */
export interface OnboardingStop {
  route: string;
  pageName: string;
  step: GuideStep;
}
