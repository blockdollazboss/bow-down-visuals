/* ─── Viral-spike response kit builder (orphan wave) ────────────────────
   Turns a PROVEN spike verdict (lib/viral-spike.ts) into a ready kit of
   suggested follow-ups. Hard rules:

   - NEVER auto-posts, auto-pins, auto-anything. Every step is a link the
     creator chooses to open; `requires_creator_action` is always true.
   - Steps only LINK to existing tools, in the site's canonical
     CREATE → BRAND → PROMOTE → MONEY order. Nothing is reimplemented.
   - The headline is built ONLY from the verdict's measured numbers.
     A first surge / silent baseline says so in plain words — no
     invented multiplier ever reaches the creator. */

import type { SpikeVerdict } from "./viral-spike";

export type SpikeContentKind = "showcase" | "short";

export interface SpikeContentRef {
  kind: SpikeContentKind;
  id: string;
  title: string;
  /** Showcase slug, when the content is a showcase item. */
  slug?: string | null;
}

export type KitStage = "create" | "brand" | "promote" | "money";

export interface KitStep {
  stage: KitStage;
  /** Stable action key for FE rendering / tests. */
  action: string;
  title: string;
  detail: string;
  /** Existing site route the creator opens to do this step. */
  href: string;
  /** The existing tool waiting at that route — named, never reimplemented. */
  tool: string;
  /** Always true: the kit suggests, the creator acts. */
  requires_creator_action: true;
}

export interface ViralSpikeKit {
  content: SpikeContentRef;
  /** Plain-words summary built only from measured verdict numbers. */
  headline: string;
  basis: "measured_multiplier" | "baseline_silent" | "first_surge";
  steps: KitStep[];
  /** The kit itself never performs any step. */
  auto_actions_taken: 0;
}

function fmtCount(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

function fmtHours(h: number): string {
  return h >= 10 ? String(Math.round(h)) : String(Math.round(h * 10) / 10);
}

export function spikeHeadline(content: SpikeContentRef, verdict: Extract<SpikeVerdict, { status: "spike" }>): string {
  const n = verdict.numbers;
  const gain = `+${fmtCount(n.recentGain)} views in about ${fmtHours(n.recentSpanHours)}h`;
  switch (verdict.basis) {
    case "measured_multiplier":
      return `"${content.title}" is spiking: ${gain} — about ${Math.round(n.multiplier!)}× its usual pace.`;
    case "baseline_silent":
      return `"${content.title}" is spiking: ${gain} after a quiet stretch with no views in its baseline window.`;
    case "first_surge":
      return `"${content.title}" is surging: ${gain}. This is its first surge — there is no earlier baseline to compare against yet.`;
  }
}

/** Build the kit, or null when the verdict is not a proven spike —
 *  no kit is ever built on insufficient or flat data. */
export function buildViralSpikeKit(
  content: SpikeContentRef,
  verdict: SpikeVerdict,
): ViralSpikeKit | null {
  if (verdict.status !== "spike") return null;

  const contentHref =
    content.kind === "showcase" && content.slug ? `/showcase/${content.slug}` : "/showcase";
  const sequelPrompt =
    `Sequel to "${content.title}" — same hook, new twist: answer the top comment, ` +
    `show the part nobody saw, or take the idea one step further while the original is hot.`;

  const steps: KitStep[] = [
    {
      stage: "create",
      action: "sequel",
      title: "Make the follow-up now",
      detail: sequelPrompt,
      href: "/video-editor",
      tool: "Video Editor (Visual Vibes)",
      requires_creator_action: true,
    },
    {
      stage: "create",
      action: "caption_variants",
      title: "Fresh captions for the repost",
      detail:
        "Generate caption variants and a sharper hook for sharing the spiking post again — same content, new doorway in.",
      href: "/hooks?tab=styler",
      tool: "Hook Studio — Caption Styler",
      requires_creator_action: true,
    },
    {
      stage: "brand",
      action: "branding_pass",
      title: "Brand the moment",
      detail:
        "Make sure the thumbnail, watermark and channel branding are on point — a spike sends new eyes to everything you have made.",
      href: "/branding-kit",
      tool: "Branding Kit",
      requires_creator_action: true,
    },
    {
      stage: "promote",
      action: "pin",
      title: "Pin it where new fans land",
      detail:
        "Open the post and pin it on your profile/showcase so the wave of new visitors hits your best-performing content first.",
      href: contentHref,
      tool: "Showcase item page — pin",
      requires_creator_action: true,
    },
    {
      stage: "promote",
      action: "promote_push",
      title: "Push it further",
      detail:
        "Build promo posts around the spike — quote the numbers the post actually earned and ride the momentum while it lasts.",
      href: "/promote",
      tool: "Promote — Promo Content Generator",
      requires_creator_action: true,
    },
    {
      stage: "money",
      action: "coach_next_step",
      title: "Turn views into money",
      detail:
        "The Monetization Coach maps the next money step for a post with this kind of reach — offers, memberships, store links.",
      href: "/coach",
      tool: "Monetization Coach",
      requires_creator_action: true,
    },
    {
      stage: "money",
      action: "check_earnings",
      title: "Check what it earned",
      detail: "See what the spike has actually paid so far before deciding how hard to push it.",
      href: "/earnings",
      tool: "Earnings",
      requires_creator_action: true,
    },
  ];

  return {
    content,
    headline: spikeHeadline(content, verdict),
    basis: verdict.basis,
    steps,
    auto_actions_taken: 0,
  };
}
