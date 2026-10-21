import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import {
  Receipt, Loader2, Sparkles, Download, Mail, Plus, Trash2, Check,
  BadgeCheck, Wallet, FileText,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useTranslation } from "react-i18next";

/* ─── Sponsor Invoice Generator panel ─────────────────────────────────────
   Mounted INSIDE the Sponsorship Outreach page (/sponsorship-outreach),
   right next to the sponsor-read generator. The read fulfills the landed
   deal creatively — the invoice fulfills it financially.
   POST /api/generate-invoice → 50 Visual Bucs per PDF.
   Handoff chain: invoice marked paid → "Log to Money Tracker" deep link
   (/coach?tab=money&income=<dollars>&note=<text>) the sibling MoneyTrackerPanel
   consumes on mount, prefilled as an invoice_payout income entry. */

const INVOICE_COST = 50;

const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD"] as const;

interface LineItemDraft {
  description: string;
  quantity: string;
  rate: string; // dollars, human-entered; converted to cents on submit
}

interface InvoiceLineItem {
  description: string;
  quantity: number;
  rateCents: number;
}

interface InvoiceRecord {
  id: string;
  invoiceNumber: string;
  brandName: string;
  brandEmail: string | null;
  creatorName: string;
  creatorEmail: string | null;
  paymentDetails: string | null;
  lineItems: InvoiceLineItem[];
  totalCents: number;
  currency: string;
  dueDate: string;
  notes: string | null;
  status: "unpaid" | "paid";
  paidAt: string | null;
  createdAt: string;
}

interface GenerateResponse {
  invoice?: InvoiceRecord;
  pdfBase64?: string;
  pdfFilename?: string;
  creditsUsed?: number;
  creditsRemaining?: number;
  error?: string;
  message?: string;
}

interface InvoiceGeneratorPanelProps {
  prefillBrand?: string;
  prefillCreator?: string;
}

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

const labelClass = "mb-1.5 block text-xs font-semibold uppercase tracking-wider text-white/50";

function defaultDueDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString().slice(0, 10);
}

