/**
 * BusinessBenches — the six business/social benches with no
 * in-World form until Stack 400 (census Lane B items 10, 13,
 * 14, 22 / manifest items B-10, B-13, B-14, B-22), each on its
 * 2D twin's own rail at the registry's price (lib/world/
 * business-benches.ts):
 *
 *   DealMatchBench       /api/sponsors/match        100
 *   SponsorReadBench     /api/sponsor-read          100
 *   InvoiceBench         /api/generate-invoice      50
 *   OneSheetBench        /api/sync-pitch/one-sheet  150
 *   ContentCalendarBench /api/content-calendar      150
 *   StockBench           /api/stock/search 0 + /api/stock/import 50
 *
 * DealMatch + SponsorRead stack at the Get Paid board beside
 * the in-World Brand Deals desk (the Charts board's outreach
 * panel); Invoice + OneSheet stack there with the business
 * desks; ContentCalendar + Stock stack at the My Studio
 * board beside the Publish desk, the Create Wing's planning
 * home. Every charge rides the registry-priced spend
 * confirmation; the stock search is free and rides a plain
 * authed GET exactly as the editor panel runs it. Copy rides
 * each twin's own catalog namespace.
 */
import { useEffect, useState } from "react";
import {
  CalendarDays, Check, CheckCircle2, Copy, Download, FileText, Handshake,
  Loader2, Megaphone, Music2, Plus, Receipt, Search, Sparkles, Trash2, X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { apiErrorMessage } from "@/lib/api-error";
import { copyText } from "@/lib/streaming";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useHubProject } from "@/lib/hub-project";
import { DeskSelectField, DeskTextField, useDeskAuthHeaders } from "./CreateDeskLeaf";
import { NativeCard } from "./NativeCard";
import { NativeEmptyState, NativeErrorState, NativeLoadingState } from "./NativeStates";
import {
  CALENDAR_PLATFORMS,
  CONTENT_CALENDAR_PATH,
  DEAL_MATCH_PATH,
  INVOICE_CURRENCIES,
  INVOICE_GENERATE_PATH,
  INVOICES_PATH,
  ONE_SHEET_DEFAULT_ENERGY,
  ONE_SHEET_PATH,
  SPONSOR_READ_LENGTHS,
  SPONSOR_READ_MAX_POINTS,
  SPONSOR_READ_PATH,
  SPONSOR_READ_TONE_LABEL_KEYS,
  SPONSOR_READ_TONES,
  STOCK_IMPORT_PATH,
  STOCK_PER_PAGE,
  STOCK_TYPES,
  calendarDaysOf,
  calendarTodayISO,
  contentCalendarCost,
  contentCalendarPayload,
  dealMatchCanRun,
  dealMatchCost,
  dealMatchPayload,
  dealMatchesOf,
  downloadBase64Pdf,
  formatInvoiceDate,
  formatInvoiceMoney,
  invoiceCanRun,
  invoiceCost,
  invoiceDefaultDueDate,
  invoiceGeneratedOf,
  invoiceListOf,
  invoicePayload,
  invoiceStatusPath,
  invoiceTotalCentsOf,
  invoiceUpdatedOf,
  oneSheetCanRun,
  oneSheetCost,
  oneSheetOf,
  oneSheetPayload,
  oneSheetShareUrl,
  sponsorReadAddPoint,
  sponsorReadCanRun,
  sponsorReadCost,
  sponsorReadOf,
  sponsorReadPayload,
  stockImportCost,
  stockImportPayload,
  stockImportedOf,
  stockNotConfigured,
  stockSearchOf,
  stockSearchUrl,
  type CalendarDay,
  type CalendarPlatform,
  type DealMatch,
  type InvoiceCurrency,
  type InvoiceLineDraft,
  type InvoiceRecord,
  type OneSheet,
  type SponsorRead,
  type SponsorReadLength,
  type SponsorReadTone,
  type StockItem,
  type StockType,
} from "@/lib/world/business-benches";

type BenchStatus = "idle" | "working" | "done" | "failed";

function benchPalette(isLight: boolean) {
  return {
    muted: isLight ? "text-[#6B5B36]" : "text-white/50",
    strong: isLight ? "text-[#2a1e07]" : "text-white",
    cardCls: isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5",
    chipCls: (active: boolean) =>
      `rounded-xl border px-3 py-2 text-left text-xs transition bdv-touch-target ${
        active
          ? isLight
            ? "border-[#C9A84C] bg-[#F7ECD2] text-[#2a1e07]"
            : "border-amber-400 bg-amber-400/[0.16] text-amber-200"
          : isLight
            ? "border-[#C9A84C]/30 text-[#6B5B36] hover:border-[#C9A84C]/60"
            : "border-white/10 text-white/60 hover:border-white/30"
      }`,
  };
}

function BenchHeader({
  isLight, icon, title, cost, strong,
}: {
  isLight: boolean;
  icon: React.ReactNode;
  title: string;
  cost: number;
  strong: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className={isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}>{icon}</span>
      <p className={`text-base font-black ${strong}`}>{title}</p>
      <span className={`ml-auto rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${isLight ? "border-[#C9A84C]/50 text-[#7A5A12]" : "border-[#d4af37]/40 bg-[#d4af37]/10 text-[#e8c86a]"}`}>
        {cost} VB
      </span>
    </div>
  );
}

function OutOfBucsLine({ isLight, feature }: { isLight: boolean; feature: string }) {
  const { t } = useTranslation();
  return (
    <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>
      {t("worldBenches300.outOfBucs", { feature })}
    </p>
  );
}

/* ─── B-10 · Deal Matcher ───────────────────────────────────── */

