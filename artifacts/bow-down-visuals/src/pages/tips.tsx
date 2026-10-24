import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { usePageTitle } from "@/hooks/use-page-title";
import { useEffect, useState } from "react";
import {
  HandCoins, Loader2, Copy, Check, Link2, PiggyBank, Users, TrendingUp,
  MessageCircleHeart, Sparkles, BadgeAlert, Share2, AlertTriangle, RotateCcw,
  Trophy, Trash2,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useTranslation } from "react-i18next";

/* ─── Tip Jar — creator dashboard ──────────────────────────────────────────
   Set up your public tip page at /tips/:handle, share the link, and watch
   tip intent roll in. Payment processing is COMING SOON — tips are recorded
   as intent only, no charge is ever made. Setup is free. */

interface TipSettings {
  handle: string;
  displayName: string;
  message: string;
  suggestedAmounts: number[];
  goalAmount: number | null;
  goalLabel: string;
}

interface TipIntent {
  id: string;
  amount: number;
  currency: string;
  fanName: string;
  message: string;
  status: string;
  createdAt: string;
}

/* Funding goal view from the API — progress derived from PAID tips
   only; null numbers mean the server could not read the tip records. */
interface FundingGoalView {
  label: string;
  targetAmount: number;
  currency: string;
  raised: number | null;
  raisedCount: number | null;
  progress: number | null;
  reached: boolean;
  reachedAt: string | null;
  progressUnavailable?: boolean;
}

interface FundingGoalRecord {
  id: string;
  label: string;
  targetAmount: number;
  raisedAmount: number;
  startedAt: string;
  reachedAt: string;
}

interface Dashboard {
  hasPage: boolean;
  handle: string | null;
  total: number;
  count: number;
  average: number;
  goalAmount: number | null;
  goalLabel: string;
  goalProgress: number | null;
  goal: FundingGoalView | null;
  goalHistory: FundingGoalRecord[];
  feed: TipIntent[];
  paymentsLive: boolean;
}

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

const cardClass = (isLight: boolean) =>
  isLight
    ? "rounded-2xl border border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3] p-6"
    : "rounded-2xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04] p-6";

const DEFAULT_SUGGESTED = "5, 10, 25";

