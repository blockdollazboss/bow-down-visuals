/**
 * First-visit onboarding tour — step config, persistence, and pure helpers.
 *
 * The tour itself is rendered by `components/OnboardingTour.tsx`. Steps are
 * defined here as data so copy/targets can be updated without touching the
 * spotlight logic. A step with no `target` renders as a centered card; a step
 * whose target selector isn't in the DOM also falls back to centered.
 */

/* ── persistence ─────────────────────────────────────────────────────── */

export const ONBOARDING_STORAGE_KEY = "bdv_onboarded";

/** Event name fired to (re)start the tour, e.g. from Settings or Help. */
export const ONBOARDING_START_EVENT = "bdv:start-tour";

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function hasCompletedOnboarding(): boolean {
  return storage()?.getItem(ONBOARDING_STORAGE_KEY) === "1";
}

export function markOnboardingComplete(): void {
  try {
    storage()?.setItem(ONBOARDING_STORAGE_KEY, "1");
  } catch {
    /* private mode etc. — the tour just won't remember; never crash the app */
  }
}

export function resetOnboarding(): void {
  try {
    storage()?.removeItem(ONBOARDING_STORAGE_KEY);
  } catch {
    /* noop */
  }
}

/** Ask the mounted tour to start from step 0 (used by Settings / Help). */
export function requestOnboardingTour(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(ONBOARDING_START_EVENT));
}

/* ── steps ───────────────────────────────────────────────────────────── */

export interface TourCta {
  label: string;
  /** Optional route the CTA navigates to before the tour dismisses. */
  href?: string;
}

export interface TourStep {
  id: string;
  title: string;
  body: string;
  /** CSS selector for the spotlight target, e.g. '[data-tour="credits"]'. */
  target?: string;
  cta?: TourCta;
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: "welcome",
    title: "Welcome to Bow Down Visuals",
    body: "This is your content creation cheat code — songs, music videos, promo clips, thumbnails, and more, all powered by AI. Take a 30-second tour.",
    cta: { label: "Show me around" },
  },
  {
    id: "credits",
    title: "Credits fuel everything",
    body: "Every AI generation costs a few credits. This badge shows your balance — top up anytime on the Pricing page.",
    target: '[data-tour="credits"]',
  },
  {
    id: "make-video",
    title: "MV",
    body: "The flagship. Turn your song or lyrics into cinematic video scenes and AI-generated clips, ready for the editor.",
    target: '[data-tour="nav-make-video"]',
  },
  {
    id: "video-editor",
    title: "Video Editor",
    body: "This is where your projects live — assemble scenes, add captions, transitions and effects, then export your final video.",
    target: '[data-tour="nav-video-editor"]',
  },
  {
    id: "artist-vault",
    title: "Artist Vault",
    body: "Your creative identity. Save your artist's look, style, and brand rules once — every AI tool uses them automatically.",
    target: '[data-tour="card-artist-vault"]',
  },
  {
    id: "explore",
    title: "Explore everything",
    body: "This is just the start — hooks, thumbnails, monetization coaching, distribution, merch, and dozens more AI tools live in the sidebar.",
  },
  {
    id: "done",
    title: "You're ready — go create",
    body: "Pick a tool and make something great. You can replay this tour anytime from Settings.",
    cta: { label: "Let's go" },
  },
];

/* ── tooltip placement (pure, unit-tested) ───────────────────────────── */

export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export type TooltipAnchor = "below" | "above" | "center" | "sheet";

export interface TooltipPlacement {
  top: number;
  left: number;
  anchor: TooltipAnchor;
}

const GAP = 14;
const MARGIN = 16;

/** Clamp a number into [min, max]. */
function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/**
 * Decide where the tooltip card goes relative to a spotlight target.
 *
 * - Mobile viewports (< 640px): bottom sheet.
 * - No target / target off-screen: centered card.
 * - Otherwise: below the target when it fits, above when that fits,
 *   centered as a last resort. Horizontally centered on the target,
 *   clamped inside the viewport.
 */
export function computeTooltipPosition(
  target: Box | null,
  tooltip: { width: number; height: number },
  viewport: Viewport,
): TooltipPlacement {
  const { width: vw, height: vh } = viewport;
  const { width: tw, height: th } = tooltip;

  if (vw < 640) {
    return {
      top: Math.max(MARGIN, vh - th - 12),
      left: 12,
      anchor: "sheet",
    };
  }

  if (!target) {
    return {
      top: Math.max(MARGIN, (vh - th) / 2),
      left: Math.max(MARGIN, (vw - tw) / 2),
      anchor: "center",
    };
  }

  const centeredLeft = clamp(
    target.left + target.width / 2 - tw / 2,
    MARGIN,
    Math.max(MARGIN, vw - tw - MARGIN),
  );

  const belowTop = target.top + target.height + GAP;
  if (belowTop + th <= vh - MARGIN) {
    return { top: belowTop, left: centeredLeft, anchor: "below" };
  }

  const aboveTop = target.top - th - GAP;
  if (aboveTop >= MARGIN) {
    return { top: aboveTop, left: centeredLeft, anchor: "above" };
  }

  return {
    top: Math.max(MARGIN, (vh - th) / 2),
    left: centeredLeft,
    anchor: "center",
  };
}
