import { useCallback, useEffect, useState } from "react";
import { Trophy, ChevronDown, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";

/* ─── LeaderboardWidget — weekly top 10 (status only, NO VB payout) ──────
   Dashboard section: rank, display name, creation+export score for the
   current Monday-reset week. The current user is highlighted. Includes the
   Delight settings toggles (all three retention systems' on/off switches). */

interface BoardRow {
  rank: number;
  userId: string;
  name: string;
  creations: number;
  exports: number;
  score: number;
  isYou: boolean;
}

interface BoardData {
  weekStart: string;
  rows: BoardRow[];
  viewerRank: number | null;
  viewerScore: number;
}

interface DelightPrefs {
  sharkDropsEnabled: boolean;
  levelCelebrationsEnabled: boolean;
  leaderboardVisible: boolean;
}

const RANK_STYLE: Record<number, string> = {
  1: "bg-gradient-to-b from-[#f0d878] to-[#C9A84C] text-black",
  2: "bg-gradient-to-b from-[#e8e8e8] to-[#9a9a9a] text-black",
  3: "bg-gradient-to-b from-[#e0a56a] to-[#8a5a2e] text-black",
};

function Toggle({
  on,
  onChange,
  label,
  desc,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
  desc: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-white/[0.04]"
    >
      <span
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? "bg-[#C9A84C]" : "bg-white/15"}`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold text-white/80">{label}</span>
        <span className="block truncate text-xs text-white/40">{desc}</span>
      </span>
      {on && <Check className="h-4 w-4 shrink-0 text-[#e8c86a]/60" />}
    </button>
  );
}

export default function LeaderboardWidget() {
  const { t } = useTranslation();
  const { user, getAccessToken } = useAuth();
  const [board, setBoard] = useState<BoardData | null>(null);
  const [prefs, setPrefs] = useState<DelightPrefs | null>(null);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [savedTick, setSavedTick] = useState(false);

  const authHeaders = useCallback(async (): Promise<HeadersInit> => {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [getAccessToken]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const headers = await authHeaders();
        const [bRes, pRes] = await Promise.allSettled([
          fetch("/api/retention/leaderboard", { headers }),
          fetch("/api/retention/delight-prefs", { headers }),
        ]);
        if (cancelled) return;
        if (bRes.status === "fulfilled" && bRes.value.ok) {
          setBoard((await bRes.value.json().catch(() => null)) as BoardData | null);
        }
        if (pRes.status === "fulfilled" && pRes.value.ok) {
          const d = (await pRes.value.json().catch(() => ({}))) as { prefs?: DelightPrefs };
          if (d.prefs) setPrefs(d.prefs);
        }
      } catch {
        /* Non-fatal: the widget simply stays quiet on failure. */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, authHeaders]);

  const setPref = useCallback(
    async (key: keyof DelightPrefs, value: boolean) => {
      if (!prefs) return;
      const prev = prefs;
      setPrefs({ ...prefs, [key]: value }); // optimistic
      try {
        const headers = await authHeaders();
        const res = await fetch("/api/retention/delight-prefs", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify({ [key]: value }),
        });
        if (res.ok) {
          const d = (await res.json().catch(() => ({}))) as { prefs?: DelightPrefs };
          if (d.prefs) setPrefs(d.prefs);
          setSavedTick(true);
          setTimeout(() => setSavedTick(false), 1500);
        } else {
          setPrefs(prev);
        }
      } catch {
        setPrefs(prev);
      }
    },
    [prefs, authHeaders]
  );

  return (
    <section aria-label={t("retentionDelight.board_title")}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="flex items-center gap-2 text-xs font-black tracking-[0.18em] text-white/40 uppercase">
          <Trophy className="h-3.5 w-3.5 text-primary/70" />
          {t("retentionDelight.board_title")}
        </h2>
        <span className="text-[11px] font-semibold text-white/30">{t("retentionDelight.board_reset")}</span>
      </div>

      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
        {!board || board.rows.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-white/35">
            {t("retentionDelight.board_empty")}
          </p>
        ) : (
          <ul className="divide-y divide-white/[0.05]">
            {board.rows.map((r) => (
              <li
                key={r.userId}
                className={`flex items-center gap-3 px-4 py-2.5 ${r.isYou ? "bg-[#e8c86a]/[0.07] border-l-2 border-l-[#e8c86a]" : ""}`}
              >
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-black ${RANK_STYLE[r.rank] ?? "bg-white/[0.06] text-white/50"}`}
                >
                  {r.rank}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-bold text-white/80">
                  {r.name}
                  {r.isYou && (
                    <span className="ml-2 rounded-full bg-[#e8c86a]/15 border border-[#e8c86a]/30 px-2 py-0.5 text-[10px] font-black text-[#e8c86a] uppercase tracking-wide">
                      {t("retentionDelight.board_you")}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-sm font-black text-white/85">{r.score}</span>
                  <span className="block text-[10px] text-white/30">{t("retentionDelight.board_creations")}</span>
                </span>
              </li>
            ))}
          </ul>
        )}

        {board && board.viewerRank !== null && board.viewerRank > 10 && (
          <p className="border-t border-white/[0.05] px-4 py-2.5 text-center text-xs text-white/40">
            #{board.viewerRank} {t("retentionDelight.board_you")} · {board.viewerScore} {t("retentionDelight.board_creations")}
          </p>
        )}

        <p className="border-t border-white/[0.05] px-4 py-2.5 text-center text-[11px] italic text-white/30">
          {t("retentionDelight.board_note")}
        </p>
      </div>

      {/* ── Delight settings: on/off for all three systems ── */}
      <div className="mt-3 rounded-2xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
        <button
          type="button"
          onClick={() => setPrefsOpen((v) => !v)}
          aria-expanded={prefsOpen}
          className="flex w-full items-center justify-between px-4 py-3 text-left"
        >
          <span>
            <span className="block text-sm font-bold text-white/75">{t("retentionDelight.prefs_title")}</span>
            <span className="block text-xs text-white/35">{t("retentionDelight.prefs_subtitle")}</span>
          </span>
          <span className="flex items-center gap-2">
            {savedTick && <span className="text-[11px] font-bold text-[#e8c86a]">{t("retentionDelight.prefs_saved")}</span>}
            <ChevronDown className={`h-4 w-4 text-white/40 transition-transform ${prefsOpen ? "rotate-180" : ""}`} />
          </span>
        </button>
        {prefsOpen && prefs && (
          <div className="border-t border-white/[0.05] p-2">
            <Toggle
              on={prefs.sharkDropsEnabled}
              onChange={(v) => setPref("sharkDropsEnabled", v)}
              label={t("retentionDelight.prefs_sharkDrops")}
              desc={t("retentionDelight.prefs_sharkDrops_desc")}
            />
            <Toggle
              on={prefs.levelCelebrationsEnabled}
              onChange={(v) => setPref("levelCelebrationsEnabled", v)}
              label={t("retentionDelight.prefs_levelCelebrations")}
              desc={t("retentionDelight.prefs_levelCelebrations_desc")}
            />
            <Toggle
              on={prefs.leaderboardVisible}
              onChange={(v) => setPref("leaderboardVisible", v)}
              label={t("retentionDelight.prefs_leaderboardVisible")}
              desc={t("retentionDelight.prefs_leaderboardVisible_desc")}
            />
          </div>
        )}
      </div>
    </section>
  );
}
