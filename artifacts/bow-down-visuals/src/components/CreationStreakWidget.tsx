import { useCallback, useEffect, useState } from "react";
import { Flame, ChevronDown, X, Check, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

interface Milestone {
  days: number;
  reward: number;
  reached: boolean;
  claimed: boolean;
}

interface StreakData {
  enabled: boolean;
  currentStreak: number;
  longestStreak: number;
  lastCreationDate: string | null;
  milestones: Milestone[];
  nextMilestone: { days: number; reward: number } | null;
}

const HIDE_KEY = "bdv-hide-retention-streak";

export default function CreationStreakWidget({
  getToken,
  onBalanceChange,
}: {
  getToken: () => Promise<string | null>;
  onBalanceChange?: () => void;
}) {
  const { t } = useTranslation();
  const [data, setData] = useState<StreakData | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [hidden, setHidden] = useState(() => {
    try { return localStorage.getItem(HIDE_KEY) === "1"; } catch { return false; }
  });
  const [claiming, setClaiming] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const authHeaders = useCallback(async (): Promise<HeadersInit> => {
    const token = await getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [getToken]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/retention/streak", { headers: await authHeaders() });
      if (res.ok) setData((await res.json()) as StreakData);
    } catch { /* widget stays empty on failure */ }
  }, [authHeaders]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, [toast]);

  const toggleEnabled = useCallback(async () => {
    if (!data) return;
    try {
      const res = await fetch("/api/retention/prefs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ creation_streaks_enabled: !data.enabled }),
      });
      if (res.ok) void load();
    } catch { /* noop */ }
  }, [data, authHeaders, load]);

  const claim = useCallback(async (days: number) => {
    setClaiming(days);
    try {
      const res = await fetch("/api/retention/streak/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ days }),
      });
      const body = (await res.json().catch(() => ({}))) as { reward?: number; error?: string };
      if (res.ok && typeof body.reward === "number") {
        setToast(t("retention.claim_success", { reward: body.reward }));
        onBalanceChange?.();
        await load();
      } else {
        setToast(body.error ?? t("retention.claim_failed"));
      }
    } catch {
      setToast(t("retention.claim_failed"));
    } finally {
      setClaiming(null);
    }
  }, [authHeaders, load, onBalanceChange, t]);

  if (hidden) return null;
  if (!data) return null;

  const toggle = (
    <button type="button" onClick={() => void toggleEnabled()} role="switch" aria-checked={data.enabled}
      aria-label={t("retention.toggle_streaks")}
      className="flex items-center gap-2 text-[11px] font-bold text-white/50 hover:text-white/80 transition-colors">
      <span>{t("retention.toggle_streaks")}</span>
      <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${data.enabled ? "bg-primary" : "bg-white/[0.12]"}`}>
        <span className={`inline-block h-3.5 w-3.5 rounded-full bg-black transition-transform ${data.enabled ? "translate-x-[18px]" : "translate-x-[3px]"}`} />
      </span>
    </button>
  );

  /* Disabled: slim bar so the user can always switch it back on. */
  if (!data.enabled) {
    return (
      <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] px-4 py-3 flex items-center gap-3 opacity-70">
        <Flame className="h-5 w-5 text-white/30 shrink-0" />
        <span className="flex-1 text-xs font-bold text-white/40 uppercase tracking-wide">{t("retention.streak_title")}</span>
        {toggle}
      </section>
    );
  }

  const next = data.nextMilestone;
  const progressPct = next ? Math.min(100, (data.currentStreak / next.days) * 100) : 100;

  return (
    <section className="relative overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-br from-orange-500/[0.10] via-primary/[0.05] to-transparent p-5 md:p-6">
      <div className="flex items-center gap-3">
        <div className="h-11 w-11 rounded-2xl bg-orange-500/[0.14] border border-orange-500/30 flex items-center justify-center text-orange-400 shrink-0">
          <Flame className="h-6 w-6" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-black tracking-wide text-white uppercase">{t("retention.streak_title")}</h2>
          <p className="text-xs text-white/50">
            {t("retention.streak_longest")}: <span className="font-bold text-white/80">{data.longestStreak}</span>
          </p>
        </div>
        <button type="button" onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? t("retention.expand") : t("retention.collapse")}
          className="p-1.5 rounded-lg text-white/50 hover:text-primary hover:bg-white/[0.05] transition-colors">
          <ChevronDown className={`h-4 w-4 transition-transform ${collapsed ? "" : "rotate-180"}`} />
        </button>
        <button type="button" onClick={() => { try { localStorage.setItem(HIDE_KEY, "1"); } catch {} setHidden(true); }}
          aria-label={t("retention.hide_widget")}
          className="p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/[0.05] transition-colors">
          <X className="h-4 w-4" />
        </button>
      </div>

      {!collapsed && (
        <div className="mt-4">
          <div className="flex items-end gap-2">
            <span className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-b from-amber-200 to-amber-500">
              {data.currentStreak}
            </span>
            <span className="text-sm font-bold text-white/60 pb-1">
              {data.currentStreak === 1 ? t("retention.streak_day_singular") : t("retention.streak_day_plural")}
            </span>
          </div>

          {next ? (
            <div className="mt-3">
              <div className="flex justify-between text-[11px] font-bold text-white/50 mb-1.5">
                <span>{t("retention.streak_next_milestone")}</span>
                <span>{data.currentStreak}/{next.days} · {next.reward} VB</span>
              </div>
              <div className="h-2 rounded-full bg-white/[0.07] overflow-hidden">
                <div className="h-full rounded-full bg-gradient-to-r from-orange-500 to-amber-400 transition-all"
                  style={{ width: `${progressPct}%` }} />
              </div>
            </div>
          ) : null}

          <div className="mt-4 grid grid-cols-4 gap-2">
            {data.milestones.map((m) => (
              <button key={m.days} type="button" disabled={!m.reached || m.claimed || claiming === m.days}
                onClick={() => void claim(m.days)}
                className={`rounded-xl border px-2 py-2.5 text-center transition-all ${
                  m.claimed
                    ? "border-emerald-500/30 bg-emerald-500/[0.08]"
                    : m.reached
                      ? "border-primary/50 bg-primary/[0.10] hover:bg-primary/[0.18] cursor-pointer"
                      : "border-white/[0.08] bg-white/[0.02] opacity-60"
                }`}>
                <div className="text-[11px] font-black text-white">{m.days}d</div>
                <div className="text-[10px] font-bold text-amber-300/90">{m.reward} VB</div>
                <div className="mt-1 h-4 flex items-center justify-center">
                  {m.claimed ? (
                    <span className="text-[9px] font-black text-emerald-400 flex items-center gap-0.5">
                      <Check className="h-3 w-3" />{t("retention.streak_claimed")}
                    </span>
                  ) : m.reached ? (
                    claiming === m.days ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                    ) : (
                      <span className="text-[9px] font-black text-primary uppercase tracking-wide">
                        {t("retention.streak_claim", { reward: m.reward })}
                      </span>
                    )
                  ) : (
                    <span className="text-[9px] font-bold text-white/30">{data.currentStreak}/{m.days}</span>
                  )}
                </div>
              </button>
            ))}
          </div>

          <div className="mt-4 flex items-center justify-between">
            <p className="text-[11px] text-white/40">{t("retention.streak_create_today")}</p>
            {toggle}
          </div>
        </div>
      )}

      {toast && (
        <div className="mt-3 px-3 py-2 rounded-xl border border-primary/40 bg-primary/[0.12] text-xs font-bold text-amber-200">
          {toast}
        </div>
      )}
    </section>
  );
}
