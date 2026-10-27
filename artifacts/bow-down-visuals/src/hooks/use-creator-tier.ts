import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";

export type CreatorTierName = "free" | "pro" | "elite";

export interface CreatorTierState {
  tier: CreatorTierName;
  feePct: string;
  feeBps: number;
  status: string;
  currentPeriodEnd: string | null;
}

/* ─── useCreatorTier — the ONE source of truth for tier display ──────────
   Payfix upgrade-path (Oct 26): after a Pro purchase the /creator-pricing
   badge said PRO while the sidebar still said "free plan" — the badge
   read GET /creator-tiers/me (creator_subscriptions) and the sidebar read
   the legacy profiles.plan column. Every tier display now goes through
   this hook → that endpoint → resolveCreatorTier(), so the sidebar, the
   pricing badge, and the server gates can never disagree.              */
export function useCreatorTier(): CreatorTierState | null {
  const { user, getAccessToken } = useAuth();
  const [me, setMe] = useState<CreatorTierState | null>(null);

  useEffect(() => {
    if (!user) {
      setMe(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/creator-tiers/me", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.ok && !cancelled) setMe(await res.json());
      } catch {
        /* display degrades to the caller's fallback rather than crashing */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, getAccessToken]);

  return me;
}