export function DealMatchBench({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  const { confirmedFetch } = useConfirmedApi();
  const authHeaders = useDeskAuthHeaders();

  const [niche, setNiche] = useState("");
  const [followers, setFollowers] = useState("");
  const [platforms, setPlatforms] = useState("");
  const [status, setStatus] = useState<BenchStatus>("idle");
  const [matches, setMatches] = useState<DealMatch[] | null>(null);
  const [note, setNote] = useState("");
  const [creditsRemaining, setCreditsRemaining] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  const cost = dealMatchCost();
  const busy = status === "working";
  const { muted, strong, cardCls } = benchPalette(isLight);

  async function runMatcher() {
    const input = { niche, followers, platforms };
    if (busy) return;
    if (!dealMatchCanRun(input)) {
      setError(t("sponsors.errorNicheFirst"));
      return;
    }
    setStatus("working");
    setError(null);
    setOutOfCredits(false);
    try {
      const res = await confirmedFetch(DEAL_MATCH_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(dealMatchPayload(input)),
        overrideCost: cost,
        overrideFeature: "Sponsor Match",
      });
      if (!res) { setStatus("idle"); return; } // spend confirmation declined — nothing ran
      const data: unknown = await res.json().catch(() => null);
      if (res.status === 402) {
        setOutOfCredits(true);
        setStatus("idle");
        return;
      }
      const result = dealMatchesOf(data);
      if (!res.ok || !result) {
        setStatus("failed");
        setError(apiErrorMessage(data, t("sponsors.errorMatcher")));
        return;
      }
      setMatches(result.matches);
      setNote(result.note);
      setCreditsRemaining(result.creditsRemaining);
      setStatus("done");
    } catch {
      setStatus("failed");
      setError(t("sponsors.errorMatcher"));
    }
  }

  return (
    <NativeCard isLight={isLight}>
      <div className="space-y-3" data-testid="world-deal-match-bench">
        <BenchHeader
          isLight={isLight}
          icon={<Handshake className="h-4 w-4" />}
          title={`${t("sponsors.matcherTitleA")} ${t("sponsors.matcherTitleAccent")}`}
          cost={cost}
          strong={strong}
        />
        <p className={`text-xs ${muted}`}>{t("sponsors.matcherSubtitle")}</p>

        <div className="grid gap-3 sm:grid-cols-3">
          <DeskTextField
            isLight={isLight}
            label={t("sponsors.matchNicheLabel")}
            value={niche}
            onChange={setNiche}
            placeholder={t("sponsors.matchNichePlaceholder")}
          />
          <DeskTextField
            isLight={isLight}
            label={t("sponsors.matchFollowersLabel")}
            value={followers}
            onChange={setFollowers}
            placeholder={t("sponsors.matchFollowersPlaceholder")}
          />
          <DeskTextField
            isLight={isLight}
            label={t("sponsors.matchPlatformsLabel")}
            value={platforms}
            onChange={setPlatforms}
            placeholder={t("sponsors.matchPlatformsPlaceholder")}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            data-testid="world-deal-match-run"
            onClick={() => void runMatcher()}
            disabled={busy}
            className="ml-auto inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50 bdv-touch-target"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {busy ? t("sponsors.matching") : t("sponsors.findMatchesButton", { cost })}
          </button>
        </div>

        {error && status !== "failed" && (
          <p className={`text-xs font-semibold ${isLight ? "text-red-800" : "text-red-300"}`}>{error}</p>
        )}
        {outOfCredits && <OutOfBucsLine isLight={isLight} feature="Sponsor Match" />}

        {status === "working" && <NativeLoadingState isLight={isLight} message={t("worldBizBenches400.dealMatchStateLoading")} />}
        {status === "failed" && (
          <NativeErrorState
            isLight={isLight}
            message={error ?? t("worldBizBenches400.dealMatchStateError")}
            onRetry={() => void runMatcher()}
          />
        )}
        {status === "idle" && matches === null && (
          <NativeEmptyState isLight={isLight} message={t("worldBizBenches400.dealMatchStateEmpty")} />
        )}
        {status === "done" && matches !== null && matches.length === 0 && (
          <NativeEmptyState
            isLight={isLight}
            message={t("sponsors.emptyNoMatch")}
            detail={t("sponsors.emptyNoMatchHint")}
          />
        )}

        {status === "done" && matches !== null && matches.length > 0 && (
          <div className="space-y-2" data-testid="world-deal-match-result">
            {matches.map((m) => (
              <div key={m.dealId} className={`rounded-xl border p-3 ${cardCls}`}>
                <div className="flex items-center gap-2">
                  <p className={`text-sm font-bold ${strong}`}>{m.brandName}</p>
                  <span className={`ml-auto rounded-full border px-2 py-0.5 text-[11px] font-bold ${isLight ? "border-[#C9A84C]/50 text-[#7A5A12]" : "border-[#d4af37]/40 text-[#e8c86a]"}`}>
                    {t("syncPitch.matchScore", { score: m.score })}
                  </span>
                </div>
                {m.why && <p className={`mt-1 text-xs ${muted}`}>{m.why}</p>}
              </div>
            ))}
            {note && <p className={`text-xs ${muted}`}>{note}</p>}
            {creditsRemaining !== null && (
              <p className={`text-[11px] ${muted}`}>{creditsRemaining} VB</p>
            )}
          </div>
        )}
      </div>
    </NativeCard>
  );
}

/* ─── B-22 · Sponsor Read ───────────────────────────────────── */

