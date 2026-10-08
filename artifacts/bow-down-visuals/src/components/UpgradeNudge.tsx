import { Link, useLocation } from "wouter";
import { Crown, ArrowLeft, Sparkles } from "lucide-react";

/* ─── UpgradeNudge — Worker 12 ────────────────────────────────────────────
   The gate block. NEVER a dead end: every "pro required" moment offers BOTH
     1. the upgrade path  → /creator-pricing?returnTo=<where they were>
     2. a way back        → returnTo (defaults to the current page)
   Mount this wherever requireTier("pro"|"elite") can 403, e.g. custom-domain
   setup, premium theme picker, AI boost over-quota, 4★+ control tooltips.  */

interface Props {
  requiredTier: "pro" | "elite";
  /** Plain-English name of the locked thing, e.g. "Custom domains". */
  feature: string;
  /** Where "back" goes. Defaults to the current location. */
  returnTo?: string;
  compact?: boolean;
}

const TIER_COPY: Record<Props["requiredTier"], { name: string; feeLine: string }> = {
  pro: { name: "Pro", feeLine: "7% fee — keep 3% more of every sale" },
  elite: { name: "Elite", feeLine: "5% fee — keep 5% more of every sale" },
};

export default function UpgradeNudge({ requiredTier, feature, returnTo, compact }: Props) {
  const [location] = useLocation();
  const back = returnTo ?? location;
  const copy = TIER_COPY[requiredTier];
  const pricingUrl = `/creator-pricing?returnTo=${encodeURIComponent(back)}`;

  return (
    <div
      className={`rounded-2xl border border-amber-400/40 bg-gradient-to-br from-amber-400/15 via-black to-black ${
        compact ? "p-4" : "p-6"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="rounded-full bg-amber-400/20 p-2">
          <Crown className="h-5 w-5 text-amber-300" />
        </div>
        <div className="min-w-0 flex-1">
          <p className={`font-black text-white ${compact ? "text-sm" : "text-lg"}`}>
            {feature} is a {copy.name} move
          </p>
          <p className="mt-1 text-sm text-white/60">
            {copy.name} unlocks it — plus {copy.feeLine}. Your earnings stay
            visible on every tier; only the pro controls are gated.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Link
              href={pricingUrl}
              className="inline-flex items-center gap-2 rounded-full bg-gradient-to-b from-amber-200 to-amber-500 px-5 py-2.5 text-sm font-black text-black transition hover:brightness-110"
            >
              <Sparkles className="h-4 w-4" /> See {copy.name} plans
            </Link>
            <Link
              href={back}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/20 px-4 py-2.5 text-sm font-semibold text-white/80 transition hover:border-white/40 hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" /> Back to what I was doing
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
