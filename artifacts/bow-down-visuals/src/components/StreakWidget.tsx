import { useEffect, useState } from "react";
import { Flame } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { getSupabase } from "@/lib/supabase";

/* ─── Daily streak widget ───
   Persistent streak display for the dashboard. The DailyBonusModal only
   appears when a claim is available, so the streak was invisible the rest
   of the day. This shows it always. */

export default function StreakWidget() {
  const { user } = useAuth();
  const [streak, setStreak] = useState<number | null>(null);
  const [canClaim, setCanClaim] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/bonus/status", {
          headers: await authHeaders(),
        });
        if (!res.ok) return;
        const s = await res.json();
        if (!cancelled) {
          setStreak(s.streak || 0);
          setCanClaim(!!s.canClaimDaily);
        }
      } catch {
        /* offline — hide quietly */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  async function authHeaders(): Promise<HeadersInit> {
    try {
      const sb = getSupabase();
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      return token ? { Authorization: `Bearer ${token}` } : {};
    } catch {
      return {};
    }
  }

  if (streak === null) return null;

  function openBonusModal() {
    window.dispatchEvent(new CustomEvent("bdv:open-bonus-modal"));
  }

  return (
    <button
      type="button"
      onClick={openBonusModal}
      className="flex items-center gap-2 rounded-[18px] border border-[#C9A84C]/30 bg-gradient-to-r from-[#C9A84C]/10 to-transparent px-4 py-3 text-left w-full hover:border-[#C9A84C]/60 transition-colors cursor-pointer"
    >
      <Flame className="h-5 w-5 text-[#e8c86a]" />
      <div>
        <p className="text-sm font-bold text-white">
          {streak === 0 ? "Start your streak 🔥" : `${streak}-day streak 🔥`}
        </p>
        <p className="text-xs text-white/50">
          {canClaim
            ? "Tap to claim your daily bonus!"
            : streak === 0
              ? "Tap to claim your first daily bonus!"
              : "Claimed today — see you tomorrow!"}
        </p>
      </div>
    </button>
  );
}