function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
  } catch {
    return `${currency} ${(cents / 100).toFixed(2)}`;
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function downloadBase64Pdf(base64: string, filename: string): void {
  const link = document.createElement("a");
  link.href = `data:application/pdf;base64,${base64}`;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export default function InvoiceGeneratorPanel({ prefillBrand, prefillCreator }: InvoiceGeneratorPanelProps) {
  const { t } = useTranslation();
  const { user, getAccessToken, refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const [, navigate] = useLocation();

  const [brandName, setBrandName] = useState("");
  const [brandEmail, setBrandEmail] = useState("");
  const [creatorName, setCreatorName] = useState("");
  const [creatorEmail, setCreatorEmail] = useState("");
  const [paymentDetails, setPaymentDetails] = useState("");
  const [dueDate, setDueDate] = useState(defaultDueDate);
  const [currency, setCurrency] = useState<(typeof CURRENCIES)[number]>("USD");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<LineItemDraft[]>([
    { description: "", quantity: "1", rate: "" },
  ]);

  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const brandTouched = useRef(false);
  const creatorTouched = useRef(false);

  /* Prefill from the surrounding workflow: the brand the creator is pitching
     above, and the active artist's name — only until the user types. */
  useEffect(() => {
    if (prefillBrand && !brandTouched.current) setBrandName(prefillBrand);
  }, [prefillBrand]);
  useEffect(() => {
    if (prefillCreator && !creatorTouched.current) setCreatorName(prefillCreator);
  }, [prefillCreator]);

  const totalCents = items.reduce((sum, it) => {
    const qty = Number(it.quantity);
    const rate = Number(it.rate);
    if (!Number.isFinite(qty) || !Number.isFinite(rate) || qty <= 0 || rate < 0) return sum;
    return sum + Math.round(qty * rate * 100);
  }, 0);

  function updateItem(i: number, patch: Partial<LineItemDraft>) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }

  function addItem() {
    if (items.length >= 25) return;
    setItems((prev) => [...prev, { description: "", quantity: "1", rate: "" }]);
  }

  function removeItem(i: number) {
    if (items.length <= 1) return;
    setItems((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function authed(path: string, init?: RequestInit) {
    const token = await getAccessToken();
    return fetch(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers ?? {}),
      },
    });
  }

  async function loadInvoices() {
    if (!user) return;
    setListLoading(true);
    try {
      const res = await authed("/api/invoices");
      const data = (await res.json().catch(() => ({}))) as { invoices?: InvoiceRecord[] };
      if (res.ok && Array.isArray(data.invoices)) setInvoices(data.invoices);
    } catch {
      /* list is a convenience — form still works if it fails */
    } finally {
      setListLoading(false);
    }
  }

  useEffect(() => {
    void loadInvoices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function generate() {
    if (loading || !user) return;
    const lineItems = items
      .map((it) => ({
        description: it.description.trim(),
        quantity: Number(it.quantity),
        rateCents: Math.round(Number(it.rate) * 100),
      }))
      .filter((it) => it.description && it.quantity > 0 && Number.isFinite(it.rateCents) && it.rateCents >= 0);
    if (!brandName.trim() || !creatorName.trim() || lineItems.length === 0) {
      setError(t("outreach.invoice.fillRequired"));
      return;
    }
    setLoading(true);
    setError(null);
    setNotice(null);
    setOutOfCredits(false);
    try {
      const token = await getAccessToken();
      const res = await confirmedFetch("/api/generate-invoice", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        overrideCost: INVOICE_COST,
        overrideFeature: "Generate Invoice",
        body: JSON.stringify({
          brandName: brandName.trim(),
          brandEmail: brandEmail.trim(),
          creatorName: creatorName.trim(),
          creatorEmail: creatorEmail.trim(),
          paymentDetails: paymentDetails.trim(),
          lineItems,
          currency,
          dueDate,
          notes: notes.trim(),
        }),
      });
      if (!res) return; // user cancelled the credit confirmation
      const data = (await res.json().catch(() => ({}))) as GenerateResponse;
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || !data.invoice || !data.pdfBase64) {
        throw new Error(data.message || data.error || t("outreach.invoice.failed"));
      }
      downloadBase64Pdf(data.pdfBase64, data.pdfFilename ?? `${data.invoice.invoiceNumber}.pdf`);
      refreshProfile();
      await loadInvoices();
      setTimeout(() => {
        document.getElementById("invoice-results")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("outreach.invoice.failed"));
    } finally {
      setLoading(false);
    }
  }

  async function downloadPdf(inv: InvoiceRecord) {
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/invoices/${inv.id}/pdf`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${inv.invoiceNumber}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch {
      setError(t("outreach.invoice.failed"));
    }
  }

  function emailHref(inv: InvoiceRecord): string {
    const to = inv.brandEmail ?? "";
    const subject = t("outreach.invoice.mailSubject", {
      number: inv.invoiceNumber,
      creator: inv.creatorName,
    });
    const body = t("outreach.invoice.mailBody", {
      brand: inv.brandName,
      number: inv.invoiceNumber,
      total: formatMoney(inv.totalCents, inv.currency),
      due: formatDate(inv.dueDate),
      payment: inv.paymentDetails ?? "—",
      creator: inv.creatorName,
    });
    return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  async function setStatus(inv: InvoiceRecord, status: "paid" | "unpaid") {
    if (updatingId) return;
    setUpdatingId(inv.id);
    setError(null);
    setNotice(null);
    try {
      const res = await authed(`/api/invoices/${inv.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      const data = (await res.json().catch(() => ({}))) as { invoice?: InvoiceRecord };
      if (!res.ok || !data.invoice) throw new Error("status update failed");
      setInvoices((prev) => prev.map((x) => (x.id === inv.id ? data.invoice! : x)));
      if (status === "paid") setNotice(t("outreach.invoice.paidNotice"));
    } catch {
      setError(t("outreach.invoice.statusFailed"));
    } finally {
      setUpdatingId(null);
    }
  }

  /* Handoff → Money Tracker: the paid invoice becomes an income entry.
     Deep-link protocol owned by the sibling MoneyTrackerPanel
     (/coach page, "money" tab): /coach?tab=money&income=<dollars>&note=<text>
     It opens the entry form prefilled as an "invoice_payout" income entry,
     so the paid invoice lands in the ledger in one tap. */
  function logToMoneyTracker(inv: InvoiceRecord) {
    const dollars = (inv.totalCents / 100).toFixed(2);
    const note = `Invoice ${inv.invoiceNumber} — ${inv.brandName}`;
    navigate(`/coach?tab=money&income=${encodeURIComponent(dollars)}&note=${encodeURIComponent(note)}`);
  }

  return (
    <section className="relative mt-12 rounded-2xl border border-primary/25 bg-gradient-to-b from-primary/[0.07] to-transparent p-6 md:p-8">
      {/* header */}
      <div className="text-center">
        <p className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-primary">
          <Receipt className="h-3 w-3" aria-hidden="true" /> {t("outreach.invoice.badge")}
        </p>
        <h2 className="font-display text-2xl font-black tracking-tight md:text-3xl">
          {t("outreach.invoice.title")}
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-white/55">
          {t("outreach.invoice.subtitle")}
        </p>
      </div>

      {/* form */}
      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <div className="space-y-4">
          <div>
            <label className={labelClass} htmlFor="invoice-brand">{t("outreach.invoice.brandLabel")}</label>
            <input
              id="invoice-brand"
              className={inputClass}
              value={brandName}
              onChange={(e) => {
                brandTouched.current = true;
                setBrandName(e.target.value);
              }}
              placeholder={t("outreach.invoice.brandPlaceholder")}
              maxLength={100}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="invoice-brand-email">{t("outreach.invoice.brandEmailLabel")}</label>
            <input
              id="invoice-brand-email"
              type="email"
              className={inputClass}
              value={brandEmail}
              onChange={(e) => setBrandEmail(e.target.value)}
              placeholder={t("outreach.invoice.brandEmailPlaceholder")}
              maxLength={200}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="invoice-creator">{t("outreach.invoice.creatorLabel")}</label>
            <input
              id="invoice-creator"
              className={inputClass}
              value={creatorName}
              onChange={(e) => {
                creatorTouched.current = true;
                setCreatorName(e.target.value);
              }}
              placeholder={t("outreach.invoice.creatorPlaceholder")}
              maxLength={100}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="invoice-creator-email">{t("outreach.invoice.creatorEmailLabel")}</label>
            <input
              id="invoice-creator-email"
              type="email"
              className={inputClass}
              value={creatorEmail}
              onChange={(e) => setCreatorEmail(e.target.value)}
              placeholder={t("outreach.invoice.creatorEmailPlaceholder")}
              maxLength={200}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="invoice-payment">{t("outreach.invoice.paymentLabel")}</label>
            <input
              id="invoice-payment"
              className={inputClass}
              value={paymentDetails}
              onChange={(e) => setPaymentDetails(e.target.value)}
              placeholder={t("outreach.invoice.paymentPlaceholder")}
              maxLength={500}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass} htmlFor="invoice-due">{t("outreach.invoice.dueLabel")}</label>
              <input
                id="invoice-due"
                type="date"
                className={inputClass}
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="invoice-currency">{t("outreach.invoice.currencyLabel")}</label>
              <select
                id="invoice-currency"
                className={`${inputClass} appearance-none`}
                value={currency}
                onChange={(e) => setCurrency(e.target.value as (typeof CURRENCIES)[number])}
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c} className="bg-black">{c}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between">
              <span className={labelClass}>{t("outreach.invoice.itemsTitle")}</span>
              <span className="text-sm font-bold text-primary">{formatMoney(totalCents, currency)}</span>
            </div>
            <div className="space-y-3">
              {items.map((it, i) => (
                <div key={i} className="rounded-xl border border-white/10 bg-black/40 p-3">
                  <input
                    className={inputClass}
                    value={it.description}
                    onChange={(e) => updateItem(i, { description: e.target.value })}
                    placeholder={t("outreach.invoice.descPlaceholder")}
                    maxLength={200}
                    aria-label={t("outreach.invoice.itemsTitle")}
                  />
                  <div className="mt-2 flex gap-2">
                    <div className="w-20">
                      <input
                        className={inputClass}
                        type="number"
                        min="0.01"
                        step="any"
                        value={it.quantity}
                        onChange={(e) => updateItem(i, { quantity: e.target.value })}
                        aria-label={t("outreach.invoice.qtyLabel")}
                        title={t("outreach.invoice.qtyLabel")}
                      />
                    </div>
                    <div className="flex-1">
                      <input
                        className={inputClass}
                        type="number"
                        min="0"
                        step="0.01"
                        value={it.rate}
                        onChange={(e) => updateItem(i, { rate: e.target.value })}
                        placeholder={t("outreach.invoice.rateLabel")}
                        aria-label={t("outreach.invoice.rateLabel")}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeItem(i)}
                      disabled={items.length <= 1}
                      className="shrink-0 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-white/50 transition hover:border-red-400/40 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-30"
                      aria-label={t("outreach.invoice.removeItem")}
                      title={t("outreach.invoice.removeItem")}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {items.length < 25 && (
              <button
                type="button"
                onClick={addItem}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-xs font-bold text-primary transition hover:bg-primary/20"
              >
                <Plus className="h-3.5 w-3.5" /> {t("outreach.invoice.addItem")}
              </button>
            )}
          </div>
          <div>
            <label className={labelClass} htmlFor="invoice-notes">{t("outreach.invoice.notesLabel")}</label>
            <textarea
              id="invoice-notes"
              className={inputClass}
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t("outreach.invoice.notesPlaceholder")}
              maxLength={1000}
            />
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="mt-8 text-center">
        <button
          onClick={generate}
          disabled={loading || !user}
          className="inline-flex items-center gap-2 rounded-full bg-primary px-8 py-3.5 text-sm font-bold text-black shadow-[0_0_24px_rgba(212,175,55,0.35)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {loading ? t("outreach.invoice.generating") : t("outreach.invoice.generate", { cost: INVOICE_COST })}
        </button>
        <p className="mt-2 text-xs text-white/35">
          {t("outreach.invoice.autoNumber")}
        </p>
        {!user && <p className="mt-3 text-xs text-white/40">{t("outreach.invoice.signInPrompt")}</p>}
        {error && <p className="mx-auto mt-4 max-w-md text-sm text-red-400">{error}</p>}
        {notice && (
          <p className="mx-auto mt-4 flex max-w-md items-center justify-center gap-1.5 text-sm text-emerald-400">
            <Check className="h-4 w-4" /> {notice}
          </p>
        )}
        {outOfCredits && (
          <div className="mx-auto mt-4 max-w-md">
            <OutOfCredits />
          </div>
        )}
      </div>

      {/* invoice list */}
      <div id="invoice-results" className="mt-10">
        <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-primary">
          <FileText className="h-4 w-4" /> {t("outreach.invoice.listTitle")}
        </h3>
        {listLoading ? (
          <p className="mt-4 flex items-center gap-2 text-sm text-white/40">
            <Loader2 className="h-4 w-4 animate-spin" /> …
          </p>
        ) : invoices.length === 0 ? (
          <p className="mt-4 text-sm text-white/40">{t("outreach.invoice.listEmpty")}</p>
        ) : (
          <div className="mt-4 space-y-3">
            {invoices.map((inv) => (
              <div
                key={inv.id}
                className="flex flex-col gap-3 rounded-xl border border-white/10 bg-black/40 p-4 md:flex-row md:items-center md:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-bold text-white">{inv.invoiceNumber}</p>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${
                        inv.status === "paid"
                          ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
                          : "border-amber-400/40 bg-amber-400/10 text-amber-300"
                      }`}
                    >
                      {inv.status === "paid" && <BadgeCheck className="h-3 w-3" />}
                      {inv.status === "paid" ? t("outreach.invoice.paid") : t("outreach.invoice.unpaid")}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-xs text-white/50">
                    {inv.brandName} · {formatMoney(inv.totalCents, inv.currency)} ·{" "}
                    {t("outreach.invoice.dueLabel")}: {formatDate(inv.dueDate)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => downloadPdf(inv)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-white/60 transition hover:border-primary/40 hover:text-white"
                  >
                    <Download className="h-3.5 w-3.5" /> {t("outreach.invoice.download")}
                  </button>
                  <a
                    href={emailHref(inv)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-white/60 transition hover:border-primary/40 hover:text-white"
                  >
                    <Mail className="h-3.5 w-3.5" /> {t("outreach.invoice.sendEmail")}
                  </a>
                  <button
                    type="button"
                    onClick={() => setStatus(inv, inv.status === "paid" ? "unpaid" : "paid")}
                    disabled={updatingId === inv.id}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary transition hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {updatingId === inv.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Check className="h-3.5 w-3.5" />
                    )}
                    {inv.status === "paid" ? t("outreach.invoice.markUnpaid") : t("outreach.invoice.markPaid")}
                  </button>
                  {inv.status === "paid" && (
                    <button
                      type="button"
                      onClick={() => logToMoneyTracker(inv)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-black transition hover:brightness-110"
                    >
                      <Wallet className="h-3.5 w-3.5" /> {t("outreach.invoice.logToTracker")}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
