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
   pricing badge, and the server gates can never disagree.

   stack600 plan-tier-change: the fetch RETRIES transport/5xx failures
   (3 attempts, short backoff). Gate Pass 1 (Oct 28) caught the badge
   flipping free ↔ pro across pages and loads: the sidebar persists
   across route changes, so ONE failed /me fetch used to poison the
   badge for the whole session (null → legacy-column fallback), while a
   luckier load on another page showed the true tier. A blip now heals
   itself instead of sticking.                                          */
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
      const delays = [0, 400, 1200];
      for (let attempt = 0; attempt < delays.length; attempt++) {
        if (attempt > 0) {
          await new Promise((r) => setTimeout(r, delays[attempt]));
          if (cancelled) return;
        }
        try {
          const token = await getAccessToken();
          const res = await fetch("/api/creator-tiers/me", {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          if (res.ok) {
            const data = (await res.json()) as CreatorTierState;
            if (!cancelled) setMe(data);
            return;
          }
          if (res.status < 500) return; // a definitive answer — no retry
        } catch {
          /* transport blip — fall through to the next attempt */
        }
      }
      /* All attempts failed: leave me null (the caller's neutral
         loading state) rather than inventing a tier. */
    })();
    return () => {
      cancelled = true;
    };
  }, [user, getAccessToken]);

  return me;
}
