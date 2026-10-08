import { useEffect, useMemo, useRef, useState } from "react";
import { useSearch } from "wouter";
import {
  Wallet, Plus, Loader2, AlertTriangle, ChevronLeft, ChevronRight,
  TrendingUp, TrendingDown, Trash2, X, CheckCircle2, PiggyBank,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useTranslation } from "react-i18next";
import SplitsOverview, { fetchReleaseOptions } from "./SplitsOverview";

/* ─── Money Tracker panel (mounted INSIDE the /coach page as a tab) ──────
   "Know your numbers": a free per-user income/expense ledger (CRUD on
   /api/money). Monthly P&L, category breakdowns, running totals.

   Deep-link protocol (also used by the sibling Sponsor Invoice Generator):
     /coach?tab=money&income=<dollars>&note=<text>
   prefills an income entry so a paid invoice lands in the ledger in one tap.

   Coherence: readMoneySnapshot() exposes the current totals so the
   Monetization Coach gameplan request can carry the creator's real numbers
   as context (module-level store, updated on every data load). */

export type MoneyEntryType = "income" | "expense";

interface MoneyEntry {
  id: string;
  entry_type: MoneyEntryType;
  category: string;
  amount_cents: number;
  note: string;
  source: string | null;
  entry_date: string; // YYYY-MM-DD
  created_at: string;
  releaseId?: string | null;
}

const INCOME_CATEGORIES = [
  "sponsor_deals", "merch_sales", "streaming_royalties", "ad_revenue",
  "subscriptions", "affiliate", "invoice_payout", "other_income",
] as const;

const EXPENSE_CATEGORIES = [
  "equipment", "software", "ads", "travel",
  "contractors", "production", "other_expense",
] as const;

export interface MoneySnapshot {
  monthIncomeCents: number;
  monthExpenseCents: number;
  monthNetCents: number;
  allTimeIncomeCents: number;
  allTimeExpenseCents: number;
  allTimeNetCents: number;
  topIncomeCategory: string | null;
  topExpenseCategory: string | null;
  monthLabel: string;
}

let latestSnapshot: MoneySnapshot | null = null;
/** Latest computed money totals for the coach gameplan context. */
export function readMoneySnapshot(): MoneySnapshot | null {
  return latestSnapshot;
}

