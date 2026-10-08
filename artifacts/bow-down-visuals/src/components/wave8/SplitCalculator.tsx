import { useEffect, useMemo, useState } from "react";
import {
  Plus, X, Loader2, AlertTriangle, FileDown, Trash2, CheckCircle2, Wallet,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useTranslation } from "react-i18next";
import jsPDF from "jspdf";

/* ─── Royalty Split Calculator (Wave 8) ───────────────────────────────────
   Docked as the "Split Sheets" view inside MoneyTrackerPanel (the Money
   Tracker tab on /coach). Free split-sheet CRUD on /api/wave8/splits;
   "Generate PDF" finalizes the sheet for 50 Visual Bucs
   (/api/wave8/splits/pdf) and the audited payload is rendered client-side
   with jspdf. "Post to income ledger" splits a received royalty payment
   across collaborators and logs one /api/money income entry per person. */

interface Collaborator {
  name: string;
  role: string;
  pct: number;
}

interface SplitSheet {
  id: string;
  songTitle: string;
  collaborators: Collaborator[];
  createdAt: string;
  updatedAt: string;
}

interface FinalizedSheet {
  songTitle: string;
  collaborators: Collaborator[];
  totalPct: number;
  finalizedAt: string;
  sheetCode: string;
  creditsRemaining?: number;
}

interface DraftRow {
  name: string;
  role: string;
  pct: string;
}

type RowStatus = "idle" | "posting" | "posted" | "failed";

const PDF_CREDITS = 50;

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

const labelClass = "mb-1.5 block text-[11px] font-bold uppercase tracking-widest text-white/40";

const sectionTitle =
  "mb-4 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-primary/80";

function todayYmd(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function slugify(s: string): string {
  const s2 = s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s2 || "split-sheet";
}

/* Largest-remainder split: floor every share, hand the leftover cents to
   the biggest fractional parts so the posted total matches to the cent. */
function splitCents(totalCents: number, pcts: number[]): number[] {
  const raws = pcts.map((p) => (totalCents * p) / 100);
  const shares = raws.map((r) => Math.floor(r));
  let remainder = totalCents - shares.reduce((a, b) => a + b, 0);
  const order = raws
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < remainder && k < order.length; k++) shares[order[k]!.i] += 1;
  return shares;
}

/* Gold-on-black split-sheet PDF. Plain ASCII-safe text only (no em dashes)
   so the stock helvetica font renders cleanly. */
function buildSplitPdf(data: FinalizedSheet): void {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210;
  const GOLD: [number, number, number] = [212, 175, 55];

  function newPage() {
    doc.addPage();
    doc.setFillColor(8, 8, 8);
    doc.rect(0, 0, W, 297, "F");
    doc.setFillColor(...GOLD);
    doc.rect(0, 0, W, 5, "F");
  }

  newPage();
  let y = 22;

  doc.setTextColor(...GOLD);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("ROYALTY SPLIT SHEET", 15, y);
  y += 7;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(150, 150, 150);
  doc.text("bowdownvisuals.com", 15, y);
  y += 12;

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(data.songTitle, 15, y);
  y += 8;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(160, 160, 160);
  const finDate = new Date(data.finalizedAt).toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  });
  doc.text(`Finalized: ${finDate}   |   Sheet code: ${data.sheetCode}`, 15, y);
  y += 12;

  /* table header */
  doc.setTextColor(...GOLD);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("NAME", 15, y);
  doc.text("ROLE", 85, y);
  doc.text("SHARE", 195, y, { align: "right" });
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(0.6);
  doc.line(15, y + 2.5, 195, y + 2.5);
  y += 10;

  doc.setFontSize(11);
  for (const c of data.collaborators) {
    if (y > 262) {
      newPage();
      y = 22;
    }
    doc.setFont("helvetica", "bold");
    doc.setTextColor(255, 255, 255);
    doc.text(c.name.slice(0, 40), 15, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(170, 170, 170);
    doc.text((c.role || "-").slice(0, 30), 85, y);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...GOLD);
    doc.text(`${c.pct}%`, 195, y, { align: "right" });
    y += 8;
  }

  y += 2;
  doc.setDrawColor(...GOLD);
  doc.line(15, y, 195, y);
  y += 7;
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...GOLD);
  doc.setFontSize(12);
  doc.text("TOTAL", 15, y);
  doc.text(`${data.totalPct}%`, 195, y, { align: "right" });
  y += 14;

  /* signature lines */
  doc.setFont("helvetica", "bold");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(11);
  doc.text("SIGNATURES", 15, y);
  y += 9;
  for (const c of data.collaborators) {
    if (y > 268) {
      newPage();
      y = 22;
    }
    doc.setDrawColor(120, 120, 120);
    doc.setLineWidth(0.4);
    doc.line(15, y, 110, y);
    doc.line(120, y, 195, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(150, 150, 150);
    doc.text(`Signature - ${c.name.slice(0, 32)}`, 15, y);
    doc.text("Date", 120, y);
    y += 11;
  }

  y += 4;
  doc.setFontSize(9);
  doc.setTextColor(130, 130, 130);
  doc.text(
    "This sheet records the royalty split agreed between the parties named above.",
    15, Math.min(y, 285),
  );

  doc.save(`split-sheet-${slugify(data.songTitle)}.pdf`);
}