export default function Tips() {
  usePageTitle("Tip Jar", "Set up your public tip page, share your link, and let fans support your work directly.");
  const isLight = useIsLightTheme();
  const { t } = useTranslation();
  const { user, getAccessToken } = useAuth();
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  /* Dashboard load failures (network, HTTP) get their own error state
     with a retry — separate from `error`, which stays scoped to action
     (save) failures shown in the red banner. */
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [message, setMessage] = useState("");
  const [suggested, setSuggested] = useState(DEFAULT_SUGGESTED);
  const [goalAmount, setGoalAmount] = useState("");
  const [goalLabel, setGoalLabel] = useState("");

  async function authFetch(path: string, opts: RequestInit = {}) {
    const token = await getAccessToken();
    const res = await fetch(path, {
      ...opts,
      headers: { ...(opts.headers ?? {}), Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  }

  async function load() {
    setLoading(true);
    setError(null);
    setLoadError(false);
    try {
      const { res, data } = await authFetch("/api/tips/dashboard");
      if (!res.ok) {
        setLoadError(true);
        return;
      }
      setDashboard(data);
      if (data.hasPage) {
        /* Settings sub-fetch stays tolerant: a failure here never swaps
           the dashboard into the load-error state. */
        try {
          const { res: sres, data: sdata } = await authFetch("/api/tips/settings");
          if (sres.ok && sdata.settings) {
            const s: TipSettings = sdata.settings;
            setHandle(s.handle);
            setDisplayName(s.displayName);
            setMessage(s.message);
            setSuggested(s.suggestedAmounts.join(", "));
            setGoalAmount(s.goalAmount != null ? String(s.goalAmount) : "");
            setGoalLabel(s.goalLabel);
          }
        } catch {
          /* tolerant — dashboard already loaded */
        }
      }
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (user) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function save() {
    setSaving(true);
    setError(null);
    const suggestedAmounts = suggested
      .split(",")
      .map((x) => Number(x.trim()))
      .filter((x) => Number.isFinite(x) && x > 0);
    const { res, data } = await authFetch("/api/tips/settings", {
      method: "POST",
      body: JSON.stringify({
        handle,
        displayName,
        message,
        suggestedAmounts: suggestedAmounts.length ? suggestedAmounts : [5, 10, 25],
        goalAmount: goalAmount.trim() ? Number(goalAmount) : null,
        goalLabel,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      setError(data.details?.[0]?.message ?? data.error ?? t("tips.saveError"));
      return;
    }
    await load();
  }

  const [removingGoal, setRemovingGoal] = useState(false);

  async function removeGoal() {
    setRemovingGoal(true);
    setError(null);
    try {
      const { res, data } = await authFetch("/api/tips/goal", { method: "DELETE" });
      if (!res.ok) {
        setError(data.error ?? t("tips.saveError"));
        return;
      }
      setGoalAmount("");
      setGoalLabel("");
      await load();
    } finally {
      setRemovingGoal(false);
    }
  }

  function tipUrl() {
    return `${window.location.origin}/tips/${dashboard?.handle ?? handle}`;
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(tipUrl());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — user can copy manually */
    }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <style>{`
        /* POLISH 2026-10-11: the "Tip Jar" gold gradient washes out on the
           ivory light background — deepen it to a dark bronze gradient in
           light theme. Dark theme keeps the original bright gold. */
        .light .tip-jar-title {
          background-image: linear-gradient(to right, #b45309, #7a5a12, #b45309);
        }
      `}</style>
      <main className="mx-auto max-w-5xl px-4 pb-24 pt-28">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.25em] text-primary">
          <HandCoins className="h-4 w-4" />{t("tips.kicker")}</div>
        <h1 className="text-4xl font-extrabold tracking-tight md:text-5xl">
          {t("tips.titlePrefix")} <span className="tip-jar-title bg-gradient-to-r from-amber-200 via-primary to-amber-200 bg-clip-text text-transparent">{t("tips.titleHighlight")}</span>
        </h1>
        <p className="mt-3 max-w-2xl text-white/55">{t("tips.subtitle")}</p>

        {/* Honest disclosure driven by the live flag: tips are intent-only until payments go live */}
        {!loading && !dashboard?.paymentsLive && (
          <div className="mt-4 flex items-start gap-3 rounded-2xl border border-amber-400/25 bg-amber-400/[0.06] p-4 text-sm text-amber-200/90">
            <BadgeAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
            <p>
              <strong className="text-amber-100">{t("tips.paymentsSoonTitle")}</strong> {t("tips.paymentsSoonBody")}
            </p>
          </div>
        )}

        {loading ? (
          <div className="mt-12 flex justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
        ) : loadError ? (
          <div className={`mt-8 rounded-2xl border p-10 text-center ${isLight ? "border-[#C9A84C]/50 bg-[#F7ECD2]" : "border-primary/25 bg-zinc-950"}`}>
            <AlertTriangle className="mx-auto h-10 w-10 text-primary" />
            <p className={`mt-3 font-bold ${isLight ? "text-[#2A1E07]" : "text-white"}`}>Couldn't load your Tip Jar.</p>
            <p className={`mt-1 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
              Something went wrong on our end — your tip page is safe, this dashboard just couldn't reach it.
            </p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 font-bold text-black hover:brightness-110"
            >
              <RotateCcw className="h-4 w-4" /> Try again
            </button>
          </div>
        ) : (
          <>
            {error && (
              <div className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{error}</div>
            )}

            <div className="mt-8 grid gap-6 lg:grid-cols-2">
              {/* Setup */}
              <section className={cardClass(isLight)}>
                <h2 className="flex items-center gap-2 text-lg font-bold">
                  <Link2 className="h-5 w-5 text-primary" />{t("tips.setupTitle")}</h2>
                <div className="mt-4 space-y-4">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-white/50">{t("tips.handleLabel")}</label>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-white/40">/tips/</span>
                      <input value={handle} onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))}
                        placeholder={t("tips.handlePlaceholder")} className={inputClass} maxLength={30} />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-white/50">{t("tips.displayNameLabel")}</label>
                    <input value={displayName} onChange={(e) => setDisplayName(e.target.value)}
                      placeholder={t("tips.displayNamePlaceholder")} className={inputClass} maxLength={60} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-white/50">{t("tips.messageLabel")}</label>
                    <textarea value={message} onChange={(e) => setMessage(e.target.value)}
                      placeholder={t("tips.messagePlaceholder")} className={inputClass} rows={3} maxLength={500} />
                  </div>
                  <div data-min-stars="3">
                    <label className="mb-1 block text-xs font-medium text-white/50">{t("tips.suggestedLabel")}</label>
                    <input value={suggested} onChange={(e) => setSuggested(e.target.value)}
                      placeholder={t("tips.suggestedPlaceholder")} className={inputClass} />
                  </div>
                  <div data-min-stars="3" className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-white/50">{t("tips.goalAmountLabel")}</label>
                      <input value={goalAmount} onChange={(e) => setGoalAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                        placeholder={t("tips.goalAmountPlaceholder")} className={inputClass} inputMode="decimal" />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-white/50">{t("tips.goalLabelLabel")}</label>
                      <input value={goalLabel} onChange={(e) => setGoalLabel(e.target.value)}
                        placeholder={t("tips.goalLabelPlaceholder")} className={inputClass} maxLength={80} />
                    </div>
                  </div>
                  <button onClick={save} disabled={saving || !handle.trim() || !displayName.trim()}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-primary px-4 py-3 text-sm font-bold text-black transition hover:brightness-110 disabled:opacity-40">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    {dashboard?.hasPage ? t("tips.updateButton") : t("tips.createButton")}
                  </button>
                  {dashboard?.hasPage && (
                    <>
                      <button onClick={copyLink}
                        className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-white/80 transition hover:bg-white/[0.08]">
                        {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                        {copied ? t("tips.linkCopied") : t("tips.copyLink")}
                      </button>
                      <button
                        onClick={async () => {
                          const shareData = {
                            title: `Tip ${displayName || dashboard.handle} — Bow Down Visuals`,
                            text: `Support ${displayName || dashboard.handle}! 💰 Tip jar powered by Bow Down Visuals`,
                            url: tipUrl(),
                          };
                          try {
                            if (navigator.share) await navigator.share(shareData);
                            else await navigator.clipboard.writeText(`${shareData.text}\n${shareData.url}`);
                          } catch { /* user dismissed */ }
                        }}
                        className="flex w-full items-center justify-center gap-2 rounded-xl border border-primary/40 bg-primary/10 px-4 py-3 text-sm font-bold text-primary transition hover:bg-primary/20">
                        <Share2 className="h-4 w-4" />
                        {t("tips.shareTipPage", { defaultValue: "Share tip page" })}
                      </button>
                    </>
                  )}
                </div>
              </section>

              {/* Dashboard */}
              <section className={cardClass(isLight)}>
                <h2 className="flex items-center gap-2 text-lg font-bold">
                  <PiggyBank className="h-5 w-5 text-primary" />{t("tips.totalsTitle")}</h2>
                {!dashboard?.hasPage ? (
                  <p className="mt-4 text-sm text-white/50">{t("tips.noPageBody")}</p>
                ) : (
                  <>
                    <div className="mt-4 grid grid-cols-3 gap-3">
                      <div className="rounded-xl border border-white/10 bg-black/40 p-4 text-center">
                        <div className="text-2xl font-extrabold text-primary">${dashboard.total.toFixed(2)}</div>
                        <div className="mt-1 text-[11px] uppercase tracking-wider text-white/40">{t("tips.tippedLabel")}</div>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-black/40 p-4 text-center">
                        <div className="flex items-center justify-center gap-1 text-2xl font-extrabold"><Users className="h-5 w-5 text-primary" />{dashboard.count}</div>
                        <div className="mt-1 text-[11px] uppercase tracking-wider text-white/40">{t("tips.tipsLabel")}</div>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-black/40 p-4 text-center">
                        <div className="flex items-center justify-center gap-1 text-2xl font-extrabold"><TrendingUp className="h-5 w-5 text-primary" />${dashboard.average.toFixed(2)}</div>
                        <div className="mt-1 text-[11px] uppercase tracking-wider text-white/40">{t("tips.averageLabel")}</div>
                      </div>
                    </div>
                    {dashboard.goal != null && (
                      <div className="mt-4">
                        <div className="flex items-center justify-between text-xs text-white/50">
                          <span>
                            {dashboard.goal.raised != null
                              ? t("tips.goalProgress", { label: dashboard.goal.label || t("tips.goalDefault"), total: dashboard.goal.raised.toFixed(2), goal: dashboard.goal.targetAmount.toFixed(2) })
                              : (dashboard.goal.label || t("tips.goalDefault"))}
                          </span>
                          {dashboard.goal.progress != null && <span>{Math.round(dashboard.goal.progress * 100)}%</span>}
                        </div>
                        {dashboard.goal.progress != null && (
                          <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-white/10">
                            <div className="h-full rounded-full bg-gradient-to-r from-amber-500 to-primary transition-all"
                              style={{ width: `${Math.round(dashboard.goal.progress * 100)}%` }} />
                          </div>
                        )}
                        {dashboard.goal.reached ? (
                          <div className="mt-3 flex items-center gap-2 rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs font-bold text-amber-200">
                            <Trophy className="h-4 w-4 shrink-0 text-primary" />
                            {t("tips.goalReached")}
                          </div>
                        ) : (
                          <p className="mt-2 text-[11px] text-white/35">{t("tips.goalPaidOnlyNote")}</p>
                        )}
                        <button onClick={() => void removeGoal()} disabled={removingGoal}
                          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-white/70 transition hover:bg-white/[0.08] disabled:opacity-40">
                          {removingGoal ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                          {t("tips.goalRemove")}
                        </button>
                      </div>
                    )}
                    {dashboard.goalHistory.length > 0 && (
                      <div className="mt-5">
                        <h3 className="flex items-center gap-2 text-sm font-bold text-white/70">
                          <Trophy className="h-4 w-4 text-primary" />{t("tips.goalHistoryTitle")}
                        </h3>
                        <div className="mt-2 space-y-2">
                          {dashboard.goalHistory.map((g) => (
                            <div key={g.id} className="rounded-xl border border-white/10 bg-black/40 p-3 text-xs text-white/55">
                              {t("tips.goalHistoryLine", {
                                label: g.label || t("tips.goalDefault"),
                                raised: g.raisedAmount.toFixed(2),
                                goal: g.targetAmount.toFixed(2),
                                date: new Date(g.reachedAt).toLocaleDateString(),
                              })}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <h3 className="mt-6 flex items-center gap-2 text-sm font-bold text-white/70">
                      <MessageCircleHeart className="h-4 w-4 text-primary" />{t("tips.recentTips")}</h3>
                    <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
                      {dashboard.feed.length === 0 && (
                        <p className="text-sm text-white/40">{t("tips.noTipsYet")}</p>
                      )}
                      {dashboard.feed.map((tip) => (
                        <div key={tip.id} className="rounded-xl border border-white/10 bg-black/40 p-3">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-semibold text-white/85">{tip.fanName || t("tips.anonymousFan")}</span>
                            <span className="text-sm font-bold text-primary">${tip.amount.toFixed(2)}</span>
                          </div>
                          {tip.message && <p className="mt-1 text-xs text-white/50">“{tip.message}”</p>}
                          <p className="mt-1 text-[11px] text-white/30">
                            {t("tips.tipMeta", { date: new Date(tip.createdAt).toLocaleString(), status: tip.status === "pending_payment" ? t("tips.intentRecorded") : tip.status })}
                          </p>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </section>
            </div>
          </>
        )}
      </main>

    </div>
  );
}