function todayYmd(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function fmtMoney(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

const sectionTitle =
  "mb-4 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-primary/80";

export default function MoneyTrackerPanel() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const search = useSearch();

  const [entries, setEntries] = useState<MoneyEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(() => new Date());
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  /* Ledger vs Splits view (deep-linkable: /coach?tab=money&view=splits) */
  const [view, setView] = useState<"ledger" | "splits">(() => {
    try {
      return new URLSearchParams(window.location.search).get("view") === "splits" ? "splits" : "ledger";
    } catch {
      return "ledger";
    }
  });
  const [releaseOptions, setReleaseOptions] = useState<Array<{ id: string; title: string }>>([]);
  const [fReleaseId, setFReleaseId] = useState("");
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [linkValue, setLinkValue] = useState("");

  /* form state */
  const [fType, setFType] = useState<MoneyEntryType>("income");
  const [fCategory, setFCategory] = useState<string>("sponsor_deals");
  const [fAmount, setFAmount] = useState("");
  const [fDate, setFDate] = useState(todayYmd());
  const [fNote, setFNote] = useState("");
  const [fSource, setFSource] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
 const [invoicePrefill, setInvoicePrefill] = useState(false);

  const deepLinkConsumed = useRef(false);

  /* ── deep-link prefill: ?income=<dollars>&note=<text> ───────────────── */
  useEffect(() => {
    if (deepLinkConsumed.current) return;
    deepLinkConsumed.current = true;
    const params = new URLSearchParams(search);
    const income = params.get("income");
    if (!income) return;
    const dollars = parseFloat(income);
    if (!Number.isFinite(dollars) || dollars <= 0) return;
    setFType("income");
    setFCategory("invoice_payout");
    setFAmount(dollars.toFixed(2));
    setFNote((params.get("note") ?? "").slice(0, 280));
    setFDate(todayYmd());
    setInvoicePrefill(true);
    setShowForm(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadEntries() {
    if (!user) {
      setLoading(false);
      setEntries([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await confirmedFetch("/api/money", { skipConfirm: true });
      if (!res) {
        setLoading(false);
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { entries?: MoneyEntry[]; error?: string };
      if (!res.ok) throw new Error(data.error || t("moneyTracker.errorLoad"));
      setEntries(Array.isArray(data.entries) ? data.entries : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("moneyTracker.errorLoad"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadEntries();
    if (user) {
      fetchReleaseOptions(confirmedFetch).then(setReleaseOptions).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  /* ── derived: month view + running totals ───────────────────────────── */
  const monthEntries = useMemo(
    () => entries.filter((e) => e.entry_date.startsWith(monthKey(cursor))),
    [entries, cursor],
  );

  const stats = useMemo(() => {
    let mi = 0, me = 0, ai = 0, ae = 0;
    const incByCat = new Map<string, number>();
    const expByCat = new Map<string, number>();
    for (const e of entries) {
      const inMonth = e.entry_date.startsWith(monthKey(cursor));
      if (e.entry_type === "income") {
        ai += e.amount_cents;
        if (inMonth) {
          mi += e.amount_cents;
          incByCat.set(e.category, (incByCat.get(e.category) ?? 0) + e.amount_cents);
        }
      } else {
        ae += e.amount_cents;
        if (inMonth) {
          me += e.amount_cents;
          expByCat.set(e.category, (expByCat.get(e.category) ?? 0) + e.amount_cents);
        }
      }
    }
    const topOf = (m: Map<string, number>) =>
      [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const snap: MoneySnapshot = {
      monthIncomeCents: mi,
      monthExpenseCents: me,
      monthNetCents: mi - me,
      allTimeIncomeCents: ai,
      allTimeExpenseCents: ae,
      allTimeNetCents: ai - ae,
      topIncomeCategory: topOf(incByCat),
      topExpenseCategory: topOf(expByCat),
      monthLabel: cursor.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
    };
    latestSnapshot = snap;
    return {
      ...snap,
      incByCat: [...incByCat.entries()].sort((a, b) => b[1] - a[1]),
      expByCat: [...expByCat.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [entries, cursor]);

  const monthLabel = cursor.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  function catLabel(cat: string): string {
    const key = `moneyTracker.cat_${cat}`;
    const translated = t(key);
    return translated === key ? cat.replace(/_/g, " ") : translated;
  }

  function switchType(type: MoneyEntryType) {
    setFType(type);
    setFCategory(type === "income" ? INCOME_CATEGORIES[0] : EXPENSE_CATEGORIES[0]);
    setFormError(null);
  }

  async function handleSave() {
    if (saving) return;
    const dollars = parseFloat(fAmount);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      setFormError(t("moneyTracker.errorAmount"));
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fDate)) {
      setFormError(t("moneyTracker.errorDate"));
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const res = await confirmedFetch("/api/money", {
        skipConfirm: true,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: fType,
          category: fCategory,
          amountCents: Math.round(dollars * 100),
          note: fNote.trim(),
          source: fSource.trim() || null,
          date: fDate,
          releaseId: fType === "income" && fReleaseId ? fReleaseId : null,
        }),
      });
      if (!res) return;
      const data = (await res.json().catch(() => ({}))) as { entry?: MoneyEntry; error?: string };
      if (!res.ok || !data.entry) throw new Error(data.error || t("moneyTracker.errorSave"));
      setEntries((prev) => [data.entry!, ...prev]);
      setShowForm(false);
      setInvoicePrefill(false);
      setFAmount("");
      setFNote("");
      setFSource("");
      setFReleaseId("");
      setFDate(todayYmd());
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t("moneyTracker.errorSave"));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (deletingId) return;
    setDeletingId(id);
    try {
      const res = await confirmedFetch(`/api/money/${id}`, { skipConfirm: true, method: "DELETE" });
      if (!res) return;
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || t("moneyTracker.errorDelete"));
      }
      setEntries((prev) => prev.filter((e) => e.id !== id));
      setConfirmDeleteId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("moneyTracker.errorDelete"));
    } finally {
      setDeletingId(null);
    }
  }

  function shiftMonth(delta: number) {
    setCursor((prev) => {
      const next = new Date(prev);
      next.setMonth(next.getMonth() + delta);
      return next;
    });
  }

  /* Link an income entry to a release so splits apply to it. */
  async function linkEntry(entryId: string, releaseId: string | null) {
    if (linkingId) return;
    setLinkingId(entryId);
    try {
      const res = await confirmedFetch(`/api/money/${entryId}`, {
        skipConfirm: true,
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ releaseId }),
      });
      if (!res) return;
      const data = (await res.json().catch(() => ({}))) as { entry?: MoneyEntry; error?: string };
      if (!res.ok || !data.entry) throw new Error(data.error || "Couldn't link the release.");
      setEntries((prev) => prev.map((e) => (e.id === entryId ? data.entry! : e)));
      setLinkingId(null);
      setLinkValue("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't link the release.");
      setLinkingId(null);
    }
  }

  function releaseTitle(id: string | null | undefined): string | null {
    if (!id) return null;
    return releaseOptions.find((r) => r.id === id)?.title ?? null;
  }

  if (!user) {
    return (
      <div className="mt-8 rounded-3xl border border-white/10 bg-white/[0.03] p-10 text-center">
        <Wallet className="mx-auto h-10 w-10 text-primary/60" aria-hidden="true" />
        <p className="mt-4 text-sm text-white/60">{t("moneyTracker.signInPrompt")}</p>
      </div>
    );
  }

  return (
    <div className="mt-8">
      {/* ── header: month nav + add ─────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <button
            onClick={() => shiftMonth(-1)}
            aria-label={t("moneyTracker.prevMonth")}
            className="rounded-xl border border-white/10 bg-white/[0.03] p-2 text-white/60 transition hover:border-primary/40 hover:text-white"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <p className="min-w-[150px] text-center text-sm font-black text-white">{monthLabel}</p>
          <button
            onClick={() => shiftMonth(1)}
            aria-label={t("moneyTracker.nextMonth")}
            className="rounded-xl border border-white/10 bg-white/[0.03] p-2 text-white/60 transition hover:border-primary/40 hover:text-white"
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <button
          onClick={() => { setShowForm((v) => !v); setFormError(null); }}
          className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-br from-[#f5d67b] via-primary to-[#8a6d1f] px-5 py-2.5 text-sm font-black text-black shadow-[0_4px_20px_rgba(212,175,55,0.35)] transition hover:scale-[1.03] active:scale-95"
        >
          {showForm ? <X className="h-4 w-4" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
          {showForm ? t("moneyTracker.closeForm") : t("moneyTracker.addEntry")}
        </button>
      </div>

      {/* ── Ledger vs Splits toggle ─────────────────────────────────── */}
      <div className="mt-4 inline-flex gap-1 rounded-2xl border border-white/10 bg-white/[0.03] p-1">
        {(["ledger", "splits"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`rounded-xl px-5 py-2 text-sm font-bold transition ${
              view === v
                ? "bg-gradient-to-br from-[#f5d67b] via-primary to-[#8a6d1f] text-black"
                : "text-white/55 hover:text-white"
            }`}
          >
            {v === "ledger" ? "Ledger" : "Splits"}
          </button>
        ))}
      </div>

      {view === "splits" ? (
        <SplitsOverview />
      ) : loading ? (
        <div className="mt-6 flex items-center justify-center gap-2 rounded-3xl border border-white/10 bg-white/[0.03] p-12 text-sm text-white/50">
          <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
          {t("moneyTracker.loading")}
        </div>
      ) : error ? (
        <div className="mt-6 rounded-3xl border border-red-500/30 bg-red-500/[0.06] p-8 text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-red-400" aria-hidden="true" />
          <p className="mt-3 text-sm text-white/70">{error}</p>
          <button
            onClick={loadEntries}
            className="mt-4 rounded-2xl border border-primary/40 bg-primary/10 px-5 py-2.5 text-sm font-bold text-primary transition hover:bg-primary/20"
          >
            {t("moneyTracker.retry")}
          </button>
        </div>
      ) : (
        <>
          {/* ── monthly P&L ─────────────────────────────────────────── */}
          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-3xl border border-emerald-500/25 bg-gradient-to-b from-emerald-500/[0.08] to-black p-5">
              <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-emerald-300/80">
                <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" /> {t("moneyTracker.income")}
              </p>
              <p className="mt-2 font-display text-3xl font-black text-emerald-300">{fmtMoney(stats.monthIncomeCents)}</p>
            </div>
            <div className="rounded-3xl border border-red-500/25 bg-gradient-to-b from-red-500/[0.08] to-black p-5">
              <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-red-300/80">
                <TrendingDown className="h-3.5 w-3.5" aria-hidden="true" /> {t("moneyTracker.expenses")}
              </p>
              <p className="mt-2 font-display text-3xl font-black text-red-300">{fmtMoney(stats.monthExpenseCents)}</p>
            </div>
            <div className={`rounded-3xl border p-5 bg-gradient-to-b ${stats.monthNetCents >= 0 ? "border-primary/40 from-primary/[0.12] to-black" : "border-amber-500/30 from-amber-500/[0.08] to-black"}`}>
              <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-primary/90">
                <PiggyBank className="h-3.5 w-3.5" aria-hidden="true" /> {t("moneyTracker.netProfit")}
              </p>
              <p className={`mt-2 font-display text-3xl font-black ${stats.monthNetCents >= 0 ? "text-primary" : "text-amber-300"}`}>
                {fmtMoney(stats.monthNetCents)}
              </p>
            </div>
          </div>

          {/* ── running totals ──────────────────────────────────────── */}
          <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1 rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-3 text-xs text-white/50">
            <span className="font-bold uppercase tracking-widest text-white/35">{t("moneyTracker.allTime")}</span>
            <span>{t("moneyTracker.income")}: <b className="text-emerald-300">{fmtMoney(stats.allTimeIncomeCents)}</b></span>
            <span>{t("moneyTracker.expenses")}: <b className="text-red-300">{fmtMoney(stats.allTimeExpenseCents)}</b></span>
            <span>{t("moneyTracker.netProfit")}: <b className={stats.allTimeNetCents >= 0 ? "text-primary" : "text-amber-300"}>{fmtMoney(stats.allTimeNetCents)}</b></span>
          </div>

          {/* ── add entry form ──────────────────────────────────────── */}
          {showForm && (
            <div className="mt-6 rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-8">
              <p className={sectionTitle}>{t("moneyTracker.newEntry")}</p>
              {invoicePrefill && (
                <p className="mb-4 flex items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/[0.08] px-4 py-2.5 text-xs font-semibold text-primary">
                  <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {t("moneyTracker.prefilledInvoice")}
                </p>
              )}
              <div className="grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-1.5">
                {(["income", "expense"] as const).map((type) => (
                  <button
                    key={type}
                    onClick={() => switchType(type)}
                    className={`rounded-xl px-4 py-2.5 text-sm font-bold transition ${
                      fType === type
                        ? type === "income"
                          ? "bg-emerald-500 text-black shadow-[0_0_16px_rgba(16,185,129,0.3)]"
                          : "bg-red-500 text-black shadow-[0_0_16px_rgba(239,68,68,0.3)]"
                        : "text-white/55 hover:text-white"
                    }`}
                  >
                    {t(`moneyTracker.${type}`)}
                  </button>
                ))}
              </div>
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-widest text-white/40">
                    {t("moneyTracker.category")}
                  </label>
                  <select
                    value={fCategory}
                    onChange={(e) => setFCategory(e.target.value)}
                    className={`${inputClass} appearance-none`}
                  >
                    {(fType === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES).map((c) => (
                      <option key={c} value={c} className="bg-black">{catLabel(c)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-widest text-white/40">
                    {t("moneyTracker.amount")}
                  </label>
                  <input
                    value={fAmount}
                    onChange={(e) => setFAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                    inputMode="decimal"
                    placeholder="0.00"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-widest text-white/40">
                    {t("moneyTracker.date")}
                  </label>
                  <input
                    type="date"
                    value={fDate}
                    onChange={(e) => setFDate(e.target.value)}
                    className={`${inputClass} [color-scheme:dark]`}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-widest text-white/40">
                    {t("moneyTracker.source")}
                  </label>
                  <input
                    value={fSource}
                    onChange={(e) => setFSource(e.target.value)}
                    maxLength={120}
                    placeholder={t("moneyTracker.sourcePlaceholder")}
                    className={inputClass}
                  />
                </div>
              </div>
              {fType === "income" && releaseOptions.length > 0 && (
                <div className="mt-4">
                  <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-widest text-white/40">
                    Release <span className="font-normal normal-case text-white/30">(optional — applies its splits to this income)</span>
                  </label>
                  <select
                    value={fReleaseId}
                    onChange={(e) => setFReleaseId(e.target.value)}
                    className={`${inputClass} appearance-none`}
                  >
                    <option value="" className="bg-black">No release — unlinked income</option>
                    {releaseOptions.map((r) => (
                      <option key={r.id} value={r.id} className="bg-black">{r.title}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="mt-4">
                <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-widest text-white/40">
                  {t("moneyTracker.note")}
                </label>
                <input
                  value={fNote}
                  onChange={(e) => setFNote(e.target.value)}
                  maxLength={280}
                  placeholder={t("moneyTracker.notePlaceholder")}
                  className={inputClass}
                />
              </div>
              {formError && (
                <p className="mt-3 flex items-center gap-1.5 text-sm text-red-300">
                  <AlertTriangle className="h-4 w-4" aria-hidden="true" /> {formError}
                </p>
              )}
              <button
                onClick={handleSave}
                disabled={saving}
                className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-gradient-to-br from-[#f5d67b] via-primary to-[#8a6d1f] px-8 py-3 text-sm font-black text-black shadow-[0_4px_20px_rgba(212,175,55,0.35)] transition hover:scale-[1.03] active:scale-95 disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
                {saving ? t("moneyTracker.saving") : t("moneyTracker.saveEntry")}
              </button>
            </div>
          )}

          {/* ── category breakdown ──────────────────────────────────── */}
          {(stats.incByCat.length > 0 || stats.expByCat.length > 0) && (
            <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2">
              {([
                ["income", stats.incByCat, "text-emerald-300", "from-emerald-500 to-emerald-300"],
                ["expense", stats.expByCat, "text-red-300", "from-red-500 to-red-300"],
              ] as const).map(([type, rows, labelCls, barCls]) => {
                const total = rows.reduce((s, [, c]) => s + c, 0);
                if (rows.length === 0) return null;
                return (
                  <div key={type} className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                    <p className={sectionTitle}>{t(`moneyTracker.breakdown${type === "income" ? "Income" : "Expense"}`)}</p>
                    <div className="space-y-3">
                      {rows.map(([cat, cents]) => (
                        <div key={cat}>
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-white/70">{catLabel(cat)}</span>
                            <span className={`font-bold ${labelCls}`}>{fmtMoney(cents)}</span>
                          </div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
                            <div
                              className={`h-full rounded-full bg-gradient-to-r ${barCls}`}
                              style={{ width: `${total > 0 ? Math.max(4, Math.round((cents / total) * 100)) : 0}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── entries list ────────────────────────────────────────── */}
          <div className="mt-6 rounded-3xl border border-white/10 bg-white/[0.03] p-5 md:p-6">
            <p className={sectionTitle}>{t("moneyTracker.entriesThisMonth", { month: monthLabel })}</p>
            {monthEntries.length === 0 ? (
              <div className="py-10 text-center">
                <Wallet className="mx-auto h-10 w-10 text-white/20" aria-hidden="true" />
                <p className="mt-3 text-sm text-white/50">{t("moneyTracker.emptyMonth")}</p>
                <button
                  onClick={() => setShowForm(true)}
                  className="mt-4 inline-flex items-center gap-2 rounded-2xl border border-primary/40 bg-primary/10 px-5 py-2.5 text-sm font-bold text-primary transition hover:bg-primary/20"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" /> {t("moneyTracker.addFirst")}
                </button>
              </div>
            ) : (
              <ul className="divide-y divide-white/[0.06]">
                {monthEntries.map((e) => (
                  <li key={e.id} className="flex items-center gap-3 py-3">
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${
                        e.entry_type === "income"
                          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                          : "border-red-500/40 bg-red-500/10 text-red-300"
                      }`}
                      aria-hidden="true"
                    >
                      {e.entry_type === "income" ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-white">
                        {e.note || catLabel(e.category)}
                      </p>
                      <p className="text-[11px] text-white/40">
                        {catLabel(e.category)}
                        {e.source ? ` · ${e.source}` : ""}
                        {" · "}
                        {new Date(`${e.entry_date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </p>
                      {e.entry_type === "income" && (
                        <div className="mt-1">
                          {linkingId === e.id ? (
                            <span className="inline-flex items-center gap-1.5">
                              <select
                                value={linkValue}
                                onChange={(sel) => linkEntry(e.id, sel.target.value || null)}
                                className="rounded-lg border border-primary/40 bg-black px-2 py-1 text-[11px] text-white outline-none"
                                autoFocus
                              >
                                <option value="">Unlinked — pick a release…</option>
                                {releaseOptions.map((r) => (
                                  <option key={r.id} value={r.id}>{r.title}</option>
                                ))}
                              </select>
                              <button
                                onClick={() => { setLinkingId(null); setLinkValue(""); }}
                                className="text-[11px] font-bold text-white/50 hover:text-white"
                              >
                                Cancel
                              </button>
                            </span>
                          ) : releaseTitle(e.releaseId) ? (
                            <span className="inline-flex items-center gap-1.5">
                              <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/[0.08] px-2 py-0.5 text-[10px] font-bold text-primary">
                                {releaseTitle(e.releaseId)}
                              </span>
                              <button
                                onClick={() => linkEntry(e.id, null)}
                                className="text-[10px] font-bold text-white/40 hover:text-white"
                              >
                                Unlink
                              </button>
                            </span>
                          ) : releaseOptions.length > 0 ? (
                            <button
                              onClick={() => { setLinkingId(e.id); setLinkValue(""); }}
                              className="text-[10px] font-bold text-primary/80 hover:text-primary"
                            >
                              Link a release to apply splits
                            </button>
                          ) : null}
                        </div>
                      )}
                    </div>
                    <span className={`shrink-0 font-display text-base font-black ${e.entry_type === "income" ? "text-emerald-300" : "text-red-300"}`}>
                      {e.entry_type === "income" ? "+" : "−"}{fmtMoney(e.amount_cents)}
                    </span>
                    {confirmDeleteId === e.id ? (
                      <span className="flex shrink-0 items-center gap-1.5">
                        <button
                          onClick={() => handleDelete(e.id)}
                          disabled={deletingId === e.id}
                          className="rounded-lg bg-red-500 px-2.5 py-1.5 text-xs font-bold text-black transition hover:brightness-110 disabled:opacity-50"
                        >
                          {deletingId === e.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : t("moneyTracker.confirmDelete")}
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="rounded-lg border border-white/15 px-2.5 py-1.5 text-xs font-bold text-white/60 transition hover:text-white"
                        >
                          {t("moneyTracker.cancelDelete")}
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() => setConfirmDeleteId(e.id)}
                        aria-label={t("moneyTracker.deleteEntry")}
                        className="shrink-0 rounded-lg border border-white/10 p-1.5 text-white/40 transition hover:border-red-500/50 hover:text-red-300"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
