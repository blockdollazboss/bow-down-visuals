import { useEffect, useState } from "react";
import {
  DollarSign, TrendingUp, Music2, Upload, Sparkles, Loader2,
  Wallet, Link2, CheckCircle2, Clock3, AlertTriangle, Copy,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import { useTranslation } from "react-i18next";

/* ─── Royalty Tracker (tab panel inside MoneyTrackerPanel, /coach) ─────────
   One dashboard for streaming earnings across platforms.

   Pricing rule: pure data display is FREE (dashboard, import, payouts).
   Only the AI earnings insights cost credits (1 credit).

   v1 honesty: CSV import is the universal path (every distributor exports
   CSVs). Platform auto-sync is "coming soon" except manual — never faked. */

const INSIGHTS_CREDIT_COST = 1;

interface SummaryData {
  total: string;
  totalStreams: number;
  entryCount: number;
  perSong: { song: string; amount: string; cents: number; streams: number }[];
  perPlatform: { platform: string; label: string; amount: string; cents: number; streams: number }[];
  monthly: { month: string; amount: string; cents: number }[];
}

interface PlatformStatus {
  key: string;
  label: string;
  connected: boolean;
  connectionType: string | null;
  accountLabel: string | null;
  connectable: boolean;
}

interface Payout {
  id: string;
  distributor: string;
  period_start: string;
  period_end: string;
  expected_amount: string;
  received_amount: string | null;
  currency: string;
  status: string;
  notes: string | null;
}

interface Insight {
  title: string;
  detail: string;
}

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";
const labelClass = "mb-1.5 block text-xs font-bold uppercase tracking-widest text-white/50";

function fmtMoney(amount: string, currency = "USD"): string {
  const n = parseFloat(amount);
  if (Number.isNaN(n)) return `${currency} 0.00`;
  return `${currency} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function Bar({ pct, gold }: { pct: number; gold?: boolean }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
      <div
        className={`h-full rounded-full transition-all ${gold ? "bg-gradient-to-r from-amber-500 to-yellow-300" : "bg-white/40"}`}
        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
      />
    </div>
  );
}

export default function RoyaltyTrackerPanel() {
  const { t } = useTranslation();
  const { user, getAccessToken, refreshProfile } = useAuth();

  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [platforms, setPlatforms] = useState<PlatformStatus[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);

  /* CSV import */
  const [csv, setCsv] = useState("");
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null);

  /* AI insights */
  const [insights, setInsights] = useState<Insight[] | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState<string | null>(null);
  const [insightsOutOfCredits, setInsightsOutOfCredits] = useState(false);

  /* Payout form */
  const [showPayoutForm, setShowPayoutForm] = useState(false);
  const [pDistributor, setPDistributor] = useState("");
  const [pStart, setPStart] = useState("");
  const [pEnd, setPEnd] = useState("");
  const [pExpected, setPExpected] = useState("");
  const [pReceived, setPReceived] = useState("");
  const [pStatus, setPStatus] = useState("expected");
  const [payoutSaving, setPayoutSaving] = useState(false);
  const [payoutMsg, setPayoutMsg] = useState<string | null>(null);

  async function authed(path: string, method: string, body?: unknown) {
    const token = await getAccessToken();
    const res = await fetch(path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { res, data };
  }

  async function loadAll() {
    setSummaryLoading(true);
    try {
      const [{ data: s }, { data: p }, { data: pay }] = await Promise.all([
        authed("/api/royalties/summary", "GET"),
        authed("/api/royalties/platforms", "GET"),
        authed("/api/royalties/payouts", "GET"),
      ]);
      setSummary(s as unknown as SummaryData);
      setPlatforms(((p as { platforms?: PlatformStatus[] }).platforms ?? []) as PlatformStatus[]);
      setPayouts(((pay as { payouts?: Payout[] }).payouts ?? []) as Payout[]);
    } catch {
      /* dashboard stays in its empty state */
    } finally {
      setSummaryLoading(false);
    }
  }

  useEffect(() => {
    if (user) loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function importCsv() {
    if (importing || !csv.trim()) return;
    setImporting(true);
    setImportMsg(null);
    try {
      const { res, data } = await authed("/api/royalties/import", "POST", { csv });
      if (!res.ok) {
        const details = (data.details as string[] | undefined)?.join(" ") ?? "";
        throw new Error(`${(data.error as string) || t("royalties.error.importFailed")} ${details}`.trim());
      }
      const warnings = (data.warnings as string[] | undefined) ?? [];
      setImportMsg({
        ok: true,
        text: t("royalties.import.success", { num: data.imported as number }) +
          (warnings.length ? ` ${t("royalties.import.warnings", { num: warnings.length })}` : ""),
      });
      setCsv("");
      loadAll();
    } catch (err) {
      setImportMsg({ ok: false, text: err instanceof Error ? err.message : t("royalties.error.importFailed") });
    } finally {
      setImporting(false);
    }
  }

  async function connectManual(key: string) {
    try {
      await authed("/api/royalties/platforms", "POST", { platform: key });
      loadAll();
    } catch {
      /* non-fatal */
    }
  }

  async function getInsights() {
    if (insightsLoading || !user) return;
    setInsightsLoading(true);
    setInsightsError(null);
    setInsightsOutOfCredits(false);
    try {
      const { res, data } = await authed("/api/royalties/insights", "POST", {});
      if (res.status === 402) {
        setInsightsOutOfCredits(true);
        return;
      }
      if (!res.ok) throw new Error((data.error as string) || t("royalties.error.insightsFailed"));
      setInsights((data.insights as Insight[]) ?? []);
      refreshProfile().catch(() => {});
    } catch (err) {
      setInsightsError(err instanceof Error ? err.message : t("royalties.error.insightsFailed"));
    } finally {
      setInsightsLoading(false);
    }
  }

  async function savePayout() {
    if (payoutSaving) return;
    if (!pDistributor.trim() || !pStart || !pEnd || !pExpected.trim()) {
      setPayoutMsg(t("royalties.error.payoutRequired"));
      return;
    }
    setPayoutSaving(true);
    setPayoutMsg(null);
    try {
      const { res, data } = await authed("/api/royalties/payouts", "POST", {
        distributor: pDistributor.trim(),
        period_start: pStart,
        period_end: pEnd,
        expected_amount: pExpected.trim(),
        received_amount: pReceived.trim() || undefined,
        status: pStatus,
      });
      if (!res.ok) throw new Error((data.error as string) || t("royalties.error.payoutSaveFailed"));
      setShowPayoutForm(false);
      setPDistributor(""); setPStart(""); setPEnd(""); setPExpected(""); setPReceived(""); setPStatus("expected");
      loadAll();
    } catch (err) {
      setPayoutMsg(err instanceof Error ? err.message : t("royalties.error.payoutSaveFailed"));
    } finally {
      setPayoutSaving(false);
    }
  }

  const maxSong = summary?.perSong[0]?.cents ?? 1;
  const maxMonth = summary?.monthly.reduce((m, x) => Math.max(m, x.cents), 0) ?? 1;
  const hasData = (summary?.entryCount ?? 0) > 0;

  return (
    <div>
      <div>
        {/* Section heading */}
        <div className="mb-8 text-center">
          <p className="text-xs font-bold uppercase tracking-[0.25em] text-amber-400/80">{t("royalties.eyebrow")}</p>
          <h2 className="mt-2 text-2xl font-black tracking-tight md:text-3xl">
            {t("royalties.titlePrefix")} <span className="bg-gradient-to-r from-amber-400 to-yellow-200 bg-clip-text text-transparent">{t("royalties.titleSuffix")}</span>
          </h2>
          <p className="mx-auto mt-2 max-w-2xl text-sm text-white/55">
            {t("royalties.subtitle")}
          </p>
        </div>

        {!user ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
            <p className="text-white/70">{t("royalties.signIn")}</p>
          </div>
        ) : summaryLoading ? (
          <div className="flex items-center gap-3 text-white/50">
            <Loader2 className="h-5 w-5 animate-spin" /> {t("royalties.loading")}
          </div>
        ) : (
          <>
            {/* Totals */}
            <div className="mb-8 grid gap-4 sm:grid-cols-3">
              <div className="rounded-2xl border border-amber-400/25 bg-gradient-to-br from-amber-500/15 to-transparent p-5">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-amber-300/80">
                  <DollarSign className="h-4 w-4" /> {t("royalties.totals.earnings")}
                </div>
                <div className="mt-2 text-3xl font-black text-amber-300">{fmtMoney(summary?.total ?? "0.00")}</div>
                <div className="mt-1 text-xs text-white/45">{t("royalties.totals.entries", { num: summary?.entryCount ?? 0 })}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-white/50">
                  <TrendingUp className="h-4 w-4" /> {t("royalties.totals.streams")}
                </div>
                <div className="mt-2 text-3xl font-black">{(summary?.totalStreams ?? 0).toLocaleString()}</div>
                <div className="mt-1 text-xs text-white/45">{t("royalties.totals.acrossPlatforms")}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-white/50">
                  <Music2 className="h-4 w-4" /> {t("royalties.totals.songs")}
                </div>
                <div className="mt-2 text-3xl font-black">{summary?.perSong.length ?? 0}</div>
                <div className="mt-1 text-xs text-white/45">{t("royalties.totals.platforms", { num: summary?.perPlatform.length ?? 0 })}</div>
              </div>
            </div>

            {/* AI insights */}
            <div className="mb-8 rounded-2xl border border-amber-400/25 bg-gradient-to-br from-amber-500/10 to-transparent p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-amber-300" />
                  <h2 className="text-lg font-bold">{t("royalties.insights.title")}</h2>
                  <span className="rounded-full bg-amber-400/15 px-2.5 py-0.5 text-xs font-bold text-amber-300">{t("royalties.insights.cost", { cost: INSIGHTS_CREDIT_COST })}</span>
                </div>
                <button
                  onClick={getInsights}
                  disabled={insightsLoading || !hasData}
                  className="rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 px-5 py-2.5 text-sm font-bold text-black transition hover:brightness-110 disabled:opacity-40"
                >
                  {insightsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : t("royalties.insights.analyze")}
                </button>
              </div>
              {!hasData && <p className="mt-2 text-sm text-white/50">{t("royalties.insights.needData")}</p>}
              {insightsOutOfCredits && <div className="mt-3"><OutOfCredits /></div>}
              {insightsError && <p className="mt-3 text-sm text-red-400">{insightsError}</p>}
              {insights && (
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {insights.map((ins, i) => (
                    <div key={i} className="rounded-xl border border-white/10 bg-black/40 p-4">
                      <div className="text-sm font-bold text-amber-200">{ins.title}</div>
                      <div className="mt-1 text-sm text-white/65">{ins.detail}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {hasData ? (
              <>
                {/* Monthly trend */}
                <div className="mb-8 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                  <h2 className="mb-4 text-lg font-bold">{t("royalties.monthlyTrend")}</h2>
                  <div className="flex items-end gap-2 overflow-x-auto pb-2">
                    {summary!.monthly.map((m) => (
                      <div key={m.month} className="flex min-w-[52px] flex-1 flex-col items-center gap-1.5">
                        <div className="text-[11px] font-bold text-amber-200/90">${parseFloat(m.amount).toFixed(0)}</div>
                        <div
                          className="w-full rounded-t-md bg-gradient-to-t from-amber-600/70 to-yellow-300/90"
                          style={{ height: `${Math.max(8, (m.cents / maxMonth) * 120)}px` }}
                          title={`${m.month}: ${fmtMoney(m.amount)}`}
                        />
                        <div className="text-[10px] text-white/40">{m.month.slice(2)}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mb-8 grid gap-6 md:grid-cols-2">
                  {/* Per song */}
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                    <h2 className="mb-4 text-lg font-bold">{t("royalties.perSong")}</h2>
                    <div className="space-y-3">
                      {summary!.perSong.slice(0, 8).map((s) => (
                        <div key={s.song}>
                          <div className="mb-1 flex items-center justify-between text-sm">
                            <span className="truncate font-semibold">{s.song}</span>
                            <span className="ml-2 shrink-0 font-bold text-amber-200">{fmtMoney(s.amount)}</span>
                          </div>
                          <Bar pct={(s.cents / maxSong) * 100} gold />
                          <div className="mt-0.5 text-[11px] text-white/40">{t("royalties.streams", { num: s.streams.toLocaleString() })}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  {/* Per platform */}
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                    <h2 className="mb-4 text-lg font-bold">{t("royalties.perPlatform")}</h2>
                    <div className="space-y-3">
                      {summary!.perPlatform.map((p) => (
                        <div key={p.platform}>
                          <div className="mb-1 flex items-center justify-between text-sm">
                            <span className="font-semibold">{p.label}</span>
                            <span className="ml-2 shrink-0 font-bold text-amber-200">{fmtMoney(p.amount)}</span>
                          </div>
                          <Bar pct={(p.cents / (summary!.perPlatform[0]?.cents ?? 1)) * 100} />
                          <div className="mt-0.5 text-[11px] text-white/40">{t("royalties.streams", { num: p.streams.toLocaleString() })}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="mb-8 rounded-2xl border border-dashed border-white/15 bg-white/[0.02] p-8 text-center">
                <Upload className="mx-auto mb-3 h-8 w-8 text-white/30" />
                <p className="font-bold">{t("royalties.empty.title")}</p>
                <p className="mx-auto mt-1 max-w-md text-sm text-white/50">
                  {t("royalties.empty.desc")}
                </p>
              </div>
            )}

            {/* CSV import */}
            <div className="mb-8 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <h2 className="flex items-center gap-2 text-lg font-bold"><Upload className="h-5 w-5 text-amber-300" /> {t("royalties.import.title")} <span className="rounded-full bg-emerald-400/15 px-2.5 py-0.5 text-xs font-bold text-emerald-300">{t("royalties.free")}</span></h2>
              <p className="mt-1 text-sm text-white/50">
                {t("royalties.import.desc")}
              </p>
              <textarea
                value={csv}
                onChange={(e) => setCsv(e.target.value)}
                rows={6}
                placeholder={"Song,Platform,Period Start,Period End,Streams,Amount\nMidnight Crown,Spotify,01/01/2026,01/31/2026,12400,45.67"}
                className={`${inputClass} mt-3 font-mono text-xs`}
              />
              <div className="mt-3 flex items-center gap-3">
                <button
                  onClick={importCsv}
                  disabled={importing || !csv.trim()}
                  className="rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 px-5 py-2.5 text-sm font-bold text-black transition hover:brightness-110 disabled:opacity-40"
                >
                  {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : t("royalties.import.button")}
                </button>
                {importMsg && (
                  <p className={`text-sm ${importMsg.ok ? "text-emerald-300" : "text-red-400"}`}>{importMsg.text}</p>
                )}
              </div>
            </div>

            {/* Platforms */}
            <div className="mb-8 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <h2 className="flex items-center gap-2 text-lg font-bold"><Link2 className="h-5 w-5 text-amber-300" /> {t("royalties.platforms.title")}</h2>
              <p className="mt-1 text-sm text-white/50">
                {t("royalties.platforms.desc1")} <span className="font-bold text-white/70">{t("royalties.platforms.comingSoon")}</span>{t("royalties.platforms.desc2")}
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {platforms.map((p) => (
                  <div key={p.key} className="flex items-center justify-between rounded-xl border border-white/10 bg-black/40 px-4 py-3">
                    <div>
                      <div className="text-sm font-bold">{p.label}</div>
                      <div className="text-[11px] text-white/40">
                        {p.connected ? t("royalties.platforms.connected", { account: p.accountLabel ? ` · ${p.accountLabel}` : "" }) : p.connectable ? t("royalties.platforms.notConnected") : t("royalties.platforms.autoSyncSoon")}
                      </div>
                    </div>
                    {p.connected ? (
                      <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                    ) : p.connectable ? (
                      <button onClick={() => connectManual(p.key)} className="rounded-lg border border-amber-400/40 px-3 py-1.5 text-xs font-bold text-amber-300 transition hover:bg-amber-400/10">
                        {t("royalties.platforms.connect")}
                      </button>
                    ) : (
                      <Clock3 className="h-5 w-5 text-white/25" />
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Payouts */}
            <div className="mb-8 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-lg font-bold"><Wallet className="h-5 w-5 text-amber-300" /> {t("royalties.payouts.title")} <span className="rounded-full bg-emerald-400/15 px-2.5 py-0.5 text-xs font-bold text-emerald-300">{t("royalties.free")}</span></h2>
                <button
                  onClick={() => setShowPayoutForm((v) => !v)}
                  className="rounded-xl border border-amber-400/40 px-4 py-2 text-sm font-bold text-amber-300 transition hover:bg-amber-400/10"
                >
                  {showPayoutForm ? t("royalties.payouts.cancel") : t("royalties.payouts.record")}
                </button>
              </div>
              {showPayoutForm && (
                <div className="mt-4 grid gap-3 rounded-xl border border-white/10 bg-black/40 p-4 sm:grid-cols-2">
                  <div><label className={labelClass}>{t("royalties.payouts.distributor")}</label><input value={pDistributor} onChange={(e) => setPDistributor(e.target.value)} placeholder="DistroKid" className={inputClass} /></div>
                  <div><label className={labelClass}>{t("royalties.payouts.statusLabel")}</label>
                    <select value={pStatus} onChange={(e) => setPStatus(e.target.value)} className={inputClass}>
                      <option value="expected">{t("royalties.payouts.statusExpected")}</option>
                      <option value="received">{t("royalties.payouts.statusReceived")}</option>
                      <option value="partial">{t("royalties.payouts.statusPartial")}</option>
                      <option value="overdue">{t("royalties.payouts.statusOverdue")}</option>
                    </select>
                  </div>
                  <div><label className={labelClass}>{t("royalties.payouts.periodStart")}</label><input type="date" value={pStart} onChange={(e) => setPStart(e.target.value)} className={inputClass} /></div>
                  <div><label className={labelClass}>{t("royalties.payouts.periodEnd")}</label><input type="date" value={pEnd} onChange={(e) => setPEnd(e.target.value)} className={inputClass} /></div>
                  <div><label className={labelClass}>{t("royalties.payouts.expectedAmount")}</label><input value={pExpected} onChange={(e) => setPExpected(e.target.value)} placeholder="125.50" inputMode="decimal" className={inputClass} /></div>
                  <div><label className={labelClass}>{t("royalties.payouts.receivedAmount")}</label><input value={pReceived} onChange={(e) => setPReceived(e.target.value)} placeholder="125.50" inputMode="decimal" className={inputClass} /></div>
                  <div className="sm:col-span-2 flex items-center gap-3">
                    <button onClick={savePayout} disabled={payoutSaving} className="rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 px-5 py-2.5 text-sm font-bold text-black transition hover:brightness-110 disabled:opacity-40">
                      {payoutSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("royalties.payouts.save")}
                    </button>
                    {payoutMsg && <p className="text-sm text-red-400">{payoutMsg}</p>}
                  </div>
                </div>
              )}
              <div className="mt-4 space-y-2">
                {payouts.length === 0 && <p className="text-sm text-white/45">{t("royalties.payouts.empty")}</p>}
                {payouts.map((p) => (
                  <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/40 px-4 py-3">
                    <div>
                      <div className="text-sm font-bold">{p.distributor}</div>
                      <div className="text-[11px] text-white/40">{p.period_start} → {p.period_end}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right text-sm">
                        <div>{t("royalties.payouts.expected")} <span className="font-bold">{fmtMoney(p.expected_amount, p.currency)}</span></div>
                        {p.received_amount && <div className="text-white/55">{t("royalties.payouts.received")} <span className="font-bold text-emerald-300">{fmtMoney(p.received_amount, p.currency)}</span></div>}
                      </div>
                      <span className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ${
                        p.status === "received" ? "bg-emerald-400/15 text-emerald-300"
                        : p.status === "overdue" ? "bg-red-400/15 text-red-300"
                        : p.status === "partial" ? "bg-amber-400/15 text-amber-300"
                        : "bg-white/10 text-white/60"
                      }`}>
                        {p.status === "overdue" && <AlertTriangle className="h-3 w-3" />}
                        {t(`royalties.payouts.status.${p.status}`, { defaultValue: p.status })}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <p className="flex items-start gap-2 text-xs text-white/40">
              <Copy className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {t("royalties.disclaimer")}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
