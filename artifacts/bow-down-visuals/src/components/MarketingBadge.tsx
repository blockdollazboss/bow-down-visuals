import type { ReactNode } from "react";

/**
 * MarketingBadge — the single badge system for marketing surfaces
 * (home tools, waitlist/beta tool grids, pricing plans, dashboard cards).
 *
 * Variants:
 * - popular: gold solid — the "Most Popular" callout
 * - soon:    gold outline — "Soon" / "Beta" / coming-soon states
 * - free:    muted — "Free" plans/tools
 * - muted:   soft gold pill — neutral info (e.g. "1 credit")
 * - kicker:  uppercase micro-label for section eyebrows
 */
export type MarketingBadgeVariant = "popular" | "soon" | "free" | "muted" | "kicker";

const VARIANT_CLASSES: Record<MarketingBadgeVariant, string> = {
  popular:
    "bg-primary text-black border-transparent shadow-[0_0_18px_rgba(218,165,32,0.35)]",
  soon: "bg-primary/[0.06] text-primary border-primary/35",
  free: "bg-white/[0.05] text-white/50 border-white/10",
  muted: "bg-primary/10 text-primary/90 border-primary/20",
  kicker:
    "lux-kicker bg-transparent text-primary/90 border-transparent uppercase tracking-[0.28em] text-[10px] font-bold px-1",
};

interface MarketingBadgeProps {
  variant: MarketingBadgeVariant;
  className?: string;
  children: ReactNode;
}

export function MarketingBadge({ variant, className = "", children }: MarketingBadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-bold leading-none ${VARIANT_CLASSES[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
