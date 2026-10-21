import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Flame, Snowflake, AlertTriangle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { getSupabase } from "@/lib/supabase";

/* ─── Daily streak widget ───
   Persistent streak display for the dashboard. The DailyBonusModal only
   appears when a claim is available, so the streak was invisible the rest
   of the day. This shows it always.
   Login streaks with teeth (2026-10-11):
   - Urgent "claim today or lose your streak" state when yesterday was
     claimed but today hasn't been (the streak dies at midnight).
   - Freeze-salvage state: one day missed but a freeze is banked — claiming
     today auto-consumes it and preserves the chain. */

function utcDateDaysAgo(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

export default function StreakWidget() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [streak, setStreak] = useState<number | null>(null);
  const [canClaim, setCanClaim] = useState(false);
  const [lastDailyClaim, setLastDailyClaim] = useState<string | null>(null);
  const [freezeWouldSave, setFreezeWouldSave] = useState(false);

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
          /* A degraded 200 (profile side down) carries null profile
             fields — the streak is unknown then. Keep it null so the
             widget stays hidden instead of inventing a "start your
             streak" 0 for someone whose chain may be long. */
          if (typeof s.streak === "number") {
            setStreak(s.streak);
            setCanClaim(!!s.canClaimDaily);
            setLastDailyClaim(s.lastDailyClaim ?? null);
            setFreezeWouldSave(!!s.freezeWouldSave);
          }
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

  // Yesterday claimed, today not → the streak dies at midnight. Urgent.
  const atRisk =
    streak > 0 && canClaim && lastDailyClaim === utcDateDaysAgo(1);
  // One day missed but a freeze is banked → today's claim auto-saves it.
  const freezeSalvage = canClaim && freezeWouldSave;

  const urgent = atRisk || freezeSalvage;

  return (
    <button
      type="button"
      onClick={openBonusModal}
      className={
        "flex items-center gap-2 rounded-[18px] border px-4 py-3 text-left w-full transition-colors cursor-pointer " +
        (freezeSalvage
          ? "border-[#9fd8ff]/50 bg-gradient-to-r from-[#9fd8ff]/15 to-transparent hover:border-[#9fd8ff]/80"
          : urgent
            ? "border-[#e8c766]/60 bg-gradient-to-r from-[#e8c766]/15 to-transparent hover:border-[#e8c766]/90 animate-pulse"
            : "border-[#C9A84C]/30 bg-gradient-to-r from-[#C9A84C]/10 to-transparent hover:border-[#C9A84C]/60")
      }
    >
      {freezeSalvage ? (
        <Snowflake className="h-5 w-5 text-[#9fd8ff]" />
      ) : urgent ? (
        <AlertTriangle className="h-5 w-5 text-[#e8c766]" />
      ) : (
        <Flame className="h-5 w-5 text-[#e8c86a]" />
      )}
      <div>
        <p className="text-sm font-bold text-white">
          {freezeSalvage
            ? t("retention.streakWidget.freezeSalvageTitle", { streak, defaultValue: `🧊 Save your ${streak}-day streak!` })
            : atRisk
              ? t("retention.streakWidget.atRiskTitle", { streak, defaultValue: `Don't lose your ${streak}-day streak!` })
              : streak === 0
                ? "Start your streak 🔥"
                : `${streak}-day streak 🔥`}
        </p>
        <p className="text-xs text-white/50">
          {freezeSalvage
            ? t("retention.streakWidget.freezeSalvageSub", { defaultValue: "You missed yesterday — a streak freeze will save your chain. Claim today!" })
            : atRisk
              ? t("retention.streakWidget.atRiskSub", { defaultValue: "Claim today or your streak resets to zero." })
              : canClaim
                ? "Tap to claim your daily bonus!"
                : streak === 0
                  ? "Tap to claim your first daily bonus!"
                  : "Claimed today — see you tomorrow!"}
        </p>
      </div>
    </button>
  );
}