export default function SplitCalculator() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { confirmedFetch } = useConfirmedApi();

  const [sheets, setSheets] = useState<SplitSheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [fTitle, setFTitle] = useState("");
  const [fRows, setFRows] = useState<DraftRow[]>([
    { name: "", role: "", pct: "" },
    { name: "", role: "", pct: "" },
  ]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [rowStatus, setRowStatus] = useState<Record<string, RowStatus>>({});
  const [ledgerMsg, setLedgerMsg] = useState<Record<string, string>>({});
  const [ledgerPostingId, setLedgerPostingId] = useState<string | null>(null);
  const [cardError, setCardError] = useState<Record<string, string>>({});

  const totalPct = useMemo(
    () => fRows.reduce((s, r) => s + (parseFloat(r.pct) || 0), 0),
    [fRows],
  );

  const formValid = useMemo(() => {
    if (!fTitle.trim()) return false;
    if (fRows.length === 0) return false;
    for (const r of fRows) {
      if (!r.name.trim()) return false;
      const p = parseFloat(r.pct);
      if (!Number.isFinite(p) || p < 0 || p > 100) return false;
    }
    return Math.abs(totalPct - 100) < 0.001;
  }, [fTitle, fRows, totalPct]);

  async function loadSheets() {
    if (!user) {
      setLoading(false);
      setSheets([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await confirmedFetch("/api/wave8/splits", { skipConfirm: true });
      if (!res) {
        setLoading(false);
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { sheets?: SplitSheet[]; error?: string };
      if (!res.ok) throw new Error(data.error || t("wave8.splits.errorLoad"));
      setSheets(Array.isArray(data.sheets) ? data.sheets : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("wave8.splits.errorLoad"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSheets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  function updateRow(i: number, patch: Partial<DraftRow>) {
    setFRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function addRow() {
    if (fRows.length >= 20) return;
    setFRows((prev) => [...prev, { name: "", role: "", pct: "" }]);
  }

  function removeRow(i: number) {
    setFRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function handleSave() {
    if (saving || !formValid) return;
    setSaving(true);
    setFormError(null);
    try {
      const res = await confirmedFetch("/api/wave8/splits", {
        skipConfirm: true,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          songTitle: fTitle.trim(),
          collaborators: fRows.map((r) => ({
            name: r.name.trim(),
            role: r.role.trim(),
            pct: parseFloat(r.pct),
          })),
        }),
      });
      if (!res) return;
      const data = (await res.json().catch(() => ({}))) as { sheet?: SplitSheet; error?: string };
      if (!res.ok || !data.sheet) throw new Error(data.error || t("wave8.splits.errorSave"));
      setSheets((prev) => [data.sheet!, ...prev]);
      setShowForm(false);
      setFTitle("");
      setFRows([
        { name: "", role: "", pct: "" },
        { name: "", role: "", pct: "" },
      ]);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t("wave8.splits.errorSave"));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (deletingId) return;
    setDeletingId(id);
    try {
      const res = await confirmedFetch(`/api/wave8/splits/${id}`, { skipConfirm: true, method: "DELETE" });
      if (!res) return;
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || t("wave8.splits.errorSave"));
      }
      setSheets((prev) => prev.filter((s) => s.id !== id));
      setConfirmDeleteId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("wave8.splits.errorSave"));
    } finally {
      setDeletingId(null);
    }
  }

  /* Paid: finalize (50 VB) → the audited payload drives the client-side PDF. */
  async function handleGeneratePdf(sheet: SplitSheet) {
    if (generatingId) return;
    setGeneratingId(sheet.id);
    setCardError((prev) => ({ ...prev, [sheet.id]: "" }));
    try {
      const res = await confirmedFetch("/api/wave8/splits/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ splitId: sheet.id }),
        overrideCost: PDF_CREDITS,
        overrideFeature: t("wave8.splits.pdfFeature"),
      });
      if (!res) return; // user cancelled the credit confirm
      const data = (await res.json().catch(() => ({}))) as FinalizedSheet & {
        error?: string;
        message?: string;
      };
      if (res.status === 402) throw new Error(t("wave8.splits.outOfCredits"));
      if (!res.ok) throw new Error(data.message || data.error || t("wave8.splits.errorPdf"));
      buildSplitPdf(data);
    } catch (err) {
      setCardError((prev) => ({
        ...prev,
        [sheet.id]: err instanceof Error ? err.message : t("wave8.splits.errorPdf"),
      }));
    } finally {
      setGeneratingId(null);
    }
  }

  /* Free: post a received royalty payment — one /api/money income entry per
     collaborator, split by their percent (largest-remainder cents). */
  async function handlePostToLedger(sheet: SplitSheet) {
    if (ledgerPostingId) return;
    const dollars = parseFloat(amounts[sheet.id] ?? "");
    if (!Number.isFinite(dollars) || dollars <= 0) {
      setCardError((prev) => ({ ...prev, [sheet.id]: t("wave8.splits.errorAmount") }));
      return;
    }
    setLedgerPostingId(sheet.id);
    setCardError((prev) => ({ ...prev, [sheet.id]: "" }));
    setLedgerMsg((prev) => ({ ...prev, [sheet.id]: "" }));
    const totalCents = Math.round(dollars * 100);
    const shares = splitCents(totalCents, sheet.collaborators.map((c) => c.pct));
    const category = `Royalties — ${sheet.songTitle}`.slice(0, 60);
    let ok = 0;
    for (let i = 0; i < sheet.collaborators.length; i++) {
      const c = sheet.collaborators[i]!;
      const key = `${sheet.id}:${i}`;
      setRowStatus((prev) => ({ ...prev, [key]: "posting" }));
      try {
        const res = await confirmedFetch("/api/money", {
          skipConfirm: true,
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "income",
            category,
            amountCents: shares[i],
            note: `${c.name} ${c.pct}% split`.slice(0, 280),
            date: todayYmd(),
          }),
        });
        const data = (await res!.json().catch(() => ({}))) as { entry?: unknown; error?: string; message?: string };
        if (!res || !res.ok || !data.entry) {
          throw new Error(data.message || data.error || t("wave8.splits.errorLedger"));
        }
        setRowStatus((prev) => ({ ...prev, [key]: "posted" }));
        ok++;
      } catch {
        setRowStatus((prev) => ({ ...prev, [key]: "failed" }));
      }
    }
    const failed = sheet.collaborators.length - ok;
    setLedgerMsg((prev) => ({
      ...prev,
      [sheet.id]:
        failed === 0
          ? t("wave8.splits.ledgerDone")
          : t("wave8.splits.ledgerPartial", { ok, total: sheet.collaborators.length, failed }),
    }));
    setLedgerPostingId(null);
  }

  const meterOk = Math.abs(totalPct - 100) < 0.001;

  if (!user) {
    return (
      <div className="mt-8 rounded-3xl border border-white/10 bg-white/[0.03] p-10 text-center">
        <Wallet className="mx-auto h-10 w-10 text-primary/60" aria-hidden="true" />
        <p className="mt-4 text-sm text-white/60">{t("wave8.splits.signInPrompt")}</p>
      </div>
    );
  }

  return (
    <div className="mt-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-xl font-black text-white">{t("wave8.splits.title")}</h3>
          <p className="mt-1 text-sm text-white/50">{t("wave8.splits.subtitle")}</p>
        </div>
        <button
          onClick={() => { setShowForm((v) => !v); setFormError(null); }}
          className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-br from-[#f5d67b] via-primary to-[#8a6d1f] px-5 py-2.5 text-sm font-black text-black shadow-[0_4px_20px_rgba(212,175,55,0.35)] transition hover:scale-[1.03] active:scale-95"
        >
          {showForm ? <X className="h-4 w-4" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
          {showForm ? t("wave8.splits.closeForm") : t("wave8.splits.newSheet")}
        </button>
      </div>

      {showForm && (
        <div className="mt-6 rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-8">
          <p className={sectionTitle}>{t("wave8.splits.newSheet")}</p>
          <div>
            <label className={labelClass}>{t("wave8.splits.songTitle")}</label>
            <input
              value={fTitle}
              onChange={(e) => setFTitle(e.target.value)}
              maxLength={120}
              placeholder={t("wave8.splits.songTitlePlaceholder")}
              className={inputClass}
            />
          </div>

          <p className={`${labelClass} mt-6`}>{t("wave8.splits.collaborators")}</p>
          <div className="space-y-2">
            {fRows.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  value={row.name}
                  onChange={(e) => updateRow(i, { name: e.target.value })}
                  maxLength={80}
                  placeholder={t("wave8.splits.namePlaceholder")}
                  aria-label={t("wave8.splits.name")}
                  className={`${inputClass} flex-[3]`}
                />
                <input
                  value={row.role}
                  onChange={(e) => updateRow(i, { role: e.target.value })}
                  maxLength={40}
                  placeholder={t("wave8.splits.rolePlaceholder")}
                  aria-label={t("wave8.splits.role")}
                  className={`${inputClass} flex-[2]`}
                />
                <div className="relative w-24 shrink-0">
                  <input
                    value={row.pct}
                    onChange={(e) => updateRow(i, { pct: e.target.value.replace(/[^0-9.]/g, "") })}
                    inputMode="decimal"
                    placeholder="0"
                    aria-label={t("wave8.splits.sharePct")}
                    className={`${inputClass} pr-7`}
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-white/40">%</span>
                </div>
                {fRows.length > 1 && (
                  <button
                    onClick={() => removeRow(i)}
                    aria-label={t("wave8.splits.removeRow")}
                    className="shrink-0 rounded-lg border border-white/10 p-2 text-white/40 transition hover:border-red-500/50 hover:text-red-300"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            onClick={addRow}
            disabled={fRows.length >= 20}
            className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-bold text-white/70 transition hover:border-primary/40 hover:text-white disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> {t("wave8.splits.addCollaborator")}
          </button>

          {/* live total meter */}
          <div className="mt-5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold uppercase tracking-widest text-white/40">{t("wave8.splits.total")}</span>
              <span className={`font-black ${meterOk ? "text-primary" : "text-red-300"}`}>
                {Number.isFinite(totalPct) ? totalPct.toFixed(2).replace(/\.?0+$/, "") : "0"}%
              </span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className={`h-full rounded-full transition-all ${meterOk ? "bg-gradient-to-r from-[#f5d67b] to-primary" : "bg-red-500"}`}
                style={{ width: `${Math.min(100, (totalPct / 100) * 100)}%` }}
              />
            </div>
            {!meterOk && (
              <p className="mt-1.5 text-xs text-red-300/80">{t("wave8.splits.totalHint")}</p>
            )}
          </div>

          {formError && (
            <p className="mt-3 flex items-center gap-1.5 text-sm text-red-300">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" /> {formError}
            </p>
          )}
          <button
            onClick={handleSave}
            disabled={saving || !formValid}
            className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-gradient-to-br from-[#f5d67b] via-primary to-[#8a6d1f] px-8 py-3 text-sm font-black text-black shadow-[0_4px_20px_rgba(212,175,55,0.35)] transition hover:scale-[1.03] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
            {saving ? t("wave8.splits.saving") : t("wave8.splits.saveSheet")}
          </button>
        </div>
      )}

      {/* ── saved sheets ─────────────────────────────────────────────── */}
      <div className="mt-8 rounded-3xl border border-white/10 bg-white/[0.03] p-5 md:p-6">
        <p className={sectionTitle}>{t("wave8.splits.savedSheets")}</p>
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-white/50">
            <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
          </div>
        ) : error ? (
          <div className="py-6 text-center">
            <p className="text-sm text-white/60">{error}</p>
            <button
              onClick={loadSheets}
              className="mt-4 rounded-2xl border border-primary/40 bg-primary/10 px-5 py-2.5 text-sm font-bold text-primary transition hover:bg-primary/20"
            >
              {t("wave8.splits.retry")}
            </button>
          </div>
        ) : sheets.length === 0 ? (
          <p className="py-8 text-center text-sm text-white/40">{t("wave8.splits.empty")}</p>
        ) : (
          <div className="space-y-4">
            {sheets.map((sheet) => {
              const posting = ledgerPostingId === sheet.id;
              const generating = generatingId === sheet.id;
              return (
                <div key={sheet.id} className="rounded-2xl border border-white/10 bg-black/40 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-base font-black text-white">{sheet.songTitle}</p>
                      <p className="mt-0.5 text-xs text-white/40">
                        {t("wave8.splits.createdOn", {
                          date: new Date(sheet.createdAt).toLocaleDateString("en-US", {
                            month: "short", day: "numeric", year: "numeric",
                          }),
                        })}
                      </p>
                    </div>
                    {confirmDeleteId === sheet.id ? (
                      <span className="flex items-center gap-1.5">
                        <span className="text-xs text-white/50">{t("wave8.splits.confirmDelete")}</span>
                        <button
                          onClick={() => handleDelete(sheet.id)}
                          disabled={deletingId === sheet.id}
                          className="rounded-lg bg-red-500 px-2.5 py-1.5 text-xs font-bold text-black transition hover:brightness-110 disabled:opacity-50"
                        >
                          {deletingId === sheet.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : t("wave8.splits.confirmYes")}
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="rounded-lg border border-white/15 px-2.5 py-1.5 text-xs font-bold text-white/60 transition hover:text-white"
                        >
                          {t("wave8.splits.cancel")}
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() => setConfirmDeleteId(sheet.id)}
                        aria-label={t("wave8.splits.deleteSheet")}
                        className="rounded-lg border border-white/10 p-1.5 text-white/40 transition hover:border-red-500/50 hover:text-red-300"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    )}
                  </div>

                  <div className="mt-4 overflow-hidden rounded-xl border border-white/[0.07]">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-white/[0.03] text-left text-[11px] uppercase tracking-widest text-white/40">
                          <th className="px-4 py-2 font-bold">{t("wave8.splits.name")}</th>
                          <th className="px-4 py-2 font-bold">{t("wave8.splits.role")}</th>
                          <th className="px-4 py-2 text-right font-bold">{t("wave8.splits.sharePct")}</th>
                          <th className="px-4 py-2 text-right font-bold" aria-label="ledger status" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/[0.06]">
                        {sheet.collaborators.map((c, i) => {
                          const st = rowStatus[`${sheet.id}:${i}`] ?? "idle";
                          return (
                            <tr key={i}>
                              <td className="px-4 py-2.5 font-semibold text-white">{c.name}</td>
                              <td className="px-4 py-2.5 text-white/50">{c.role || "—"}</td>
                              <td className="px-4 py-2.5 text-right font-black text-primary">{c.pct}%</td>
                              <td className="px-4 py-2.5 text-right">
                                {st === "posting" && <Loader2 className="ml-auto h-4 w-4 animate-spin text-primary" aria-hidden="true" />}
                                {st === "posted" && (
                                  <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-300">
                                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> {t("wave8.splits.posted")}
                                  </span>
                                )}
                                {st === "failed" && (
                                  <span className="inline-flex items-center gap-1 text-xs font-bold text-red-300">
                                    <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> {t("wave8.splits.failed")}
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* post to income ledger */}
                  <div className="mt-4 flex flex-wrap items-end gap-3">
                    <div className="w-44">
                      <label className={labelClass}>{t("wave8.splits.royaltyAmount")}</label>
                      <input
                        value={amounts[sheet.id] ?? ""}
                        onChange={(e) => setAmounts((prev) => ({ ...prev, [sheet.id]: e.target.value.replace(/[^0-9.]/g, "") }))}
                        inputMode="decimal"
                        placeholder={t("wave8.splits.royaltyAmountPlaceholder")}
                        className={inputClass}
                      />
                    </div>
                    <button
                      onClick={() => handlePostToLedger(sheet)}
                      disabled={posting}
                      className="inline-flex items-center gap-2 rounded-2xl border border-primary/40 bg-primary/10 px-5 py-2.5 text-sm font-bold text-primary transition hover:bg-primary/20 disabled:opacity-50"
                    >
                      {posting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Wallet className="h-4 w-4" aria-hidden="true" />}
                      {posting ? t("wave8.splits.posting") : t("wave8.splits.postToLedger")}
                    </button>
                    {ledgerMsg[sheet.id] && (
                      <p className="w-full text-xs font-semibold text-emerald-300">{ledgerMsg[sheet.id]}</p>
                    )}
                  </div>

                  {/* generate PDF */}
                  <div className="mt-4 border-t border-white/[0.07] pt-4">
                    <button
                      onClick={() => handleGeneratePdf(sheet)}
                      disabled={generating}
                      className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-br from-[#f5d67b] via-primary to-[#8a6d1f] px-5 py-2.5 text-sm font-black text-black shadow-[0_4px_20px_rgba(212,175,55,0.35)] transition hover:scale-[1.03] active:scale-95 disabled:opacity-50"
                    >
                      {generating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <FileDown className="h-4 w-4" aria-hidden="true" />}
                      {generating ? t("wave8.splits.generating") : t("wave8.splits.generatePdf")}
                    </button>
                    <p className="mt-2 text-xs text-white/35">{t("wave8.splits.pdfNote")}</p>
                    {cardError[sheet.id] && (
                      <p className="mt-2 flex items-center gap-1.5 text-sm text-red-300">
                        <AlertTriangle className="h-4 w-4" aria-hidden="true" /> {cardError[sheet.id]}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
