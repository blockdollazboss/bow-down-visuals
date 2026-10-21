import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Crown } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

/* ─── TierBadge — Worker 12 ────────────────────────────────────────────────
   Shows the creator's current tier + fee rate. ALWAYS links to the upgrade
   page (link-graph: dashboard badge → upgrade). Mount in seller dashboards,
   shop settings headers, anywhere the fee rate matters.                    */

interface Me {
  tier: "free" | "pro" | "elite";
  feePct: string;
  feeBps: number;
}

const TIER_STYLES: Record<Me["tier"], string> = {
  free: "border-white/20 bg-white/5 text-white/70",
  pro: "border-amber-400/50 bg-amber-400/10 text-amber-200",
  elite: "border-amber-300 bg-gradient-to-r from-amber-300/25 to-yellow-500/25 text-amber-100",
};

export default function TierBadge({ showFee = true }: { showFee?: boolean }) {
  const { user, getAccessToken } = useAuth();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/creator-tiers/me", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.ok) setMe(await res.json());
      } catch {
        /* badge degrades to Free rather than crashing */
      }
    })();
  }, [user, getAccessToken]);

  const tier = me?.tier ?? "free";
  const label = tier === "free" ? "Free" : tier === "pro" ? "Pro" : "Elite";

  return (
    <Link
      href="/creator-pricing"
      title={`${label} tier — see plans & upgrade`}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-black uppercase tracking-wider transition hover:brightness-125 ${TIER_STYLES[tier]}`}
    >
      <Crown className="h-3.5 w-3.5" />
      {label}
      {showFee && me && <span className="font-semibold normal-case tracking-normal opacity-80">· {me.feePct} fee</span>}
    </Link>
  );
}
