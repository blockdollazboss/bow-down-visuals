import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearch } from "wouter";
import {
  Loader2, Wallet, TrendingUp, BadgeDollarSign, PiggyBank, Copy, Check,
  Plus, Minus, Tag, ShoppingBag, CalendarClock, ExternalLink, AlertCircle,
  CheckCircle2, Sparkles, ArrowRight, CircleDollarSign,
  PlusCircle, ListChecks, CircleDashed, Wand2, Music2, AlertTriangle,
  RotateCcw, Upload, Download, FileSpreadsheet,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useUserMode } from "@/contexts/UserModeContext";
import { usePageTitle } from "@/hooks/use-page-title";
import { levelInfo } from "@/lib/creator-level";
import {
  listProducts, moneyChecklist, mySales, createProduct, updateProduct, deactivateProduct,
  listDiscounts, createDiscount, updateDiscount, deleteDiscount,
  logSaleToTracker, confirmServiceBooking,
  previewShopifyImport, commitShopifyImport, downloadShopifyExport,
  KIND_LABELS, KIND_EMOJI, dollarsToCents, usd,
  type StoreProductDTO, type StoreOrderDTO, type DiscountCodeDTO,
  type MoneyChecklist, type CreateProductInput, type StoreProductKind,
  type ShopifyImportResultDTO, type ShopifyExportKind,
} from "@/lib/storefront-api";
import PromoteButton from "@/components/storefront/PromoteButton";
import CourseBuilderPanel from "@/components/courses/CourseBuilderPanel";
import {
  allSectionsFailed, initialSectionStates, markSectionLoading, sectionsToRefetch, settleSection,
  type SectionStates,
} from "@/lib/dashboard-sections";

/* ─── Section resilience (the shared seam, lib/dashboard-sections) ────
   The storefront surface hangs off ONE page-level section — the money
   checklist (GET /api/storefront/money-checklist) — feeding the
   earnings hero, the next-move + checklist cards, and the store slug.
   The payout card and every tab (products / orders / discounts) load
   from their OWN endpoints and already carry their own scoped error
   states. So the overview section settles on its own through the
   seam: its failure renders its failure card in the overview area,
   with its own Retry — it no longer replaces the whole page, and the
   tabs stay open for business. The digital surface below runs the
   same seam over its own three sections. */
type StoreOverviewSectionKey = "overview";
const STORE_OVERVIEW_SECTION_KEYS: readonly StoreOverviewSectionKey[] = ["overview"];

/* ─── /store/dashboard — the seller dashboard, the GET PAID finale ──────
 *
 * This is the money UX for the whole creator platform: earnings FIRST,
 * then the money checklist, then the single sharpest next-money-move nudge.
 *
 * Difficulty ladder (6-star Creator Level — viewing earnings is NEVER gated):
 *  - 1★ Street Punk:  dead-simple product creation (title + AI starting price)
 *  - 2-3★ Hustler/Gangster: guided (kind picker, descriptions, discount nudges)
 *  - 4-6★ Shot Caller+: full commerce control (inventory, compare-at pricing,
 *    media, related links, service details, event links, discount codes)
 *
 * MOUNT (coordinator): add ONE route in App.tsx — no sidebar items.
 *   const StoreDashboard = lazyWithRetry(() => import("@/pages/store-dashboard"));
 *   <Route path="/store/dashboard"><ProtectedRoute><StoreDashboard /></ProtectedRoute></Route>
 *
 * Cheat-code voice throughout: short, money-forward, zero fluff.
 */

type Tab = "overview" | "products" | "orders" | "discounts";

/* ── Revenue surface: Storefront (original dashboard) · Digital music sales
   (absorbed from /music-sales) · Royalties (link to the dedicated page). */
type Surface = "storefront" | "digital";

/* No 'course' entry on purpose: a course price is ALWAYS the
   creator's own, typed in the Course Builder below — never a
   suggested starting price. */
const KIND_STARTING_PRICE: Record<Exclude<StoreProductKind, "course">, number> = {
  digital: 999, download: 499, merch: 2999, service: 9900, ticket: 2500,
};

function useToken() {
  const { getAccessToken } = useAuth();
  return useCallback(async () => {
    const t = await getAccessToken();
    if (!t) throw new Error("Sign in first.");
    return t;
  }, [getAccessToken]);
}