export function SponsorReadBench({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  const { confirmedFetch } = useConfirmedApi();
  const authHeaders = useDeskAuthHeaders();

  const [brandName, setBrandName] = useState("");
  const [productDescription, setProductDescription] = useState("");
  const [readLength, setReadLength] = useState<SponsorReadLength>("30");
  const [tone, setTone] = useState<SponsorReadTone>("energetic");
  const [keyPoints, setKeyPoints] = useState<string[]>([]);
  const [pointDraft, setPointDraft] = useState("");
  const [status, setStatus] = useState<BenchStatus>("idle");
  const [read, setRead] = useState<SponsorRead | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [copied, setCopied] = useState(false);

  const cost = sponsorReadCost();
  const busy = status === "working";
  const { muted, strong, cardCls, chipCls } = benchPalette(isLight);

  function addPoint() {
    const next = sponsorReadAddPoint(keyPoints, pointDraft);
    if (next !== keyPoints) {
      setKeyPoints(next);
      setPointDraft("");
    }
  }

  async function generate() {
    const input = { brandName, productDescription, readLength, tone, keyPoints };
    if (busy) return;
    if (!sponsorReadCanRun(input)) {
      setError(t("outreach.sponsorReadFillRequired"));
      return;
    }
    setStatus("working");
    setError(null);
    setOutOfCredits(false);
    try {
      const res = await confirmedFetch(SPONSOR_READ_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(sponsorReadPayload(input)),
        overrideCost: cost,
        overrideFeature: "Sponsor Read",
      });
      if (!res) { setStatus("idle"); return; } // spend confirmation declined — nothing ran
      const data: unknown = await res.json().catch(() => null);
      if (res.status === 402 || (data as { error?: string } | null)?.error === "out_of_credits") {
        setOutOfCredits(true);
        setStatus("idle");
        return;
      }
      const parsed = sponsorReadOf(data);
      if (!res.ok || !parsed) {
        setStatus("failed");
        setError(apiErrorMessage(data, t("outreach.sponsorReadFailed")));
        return;
      }
      setRead(parsed);
      setStatus("done");
    } catch {
      setStatus("failed");
      setError(t("outreach.sponsorReadFailed"));
    }
  }

  async function copyScript() {
    if (!read) return;
    const text = `${t("outreach.sponsorReadHook")}: ${read.hookLine}\n\n${read.script}\n\n${t("outreach.sponsorReadCta")}: ${read.ctaLine}`;
    if (await copyText(text)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  return (
    <NativeCard isLight={isLight}>
      <div className="space-y-3" data-testid="world-sponsor-read-bench">
        <BenchHeader
          isLight={isLight}
          icon={<Megaphone className="h-4 w-4" />}
          title={t("outreach.sponsorReadTitle")}
          cost={cost}
          strong={strong}
        />
        <p className={`text-xs ${muted}`}>{t("outreach.sponsorReadSubtitle")}</p>

        <div className="grid gap-3 sm:grid-cols-2">
          <DeskTextField
            isLight={isLight}
            label={t("outreach.sponsorReadBrandLabel")}
            value={brandName}
            onChange={setBrandName}
            placeholder={t("outreach.sponsorReadBrandPlaceholder")}
          />
          <DeskTextField
            isLight={isLight}
            label={t("outreach.sponsorReadProductLabel")}
            value={productDescription}
            onChange={setProductDescription}
            placeholder={t("outreach.sponsorReadProductPlaceholder")}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <DeskSelectField
            isLight={isLight}
            label={t("outreach.sponsorReadLengthLabel")}
            value={readLength}
            onChange={(v) => setReadLength(v as SponsorReadLength)}
            options={SPONSOR_READ_LENGTHS.map((l) => ({ value: l, label: `${l}s` }))}
          />
          <DeskSelectField
            isLight={isLight}
            label={t("outreach.sponsorReadToneLabel")}
            value={tone}
            onChange={(v) => setTone(v as SponsorReadTone)}
            options={SPONSOR_READ_TONES.map((tn) => ({ value: tn, label: t(SPONSOR_READ_TONE_LABEL_KEYS[tn]) }))}
          />
        </div>

        <div>
          <p className={`mb-1 text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
            {t("outreach.sponsorReadPointsLabel")}
          </p>
          <div className="flex gap-2">
            <input
              value={pointDraft}
              onChange={(e) => setPointDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addPoint(); } }}
              placeholder={t("outreach.sponsorReadPointsPlaceholder")}
              className={`min-w-0 flex-1 rounded-xl border px-3 py-2 text-sm outline-none transition ${isLight ? "border-[#C9A84C]/50 bg-white/70 text-[#2a1e07] placeholder:text-[#6B5B36]/60 focus:border-[#C9A84C]" : "border-white/15 bg-white/5 text-white placeholder:text-white/35 focus:border-[#d4af37]/60"}`}
            />
            <button
              type="button"
              onClick={addPoint}
              disabled={keyPoints.length >= SPONSOR_READ_MAX_POINTS}
              className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[#d4af37]/50 px-3 py-2 text-xs font-bold text-[#d4af37] transition hover:bg-[#d4af37]/10 disabled:opacity-50 bdv-touch-target"
            >
              <Plus className="h-3.5 w-3.5" /> +
            </button>
          </div>
          <p className={`mt-1 text-[11px] ${muted}`}>{t("outreach.sponsorReadPointsHint")}</p>
          {keyPoints.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {keyPoints.map((p, i) => (
                <span key={i} className={chipCls(false)}>
                  <span className="inline-flex items-center gap-1.5">
                    {p}
                    <button
                      type="button"
                      aria-label={t("worldBenches300.removeLabel")}
                      onClick={() => setKeyPoints((prev) => prev.filter((_, idx) => idx !== i))}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            data-testid="world-sponsor-read-run"
            onClick={() => void generate()}
            disabled={busy}
            className="ml-auto inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50 bdv-touch-target"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {busy ? t("outreach.sponsorReadWriting") : t("outreach.sponsorReadGenerate", { cost })}
          </button>
        </div>

        {error && status !== "failed" && (
          <p className={`text-xs font-semibold ${isLight ? "text-red-800" : "text-red-300"}`}>{error}</p>
        )}
        {outOfCredits && <OutOfBucsLine isLight={isLight} feature="Sponsor Read" />}

        {status === "working" && <NativeLoadingState isLight={isLight} message={t("worldBizBenches400.sponsorReadStateLoading")} />}
        {status === "failed" && (
          <NativeErrorState
            isLight={isLight}
            message={error ?? t("worldBizBenches400.sponsorReadStateError")}
            onRetry={() => void generate()}
          />
        )}
        {status === "idle" && !read && (
          <NativeEmptyState isLight={isLight} message={t("worldBizBenches400.sponsorReadStateEmpty")} />
        )}

        {read && (
          <div className={`rounded-xl border p-3 ${cardCls}`} data-testid="world-sponsor-read-result">
            <p className={`flex items-center gap-2 text-sm font-semibold ${strong}`}>
              <CheckCircle2 className="h-4 w-4 text-green-500" /> {t("worldBizBenches400.sponsorReadAddedTitle")}
              <span className={`ml-auto text-[11px] font-bold ${muted}`}>
                {t("outreach.sponsorReadEstimated", { seconds: read.estimatedSeconds })}
              </span>
            </p>
            <p className={`mt-2 text-xs font-bold uppercase tracking-widest ${muted}`}>{t("outreach.sponsorReadHook")}</p>
            <p className={`mt-0.5 text-sm ${strong}`}>{read.hookLine}</p>
            <p className={`mt-3 text-xs font-bold uppercase tracking-widest ${muted}`}>{t("outreach.sponsorReadScript")}</p>
            <p className={`mt-0.5 whitespace-pre-wrap text-sm leading-relaxed ${strong}`}>{read.script}</p>
            <p className={`mt-3 text-xs font-bold uppercase tracking-widest ${muted}`}>{t("outreach.sponsorReadCta")}</p>
            <p className={`mt-0.5 text-sm ${strong}`}>{read.ctaLine}</p>
            <button
              type="button"
              onClick={() => void copyScript()}
              className="mt-3 inline-flex items-center gap-2 rounded-full border border-[#d4af37]/50 px-3 py-1.5 text-xs font-bold text-[#d4af37] transition hover:bg-[#d4af37]/10 bdv-touch-target"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? t("syncPitch.copied") : t("worldBenches300.copyLabel")}
            </button>
          </div>
        )}
      </div>
    </NativeCard>
  );
}

/* ─── B-13 · Invoice Generator ──────────────────────────────── */

export function InvoiceBench({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  const { confirmedFetch } = useConfirmedApi();
  const authHeaders = useDeskAuthHeaders();

  const [brandName, setBrandName] = useState("");
  const [brandEmail, setBrandEmail] = useState("");
  const [creatorName, setCreatorName] = useState("");
  const [creatorEmail, setCreatorEmail] = useState("");
  const [paymentDetails, setPaymentDetails] = useState("");
  const [dueDate, setDueDate] = useState(() => invoiceDefaultDueDate());
  const [currency, setCurrency] = useState<InvoiceCurrency>("USD");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<InvoiceLineDraft[]>([{ description: "", quantity: "1", rate: "" }]);

  const [status, setStatus] = useState<BenchStatus>("idle");
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [listState, setListState] = useState<"loading" | "ready" | "failed">("loading");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  const cost = invoiceCost();
  const busy = status === "working";
  const { muted, strong, cardCls } = benchPalette(isLight);
  const totalCents = invoiceTotalCentsOf(items);

  async function loadInvoices() {
    setListState("loading");
    try {
      const res = await fetch(INVOICES_PATH, { headers: await authHeaders() });
      const data: unknown = await res.json().catch(() => null);
      const list = invoiceListOf(data);
      if (!res.ok || !list) {
        setListState("failed");
        return;
      }
      setInvoices(list);
      setListState("ready");
    } catch {
      setListState("failed");
    }
  }

  useEffect(() => {
    void loadInvoices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateItem(i: number, patch: Partial<InvoiceLineDraft>) {
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

  async function generate() {
    const input = {
      brandName, brandEmail, creatorName, creatorEmail, paymentDetails,
      items, currency, dueDate, notes,
    };
    if (busy) return;
    if (!invoiceCanRun(input)) {
      setError(t("outreach.invoice.fillRequired"));
      return;
    }
    setStatus("working");
    setError(null);
    setNotice(null);
    setOutOfCredits(false);
    try {
      const res = await confirmedFetch(INVOICE_GENERATE_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(invoicePayload(input)),
        overrideCost: cost,
        overrideFeature: "Generate Invoice",
      });
      if (!res) { setStatus("idle"); return; } // spend confirmation declined — nothing ran
      const data: unknown = await res.json().catch(() => null);
      if (res.status === 402 || (data as { error?: string } | null)?.error === "out_of_credits") {
        setOutOfCredits(true);
        setStatus("idle");
        return;
      }
      const generated = invoiceGeneratedOf(data);
      if (!res.ok || !generated) {
        setStatus("failed");
        setError(apiErrorMessage(data, t("outreach.invoice.failed")));
        return;
      }
      downloadBase64Pdf(generated.pdfBase64, generated.pdfFilename);
      setNotice(t("worldBizBenches400.invoiceAddedTitle"));
      setStatus("done");
      void loadInvoices();
    } catch {
      setStatus("failed");
      setError(t("outreach.invoice.failed"));
    }
  }

  async function flipStatus(inv: InvoiceRecord) {
    if (updatingId) return;
    const next = inv.status === "paid" ? "unpaid" : "paid";
    setUpdatingId(inv.id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(invoiceStatusPath(inv.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ status: next }),
      });
      const data: unknown = await res.json().catch(() => null);
      const updated = invoiceUpdatedOf(data);
      if (!res.ok || !updated) throw new Error("status update failed");
      setInvoices((prev) => prev.map((x) => (x.id === inv.id ? updated : x)));
      if (next === "paid") setNotice(t("outreach.invoice.paidNotice"));
    } catch {
      setError(t("outreach.invoice.statusFailed"));
    } finally {
      setUpdatingId(null);
    }
  }

  const fieldCls = `w-full rounded-xl border px-3 py-2 text-sm outline-none transition ${isLight ? "border-[#C9A84C]/50 bg-white/70 text-[#2a1e07] placeholder:text-[#6B5B36]/60 focus:border-[#C9A84C]" : "border-white/15 bg-white/5 text-white placeholder:text-white/35 focus:border-[#d4af37]/60"}`;

  return (
    <NativeCard isLight={isLight}>
      <div className="space-y-3" data-testid="world-invoice-bench">
        <BenchHeader
          isLight={isLight}
          icon={<Receipt className="h-4 w-4" />}
          title={t("outreach.invoice.title")}
          cost={cost}
          strong={strong}
        />
        <p className={`text-xs ${muted}`}>{t("outreach.invoice.subtitle")}</p>

        <div className="grid gap-3 sm:grid-cols-2">
          <DeskTextField isLight={isLight} label={t("outreach.invoice.brandLabel")} value={brandName} onChange={setBrandName} placeholder={t("outreach.invoice.brandPlaceholder")} />
          <DeskTextField isLight={isLight} label={t("outreach.invoice.brandEmailLabel")} value={brandEmail} onChange={setBrandEmail} placeholder={t("outreach.invoice.brandEmailPlaceholder")} />
          <DeskTextField isLight={isLight} label={t("outreach.invoice.creatorLabel")} value={creatorName} onChange={setCreatorName} placeholder={t("outreach.invoice.creatorPlaceholder")} />
          <DeskTextField isLight={isLight} label={t("outreach.invoice.creatorEmailLabel")} value={creatorEmail} onChange={setCreatorEmail} placeholder={t("outreach.invoice.creatorEmailPlaceholder")} />
          <DeskTextField isLight={isLight} label={t("outreach.invoice.paymentLabel")} value={paymentDetails} onChange={setPaymentDetails} placeholder={t("outreach.invoice.paymentPlaceholder")} />
          <DeskTextField isLight={isLight} label={t("outreach.invoice.notesLabel")} value={notes} onChange={setNotes} placeholder={t("outreach.invoice.notesPlaceholder")} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={`mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
              {t("outreach.invoice.dueLabel")}
            </span>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={fieldCls} style={{ colorScheme: isLight ? "light" : "dark" }} />
          </label>
          <DeskSelectField
            isLight={isLight}
            label={t("outreach.invoice.currencyLabel")}
            value={currency}
            onChange={(v) => setCurrency(v as InvoiceCurrency)}
            options={INVOICE_CURRENCIES.map((c) => ({ value: c, label: c }))}
          />
        </div>

        <div>
          <p className={`mb-1 text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
            {t("outreach.invoice.itemsTitle")}
          </p>
          <div className="space-y-2">
            {items.map((it, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  value={it.description}
                  onChange={(e) => updateItem(i, { description: e.target.value })}
                  placeholder={t("outreach.invoice.descPlaceholder")}
                  className={`${fieldCls} min-w-0 flex-1`}
                />
                <input
                  value={it.quantity}
                  onChange={(e) => updateItem(i, { quantity: e.target.value })}
                  aria-label={t("outreach.invoice.qtyLabel")}
                  className={`${fieldCls} w-16 shrink-0`}
                />
                <input
                  value={it.rate}
                  onChange={(e) => updateItem(i, { rate: e.target.value })}
                  aria-label={t("outreach.invoice.rateLabel")}
                  className={`${fieldCls} w-24 shrink-0`}
                />
                <button
                  type="button"
                  onClick={() => removeItem(i)}
                  disabled={items.length <= 1}
                  aria-label={t("outreach.invoice.removeItem")}
                  className="shrink-0 rounded-full border border-white/15 p-2 text-white/50 transition hover:border-red-400/50 hover:text-red-300 disabled:opacity-40 bdv-touch-target"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={addItem}
              className="inline-flex items-center gap-1 rounded-full border border-[#d4af37]/50 px-3 py-1.5 text-xs font-bold text-[#d4af37] transition hover:bg-[#d4af37]/10 bdv-touch-target"
            >
              <Plus className="h-3.5 w-3.5" /> {t("outreach.invoice.addItem")}
            </button>
            <p className={`ml-auto text-sm font-bold ${strong}`}>
              {t("outreach.invoice.total")}: {formatInvoiceMoney(totalCents, currency)}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            data-testid="world-invoice-run"
            onClick={() => void generate()}
            disabled={busy}
            className="ml-auto inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50 bdv-touch-target"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {busy ? t("outreach.invoice.generating") : t("outreach.invoice.generate", { cost })}
          </button>
        </div>

        {error && status !== "failed" && (
          <p className={`text-xs font-semibold ${isLight ? "text-red-800" : "text-red-300"}`}>{error}</p>
        )}
        {notice && (
          <p className={`text-xs font-semibold ${isLight ? "text-green-800" : "text-green-300"}`}>{notice}</p>
        )}
        {outOfCredits && <OutOfBucsLine isLight={isLight} feature="Generate Invoice" />}

        {status === "working" && <NativeLoadingState isLight={isLight} message={t("outreach.invoice.generating")} />}
        {status === "failed" && (
          <NativeErrorState
            isLight={isLight}
            message={error ?? t("outreach.invoice.failed")}
            onRetry={() => void generate()}
          />
        )}

        <div>
          <p className={`mb-2 text-xs font-bold uppercase tracking-widest ${muted}`}>{t("outreach.invoice.listTitle")}</p>
          {listState === "loading" && <NativeLoadingState isLight={isLight} message={t("worldBizBenches400.invoiceStateLoading")} />}
          {listState === "failed" && (
            <NativeErrorState
              isLight={isLight}
              message={t("worldBizBenches400.invoiceStateError")}
              onRetry={() => void loadInvoices()}
            />
          )}
          {listState === "ready" && invoices.length === 0 && (
            <NativeEmptyState isLight={isLight} message={t("worldBizBenches400.invoiceStateEmpty")} />
          )}
          {listState === "ready" && invoices.length > 0 && (
            <div className="space-y-2" data-testid="world-invoice-list">
              {invoices.map((inv) => (
                <div key={inv.id} className={`flex flex-wrap items-center gap-2 rounded-xl border p-3 ${cardCls}`}>
                  <div className="min-w-0">
                    <p className={`truncate text-sm font-bold ${strong}`}>{inv.invoiceNumber} · {inv.brandName}</p>
                    <p className={`text-[11px] ${muted}`}>
                      {formatInvoiceMoney(inv.totalCents, inv.currency)} · {t("outreach.invoice.dueLabel")} {formatInvoiceDate(inv.dueDate)}
                    </p>
                  </div>
                  <span className={`ml-auto rounded-full border px-2 py-0.5 text-[11px] font-bold ${inv.status === "paid" ? "border-green-500/40 text-green-400" : isLight ? "border-[#C9A84C]/50 text-[#7A5A12]" : "border-[#d4af37]/40 text-[#e8c86a]"}`}>
                    {inv.status === "paid" ? t("outreach.invoice.paid") : t("outreach.invoice.unpaid")}
                  </span>
                  <button
                    type="button"
                    onClick={() => void flipStatus(inv)}
                    disabled={updatingId === inv.id}
                    className="inline-flex items-center gap-1 rounded-full bg-[#d4af37] px-3 py-1.5 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50 bdv-touch-target"
                  >
                    {updatingId === inv.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                    {inv.status === "paid" ? t("outreach.invoice.markUnpaid") : t("outreach.invoice.markPaid")}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </NativeCard>
  );
}

/* ─── B-14 · Sync One-Sheet ─────────────────────────────────── */

export function OneSheetBench({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  const { confirmedFetch } = useConfirmedApi();
  const authHeaders = useDeskAuthHeaders();

  const [songTitle, setSongTitle] = useState("");
  const [artistName, setArtistName] = useState("");
  const [genre, setGenre] = useState("");
  const [mood, setMood] = useState("");
  const [bpm, setBpm] = useState("");
  const [musicalKey, setMusicalKey] = useState("");
  const [energy, setEnergy] = useState(ONE_SHEET_DEFAULT_ENERGY);
  const [description, setDescription] = useState("");
  const [instrumentalAvailable, setInstrumentalAvailable] = useState(false);
  const [stemsAvailable, setStemsAvailable] = useState(false);
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [status, setStatus] = useState<BenchStatus>("idle");
  const [sheet, setSheet] = useState<OneSheet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [shared, setShared] = useState(false);

  const cost = oneSheetCost();
  const busy = status === "working";
  const { muted, strong, cardCls } = benchPalette(isLight);
  const c = sheet?.content;

  async function generate() {
    const input = {
      songTitle, artistName, genre, mood, bpm, musicalKey, energy, description,
      instrumentalAvailable, stemsAvailable, contactName, contactEmail,
    };
    if (busy) return;
    if (!oneSheetCanRun(input)) {
      setError(t("syncPitch.titleRequired"));
      return;
    }
    setStatus("working");
    setError(null);
    setOutOfCredits(false);
    setShared(false);
    try {
      const res = await confirmedFetch(ONE_SHEET_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(oneSheetPayload(input)),
        overrideCost: cost,
        overrideFeature: "Sync One-Sheet",
      });
      if (!res) { setStatus("idle"); return; } // spend confirmation declined — nothing ran
      const data: unknown = await res.json().catch(() => null);
      if (res.status === 402 || (data as { error?: string } | null)?.error === "out_of_credits") {
        setOutOfCredits(true);
        setStatus("idle");
        return;
      }
      const parsed = oneSheetOf(data);
      if (!res.ok || !parsed) {
        setStatus("failed");
        setError(apiErrorMessage(data, t("syncPitch.kitFailed")));
        return;
      }
      setSheet(parsed);
      setStatus("done");
    } catch {
      setStatus("failed");
      setError(t("syncPitch.kitFailed"));
    }
  }

  async function copyShare() {
    if (!sheet) return;
    if (await copyText(oneSheetShareUrl(window.location.origin, sheet))) {
      setShared(true);
      setTimeout(() => setShared(false), 2000);
    }
  }

  const checkCls = `flex cursor-pointer items-center gap-2 rounded-xl border p-3 text-sm ${cardCls}`;

  return (
    <NativeCard isLight={isLight}>
      <div className="space-y-3" data-testid="world-one-sheet-bench">
        <BenchHeader
          isLight={isLight}
          icon={<FileText className="h-4 w-4" />}
          title={t("syncPitch.publicTitle")}
          cost={cost}
          strong={strong}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <DeskTextField isLight={isLight} label={t("syncPitch.yourSong")} value={songTitle} onChange={setSongTitle} placeholder={t("syncPitch.songTitlePlaceholder")} />
          <DeskTextField isLight={isLight} label={t("syncPitch.artistNamePlaceholder")} value={artistName} onChange={setArtistName} placeholder={t("syncPitch.artistNamePlaceholder")} />
          <DeskTextField isLight={isLight} label={t("syncPitch.genrePlaceholder")} value={genre} onChange={setGenre} placeholder={t("syncPitch.genrePlaceholder")} />
          <DeskTextField isLight={isLight} label={t("syncPitch.moodTagsLabel")} value={mood} onChange={setMood} placeholder={t("syncPitch.moodPlaceholder")} />
          <DeskTextField isLight={isLight} label={t("syncPitch.statBpm")} value={bpm} onChange={setBpm} placeholder={t("syncPitch.bpmPlaceholder")} />
          <DeskTextField isLight={isLight} label={t("syncPitch.statKey")} value={musicalKey} onChange={setMusicalKey} placeholder={t("syncPitch.keyPlaceholder")} />
        </div>

        <DeskTextField
          isLight={isLight}
          label={t("syncPitch.descriptionPlaceholder")}
          value={description}
          onChange={setDescription}
          placeholder={t("syncPitch.descriptionPlaceholder")}
        />

        <label className="block">
          <span className={`mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
            Energy · {energy}
          </span>
          <input
            type="range"
            min={0}
            max={100}
            value={energy}
            onChange={(e) => setEnergy(Number(e.target.value))}
            className="w-full accent-amber-400"
          />
        </label>

        <div className="flex flex-wrap gap-3">
          <label className={checkCls}>
            <input type="checkbox" checked={instrumentalAvailable} onChange={(e) => setInstrumentalAvailable(e.target.checked)} className="h-4 w-4 accent-amber-400" />
            <span className={`text-sm font-semibold ${strong}`}>{t("syncPitch.instrumentalAvailable")}</span>
          </label>
          <label className={checkCls}>
            <input type="checkbox" checked={stemsAvailable} onChange={(e) => setStemsAvailable(e.target.checked)} className="h-4 w-4 accent-amber-400" />
            <span className={`text-sm font-semibold ${strong}`}>{t("syncPitch.statStems")}</span>
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <DeskTextField isLight={isLight} label={t("syncPitch.contactLabel")} value={contactName} onChange={setContactName} placeholder={t("syncPitch.contactNamePlaceholder")} />
          <DeskTextField isLight={isLight} label={t("syncPitch.contactEmailPlaceholder")} value={contactEmail} onChange={setContactEmail} placeholder={t("syncPitch.contactEmailPlaceholder")} />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            data-testid="world-one-sheet-run"
            onClick={() => void generate()}
            disabled={busy}
            className="ml-auto inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50 bdv-touch-target"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {busy ? t("syncPitch.writingSheet") : t("syncPitch.generateSheet", { cost })}
          </button>
        </div>

        {error && status !== "failed" && (
          <p className={`text-xs font-semibold ${isLight ? "text-red-800" : "text-red-300"}`}>{error}</p>
        )}
        {outOfCredits && <OutOfBucsLine isLight={isLight} feature="Sync One-Sheet" />}

        {status === "working" && <NativeLoadingState isLight={isLight} message={t("worldBizBenches400.oneSheetStateLoading")} />}
        {status === "failed" && (
          <NativeErrorState
            isLight={isLight}
            message={error ?? t("worldBizBenches400.oneSheetStateError")}
            onRetry={() => void generate()}
          />
        )}
        {status === "idle" && !sheet && (
          <NativeEmptyState isLight={isLight} message={t("worldBizBenches400.oneSheetStateEmpty")} />
        )}

        {sheet && c && (
          <div className={`rounded-xl border p-3 ${cardCls}`} data-testid="world-one-sheet-result">
            <p className={`text-[11px] font-bold uppercase tracking-widest ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
              {t("syncPitch.oneSheetBadge")}
            </p>
            <p className={`mt-1 text-lg font-black ${strong}`}>
              {sheet.songTitle}
              {sheet.artistName ? <span className={`text-sm font-normal ${muted}`}> — {sheet.artistName}</span> : null}
            </p>
            <p className={`mt-2 border-l-2 border-[#d4af37]/60 pl-3 text-sm italic leading-relaxed ${strong}`}>“{c.logline}”</p>

            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { label: t("syncPitch.statBpm"), value: sheet.bpm || "—" },
                { label: t("syncPitch.statKey"), value: sheet.musicalKey || "—" },
                { label: t("syncPitch.statInstrumental"), value: sheet.instrumentalAvailable ? t("syncPitch.yes") : t("syncPitch.no") },
                { label: t("syncPitch.statStems"), value: sheet.stemsAvailable ? t("syncPitch.yes") : t("syncPitch.no") },
              ].map((s) => (
                <div key={s.label} className={`rounded-xl border p-2.5 ${cardCls}`}>
                  <p className={`text-[10px] font-bold uppercase tracking-widest ${muted}`}>{s.label}</p>
                  <p className={`mt-0.5 text-sm font-semibold ${strong}`}>{s.value}</p>
                </div>
              ))}
            </div>

            {sheet.moodTags.length > 0 && (
              <div className="mt-3">
                <p className={`text-[11px] font-bold uppercase tracking-widest ${muted}`}>{t("syncPitch.moodTagsLabel")}</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {sheet.moodTags.map((m) => (
                    <span key={m} className="rounded-full border border-[#d4af37]/30 bg-[#d4af37]/10 px-2.5 py-0.5 text-xs font-semibold text-[#d4af37]">{m}</span>
                  ))}
                </div>
              </div>
            )}

            {c.soundsLike && (
              <div className="mt-3">
                <p className={`text-[11px] font-bold uppercase tracking-widest ${muted}`}>{t("syncPitch.soundsLikeLabel")}</p>
                <p className={`mt-0.5 text-sm ${strong}`}>{c.soundsLike}</p>
              </div>
            )}

            {sheet.comparableArtists.length > 0 && (
              <div className="mt-3">
                <p className={`text-[11px] font-bold uppercase tracking-widest ${muted}`}>{t("syncPitch.comparableArtists")}</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {sheet.comparableArtists.map((a) => (
                    <span key={a} className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${cardCls}`}>{a}</span>
                  ))}
                </div>
              </div>
            )}

            {c.syncUses.length > 0 && (
              <div className="mt-3">
                <p className={`text-[11px] font-bold uppercase tracking-widest ${muted}`}>{t("syncPitch.syncUsesLabel")}</p>
                <ul className="mt-1.5 space-y-1">
                  {c.syncUses.map((u, i) => (
                    <li key={i} className={`flex items-start gap-2 text-sm ${strong}`}>
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-500" /> {u}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-3">
              <p className={`text-[11px] font-bold uppercase tracking-widest ${muted}`}>{t("syncPitch.supervisorEmail")}</p>
              <p className={`mt-1 text-sm font-semibold ${strong}`}>{c.pitchEmail.subject}</p>
              <p className={`mt-1 whitespace-pre-wrap text-sm leading-relaxed ${muted}`}>{c.pitchEmail.body}</p>
            </div>

            {c.licensingNotes && (
              <div className="mt-3">
                <p className={`flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest ${muted}`}>
                  <Music2 className="h-3.5 w-3.5" /> {t("syncPitch.licensingNotesLabel")}
                </p>
                <p className={`mt-0.5 text-sm leading-relaxed ${muted}`}>{c.licensingNotes}</p>
              </div>
            )}

            {(sheet.contactName || sheet.contactEmail) && (
              <p className={`mt-3 text-sm ${muted}`}>
                {t("syncPitch.contactLabel")}: {sheet.contactName}
                {sheet.contactEmail ? ` · ${sheet.contactEmail}` : ""}
              </p>
            )}

            {c.disclaimer && <p className={`mt-3 text-[11px] leading-relaxed ${muted}`}>{c.disclaimer}</p>}

            <button
              type="button"
              onClick={() => void copyShare()}
              className="mt-3 inline-flex items-center gap-2 rounded-full border border-[#d4af37]/50 px-3 py-1.5 text-xs font-bold text-[#d4af37] transition hover:bg-[#d4af37]/10 bdv-touch-target"
            >
              {shared ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {shared ? t("syncPitch.linkCopied") : t("syncPitch.copyShareLink")}
            </button>
            <p className={`mt-2 text-[10px] ${muted}`}>{t("syncPitch.madeWith")}</p>
          </div>
        )}
      </div>
    </NativeCard>
  );
}

/* ─── B-22 · Content Calendar ───────────────────────────────── */

const CALENDAR_PLATFORM_COLORS: Record<string, string> = {
  tiktok: "border-cyan-400/40 text-cyan-300",
  instagram: "border-pink-500/40 text-pink-300",
  youtube: "border-red-500/40 text-red-300",
};

export function ContentCalendarBench({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  const { confirmedFetch } = useConfirmedApi();
  const authHeaders = useDeskAuthHeaders();

  const [niche, setNiche] = useState("");
  const [platforms, setPlatforms] = useState<CalendarPlatform[]>(["tiktok", "instagram", "youtube"]);
  const [postsPerWeek, setPostsPerWeek] = useState("3");
  const [startDate, setStartDate] = useState(() => calendarTodayISO());
  const [status, setStatus] = useState<BenchStatus>("idle");
  const [days, setDays] = useState<CalendarDay[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  const cost = contentCalendarCost();
  const busy = status === "working";
  const { muted, strong, cardCls, chipCls } = benchPalette(isLight);
  const postDays = days ? days.filter((d) => d.post) : [];

  function togglePlatform(p: CalendarPlatform) {
    setPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  }

  async function build() {
    if (busy) return;
    setStatus("working");
    setError(null);
    setOutOfCredits(false);
    try {
      const res = await confirmedFetch(CONTENT_CALENDAR_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(contentCalendarPayload({ niche, platforms, postsPerWeek, startDate })),
        overrideCost: cost,
        overrideFeature: "Content Calendar",
      });
      if (!res) { setStatus("idle"); return; } // spend confirmation declined — nothing ran
      const data: unknown = await res.json().catch(() => null);
      if (res.status === 402 || (data as { error?: string } | null)?.error === "out_of_credits") {
        setOutOfCredits(true);
        setStatus("idle");
        return;
      }
      const parsed = calendarDaysOf(data);
      if (!res.ok || !parsed) {
        setStatus("failed");
        setError(apiErrorMessage(data, t("worldBizBenches400.calendarStateError")));
        return;
      }
      setDays(parsed);
      setStatus("done");
    } catch {
      setStatus("failed");
      setError(t("worldBizBenches400.calendarStateError"));
    }
  }

  const fieldCls = `w-full rounded-xl border px-3 py-2 text-sm outline-none transition ${isLight ? "border-[#C9A84C]/50 bg-white/70 text-[#2a1e07] placeholder:text-[#6B5B36]/60 focus:border-[#C9A84C]" : "border-white/15 bg-white/5 text-white placeholder:text-white/35 focus:border-[#d4af37]/60"}`;

  return (
    <NativeCard isLight={isLight}>
      <div className="space-y-3" data-testid="world-content-calendar-bench">
        <BenchHeader
          isLight={isLight}
          icon={<CalendarDays className="h-4 w-4" />}
          title={t("contentIntelligence.step5Title")}
          cost={cost}
          strong={strong}
        />
        <p className={`text-xs ${muted}`}>{t("contentIntelligence.step5Blurb")}</p>

        <div className="grid gap-3 sm:grid-cols-2">
          <DeskTextField
            isLight={isLight}
            label={t("contentIntelligence.nicheLabel")}
            value={niche}
            onChange={setNiche}
            placeholder={t("contentIntelligence.nichePlaceholder")}
          />
          <label className="block">
            <span className={`mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
              {t("contentIntelligence.startDateLabel")}
            </span>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={fieldCls} style={{ colorScheme: isLight ? "light" : "dark" }} />
          </label>
        </div>

        <div>
          <p className={`mb-1 text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
            {t("contentIntelligence.calPlatformsLabel")}
          </p>
          <div className="flex flex-wrap gap-2">
            {CALENDAR_PLATFORMS.map((p) => (
              <button key={p} type="button" onClick={() => togglePlatform(p)} className={chipCls(platforms.includes(p))}>
                <span className="text-xs font-bold capitalize">{p}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <DeskTextField
            isLight={isLight}
            label={t("contentIntelligence.cadenceLabel")}
            value={postsPerWeek}
            onChange={setPostsPerWeek}
            placeholder="3"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <p className={`text-[11px] ${muted}`}>{t("contentIntelligence.costNote", { cost })}</p>
          <button
            type="button"
            data-testid="world-content-calendar-run"
            onClick={() => void build()}
            disabled={busy}
            className="ml-auto inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50 bdv-touch-target"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarDays className="h-4 w-4" />}
            {busy ? t("contentIntelligence.buildingCalendar") : t("contentIntelligence.step5Cta")}
          </button>
        </div>

        {error && status !== "failed" && (
          <p className={`text-xs font-semibold ${isLight ? "text-red-800" : "text-red-300"}`}>{error}</p>
        )}
        {outOfCredits && <OutOfBucsLine isLight={isLight} feature="Content Calendar" />}

        {status === "working" && <NativeLoadingState isLight={isLight} message={t("worldBizBenches400.calendarStateLoading")} />}
        {status === "failed" && (
          <NativeErrorState
            isLight={isLight}
            message={error ?? t("worldBizBenches400.calendarStateError")}
            onRetry={() => void build()}
          />
        )}
        {status === "idle" && !days && (
          <NativeEmptyState isLight={isLight} message={t("worldBizBenches400.calendarStateEmpty")} />
        )}

        {status === "done" && days && (
          <div data-testid="world-content-calendar-result">
            <div className="flex flex-wrap items-center gap-3">
              <span className="rounded-full border border-[#d4af37]/40 bg-[#d4af37]/10 px-3 py-1 text-xs font-black uppercase tracking-widest text-[#d4af37]">
                {postDays.length} {t("contentIntelligence.postsPlanned")}
              </span>
              <span className={`text-sm ${muted}`}>
                {t("contentIntelligence.calendarFrom", { from: days[0]?.dayLabel ?? "", to: days[days.length - 1]?.dayLabel ?? "" })}
              </span>
            </div>
            <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
              {postDays.map((d) => (
                <div key={d.date} className={`rounded-xl border p-3 ${cardCls}`}>
                  <div className="flex items-center justify-between gap-2">
                    <p className={`text-xs font-bold uppercase tracking-widest ${muted}`}>{d.dayLabel}</p>
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold capitalize ${isLight ? "border-[#C9A84C]/40 text-[#7A5A12]" : CALENDAR_PLATFORM_COLORS[d.platform] ?? "border-white/15 text-white/50"}`}>
                      {d.platform}
                    </span>
                  </div>
                  <p className={`mt-1.5 text-sm font-bold leading-snug ${strong}`}>{d.title}</p>
                  {d.hook && <p className={`mt-1 text-xs italic leading-relaxed ${muted}`}>“{d.hook}”</p>}
                  <p className={`mt-1.5 text-[11px] ${muted}`}>
                    {d.format && <span className="capitalize">{d.format} · </span>}
                    {d.bestTime}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </NativeCard>
  );
}

/* ─── B-22 · Stock Library ──────────────────────────────────── */

export function StockBench({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  const { confirmedFetch } = useConfirmedApi();
  const { addAsset } = useHubProject();
  const authHeaders = useDeskAuthHeaders();
  const tr = (key: string, opts?: Record<string, string | number>) =>
    t(`videoEditor.stockLibrary.${key}`, opts);

  const [query, setQuery] = useState("");
  const [type, setType] = useState<StockType>("video");
  const [items, setItems] = useState<StockItem[]>([]);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [notConfigured, setNotConfigured] = useState(false);
  const [page, setPage] = useState(1);
  const [totalResults, setTotalResults] = useState(0);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [importedIds, setImportedIds] = useState<string[]>([]);
  const [importFailed, setImportFailed] = useState(false);
  const [outOfCredits, setOutOfCredits] = useState(false);

  const importCost = stockImportCost();
  const { muted, strong, cardCls, chipCls } = benchPalette(isLight);
  const totalPages = Math.max(1, Math.ceil(totalResults / STOCK_PER_PAGE));

  async function runSearch(nextPage: number) {
    const q = query.trim();
    if (!q || searching) return;
    setSearching(true);
    setSearchFailed(false);
    setNotConfigured(false);
    setOutOfCredits(false);
    try {
      const res = await fetch(stockSearchUrl(q, type, nextPage), { headers: await authHeaders() });
      const data: unknown = await res.json().catch(() => null);
      if (stockNotConfigured(res.status, data)) {
        setNotConfigured(true);
        setItems([]);
        setSearched(true);
        return;
      }
      const parsed = stockSearchOf(data);
      if (!res.ok || !parsed) {
        setSearchFailed(true);
        setItems([]);
        setSearched(true);
        return;
      }
      setItems(parsed.items);
      setTotalResults(parsed.totalResults);
      setPage(nextPage);
      setSearched(true);
    } catch {
      setSearchFailed(true);
      setItems([]);
      setSearched(true);
    } finally {
      setSearching(false);
    }
  }

  async function importItem(item: StockItem) {
    if (importingId) return;
    setImportingId(item.id);
    setImportFailed(false);
    setOutOfCredits(false);
    try {
      const res = await confirmedFetch(STOCK_IMPORT_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(stockImportPayload(item)),
        overrideCost: importCost,
        overrideFeature: "Stock Import",
      });
      if (!res) return; // spend confirmation declined — nothing ran
      const data: unknown = await res.json().catch(() => null);
      if (res.status === 402) {
        setOutOfCredits(true);
        return;
      }
      const imported = stockImportedOf(data);
      if (!res.ok || !imported) {
        setImportFailed(true);
        return;
      }
      /* The panel's coherence rule: the import lands in the hub
         project so captions, templates and export treat it like
         any other clip. */
      try {
        addAsset({
          kind: imported.type === "video" ? "clip" : "image",
          url: imported.fileUrl,
          label: imported.title,
          detail: tr("hubAssetDetail", { name: imported.photographer }),
        });
      } catch { /* non-fatal — the import itself landed */ }
      setImportedIds((prev) => [...prev, item.id]);
    } catch {
      setImportFailed(true);
    } finally {
      setImportingId(null);
    }
  }

  return (
    <NativeCard isLight={isLight}>
      <div className="space-y-3" data-testid="world-stock-bench">
        <BenchHeader
          isLight={isLight}
          icon={<Search className="h-4 w-4" />}
          title={tr("title")}
          cost={importCost}
          strong={strong}
        />
        <p className={`text-xs ${muted}`}>{tr("subtitle")}</p>

        <div className="flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void runSearch(1); }}
            placeholder={tr("searchPlaceholder")}
            aria-label={tr("searchPlaceholder")}
            className={`min-w-0 flex-1 rounded-xl border px-3 py-2 text-sm outline-none transition ${isLight ? "border-[#C9A84C]/50 bg-white/70 text-[#2a1e07] placeholder:text-[#6B5B36]/60 focus:border-[#C9A84C]" : "border-white/15 bg-white/5 text-white placeholder:text-white/35 focus:border-[#d4af37]/60"}`}
          />
          <button
            type="button"
            data-testid="world-stock-search-run"
            onClick={() => void runSearch(1)}
            disabled={searching || !query.trim()}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50 bdv-touch-target"
          >
            {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            {tr("searchButton")}
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {STOCK_TYPES.map((tp) => (
            <button key={tp} type="button" onClick={() => setType(tp)} className={chipCls(type === tp)}>
              <span className="text-xs font-bold">{tp === "video" ? tr("typeVideo") : tr("typePhoto")}</span>
            </button>
          ))}
          <span className={`ml-auto text-[11px] ${muted}`}>{tr("priceBadge")}</span>
        </div>

        {outOfCredits && <OutOfBucsLine isLight={isLight} feature="Stock Import" />}
        {importFailed && (
          <p className={`text-xs font-semibold ${isLight ? "text-red-800" : "text-red-300"}`}>{tr("importFailedDesc")}</p>
        )}

        {searching && <NativeLoadingState isLight={isLight} message={t("worldBizBenches400.stockStateLoading")} />}
        {!searching && searchFailed && (
          <NativeErrorState
            isLight={isLight}
            message={t("worldBizBenches400.stockStateError")}
            onRetry={() => void runSearch(page)}
          />
        )}
        {!searching && notConfigured && (
          <NativeEmptyState
            isLight={isLight}
            message={tr("notConfiguredTitle")}
            detail={tr("notConfiguredDesc")}
          />
        )}
        {!searching && !searchFailed && !notConfigured && searched && items.length === 0 && (
          <NativeEmptyState isLight={isLight} message={tr("emptyTitle")} detail={tr("emptyDesc")} />
        )}
        {!searching && !searched && (
          <NativeEmptyState isLight={isLight} message={tr("idleHint")} />
        )}

        {items.length > 0 && (
          <div data-testid="world-stock-result">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {items.map((item) => {
                const imported = importedIds.includes(item.id);
                return (
                  <div key={item.id} className={`overflow-hidden rounded-xl border ${cardCls}`}>
                    <div className="relative">
                      <img src={item.previewUrl} alt={item.title} className="aspect-video w-full object-cover" loading="lazy" />
                      <span className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-bold ${isLight ? "bg-white/80 text-[#7A5A12]" : "bg-black/60 text-[#e8c86a]"}`}>
                        {item.type === "video" ? tr("badgeVideo") : tr("badgePhoto")}
                      </span>
                    </div>
                    <div className="space-y-1.5 px-3 py-2">
                      <p className={`truncate text-[11px] ${muted}`}>
                        {tr(item.type === "video" ? "videoBy" : "photoBy", { name: item.photographer })}
                      </p>
                      <button
                        type="button"
                        onClick={() => void importItem(item)}
                        disabled={importingId === item.id || imported}
                        className="inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3 py-1.5 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-60 bdv-touch-target"
                      >
                        {importingId === item.id
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : imported ? <Check className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}
                        {imported ? t("worldBizBenches400.stockAddedTitle") : tr("addToTimeline")}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            {totalPages > 1 && (
              <div className="mt-3 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => void runSearch(page - 1)}
                  disabled={page <= 1 || searching}
                  className="rounded-full border border-[#d4af37]/50 px-3 py-1.5 text-xs font-bold text-[#d4af37] transition hover:bg-[#d4af37]/10 disabled:opacity-50 bdv-touch-target"
                >
                  {tr("prevPage")}
                </button>
                <span className={`text-xs ${muted}`}>{tr("pageOf", { page, total: totalPages })}</span>
                <button
                  type="button"
                  onClick={() => void runSearch(page + 1)}
                  disabled={page >= totalPages || searching}
                  className="rounded-full border border-[#d4af37]/50 px-3 py-1.5 text-xs font-bold text-[#d4af37] transition hover:bg-[#d4af37]/10 disabled:opacity-50 bdv-touch-target"
                >
                  {tr("nextPage")}
                </button>
              </div>
            )}
          </div>
        )}

      </div>
    </NativeCard>
  );
}