/* ── Earnings hero: gross / fee / net, honest math, never gated ───────── */
function EarningsHero({ data }: { data: MoneyChecklist }) {
  const e = data.earnings;
  const cards = [
    { icon: TrendingUp, label: "Gross sales", value: e.gross, sub: `${e.orderCount} order${e.orderCount === 1 ? "" : "s"}` },
    { icon: BadgeDollarSign, label: `Platform fee (${e.platformFeePct}%)`, value: e.fee, sub: "Taken from your cut — buyers never pay extra" },
    { icon: Wallet, label: "Your net", value: e.net, sub: "Real dollars, not Visual Bucs", hot: true },
  ];
  return (
    <div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {cards.map((c) => (
          <div
            key={c.label}
            className={`rounded-2xl border p-5 ${c.hot
              ? "border-primary/50 bg-gradient-to-br from-primary/[0.16] to-transparent shadow-[0_0_36px_rgba(218,165,32,0.15)]"
              : "lux-card"}`}
          >
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-white/45">
              <c.icon className={`h-4 w-4 ${c.hot ? "text-primary" : "text-white/40"}`} /> {c.label}
            </div>
            <p className={`mt-2 text-3xl font-black tracking-tight ${c.hot ? "text-primary" : "text-white"}`}>{c.value}</p>
            <p className="mt-1 text-[11px] leading-relaxed text-white/40">{c.sub}</p>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-start gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3">
        <PiggyBank className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <p className="text-[11px] leading-relaxed text-white/50">
          <span className="font-bold text-white/70">Pending payout: {e.net}.</span> {e.pendingPayoutNote}
        </p>
      </div>
    </div>
  );
}

function NextMoveCard({ data }: { data: MoneyChecklist }) {
  const n = data.nextMove;
  if (!n) {
    return (
      <div className="rounded-2xl border border-green-500/30 bg-green-500/[0.07] p-5">
        <p className="flex items-center gap-2 text-sm font-black text-green-300">
          <CheckCircle2 className="h-5 w-5" /> Money checklist: clean.
        </p>
        <p className="mt-1 text-xs text-white/55">Everything that should be making you money is making you money. Now go promote — the Promote button on every product is your megaphone.</p>
        <Link href={data.links.storeUrl}>
          <span className="mt-3 inline-block cursor-pointer rounded-full bg-gradient-to-b from-[#e8c547] to-[#b8860b] px-4 py-2 text-xs font-black text-black">
            Open your store →
          </span>
        </Link>
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-primary/40 bg-gradient-to-br from-primary/[0.14] to-transparent p-5 shadow-[0_0_36px_rgba(218,165,32,0.14)]">
      <p className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-primary">
        <Sparkles className="h-4 w-4" /> Your next money move
      </p>
      <h3 className="mt-2 text-xl font-black text-white">{n.title}</h3>
      <p className="mt-1 text-sm leading-relaxed text-white/60">{n.detail}</p>
      <Link href={n.href}>
        <span className="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-full bg-gradient-to-b from-[#e8c547] to-[#b8860b] px-5 py-2.5 text-sm font-black text-black transition hover:brightness-110">
          {n.cta} <ArrowRight className="h-4 w-4" />
        </span>
      </Link>
    </div>
  );
}

function ChecklistCard({ data }: { data: MoneyChecklist }) {
  return (
    <div className="lux-card rounded-2xl p-5">
      <h3 className="mb-1 text-sm font-black uppercase tracking-wider text-white/70">Money checklist</h3>
      <p className="mb-4 text-[11px] text-white/40">Guide to the money, every step. Knock these out in order.</p>
      <ul className="space-y-2.5">
        {data.checklist.map((c) => (
          <li key={c.id} className="flex items-start gap-3">
            {c.done
              ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-400" />
              : <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full border border-primary/60" />}
            <div className="min-w-0 flex-1">
              <p className={`text-sm font-bold ${c.done ? "text-white/40 line-through" : "text-white"}`}>{c.title}</p>
              {!c.done && <p className="text-[11px] leading-relaxed text-white/45">{c.detail}</p>}
              {!c.done && (
                <Link href={c.href}>
                  <span className="mt-0.5 inline-block cursor-pointer text-[11px] font-bold text-primary hover:underline">
                    {c.cta} →
                  </span>
                </Link>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── Stripe Connect payouts: "Connect your bank / Get paid" ───────────────
 * The Get Paid finale for the seller dashboard. States:
 *  - not connected → gold "Connect your bank" CTA (Stripe-hosted onboarding)
 *  - connected but unfinished → "Finish setup"
 *  - onboarded → pending total + Cash out button + Manage-in-Stripe link.
 * TEST MODE: transfers exercise Stripe's test API — no real money moves. */
interface ConnectStatus {
  connected: boolean;
  accountId: string | null;
  onboarded: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  pendingCents: number;
  minPayoutCents: number;
  testMode: boolean;
}

function ConnectPayoutCard() {
  const getToken = useToken();
  const search = useSearch();
  const [status, setStatus] = useState<ConnectStatus | null>(null);
  const [noProfile, setNoProfile] = useState(false);
  const [busy, setBusy] = useState<"connect" | "payout" | "manage" | null>(null);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [justReturned, setJustReturned] = useState(false);

  const load = useCallback(async () => {
    const token = await getToken();
    const res = await fetch("/api/connect/status", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 404) { setNoProfile(true); return; }
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new Error((data.error as string) || "Couldn't load payout status.");
    setStatus(data as unknown as ConnectStatus);
  }, [getToken]);

  useEffect(() => { load().catch((e: Error) => setErr(e.message)); }, [load]);

  /* Returning from Stripe's hosted onboarding (?connect=done): re-check status
     after a beat so the account.updated webhook has time to land. */
  useEffect(() => {
    const params = new URLSearchParams(search);
    if (params.get("connect") === "done") {
      setJustReturned(true);
      window.history.replaceState(null, "", "/store/dashboard");
      const t = setTimeout(() => load().catch(() => {}), 3000);
      return () => clearTimeout(t);
    }
    if (params.get("connect") === "refresh") {
      window.history.replaceState(null, "", "/store/dashboard");
    }
    return undefined;
  }, [search, load]);

  const goOnboard = async (path: "/api/connect/onboard" | "/api/connect/refresh") => {
    setErr(""); setNote(""); setBusy("connect");
    try {
      const token = await getToken();
      const res = await fetch(path, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string; message?: string };
      if (!res.ok || !data.url) throw new Error(data.message || data.error || "Couldn't start bank setup.");
      window.location.href = data.url;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't start bank setup.");
      setBusy(null);
    }
  };

  const doPayout = async () => {
    setErr(""); setNote(""); setBusy("payout");
    try {
      const token = await getToken();
      const res = await fetch("/api/connect/payout", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json().catch(() => ({}))) as {
        payout?: { amountCents: number }; error?: string; message?: string; note?: string;
      };
      if (!res.ok) throw new Error(data.message || data.error || "Payout failed.");
      setNote(
        `Cash out sent: $${((data.payout?.amountCents ?? 0) / 100).toFixed(2)}${data.note ? ` — ${data.note}` : ""}`,
      );
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Payout failed.");
    } finally {
      setBusy(null);
    }
  };

  /* "Manage payout setup" routes through the working onboarding path:
     a fresh hosted setup link for the same account (POST /connect/refresh).
     The old dashboard login-link button was removed — the accounts API
     has no login-link endpoint, so that button could only ever fail. */
  const openManage = async () => {
    await goOnboard("/api/connect/refresh");
  };

  if (noProfile) return null;
  if (!status && !err) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-white/40">
        <Loader2 className="h-4 w-4 animate-spin" /> <span className="text-xs">Loading payout setup…</span>
      </div>
    );
  }

  const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;
  const canCashOut = !!status?.payoutsEnabled && (status?.pendingCents ?? 0) >= (status?.minPayoutCents ?? 100);

  return (
    <div className="rounded-2xl border border-primary/40 bg-gradient-to-br from-primary/[0.14] to-transparent p-5 shadow-[0_0_36px_rgba(218,165,32,0.14)]">
      <p className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-primary">
        <Wallet className="h-4 w-4" /> Get paid
        {status?.testMode && (
          <span className="rounded-full border border-white/20 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white/50">
            Test mode
          </span>
        )}
      </p>

      {justReturned && (
        <p className="mt-2 flex items-center gap-2 text-xs font-bold text-green-300">
          <CheckCircle2 className="h-4 w-4" /> Welcome back — checking your Stripe setup…
        </p>
      )}

      {!status?.connected && (
        <>
          <h3 className="mt-2 text-xl font-black text-white">Connect your bank. Get your money.</h3>
          <p className="mt-1 text-sm leading-relaxed text-white/60">
            Your sales pile up as a pending balance. Connect a bank through Stripe (2 minutes, secure, Stripe-hosted)
            and cash out whenever you want. This is the guide to the money — all the way to your account.
          </p>
          <button
            onClick={() => goOnboard("/api/connect/onboard")}
            disabled={busy === "connect"}
            className="mt-4 inline-flex items-center gap-2 rounded-full bg-gradient-to-b from-[#e8c547] to-[#b8860b] px-5 py-2.5 text-sm font-black text-black transition hover:brightness-110 disabled:opacity-60"
          >
            {busy === "connect" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CircleDollarSign className="h-4 w-4" />}
            Connect your bank →
          </button>
        </>
      )}

      {status?.connected && !status.payoutsEnabled && (
        <>
          <h3 className="mt-2 text-xl font-black text-white">Almost there — finish your Stripe setup.</h3>
          <p className="mt-1 text-sm leading-relaxed text-white/60">
            Your bank connection started but isn't verified yet. Finish Stripe's quick verification to unlock payouts.
          </p>
          <button
            onClick={() => goOnboard("/api/connect/refresh")}
            disabled={busy === "connect"}
            className="mt-4 inline-flex items-center gap-2 rounded-full bg-gradient-to-b from-[#e8c547] to-[#b8860b] px-5 py-2.5 text-sm font-black text-black transition hover:brightness-110 disabled:opacity-60"
          >
            {busy === "connect" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Finish setup →
          </button>
        </>
      )}

      {status?.connected && status.payoutsEnabled && (
        <>
          <h3 className="mt-2 text-xl font-black text-white">
            Ready to cash out <span className="text-primary">{dollars(status.pendingCents)}</span>
          </h3>
          <p className="mt-1 text-sm leading-relaxed text-white/60">
            <CheckCircle2 className="mr-1 inline h-4 w-4 text-green-400" />
            Bank connected and verified. Minimum cash-out is {dollars(status.minPayoutCents)}.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              onClick={doPayout}
              disabled={!canCashOut || busy === "payout"}
              className="inline-flex items-center gap-2 rounded-full bg-gradient-to-b from-[#e8c547] to-[#b8860b] px-5 py-2.5 text-sm font-black text-black transition hover:brightness-110 disabled:opacity-40"
            >
              {busy === "payout" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              Cash out {dollars(status.pendingCents)}
            </button>
            <button
              onClick={openManage}
              disabled={busy === "connect"}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-white/55 hover:text-white"
            >
              {busy === "connect" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}
              Manage payout setup
            </button>
          </div>
        </>
      )}

      {err && (
        <>
          <p className="mt-3 flex items-start gap-2 text-xs font-bold text-red-300">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {err}
          </p>
          {/* The error text alone was a dead end — the only recovery was
              a silent timer on the Stripe-return path. Give every error
              here a visible retry that re-runs the payout-status load. */}
          <button
            type="button"
            onClick={() => { setErr(""); load().catch((e: Error) => setErr(e.message)); }}
            className="mt-3 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 font-bold text-black hover:brightness-110"
          >
            <RotateCcw className="h-4 w-4" /> Try again
          </button>
        </>
      )}
      {note && (
        <p className="mt-3 flex items-start gap-2 text-xs font-bold text-green-300">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> {note}
        </p>
      )}
    </div>
  );
}

/* ── Products tab ────────────────────────────────────────────────────── */
function ProductsTab({ slug, onChanged }: { slug: string; onChanged: () => void }) {
  const isLight = useIsLightTheme();
  const getToken = useToken();
  const { gateStars: stars } = useUserMode();
  const [products, setProducts] = useState<StoreProductDTO[] | null>(null);
  /* Product-list load failures are NOT "your shelves are empty" — they
     get their own error state with a retry, scoped to the list only
     (the header and create form above stay usable). The empty state
     renders ONLY for a successful load with zero products. */
  const [loadError, setLoadError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [form, setForm] = useState({
    kind: "digital" as StoreProductKind,
    title: "",
    description: "",
    priceDollars: "",
    compareAtDollars: "",
    inventory: "-1",
    mediaUrl: "",
    relatedLabel: "",
    relatedUrl: "",
    durationMin: "",
    location: "",
    calendarLink: "",
    eventId: "",
  });

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const r = await listProducts(slug);
      setProducts(r.products);
    } catch {
      setLoadError(true);
    }
  }, [slug]);

  useEffect(() => { load(); }, [load, retryNonce]);

  const aiStartingPrice = () => {
    const starting = KIND_STARTING_PRICE[form.kind as keyof typeof KIND_STARTING_PRICE] as number | undefined;
    if (starting === undefined) return; /* courses: priced by the creator in the Course Builder, never suggested */
    setForm((f) => ({ ...f, priceDollars: (starting / 100).toFixed(2) }));
  };

  const submit = async () => {
    setErr("");
    if (!form.title.trim()) { setErr("Give it a title."); return; }
    const cents = dollarsToCents(form.priceDollars);
    /* $0 is a real price here: a free lead magnet (0190) — fans claim
       it with their email instead of checking out. Negative isn't. */
    if (!Number.isFinite(cents) || cents < 0) { setErr("Set a price — $0 makes it a free lead magnet; a negative price isn't a price."); return; }
    setBusy(true);
    try {
      const token = await getToken();
      const input: CreateProductInput = {
        kind: form.kind,
        title: form.title.trim(),
        description: form.description.trim(),
        priceCents: cents,
        compareAtCents: form.compareAtDollars ? dollarsToCents(form.compareAtDollars) : null,
        inventory: form.kind === "digital" || form.kind === "download" ? -1 : parseInt(form.inventory, 10) || -1,
        mediaUrls: form.mediaUrl.trim() ? [form.mediaUrl.trim()] : [],
        relatedLinks: form.relatedLabel.trim() && form.relatedUrl.trim()
          ? [{ label: form.relatedLabel.trim(), url: form.relatedUrl.trim() }] : [],
        serviceDetails: form.kind === "service" ? {
          duration_min: form.durationMin ? parseInt(form.durationMin, 10) : undefined,
          location: form.location.trim() || undefined,
          booking_calendar_link: form.calendarLink.trim() || undefined,
        } : null,
        eventId: form.kind === "ticket" && form.eventId.trim() ? form.eventId.trim() : null,
        isActive: true,
      };
      await createProduct(token, input);
      setShowForm(false);
      setForm({ kind: "digital", title: "", description: "", priceDollars: "", compareAtDollars: "", inventory: "-1", mediaUrl: "", relatedLabel: "", relatedUrl: "", durationMin: "", location: "", calendarLink: "", eventId: "" });
      await load();
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't create that product.");
    } finally {
      setBusy(false);
    }
  };

  const setInventory = async (p: StoreProductDTO, inv: number) => {
    try {
      const token = await getToken();
      await updateProduct(token, p.id, { inventory: inv });
      await load();
      onChanged();
    } catch { /* inventory stepper never hard-fails the page */ }
  };

  const toggleActive = async (p: StoreProductDTO) => {
    try {
      const token = await getToken();
      if (p.isActive) await deactivateProduct(token, p.id);
      else await updateProduct(token, p.id, { isActive: true } as Partial<CreateProductInput>);
      await load();
      onChanged();
    } catch { /* noop */ }
  };

  const inputCls = "w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/25";

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-xs text-white/45">
          Playing at <span className="font-bold text-primary">{stars}★ {levelInfo(stars).rank}</span> —{" "}
          {stars <= 1 ? "dead simple: title + price, Thy Cheat Code handles the rest."
            : stars <= 3 ? "guided mode: kinds, descriptions, discount nudges unlocked."
            : "full commerce control: inventory, compare-at pricing, links, codes, everything."}
        </p>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-b from-[#e8c547] to-[#b8860b] px-4 py-2 text-xs font-black text-black hover:brightness-110"
        >
          <Plus className="h-3.5 w-3.5" /> New product
        </button>
      </div>

      {showForm && (
        <div className="mb-6 rounded-2xl border border-primary/30 bg-[#14100a] p-5">
          <h3 className="mb-1 text-base font-black text-white">List it. Price it. Get paid. 👑</h3>
          <p className="mb-4 text-[11px] text-white/45">
            {stars <= 1
              ? "Street Punk mode: just a title and a price. Thy Cheat Code suggests a starting price — change it anytime."
              : "Fill what you want; advanced fields unlock as you climb the stars."}
          </p>
          {err && <p className="mb-3 flex items-center gap-2 text-xs text-red-400"><AlertCircle className="h-4 w-4" />{err}</p>}

          {/* 1★: title + price only */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Product title — e.g. Midnight Pack Vol. 2" className={inputCls} />
            <div className="flex gap-2">
              <input value={form.priceDollars} onChange={(e) => setForm({ ...form, priceDollars: e.target.value })} placeholder="Price ($)" inputMode="decimal" className={inputCls} />
              <button onClick={aiStartingPrice} title="Let Thy Cheat Code suggest a starting price" className="shrink-0 rounded-lg border border-primary/40 bg-primary/10 px-3 text-xs font-bold text-primary hover:bg-primary/20">
                ✨ Price it
              </button>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-white/45">
            Set the price to $0 and this becomes a <span className="font-bold text-primary">free lead magnet</span> — fans claim it with their email (which joins your list) and get it instantly. No checkout, no card.
          </p>

          {/* 2-3★: guided */}
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2" data-min-stars="2">
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as StoreProductKind })} className={inputCls}>
              {/* 'course' is not listed here on purpose: a course needs
                  a curriculum, so it is created in the Course Builder
                  docked below this tab — never as a bare product. */}
              {(Object.keys(KIND_LABELS) as StoreProductKind[]).filter((k) => k !== "course").map((k) => (
                <option key={k} value={k}>{KIND_EMOJI[k]} {KIND_LABELS[k]}</option>
              ))}
            </select>
            <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="One-line pitch (optional)" className={inputCls} />
          </div>

          {/* 4★+: full commerce control */}
          <div data-min-stars="4">
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <input value={form.compareAtDollars} onChange={(e) => setForm({ ...form, compareAtDollars: e.target.value })} placeholder="Compare-at $ (sale anchor)" inputMode="decimal" className={inputCls} />
              <input value={form.inventory} onChange={(e) => setForm({ ...form, inventory: e.target.value })} placeholder="Inventory (-1 = unlimited)" inputMode="numeric" className={inputCls} />
              <input value={form.mediaUrl} onChange={(e) => setForm({ ...form, mediaUrl: e.target.value })} placeholder="Cover image URL" className={inputCls} />
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <input value={form.relatedLabel} onChange={(e) => setForm({ ...form, relatedLabel: e.target.value })} placeholder="Related link label — e.g. The track" className={inputCls} />
              <input value={form.relatedUrl} onChange={(e) => setForm({ ...form, relatedUrl: e.target.value })} placeholder="Related link URL — e.g. /songs/…" className={inputCls} />
            </div>
            {form.kind === "service" && (
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <input value={form.durationMin} onChange={(e) => setForm({ ...form, durationMin: e.target.value })} placeholder="Duration (min)" inputMode="numeric" className={inputCls} />
                <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Location" className={inputCls} />
                <input value={form.calendarLink} onChange={(e) => setForm({ ...form, calendarLink: e.target.value })} placeholder="Booking calendar link (stub)" className={inputCls} />
              </div>
            )}
            {form.kind === "ticket" && (
              <div className="mt-3">
                <input value={form.eventId} onChange={(e) => setForm({ ...form, eventId: e.target.value })} placeholder="Event ID (from your /shows event)" className={inputCls} />
                <p className="mt-1 text-[10px] text-white/35">Ticket sales create an event RSVP automatically.</p>
              </div>
            )}
          </div>

          <div className="mt-4 flex gap-2">
            <button
              onClick={submit} disabled={busy}
              className="rounded-full bg-gradient-to-b from-[#e8c547] to-[#b8860b] px-5 py-2 text-sm font-black text-black hover:brightness-110 disabled:opacity-60"
            >
              {busy ? "Listing…" : "List it 🚀"}
            </button>
            <button onClick={() => setShowForm(false)} className="rounded-full border border-white/15 px-4 py-2 text-sm text-white/60">
              Cancel
            </button>
          </div>
          <p className="mt-2 text-[10px] text-white/30">Real-money listing via Stripe · {usd(0).slice(0, 1)}5% platform fee comes out of your cut · never Visual Bucs.</p>
        </div>
      )}

      {loadError ? (
        <div className={`rounded-2xl border p-10 text-center ${isLight ? "border-[#C9A84C]/50 bg-[#F7ECD2]" : "border-primary/25 bg-zinc-950"}`}>
          <AlertTriangle className="mx-auto h-10 w-10 text-primary" />
          <p className={`mt-3 font-bold ${isLight ? "text-[#2A1E07]" : "text-white"}`}>Couldn't load your products.</p>
          <p className={`mt-1 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
            Something went wrong on our end — your products are safe, this tab just couldn't load them.
          </p>
          <button
            type="button"
            onClick={() => setRetryNonce((n) => n + 1)}
            className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 font-bold text-black hover:brightness-110"
          >
            <RotateCcw className="h-4 w-4" /> Try again
          </button>
        </div>
      ) : !products ? (
        <div className="flex justify-center py-10 text-white/40"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : products.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/15 p-10 text-center">
          <p className="text-sm font-bold text-white/70">Your shelves are empty.</p>
          <p className="mt-1 text-xs text-white/40">One product, one price, one tap — that's the whole first step to getting paid.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-[11px] uppercase tracking-wider text-white/40">
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Kind</th>
                <th className="px-4 py-3">Price</th>
                <th className="px-4 py-3" data-min-stars="4">Inventory</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} className="border-b border-white/[0.06] last:border-0 hover:bg-white/[0.02]">
                  <td className="px-4 py-3">
                    <Link href={p.links.productUrl}>
                      <span className="cursor-pointer font-bold text-white hover:text-primary">{p.title}</span>
                    </Link>
                    <p className="text-[10px] text-white/30">→ {p.links.productUrl}</p>
                  </td>
                  <td className="px-4 py-3 text-xs text-white/60">{KIND_EMOJI[p.kind]} {KIND_LABELS[p.kind]}</td>
                  <td className="px-4 py-3 font-bold text-primary">
                    {p.priceCents === 0 ? (
                      <span className="inline-flex items-center gap-1.5">
                        FREE
                        <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">Lead magnet</span>
                      </span>
                    ) : (
                      p.price
                    )}
                  </td>
                  <td className="px-4 py-3" data-min-stars="4">
                    {p.unlimited ? (
                      <span className="text-xs text-white/40">∞ unlimited</span>
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        <button onClick={() => setInventory(p, Math.max(0, p.inventory - 1))} className="rounded border border-white/15 p-1 text-white/60 hover:text-white" title="Decrease">
                          <Minus className="h-3 w-3" />
                        </button>
                        <span className={`min-w-[3ch] text-center text-xs font-bold ${p.soldOut ? "text-red-400" : "text-white"}`}>
                          {p.inventory}
                        </span>
                        <button onClick={() => setInventory(p, p.inventory + 1)} className="rounded border border-white/15 p-1 text-white/60 hover:text-white" title="Increase">
                          <Plus className="h-3 w-3" />
                        </button>
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => toggleActive(p)} className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${p.isActive ? "bg-green-500/15 text-green-300" : "bg-white/10 text-white/40"}`}>
                      {p.isActive ? "Live" : "Draft"}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <PromoteButton product={p} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ── Orders tab ──────────────────────────────────────────────────────── */
function OrdersTab() {
  const isLight = useIsLightTheme();
  const getToken = useToken();
  const [orders, setOrders] = useState<StoreOrderDTO[] | null>(null);
  const [totals, setTotals] = useState<{ gross: string; fee: string; net: string; platformFeePct: number } | null>(null);
  const [logged, setLogged] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  /* Orders load failures are NOT "no sales yet" — they get their own
     error state with a retry, scoped to this tab only. The empty state
     renders ONLY for a successful load with zero orders. */
  const [loadError, setLoadError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const token = await getToken();
      const r = await mySales(token);
      setOrders(r.orders);
      setTotals(r.totals);
    } catch {
      setLoadError(true);
    }
  }, [getToken]);

  useEffect(() => { load(); }, [load, retryNonce]);

  const logToTracker = async (o: StoreOrderDTO) => {
    setBusyId(o.id);
    try {
      const token = await getToken();
      await logSaleToTracker(token, o.id);
      setLogged((s) => new Set(s).add(o.id));
    } catch (e) {
      if (e instanceof Error && e.message.includes("already")) setLogged((s) => new Set(s).add(o.id));
    } finally {
      setBusyId(null);
    }
  };

  const confirmBooking = async (o: StoreOrderDTO, confirmed: boolean) => {
    setBusyId(o.id);
    try {
      const token = await getToken();
      await confirmServiceBooking(token, o.id, confirmed);
      await load();
    } finally {
      setBusyId(null);
    }
  };

  if (loadError) {
    return (
      <div className={`rounded-2xl border p-10 text-center ${isLight ? "border-[#C9A84C]/50 bg-[#F7ECD2]" : "border-primary/25 bg-zinc-950"}`}>
        <AlertTriangle className="mx-auto h-10 w-10 text-primary" />
        <p className={`mt-3 font-bold ${isLight ? "text-[#2A1E07]" : "text-white"}`}>Couldn't load your orders.</p>
        <p className={`mt-1 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
          Something went wrong on our end — your sales are safe, this tab just couldn't load them.
        </p>
        <button
          type="button"
          onClick={() => setRetryNonce((n) => n + 1)}
          className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 font-bold text-black hover:brightness-110"
        >
          <RotateCcw className="h-4 w-4" /> Try again
        </button>
      </div>
    );
  }

  if (!orders) return <div className="flex justify-center py-10 text-white/40"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div>
      {totals && (
        <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-1 rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-3 text-sm">
          <span className="text-white/50">Gross <b className="text-white">{totals.gross}</b></span>
          <span className="text-white/50">Fee ({totals.platformFeePct}%) <b className="text-white">{totals.fee}</b></span>
          <span className="text-white/50">Your net <b className="text-primary">{totals.net}</b></span>
        </div>
      )}
      {orders.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/15 p-10 text-center">
          <p className="text-sm font-bold text-white/70">No sales yet — but the shelves are stocked.</p>
          <p className="mt-1 text-xs text-white/40">Hit the Promote button on a product. Money doesn't find you; you go get it.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-[11px] uppercase tracking-wider text-white/40">
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3">Gross</th>
                <th className="px-4 py-3">Fee</th>
                <th className="px-4 py-3">Your net</th>
                <th className="px-4 py-3">Fulfillment</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-b border-white/[0.06] last:border-0 hover:bg-white/[0.02]">
                  <td className="px-4 py-3">
                    {o.links.productUrl ? (
                      <Link href={o.links.productUrl}><span className="cursor-pointer font-bold text-white hover:text-primary">{o.productTitle}</span></Link>
                    ) : (
                      <span className="font-bold text-white">{o.productTitle}</span>
                    )}
                    <p className="text-[10px] text-white/35">
                      {KIND_EMOJI[o.productKind as StoreProductKind] ?? "📦"} {o.productKind} · ×{o.quantity}
                      {o.discountCode && <span className="ml-1 rounded bg-primary/15 px-1.5 py-0.5 text-primary">🏷️ {o.discountCode}</span>}
                      {" · "}{new Date(o.createdAt).toLocaleDateString()}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-white/80">{o.gross}</td>
                  <td className="px-4 py-3 text-white/50">{o.platformFee}</td>
                  <td className="px-4 py-3 font-black text-primary">{o.net}</td>
                  <td className="max-w-[220px] px-4 py-3 text-[11px] leading-relaxed text-white/45">
                    {o.fulfillmentNote ?? "—"}
                    {o.productKind === "service" && o.status === "completed" && !o.fulfillmentNote?.startsWith("Booking confirmed") && !o.fulfillmentNote?.startsWith("Booking declined") && (
                      <span className="mt-1 flex gap-1.5">
                        <button disabled={busyId === o.id} onClick={() => confirmBooking(o, true)} className="rounded-full bg-green-500/20 px-2.5 py-1 text-[10px] font-bold text-green-300 hover:bg-green-500/30">
                          Confirm
                        </button>
                        <button disabled={busyId === o.id} onClick={() => confirmBooking(o, false)} className="rounded-full bg-red-500/20 px-2.5 py-1 text-[10px] font-bold text-red-300 hover:bg-red-500/30">
                          Decline
                        </button>
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {logged.has(o.id) ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-green-400">
                        <Check className="h-3.5 w-3.5" /> In tracker
                      </span>
                    ) : (
                      <button
                        disabled={busyId === o.id}
                        onClick={() => logToTracker(o)}
                        className="inline-flex items-center gap-1 rounded-full border border-white/15 px-3 py-1.5 text-[11px] font-bold text-white/70 hover:border-primary/40 hover:text-white"
                        title="Push this sale into your Money Tracker as income"
                      >
                        {busyId === o.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CircleDollarSign className="h-3.5 w-3.5" />}
                        Log to tracker
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-[11px] text-white/35">
        Honest math on every row: what the buyer paid, what the platform kept ({totals?.platformFeePct ?? 5}%), what's yours. Real dollars via Stripe — never Visual Bucs.
      </p>
    </div>
  );
}

/* ── Discounts tab ───────────────────────────────────────────────────── */
function DiscountsTab() {
  const isLight = useIsLightTheme();
  const getToken = useToken();
  const [codes, setCodes] = useState<DiscountCodeDTO[] | null>(null);
  const [form, setForm] = useState({ code: "", percentOff: "15", maxUses: "-1", expiresAt: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  /* Discount load failures are NOT "no codes yet" — they get their own
     error state with a retry, scoped to the code list only (the
     generator form above stays usable). The empty state renders ONLY
     for a successful load with zero codes. */
  const [loadError, setLoadError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const token = await getToken();
      const r = await listDiscounts(token);
      setCodes(r.codes);
    } catch {
      setLoadError(true);
    }
  }, [getToken]);

  useEffect(() => { load(); }, [load, retryNonce]);

  const randomCode = () => {
    const words = ["BOWDOWN", "CHEATCODE", "KING", "SHARK", "GOLD", "LAUNCH", "VIP"];
    const w = words[Math.floor(Math.random() * words.length)];
    const n = Math.floor(10 + Math.random() * 89);
    setForm((f) => ({ ...f, code: `${w}${n}` }));
  };

  const submit = async () => {
    setErr("");
    if (!form.code.trim()) { setErr("Name your code."); return; }
    const pct = parseInt(form.percentOff, 10);
    if (!pct || pct < 1 || pct > 90) { setErr("Percent off must be 1–90."); return; }
    setBusy(true);
    try {
      const token = await getToken();
      await createDiscount(token, {
        code: form.code.trim(),
        percentOff: pct,
        maxUses: parseInt(form.maxUses, 10) || -1,
        expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
      });
      setForm({ code: "", percentOff: "15", maxUses: "-1", expiresAt: "" });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't create that code.");
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (c: DiscountCodeDTO) => {
    const token = await getToken();
    await updateDiscount(token, c.id, { isActive: !c.isActive });
    await load();
  };

  const remove = async (c: DiscountCodeDTO) => {
    if (!window.confirm(`Delete code ${c.code}?`)) return;
    const token = await getToken();
    await deleteDiscount(token, c.id);
    await load();
  };

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(code);
      setTimeout(() => setCopied(null), 2000);
    } catch { /* clipboard blocked — user can select manually */ }
  };

  const inputCls = "w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/25";

  return (
    <div>
      {/* Generator — guided at 2★+, full control 4★+ (max uses / expiry). */}
      <div className="mb-6 rounded-2xl border border-primary/30 bg-[#14100a] p-5" data-min-stars="2">
        <h3 className="mb-1 text-base font-black text-white">Discount code generator 🏷️</h3>
        <p className="mb-4 text-[11px] text-white/45">Codes apply to your whole store and are checked server-side at checkout — nobody games the price.</p>
        {err && <p className="mb-3 flex items-center gap-2 text-xs text-red-400"><AlertCircle className="h-4 w-4" />{err}</p>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex gap-2">
            <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="CODE name" className={inputCls} />
            <button onClick={randomCode} title="Generate a code name" className="shrink-0 rounded-lg border border-primary/40 bg-primary/10 px-3 text-xs font-bold text-primary hover:bg-primary/20">
              <Sparkles className="h-4 w-4" />
            </button>
          </div>
          <input value={form.percentOff} onChange={(e) => setForm({ ...form, percentOff: e.target.value })} placeholder="% off (1–90)" inputMode="numeric" className={inputCls} />
          <div data-min-stars="4" className="contents">
            <input value={form.maxUses} onChange={(e) => setForm({ ...form, maxUses: e.target.value })} placeholder="Max uses (-1 = ∞)" inputMode="numeric" className={inputCls} />
            <input type="datetime-local" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} className={inputCls} />
          </div>
        </div>
        <button onClick={submit} disabled={busy} className="mt-4 rounded-full bg-gradient-to-b from-[#e8c547] to-[#b8860b] px-5 py-2 text-sm font-black text-black hover:brightness-110 disabled:opacity-60">
          {busy ? "Creating…" : "Create code"}
        </button>
      </div>

      {loadError ? (
        <div className={`rounded-2xl border p-10 text-center ${isLight ? "border-[#C9A84C]/50 bg-[#F7ECD2]" : "border-primary/25 bg-zinc-950"}`}>
          <AlertTriangle className="mx-auto h-10 w-10 text-primary" />
          <p className={`mt-3 font-bold ${isLight ? "text-[#2A1E07]" : "text-white"}`}>Couldn't load your discount codes.</p>
          <p className={`mt-1 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
            Something went wrong on our end — your codes are safe, this tab just couldn't load them.
          </p>
          <button
            type="button"
            onClick={() => setRetryNonce((n) => n + 1)}
            className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 font-bold text-black hover:brightness-110"
          >
            <RotateCcw className="h-4 w-4" /> Try again
          </button>
        </div>
      ) : !codes ? (
        <div className="flex justify-center py-10 text-white/40"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : codes.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/15 p-10 text-center">
          <p className="text-sm font-bold text-white/70">No codes yet.</p>
          <p className="mt-1 text-xs text-white/40">A 15%-off launch code turns browsers into buyers.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {codes.map((c) => (
            <div key={c.id} className={`rounded-2xl border p-4 ${c.isActive ? "border-white/10 lux-card" : "border-white/[0.06] opacity-50"}`}>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 font-mono text-base font-black text-primary">
                  <Tag className="h-4 w-4" /> {c.code}
                </span>
                <button onClick={() => copy(c.code)} className="rounded-lg border border-white/10 p-1.5 text-white/60 hover:text-white" title="Copy code">
                  {copied === c.code ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
              <p className="mt-2 text-sm font-bold text-white">{c.percentOff}% off</p>
              <p className="mt-0.5 text-[11px] text-white/40">
                {c.usedCount} used{c.maxUses === -1 ? "" : ` / ${c.maxUses} max`}
                {c.expiresAt && ` · expires ${new Date(c.expiresAt).toLocaleDateString()}`}
              </p>
              {c.appliesTo && (
                <p className="mt-1 text-[11px] text-white/35">Applies to: {c.appliesTo}</p>
              )}
              <div className="mt-3 flex gap-2">
                <button onClick={() => toggle(c)} className="rounded-full border border-white/15 px-3 py-1 text-[11px] font-bold text-white/70 hover:text-white">
                  {c.isActive ? "Deactivate" : "Activate"}
                </button>
                <button onClick={() => remove(c)} className="rounded-full border border-white/15 px-3 py-1 text-[11px] font-bold text-red-400/80 hover:text-red-300">
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────────────────── */
export default function StoreDashboard() {
  usePageTitle("Store Dashboard — Get Paid", "Your store earnings, orders, products, and discount codes. The Get Paid finale.");
  const isLight = useIsLightTheme();
  const getToken = useToken();
  const { gateStars: stars } = useUserMode();
  const search = useSearch();
  const initialTab = useMemo<Tab>(() => {
    const t = new URLSearchParams(search).get("tab");
    return t === "products" || t === "orders" || t === "discounts" ? t : "overview";
  }, [search]);
  const [tab, setTab] = useState<Tab>(initialTab);
  /* Revenue surface — ?view=digital deep link; defaults to storefront so
     existing ?tab=products|orders|discounts links keep working. */
  const [surface, setSurface] = useState<Surface>(() => {
    try {
      if (new URLSearchParams(window.location.search).get("view") === "digital") return "digital";
    } catch { /* non-browser — ignore */ }
    return "storefront";
  });
  const [checklist, setChecklist] = useState<MoneyChecklist | null>(null);
  const [slug, setSlug] = useState("");
  /* The money-checklist endpoint answers a genuine no-profile account
     with 404 { error: "NO_PROFILE" } — that case keeps the setup-CTA
     box below: a settled, honest state, NOT a failure, so the section
     settles ok alongside it. Every OTHER failure (500s, network)
     fails the overview section alone — its card renders in the
     overview area with its own retry, and the payout card, the tabs,
     and the digital surface keep working. */
  const [noProfile, setNoProfile] = useState(false);
  const [overviewStates, setOverviewStates] = useState<SectionStates<StoreOverviewSectionKey>>(
    () => initialSectionStates(STORE_OVERVIEW_SECTION_KEYS),
  );

  const load = useCallback(async () => {
    setNoProfile(false);
    try {
      const token = await getToken();
      const c = await moneyChecklist(token);
      setChecklist(c);
      const storeUrl: string = c.links.storeUrl ?? "";
      setSlug(storeUrl.split("/artist/")[1] ?? "");
      setOverviewStates((prev) => settleSection(prev, "overview", true));
    } catch (e) {
      if (e instanceof Error && e.message === "NO_PROFILE") {
        setNoProfile(true);
        setOverviewStates((prev) => settleSection(prev, "overview", true));
      } else {
        setOverviewStates((prev) => settleSection(prev, "overview", false));
      }
    }
  }, [getToken]);

  useEffect(() => { load(); }, [load]);

  /* The overview card's Retry refetches the overview section alone —
     never the payout card's or the tabs' sections. */
  const retryOverview = () => {
    const plan = sectionsToRefetch(STORE_OVERVIEW_SECTION_KEYS, overviewStates, "overview");
    setOverviewStates((prev) => plan.reduce((s, k) => markSectionLoading(s, k), prev));
    void load();
  };
  useEffect(() => { setTab(initialTab); }, [initialTab]);

  const tabs: { id: Tab; label: string; icon: typeof Wallet }[] = [
    { id: "overview", label: "Get Paid", icon: Wallet },
    { id: "products", label: "Products", icon: ShoppingBag },
    { id: "orders", label: "Orders", icon: TrendingUp },
    { id: "discounts", label: "Discounts", icon: Tag },
  ];

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-white">
            👑 Store Dashboard
          </h1>
          <p className="mt-1 text-sm text-white/50">
            The Get Paid finale. Your earnings, your checklist, your next money move —{" "}
            <span className="font-bold text-primary">{stars}★ {levelInfo(stars).rank}</span>.
          </p>
        </div>
        {slug && (
          <Link href={`/artist/${slug}`}>
            <span className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-white/15 px-4 py-2 text-xs font-bold text-white/70 hover:text-white">
              View your public store <ExternalLink className="h-3.5 w-3.5" />
            </span>
          </Link>
        )}
      </div>

      {noProfile ? (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/[0.06] p-8 text-center">
          <p className="text-sm font-bold text-white">Couldn't load your dashboard.</p>
          <p className="mt-1 text-xs text-white/50">You need a creator profile first — then this page becomes your money command center.</p>
          <Link href="/choose-artist">
            <span className="mt-4 inline-block cursor-pointer rounded-full bg-gradient-to-b from-[#e8c547] to-[#b8860b] px-5 py-2 text-sm font-black text-black">
              Set up your creator profile →
            </span>
          </Link>
        </div>
      ) : (
        <>
          {/* ── Revenue surface switcher ── */}
          <div className="mb-6 flex flex-wrap gap-2">
            {(
              [
                { key: "storefront", label: "Storefront sales", icon: ShoppingBag },
                { key: "digital", label: "Digital sales", icon: Music2 },
              ] as { key: Surface; label: string; icon: typeof ShoppingBag }[]
            ).map((s) => (
              <button
                key={s.key}
                onClick={() => setSurface(s.key)}
                className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-bold transition ${
                  surface === s.key
                    ? "bg-gradient-to-b from-[#e8c547] to-[#b8860b] text-black shadow-[0_0_16px_rgba(218,165,32,0.35)]"
                    : "border border-white/10 bg-white/[0.03] text-white/60 hover:border-primary/40 hover:text-white"
                }`}
              >
                <s.icon className="h-4 w-4" /> {s.label}
              </button>
            ))}
            <Link href="/royalties">
              <span className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-bold text-white/60 transition hover:border-primary/40 hover:text-white">
                <BadgeDollarSign className="h-4 w-4" /> Royalties <ExternalLink className="h-3.5 w-3.5" />
              </span>
            </Link>
          </div>

          {surface === "storefront" && (
          <>
          {/* The overview section's own states: its failure card sits
              HERE, in the overview's area — the payout card and the
              tabs below are separate sections and stay up. */}
          {overviewStates.overview === "failed" ? (
            <div data-testid="store-overview-failure" className={`rounded-2xl border p-10 text-center ${isLight ? "border-[#C9A84C]/50 bg-[#F7ECD2]" : "border-primary/25 bg-zinc-950"}`}>
              <AlertTriangle className="mx-auto h-10 w-10 text-primary" />
              <p className={`mt-3 font-bold ${isLight ? "text-[#2A1E07]" : "text-white"}`}>Couldn't load your store overview.</p>
              <p className={`mt-1 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
                Something went wrong on our end — your store is safe, and the tabs below still work. This overview just couldn't load.
              </p>
              <button
                type="button"
                onClick={retryOverview}
                className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 font-bold text-black hover:brightness-110"
              >
                <RotateCcw className="h-4 w-4" /> Try again
              </button>
            </div>
          ) : !checklist ? (
            <div className="flex justify-center py-20 text-white/40"><Loader2 className="h-8 w-8 animate-spin" /></div>
          ) : (
            <EarningsHero data={checklist} />
          )}

          <div className="mt-5"><ConnectPayoutCard /></div>

          <div className="mb-6 mt-6 flex gap-2 overflow-x-auto border-b border-white/10 pb-px">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex shrink-0 items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-bold transition ${
                  tab === t.id
                    ? "border-primary text-primary"
                    : "border-transparent text-white/45 hover:text-white"
                }`}
              >
                <t.icon className="h-4 w-4" /> {t.label}
              </button>
            ))}
          </div>

          {tab === "overview" && overviewStates.overview === "ok" && checklist && (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
              <div className="lg:col-span-3"><NextMoveCard data={checklist} /></div>
              <div className="lg:col-span-2"><ChecklistCard data={checklist} /></div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 lg:col-span-5" data-min-stars="2">
                <h3 className="mb-1 flex items-center gap-2 text-sm font-black uppercase tracking-wider text-white/70">
                  <CalendarClock className="h-4 w-4 text-primary" /> Promote like you mean it
                </h3>
                <p className="text-xs leading-relaxed text-white/50">
                  Every product on your <Link href={checklist.links.storeUrl}><span className="cursor-pointer font-bold text-primary hover:underline">public store</span></Link> has a{" "}
                  <b className="text-white/70">Promote</b> button: share link with your referral code, scheduler prefill, promo visuals, discount attach, and an email-list broadcast draft.
                  The store sells. Promotion is what makes it sell <i>today</i>.
                </p>
              </div>
              {/* Streaming royalties live in their own tracker — one tap away. */}
              <Link href="/royalties" className="lg:col-span-5">
                <span className="block cursor-pointer rounded-2xl border border-primary/40 bg-gradient-to-br from-primary/[0.14] to-transparent p-5 shadow-[0_0_36px_rgba(218,165,32,0.14)] transition hover:brightness-110">
                  <span className="flex items-center gap-2 text-sm font-black uppercase tracking-wider text-primary">
                    <BadgeDollarSign className="h-4 w-4" /> Streaming royalties
                  </span>
                  <span className="mt-1 block text-xs leading-relaxed text-white/50">
                    Every dollar your music earns across Spotify, Apple Music, and the rest — import your distributor CSVs, track payouts, and get AI earnings insights. <span className="font-bold text-primary">Open the Royalty Tracker →</span>
                  </span>
                </span>
              </Link>
            </div>
          )}
          {tab === "products" && <ProductsTab slug={slug} onChanged={load} />}
          {tab === "products" && <CourseBuilderPanel />}
          {tab === "products" && (
            <div className="mt-5">
              <ShopifyBridgeCard onImported={load} />
            </div>
          )}
          {tab === "orders" && <OrdersTab />}
          {tab === "discounts" && <DiscountsTab />}
          </>
          )}
          {surface === "digital" && <DigitalSalesTab />}
        </>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   SHOPIFY CSV BRIDGE — docked in shop management (Products tab).
   "Shopify" is named only as the file format's label. Import previews
   EVERY row (create / update / image / reject-with-reason) before a
   single listing saves; exports hand the creator their catalog, orders,
   and fan list in Shopify's CSV shapes. No lock-in, either direction. */
function ShopifyBridgeCard({ onImported }: { onImported: () => void }) {
  const isLight = useIsLightTheme();
  const getToken = useToken();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [fileName, setFileName] = useState("");
  const [csvText, setCsvText] = useState("");
  const [report, setReport] = useState<ShopifyImportResultDTO | null>(null);
  const [committed, setCommitted] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");

  const headCls = isLight ? "text-[#2A1E07]" : "text-white";
  const subCls = isLight ? "text-[#6B5B36]" : "text-white/50";
  const cellCls = isLight ? "text-[#2A1E07]" : "text-white/80";
  const borderCls = isLight ? "border-[#C9A84C]/40" : "border-white/10";

  const runPreview = async (csv: string) => {
    setBusy("preview"); setErr("");
    try {
      const token = await getToken();
      setReport(await previewShopifyImport(token, csv));
      setCommitted(false);
    } catch (e) {
      setReport(null);
      setErr(e instanceof Error ? e.message : "Couldn't read that file.");
    } finally { setBusy(null); }
  };

  const onFile = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    setFileName(f.name);
    setReport(null); setCommitted(false); setErr("");
    const text = await f.text();
    setCsvText(text);
    await runPreview(text);
  };

  const doCommit = async () => {
    setBusy("commit"); setErr("");
    try {
      const token = await getToken();
      setReport(await commitShopifyImport(token, csvText));
      setCommitted(true);
      onImported();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't import that file.");
    } finally { setBusy(null); }
  };

  const doExport = async (kind: ShopifyExportKind) => {
    setBusy(`export-${kind}`); setErr("");
    try {
      const token = await getToken();
      const { blob, filename } = await downloadShopifyExport(token, kind);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Export failed.");
    } finally { setBusy(null); }
  };

  const actionChip = (action: string) => {
    const styles: Record<string, string> = {
      create: "bg-emerald-500/15 text-emerald-500",
      update: "bg-sky-500/15 text-sky-500",
      image: "bg-zinc-500/15 text-zinc-400",
      reject: "bg-red-500/15 text-red-500",
    };
    const labels: Record<string, string> = {
      create: committed ? "Created" : "New",
      update: committed ? "Updated" : "Update",
      image: "Image",
      reject: "Skipped",
    };
    return (
      <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${styles[action] ?? ""}`}>
        {labels[action] ?? action}
      </span>
    );
  };

  const actionable = report ? report.summary.creates + report.summary.updates : 0;

  return (
    <div className={`rounded-2xl border p-5 ${isLight ? "border-[#C9A84C]/50 bg-[#F7ECD2]" : "border-white/10 bg-white/[0.03]"}`}>
      <h3 className={`flex items-center gap-2 text-sm font-black uppercase tracking-wider ${headCls}`}>
        <FileSpreadsheet className="h-4 w-4 text-primary" /> Shopify CSV bridge
      </h3>
      <p className={`mt-1 text-xs leading-relaxed ${subCls}`}>
        Bring a Shopify catalog in, or take yours out — plain CSV files, no lock-in either way.
        Every variant becomes its own listing (store listings carry one price each), prices land
        exactly as the file states them, and re-importing the same file updates listings instead
        of duplicating them.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div>
          <p className={`text-xs font-bold ${headCls}`}>Import products</p>
          <p className={`mt-0.5 text-[11px] ${subCls}`}>
            Export your products CSV from Shopify, then pick it here. You preview every row before anything saves.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => { void onFile(e.target.files); e.target.value = ""; }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="mt-2 inline-flex items-center gap-2 rounded-full border border-primary/50 px-4 py-2 text-xs font-bold text-primary transition hover:bg-primary hover:text-black"
          >
            {busy === "preview" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            {fileName ? `Chosen: ${fileName}` : "Choose Shopify products CSV"}
          </button>
        </div>
        <div>
          <p className={`text-xs font-bold ${headCls}`}>Export in Shopify format</p>
          <p className={`mt-0.5 text-[11px] ${subCls}`}>Your data, in the shape Shopify imports — leave whenever you want.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {([
              { kind: "products", label: "Products CSV" },
              { kind: "orders", label: "Orders CSV" },
              { kind: "customers", label: "Customers CSV (fan list)" },
            ] as { kind: ShopifyExportKind; label: string }[]).map((b) => (
              <button
                key={b.kind}
                type="button"
                onClick={() => { void doExport(b.kind); }}
                className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-bold transition ${borderCls} ${headCls} hover:border-primary/50 hover:text-primary`}
              >
                {busy === `export-${b.kind}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                {b.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {err && (
        <p className="mt-3 flex items-start gap-1.5 text-xs font-bold text-red-500">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {err}
        </p>
      )}

      {report && (
        <div className="mt-4">
          <div className={`flex flex-wrap items-center gap-2 text-xs font-bold ${headCls}`}>
            <span>{report.summary.products} products</span>
            <span className="text-emerald-500">{report.summary.creates} new</span>
            <span className="text-sky-500">{report.summary.updates} updates</span>
            <span className={subCls}>{report.summary.images} image rows</span>
            {report.summary.rejected > 0 && <span className="text-red-500">{report.summary.rejected} skipped</span>}
            {committed && <span className="inline-flex items-center gap-1 text-emerald-500"><CheckCircle2 className="h-3.5 w-3.5" /> Imported</span>}
          </div>
          <div className={`mt-2 max-h-64 overflow-y-auto rounded-xl border ${borderCls}`}>
            <table className="w-full text-left text-xs">
              <thead>
                <tr className={`${subCls} border-b ${borderCls}`}>
                  <th className="px-3 py-2 font-bold">Row</th>
                  <th className="px-3 py-2 font-bold">Listing</th>
                  <th className="px-3 py-2 font-bold">Action</th>
                  <th className="px-3 py-2 font-bold">Notes</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r) => (
                  <tr key={r.row} className={`border-b last:border-0 ${borderCls}`}>
                    <td className={`px-3 py-1.5 ${subCls}`}>{r.row}</td>
                    <td className={`px-3 py-1.5 font-bold ${cellCls}`}>{r.title ?? "—"}{r.sku ? <span className={`font-normal ${subCls}`}> · {r.sku}</span> : null}</td>
                    <td className="px-3 py-1.5">{actionChip(r.action)}</td>
                    <td className={`px-3 py-1.5 ${r.action === "reject" ? "text-red-500" : subCls}`}>
                      {r.reason ?? r.warnings.join(" ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!committed && actionable > 0 && (
            <button
              type="button"
              onClick={() => { void doCommit(); }}
              disabled={busy === "commit"}
              className="mt-3 inline-flex items-center gap-2 rounded-full bg-gradient-to-b from-[#e8c547] to-[#b8860b] px-5 py-2 text-sm font-black text-black transition hover:brightness-110 disabled:opacity-60"
            >
              {busy === "commit" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Import {actionable} listing{actionable === 1 ? "" : "s"}
            </button>
          )}
          {!committed && actionable === 0 && (
            <p className={`mt-3 text-xs ${subCls}`}>Nothing importable in this file — every row above says why.</p>
          )}
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   DIGITAL SALES — the full /music-sales page, absorbed as a surface.
   Creator sales dashboard for digital content: every sale, your cut,
   per-drop breakdown, and one-tap logging into the Money Tracker.

   Data sources preserved verbatim: GET /api/store/sales,
   GET /api/store/checklist, GET /api/store/products,
   GET /api/store/price-guide, PATCH /api/store/price,
   POST /api/store/suggest-price, POST /api/store/log-to-tracker.
   All money actions are real dollars (Stripe) — no Visual Bucs, no credit
   costs on any action here. */

interface DigitalSale {
  id: string;
  itemKind: string;
  itemId: string;
  itemTitle: string;
  gross: string;
  platformFee: string;
  creatorAmount: string;
  soldAt: string;
  loggedToTracker: boolean;
  buyUrl: string;
}

interface DigitalSalesData {
  totals: { sales: number; gross: string; platformFee: string; pendingPayout: string; pendingPayoutCents: number };
  byKind: { kind: string; sales: number; gross: string; creatorAmount: string }[];
  sales: DigitalSale[];
  platformFeePct: number;
  payoutNote: string;
  profileUrl: string;
}

interface DigitalChecklistStep {
  id: string;
  label: string;
  detail: string;
  done: boolean;
  cta: { label: string; href: string };
}

interface DigitalProduct {
  kind: string;
  id: string;
  title: string;
  priceCents: number;
  price: string;
  youKeep: string;
  isPublished: boolean;
  forSale: boolean;
  artworkUrl: string | null;
  buyUrl: string;
}

interface DigitalProductsData {
  vertical: string;
  verticalLabel: string;
  profileUrl: string;
  products: DigitalProduct[];
}

async function digitalAuthed(path: string, token: string | null, init?: RequestInit) {
  return fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

/* The digital surface's three sections — one endpoint each: sales
   (totals + recent sales), checklist (the Get Paid checklist), and
   products (the pricing list). They settle independently through the
   shared seam; see the state block inside DigitalSalesTab. */
type DigitalSectionKey = "sales" | "checklist" | "products";
const DIGITAL_SECTION_KEYS: readonly DigitalSectionKey[] = ["sales", "checklist", "products"];

/* A failed digital section's own note, rendered in that section's
   area — never the section's empty state, never a surface takeover.
   Same shape as the page's other failure cards, in this surface's
   amber styling, with the section's own Retry. */
function DigitalSectionFailure({ label, onRetry, testId }: {
  label: string;
  onRetry: () => void;
  testId: string;
}) {
  const isLight = useIsLightTheme();
  return (
    <div data-testid={testId} className={`mt-6 rounded-2xl border p-8 text-center ${isLight ? "border-amber-500/30 bg-gradient-to-b from-[#F7ECD2] to-[#FCF7EA]" : "border-amber-500/30 bg-gradient-to-b from-[#171204] to-[#0d0a04]"}`}>
      <AlertTriangle className="mx-auto h-8 w-8 text-primary" />
      <p className={`mt-3 font-bold ${isLight ? "text-[#2A1E07]" : "text-amber-200"}`}>{label} couldn’t load.</p>
      <p className={`mt-1 text-sm ${isLight ? "text-[#6B5B36]" : "text-amber-100/60"}`}>
        Something went wrong on our end — this section just couldn’t load. The rest of your dashboard is fine.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2 font-bold text-black hover:brightness-110"
      >
        <RotateCcw className="h-4 w-4" /> Try again
      </button>
    </div>
  );
}

function DigitalSalesTab() {
  const isLight = useIsLightTheme();
  const { getAccessToken } = useAuth();
  const { gateStars: stars } = useUserMode();
  const [data, setData] = useState<DigitalSalesData | null>(null);
  const [checklist, setChecklist] = useState<DigitalChecklistStep[] | null>(null);
  const [checklistComplete, setChecklistComplete] = useState(false);
  const [products, setProducts] = useState<DigitalProductsData | null>(null);
  const [guide, setGuide] = useState<{ smart: string; low: string; high: string; blurb: string } | null>(null);
  /* Per-section load states, driven by the shared seam. The three
     endpoints used to load in ONE Promise.all: a sales failure nuked
     the whole surface behind an error panel (which also claimed "No
     creator profile yet" for plain outages), while a checklist or
     products failure was silently swallowed — the section rendered
     missing, or the pricing list rendered as a fake empty. Now each
     section settles on its own: a failure shows that section's own
     note with its own Retry in its own area, and the big card is
     reserved for all three failing at once. */
  const [sectionStates, setSectionStates] = useState<SectionStates<DigitalSectionKey>>(
    () => initialSectionStates(DIGITAL_SECTION_KEYS),
  );
  /* Every digital endpoint answers a profile-less account with the
     same 404 { error: "NO_PROFILE" } — a settled state, not a
     failure; it keeps the setup panel below. */
  const [noProfile, setNoProfile] = useState(false);
  const [logging, setLogging] = useState<string | null>(null);
  const [pricing, setPricing] = useState<string | null>(null);
  const [customPrices, setCustomPrices] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);

  /* One section's fetch. Resolves true when the account has no
     creator profile (the endpoint's 404 NO_PROFILE) so the caller
     settles the section ok and the tab shows its setup panel. */
  const fetchDigitalSection = useCallback(async (key: DigitalSectionKey): Promise<boolean> => {
    const token = await getAccessToken();
    if (key === "sales") {
      const res = await digitalAuthed("/api/store/sales", token);
      const body = (await res.json().catch(() => ({}))) as DigitalSalesData & { error?: string; message?: string };
      if (!res.ok) {
        if (res.status === 404 && body.error === "NO_PROFILE") return true;
        throw new Error(body.message || body.error || "Couldn't load your sales.");
      }
      setData(body);
      return false;
    }
    if (key === "checklist") {
      const res = await digitalAuthed("/api/store/checklist", token);
      const body = (await res.json().catch(() => ({}))) as { steps?: DigitalChecklistStep[]; complete?: boolean; error?: string };
      if (!res.ok) {
        if (res.status === 404 && body.error === "NO_PROFILE") return true;
        throw new Error("Couldn't load your checklist.");
      }
      setChecklist(body.steps ?? []);
      setChecklistComplete(!!body.complete);
      return false;
    }
    const res = await digitalAuthed("/api/store/products", token);
    const body = (await res.json().catch(() => ({}))) as DigitalProductsData & { error?: string };
    if (!res.ok) {
      if (res.status === 404 && body.error === "NO_PROFILE") return true;
      throw new Error("Couldn't load your products.");
    }
    setProducts(body);
    /* Empty-state guide: what creators in YOUR vertical charge. A
       garnish on this section — its failure never fails the section
       (the products themselves already loaded). */
    if (body.products.length === 0) {
      try {
        const g = await fetch(`/api/store/price-guide?vertical=${encodeURIComponent(body.vertical)}&kind=track`);
        const gb = (await g.json().catch(() => ({}))) as {
          guide?: { track?: { smart: string; low: string; high: string; blurb: string } };
        };
        if (gb.guide?.track) setGuide(gb.guide.track);
      } catch { /* the guide is a garnish — the section already loaded */ }
    }
    return false;
  }, [getAccessToken]);

  const loadSection = useCallback(async (key: DigitalSectionKey) => {
    setSectionStates((prev) => markSectionLoading(prev, key));
    try {
      const noProf = await fetchDigitalSection(key);
      if (noProf) setNoProfile(true);
      setSectionStates((prev) => settleSection(prev, key, true));
    } catch {
      setSectionStates((prev) => settleSection(prev, key, false));
    }
  }, [fetchDigitalSection]);

  const loadAllSections = useCallback(() => {
    void Promise.allSettled(DIGITAL_SECTION_KEYS.map((k) => loadSection(k)));
  }, [loadSection]);

  useEffect(() => {
    loadAllSections();
  }, [loadAllSections]);

  /* A section's Retry refetches ONLY that section. */
  const retryDigitalSection = (key: DigitalSectionKey) => {
    void loadSection(key);
  };

  /* The total-failure card's Try again refetches the failed set. */
  const retryFailedDigitalSections = () => {
    for (const k of sectionsToRefetch(DIGITAL_SECTION_KEYS, sectionStates)) {
      void loadSection(k);
    }
  };

  async function applyPrice(kind: string, id: string, priceCents: number) {
    const key = `${kind}:${id}`;
    setPricing(key);
    setNotice(null);
    try {
      const token = await getAccessToken();
      const res = await digitalAuthed("/api/store/price", token, {
        method: "PATCH",
        body: JSON.stringify({ kind, id, priceCents }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string; message?: string;
        product?: { price: string; youKeep: string; title: string; forSale: boolean };
      };
      if (!res.ok || !body.product) throw new Error(body.message || body.error || "Couldn't set the price.");
      setNotice(
        `“${body.product.title}” priced at ${body.product.price} — you keep ${body.product.youKeep} per sale. ${body.product.forSale ? "It's live. Go get paid. 👑" : "Publish it to start selling."}`
      );
      /* A price change moves the products list AND the sales totals —
         refresh exactly those two sections, not the whole surface. */
      await Promise.allSettled([loadSection("sales"), loadSection("products")]);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Couldn't set the price.");
    } finally {
      setPricing(null);
    }
  }

  async function smartPrice(p: DigitalProduct) {
    const key = `${p.kind}:${p.id}`;
    setPricing(key);
    setNotice(null);
    try {
      const token = await getAccessToken();
      const res = await digitalAuthed("/api/store/suggest-price", token, {
        method: "POST",
        body: JSON.stringify({ kind: p.kind, itemId: p.id }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string; message?: string; suggestedCents?: number; suggested?: string; youKeep?: string; blurb?: string;
      };
      if (!res.ok || body.suggestedCents == null) throw new Error(body.message || body.error || "Couldn't suggest a price.");
      setPricing(null);
      await applyPrice(p.kind, p.id, body.suggestedCents);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Couldn't suggest a price.");
      setPricing(null);
    }
  }

  async function logToTracker(saleId: string) {
    setLogging(saleId);
    setNotice(null);
    try {
      const token = await getAccessToken();
      const res = await digitalAuthed("/api/store/log-to-tracker", token, {
        method: "POST",
        body: JSON.stringify({ saleId }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string; entry?: { amount: string } };
      if (!res.ok) throw new Error(body.message || body.error || "Couldn't log this sale.");
      setNotice(`Logged ${body.entry?.amount ?? ""} to your Money Tracker. 💰`);
      /* The logged flag lives in the sales section — refresh it alone. */
      await loadSection("sales");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Couldn't log this sale.");
    } finally {
      setLogging(null);
    }
  }

  function feePreview(cents: number): string {
    const fee = Math.round((cents * 10) / 100);
    return `You keep $${((cents - fee) / 100).toFixed(2)} · $${(fee / 100).toFixed(2)} platform fee`;
  }

  return (
    <div>
      <div className="flex items-center gap-3">
        <TrendingUp className="h-8 w-8 text-amber-300" />
        <div>
          <h2 className="text-2xl font-bold text-amber-200">Digital sales</h2>
          <p className="mt-1 text-sm text-amber-100/60">
            Create it, publish it, sell it, get paid — all in one place. It should feel illegal. 👑
          </p>
          {data?.profileUrl && (
            <Link href={data.profileUrl} className="mt-2 inline-flex items-center gap-1.5 text-sm text-amber-300 hover:underline">
              <ExternalLink className="h-4 w-4" /> View your public profile
            </Link>
          )}
        </div>
      </div>

      {notice && (
        <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-950/30 p-4 text-sm text-amber-200">
          {notice}
        </div>
      )}

      {noProfile ? (
        <div className={`${isLight ? "mt-8 rounded-2xl border border-amber-500/30 bg-gradient-to-b from-[#F7ECD2] to-[#FCF7EA] p-10 text-center" : "mt-8 rounded-2xl border border-amber-500/30 bg-gradient-to-b from-[#171204] to-[#0d0a04] p-10 text-center"}`}>
          <div className="text-4xl">🎤</div>
          <h2 className="mt-4 text-xl font-bold text-amber-200">No creator profile yet</h2>
          <p className="mt-2 text-amber-100/60">
            Set up your creator profile first — then every drop you sell shows up here.
          </p>
          <button
            type="button"
            onClick={loadAllSections}
            className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 font-bold text-black hover:brightness-110"
          >
            <RotateCcw className="h-4 w-4" /> Try again
          </button>
        </div>
      ) : allSectionsFailed(DIGITAL_SECTION_KEYS, sectionStates) ? (
        /* The big card is reserved for a TOTAL failure — all three
           sections down. Anything less renders the sections that
           loaded, with notes on the ones that didn't. */
        <div data-testid="store-digital-total-failure" className={`${isLight ? "mt-8 rounded-2xl border border-amber-500/30 bg-gradient-to-b from-[#F7ECD2] to-[#FCF7EA] p-10 text-center" : "mt-8 rounded-2xl border border-amber-500/30 bg-gradient-to-b from-[#171204] to-[#0d0a04] p-10 text-center"}`}>
          <AlertTriangle className="mx-auto h-10 w-10 text-primary" />
          <h2 className="mt-4 text-xl font-bold text-amber-200">Couldn't load your digital sales.</h2>
          <p className="mt-2 text-amber-100/60">
            Something went wrong on our end — your sales are safe, this surface just couldn't reach them.
          </p>
          <button
            type="button"
            onClick={retryFailedDigitalSections}
            className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 font-bold text-black hover:brightness-110"
          >
            <RotateCcw className="h-4 w-4" /> Try again
          </button>
        </div>
      ) : (
        <>
          {/* ── GET PAID CHECKLIST — the finale, leading the dashboard ── */}
          {sectionStates.checklist === "failed" ? (
            <DigitalSectionFailure testId="store-digital-checklist-failure" label="Your Get Paid checklist" onRetry={() => retryDigitalSection("checklist")} />
          ) : sectionStates.checklist === "loading" && !checklist ? (
            <div className="mt-6 flex justify-center py-6"><Loader2 className="h-6 w-6 animate-spin text-amber-400" /></div>
          ) : checklist && (
            <div className={`${isLight ? "mt-6 rounded-2xl border border-amber-400/40 bg-gradient-to-b from-[#F7ECD2] to-[#FCF7EA] p-6 shadow-[0_0_30px_rgba(201,162,39,0.15)]" : "mt-6 rounded-2xl border border-amber-400/40 bg-gradient-to-b from-[#1d1606] to-[#0d0a04] p-6 shadow-[0_0_30px_rgba(201,162,39,0.15)]"}`}>
              <h2 className="flex items-center gap-2 text-lg font-bold text-amber-200">
                <ListChecks className="h-5 w-5" />
                Get Paid Checklist
                {checklistComplete && <span className="text-sm font-normal text-amber-300">— you're fully live 👑</span>}
              </h2>
              <div className="mt-4 space-y-3">
                {checklist.map((s) => (
                  <div
                    key={s.id}
                    className={`flex items-center gap-4 rounded-xl border p-4 ${
                      s.done ? "border-green-500/30 bg-green-950/20" : isLight ? "border-[#C9A84C]/30 bg-[#F7ECD2]/70" : "border-amber-500/15 bg-black/40"
                    }`}
                  >
                    {s.done ? (
                      <CheckCircle2 className="h-6 w-6 shrink-0 text-green-400" />
                    ) : (
                      <CircleDashed className="h-6 w-6 shrink-0 text-amber-400/60" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className={`font-bold ${s.done ? "text-green-200" : "text-amber-100"}`}>{s.label}</div>
                      <div className="text-sm text-amber-100/50">{s.detail}</div>
                    </div>
                    {!s.done &&
                      (s.cta.href.startsWith("#") ? (
                        <a
                          href={s.cta.href}
                          className="shrink-0 rounded-full bg-gradient-to-b from-amber-300 to-amber-600 px-4 py-2 text-xs font-bold text-black hover:brightness-110"
                        >
                          {s.cta.label}
                        </a>
                      ) : (
                        <Link
                          href={s.cta.href}
                          className="shrink-0 rounded-full bg-gradient-to-b from-amber-300 to-amber-600 px-4 py-2 text-xs font-bold text-black hover:brightness-110"
                        >
                          {s.cta.label}
                        </Link>
                      ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── PRICING — difficulty ladder ── */}
          {sectionStates.products === "failed" ? (
            <DigitalSectionFailure testId="store-digital-products-failure" label="Your pricing list" onRetry={() => retryDigitalSection("products")} />
          ) : (
          <div id="pricing" className={`${isLight ? "mt-6 scroll-mt-6 rounded-2xl border border-amber-500/20 bg-gradient-to-b from-[#F7ECD2] to-[#FCF7EA] p-6" : "mt-6 scroll-mt-6 rounded-2xl border border-amber-500/20 bg-gradient-to-b from-[#141004] to-[#0d0a04] p-6"}`}>
            <h2 className="flex items-center gap-2 text-lg font-bold text-amber-200">
              <Tag className="h-5 w-5" /> Price your content
            </h2>
            <p className="mt-1 text-sm text-amber-100/60">
              {stars === 1
                ? "One tap and it's priced — the smart default does the thinking."
                : stars <= 3
                  ? "Pick a proven price point, or let the smart default decide."
                  : "Full control: any price you want, with the fee math live."}{" "}
              You always keep 95%.
            </p>

            {sectionStates.products === "loading" && !products ? (
              <div className="mt-4 flex justify-center py-6"><Loader2 className="h-6 w-6 animate-spin text-amber-400" /></div>
            ) : products && products.products.length === 0 ? (
              <div className={`mt-4 rounded-xl border p-6 text-center ${isLight ? "border-[#C9A84C]/30 bg-[#F7ECD2]/70" : "border-amber-500/20 bg-black/40"}`}>
                <div className="text-4xl">💰</div>
                <h3 className="mt-2 text-lg font-bold text-amber-200">List your first product</h3>
                <p className="mx-auto mt-2 max-w-md text-sm text-amber-100/60">
                  Upload a track, video, course, or pack from your creator tools — then price it right here.
                  {guide && products && (
                    <>
                      {" "}Here's what {products.verticalLabel.toLowerCase()} creators charge for a track:{" "}
                      <span className="font-bold text-amber-300">{guide.smart}</span> (usually {guide.low}–{guide.high}).
                    </>
                  )}
                </p>
                {guide && <p className="mx-auto mt-2 max-w-md text-xs text-amber-100/50">{guide.blurb}</p>}
                {products.profileUrl && (
                  <Link
                    href={products.profileUrl}
                    className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-gradient-to-b from-amber-300 to-amber-600 px-5 py-2.5 text-sm font-bold text-black hover:brightness-110"
                  >
                    <ExternalLink className="h-4 w-4" /> Go to your profile
                  </Link>
                )}
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {products?.products.map((p) => {
                  const key = `${p.kind}:${p.id}`;
                  const busy = pricing === key;
                  const custom = customPrices[key] ?? "";
                  const customCents = Math.round(Number(custom) * 100);
                  return (
                    <div key={key} className={`rounded-xl border p-4 ${isLight ? "border-[#C9A84C]/30 bg-[#F7ECD2]/70" : "border-amber-500/10 bg-black/40"}`}>
                      <div className="flex items-center gap-3">
                        {p.artworkUrl ? (
                          <img src={p.artworkUrl} alt={p.title} className="h-12 w-12 rounded-lg object-cover" />
                        ) : (
                          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-amber-900/30 text-xl">👑</div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="text-xs uppercase tracking-widest text-amber-400/70">
                            {(KIND_LABELS as Record<string, string>)[p.kind] ?? p.kind}
                          </div>
                          <div className="truncate font-bold text-amber-100">{p.title}</div>
                          <div className="text-xs text-amber-100/50">
                            {p.forSale ? (
                              <>On sale at <span className="font-semibold text-amber-300">{p.price}</span> · you keep {p.youKeep}</>
                            ) : p.isPublished ? (
                              "Published, no price yet — price it to start selling"
                            ) : (
                              "Draft — publish it from your creator tools, then price it here"
                            )}
                          </div>
                        </div>
                        <Link href={p.buyUrl} className="shrink-0 text-xs text-amber-300 hover:underline">
                          Drop page
                        </Link>
                      </div>

                      {/* 1★ — always visible: the primary pricing action is never gated */}
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button
                          onClick={() => smartPrice(p)}
                          disabled={busy}
                          className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-b from-amber-300 to-amber-600 px-4 py-2 text-xs font-bold text-black hover:brightness-110 disabled:opacity-60"
                        >
                          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                          ✨ Smart price it for me
                        </button>

                        {/* 2-3★ — guided presets */}
                        <span data-min-stars="2" className="inline-flex flex-wrap items-center gap-2">
                          <DigitalPresetButtons
                            kind={p.kind}
                            busy={busy}
                            onPick={(cents) => applyPrice(p.kind, p.id, cents)}
                          />
                        </span>

                        {/* 4-6★ — full control */}
                        <span data-min-stars="4" className="inline-flex items-center gap-2">
                          <span className="text-xs text-amber-100/50">$</span>
                          <input
                            value={custom}
                            onChange={(e) => setCustomPrices((m) => ({ ...m, [key]: e.target.value.replace(/[^0-9.]/g, "") }))}
                            placeholder="9.99"
                            inputMode="decimal"
                            className="w-20 rounded-lg border border-amber-500/30 bg-black px-2 py-1.5 text-sm text-amber-100 placeholder:text-amber-100/30"
                          />
                          <button
                            onClick={() => customCents > 0 && applyPrice(p.kind, p.id, customCents)}
                            disabled={busy || !(customCents > 0)}
                            className="rounded-full border border-amber-500/40 px-3 py-1.5 text-xs font-bold text-amber-200 hover:bg-amber-500/10 disabled:opacity-40"
                          >
                            Set price
                          </button>
                        </span>
                      </div>
                      <span data-min-stars="4" className="mt-1 block text-xs text-amber-100/40">
                        {customCents > 0 ? feePreview(customCents) : "Type a custom price to see the live fee split."}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          )}

          {/* ── Totals (never gated): a sales failure shows its own
               note here — never fake zero totals in its place. ── */}
          {sectionStates.sales === "failed" ? (
            <DigitalSectionFailure testId="store-digital-sales-failure" label="Your sales totals" onRetry={() => retryDigitalSection("sales")} />
          ) : sectionStates.sales === "loading" && !data ? (
            <div className="mt-6 flex justify-center py-6"><Loader2 className="h-6 w-6 animate-spin text-amber-400" /></div>
          ) : null}
          {data && sectionStates.sales !== "failed" && (
            <>
              <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
                <div className={`${isLight ? "rounded-2xl border border-amber-500/20 bg-gradient-to-b from-[#F7ECD2] to-[#FCF7EA] p-5" : "rounded-2xl border border-amber-500/20 bg-gradient-to-b from-[#141004] to-[#0d0a04] p-5"}`}>
                  <div className="text-xs uppercase tracking-widest text-amber-400/70">Sales</div>
                  <div className="mt-1 text-2xl font-bold text-amber-200">{data.totals.sales}</div>
                </div>
                <div className={`${isLight ? "rounded-2xl border border-amber-500/20 bg-gradient-to-b from-[#F7ECD2] to-[#FCF7EA] p-5" : "rounded-2xl border border-amber-500/20 bg-gradient-to-b from-[#141004] to-[#0d0a04] p-5"}`}>
                  <div className="text-xs uppercase tracking-widest text-amber-400/70">Gross</div>
                  <div className="mt-1 text-2xl font-bold text-amber-200">{data.totals.gross}</div>
                </div>
                <div className={`${isLight ? "rounded-2xl border border-amber-500/20 bg-gradient-to-b from-[#F7ECD2] to-[#FCF7EA] p-5" : "rounded-2xl border border-amber-500/20 bg-gradient-to-b from-[#141004] to-[#0d0a04] p-5"}`}>
                  <div className="text-xs uppercase tracking-widest text-amber-400/70">
                    Platform fee ({data.platformFeePct}%)
                  </div>
                  <div className="mt-1 text-2xl font-bold text-amber-100/70">{data.totals.platformFee}</div>
                </div>
                <div className={`${isLight ? "rounded-2xl border border-amber-400/40 bg-gradient-to-b from-[#F7ECD2] to-[#FCF7EA] p-5 shadow-[0_0_30px_rgba(201,162,39,0.15)]" : "rounded-2xl border border-amber-400/40 bg-gradient-to-b from-[#1d1606] to-[#0d0a04] p-5 shadow-[0_0_30px_rgba(201,162,39,0.15)]"}`}>
                  <div className="flex items-center gap-1.5 text-xs uppercase tracking-widest text-amber-300">
                    <PiggyBank className="h-4 w-4" /> Your cut · pending payout
                  </div>
                  <div className="mt-1 text-2xl font-bold text-amber-300">{data.totals.pendingPayout}</div>
                </div>
              </div>

              <div className={`mt-4 flex items-start gap-2 rounded-xl border p-4 text-xs ${isLight ? "border-[#C9A84C]/30 bg-[#F7ECD2]/70 text-[#6B5B36]" : "border-amber-500/20 bg-black/40 text-amber-100/60"}`}>
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                <span>
                  {data.payoutNote} Real money, real dollars — completely separate from Visual Bucs (AI credits).
                </span>
              </div>

              {data.byKind.length > 0 && (
                <div className={`${isLight ? "mt-6 rounded-2xl border border-amber-500/20 bg-gradient-to-b from-[#F7ECD2] to-[#FCF7EA] p-6" : "mt-6 rounded-2xl border border-amber-500/20 bg-gradient-to-b from-[#141004] to-[#0d0a04] p-6"}`}>
                  <h2 className="flex items-center gap-2 text-lg font-bold text-amber-200">
                    <Sparkles className="h-5 w-5" /> What's selling
                  </h2>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                    {data.byKind.map((k) => (
                      <div key={k.kind} className={`rounded-xl border p-4 ${isLight ? "border-[#C9A84C]/30 bg-[#F7ECD2]/70" : "border-amber-500/10 bg-black/40"}`}>
                        <div className="text-xs uppercase tracking-widest text-amber-400/70">
                          {(KIND_LABELS as Record<string, string>)[k.kind] ?? k.kind}
                        </div>
                        <div className="mt-1 text-xl font-bold text-amber-200">{k.gross}</div>
                        <div className="text-xs text-amber-100/50">
                          {k.sales} sale{k.sales === 1 ? "" : "s"} · you keep {k.creatorAmount}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className={`${isLight ? "mt-6 rounded-2xl border border-amber-500/20 bg-gradient-to-b from-[#F7ECD2] to-[#FCF7EA] p-6" : "mt-6 rounded-2xl border border-amber-500/20 bg-gradient-to-b from-[#141004] to-[#0d0a04] p-6"}`}>
                <h2 className="flex items-center gap-2 text-lg font-bold text-amber-200">
                  <BadgeDollarSign className="h-5 w-5" /> Recent sales
                </h2>
                {data.sales.length === 0 ? (
                  <p className="mt-4 text-amber-100/60">
                    No sales yet. Put a price on your content and share the link — the first "you just got
                    paid" moment is waiting.
                  </p>
                ) : (
                  <div className="mt-4 space-y-3">
                    {data.sales.map((s) => (
                      <div key={s.id} className={`flex items-center gap-4 rounded-xl border p-4 ${isLight ? "border-[#C9A84C]/30 bg-[#F7ECD2]/70" : "border-amber-500/10 bg-black/40"}`}>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs uppercase tracking-widest text-amber-400/70">
                            {(KIND_LABELS as Record<string, string>)[s.itemKind] ?? s.itemKind}
                          </div>
                          <Link href={s.buyUrl} className="truncate font-bold text-amber-100 hover:text-amber-300 hover:underline">
                            {s.itemTitle}
                          </Link>
                          <div className="text-xs text-amber-100/50">
                            {new Date(s.soldAt).toLocaleString()} · {s.gross} sale · {s.platformFee} fee ·{" "}
                            <span className="font-semibold text-amber-200">you keep {s.creatorAmount}</span>
                          </div>
                        </div>
                        {s.loggedToTracker ? (
                          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-green-500/30 bg-green-950/30 px-3 py-1.5 text-xs font-semibold text-green-300">
                            <CheckCircle2 className="h-4 w-4" /> In Money Tracker
                          </span>
                        ) : (
                          <button
                            onClick={() => logToTracker(s.id)}
                            disabled={logging === s.id}
                            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-gradient-to-b from-amber-300 to-amber-600 px-4 py-2 text-xs font-bold text-black hover:brightness-110 disabled:opacity-60"
                          >
                            {logging === s.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlusCircle className="h-4 w-4" />}
                            Log to Money Tracker
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <Link href="/coach?tab=money" className="mt-4 inline-flex items-center gap-1.5 text-sm text-amber-300 hover:underline">
                  <Wallet className="h-4 w-4" /> Open the Money Tracker
                </Link>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

/* Guided presets (2-3★): fetched per kind from the price guide. */
function DigitalPresetButtons({ kind, busy, onPick }: { kind: string; busy: boolean; onPick: (cents: number) => void }) {
  const [presets, setPresets] = useState<{ cents: number; label: string }[] | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/store/price-guide?kind=${encodeURIComponent(kind)}`)
      .then((r) => r.json())
      .then((b: { guide?: Record<string, { presets?: { cents: number; label: string }[] }> }) => {
        if (alive) setPresets(b.guide?.[kind]?.presets ?? null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [kind]);
  if (!presets) return null;
  return (
    <>
      {presets.map((p) => (
        <button
          key={p.cents}
          onClick={() => onPick(p.cents)}
          disabled={busy}
          className="rounded-full border border-amber-500/40 px-3 py-1.5 text-xs font-bold text-amber-200 hover:bg-amber-500/10 disabled:opacity-40"
        >
          {p.label}
        </button>
      ))}
    </>
  );
}
