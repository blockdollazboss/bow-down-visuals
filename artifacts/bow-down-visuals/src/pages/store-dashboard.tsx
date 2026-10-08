import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearch } from "wouter";
import {
  Loader2, Wallet, TrendingUp, BadgeDollarSign, PiggyBank, Copy, Check,
  Plus, Minus, Tag, ShoppingBag, CalendarClock, ExternalLink, AlertCircle,
  CheckCircle2, Sparkles, ArrowRight, CircleDollarSign,
  PlusCircle, ListChecks, CircleDashed, Wand2, Music2, AlertTriangle,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useUserMode } from "@/contexts/UserModeContext";
import { usePageTitle } from "@/hooks/use-page-title";
import { levelInfo } from "@/lib/creator-level";
import {
  listProducts, moneyChecklist, mySales, createProduct, updateProduct, deactivateProduct,
  listDiscounts, createDiscount, updateDiscount, deleteDiscount,
  logSaleToTracker, confirmServiceBooking,
  KIND_LABELS, KIND_EMOJI, dollarsToCents, usd,
  type StoreProductDTO, type StoreOrderDTO, type DiscountCodeDTO,
  type MoneyChecklist, type CreateProductInput, type StoreProductKind,
} from "@/lib/storefront-api";
import PromoteButton from "@/components/storefront/PromoteButton";

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

const KIND_STARTING_PRICE: Record<StoreProductKind, number> = {
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

  const openManage = async () => {
    setErr(""); setBusy("manage");
    try {
      const token = await getToken();
      const res = await fetch("/api/connect/login-link", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string; message?: string };
      if (!res.ok || !data.url) throw new Error(data.message || data.error || "Couldn't open Stripe.");
      window.open(data.url, "_blank", "noopener");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't open Stripe.");
    } finally {
      setBusy(null);
    }
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
              disabled={busy === "manage"}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-white/55 hover:text-white"
            >
              {busy === "manage" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}
              Manage in Stripe
            </button>
          </div>
        </>
      )}

      {err && (
        <p className="mt-3 flex items-start gap-2 text-xs font-bold text-red-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {err}
        </p>
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
  const getToken = useToken();
  const { stars } = useUserMode();
  const [products, setProducts] = useState<StoreProductDTO[] | null>(null);
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
    try {
      const r = await listProducts(slug);
      setProducts(r.products);
    } catch {
      setProducts([]);
    }
  }, [slug]);

  useEffect(() => { load(); }, [load]);

  const aiStartingPrice = () => {
    setForm((f) => ({ ...f, priceDollars: (KIND_STARTING_PRICE[f.kind] / 100).toFixed(2) }));
  };

  const submit = async () => {
    setErr("");
    if (!form.title.trim()) { setErr("Give it a title."); return; }
    const cents = dollarsToCents(form.priceDollars);
    if (!Number.isFinite(cents) || cents <= 0) { setErr("Set a real price (more than $0)."); return; }
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

          {/* 2-3★: guided */}
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2" data-min-stars="2">
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as StoreProductKind })} className={inputCls}>
              {(Object.keys(KIND_LABELS) as StoreProductKind[]).map((k) => (
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
          <p className="mt-2 text-[10px] text-white/30">Real-money listing via Stripe · {usd(0).slice(0, 1)}10% platform fee comes out of your cut · never Visual Bucs.</p>
        </div>
      )}

      {!products ? (
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
                  <td className="px-4 py-3 font-bold text-primary">{p.price}</td>
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
  const getToken = useToken();
  const [orders, setOrders] = useState<StoreOrderDTO[] | null>(null);
  const [totals, setTotals] = useState<{ gross: string; fee: string; net: string; platformFeePct: number } | null>(null);
  const [logged, setLogged] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const token = await getToken();
    const r = await mySales(token);
    setOrders(r.orders);
    setTotals(r.totals);
  }, [getToken]);

  useEffect(() => { load().catch(() => setOrders([])); }, [load]);

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
        Honest math on every row: what the buyer paid, what the platform kept ({totals?.platformFeePct ?? 10}%), what's yours. Real dollars via Stripe — never Visual Bucs.
      </p>
    </div>
  );
}

/* ── Discounts tab ───────────────────────────────────────────────────── */
function DiscountsTab() {
  const getToken = useToken();
  const [codes, setCodes] = useState<DiscountCodeDTO[] | null>(null);
  const [form, setForm] = useState({ code: "", percentOff: "15", maxUses: "-1", expiresAt: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    const token = await getToken();
    const r = await listDiscounts(token);
    setCodes(r.codes);
  }, [getToken]);

  useEffect(() => { load().catch(() => setCodes([])); }, [load]);

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

      {!codes ? (
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
  const getToken = useToken();
  const { stars } = useUserMode();
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
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      const c = await moneyChecklist(token);
      setChecklist(c);
      const storeUrl: string = c.links.storeUrl ?? "";
      setSlug(storeUrl.split("/artist/")[1] ?? "");
    } catch {
      setFailed(true);
    }
  }, [getToken]);

  useEffect(() => { load(); }, [load]);
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

      {failed ? (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/[0.06] p-8 text-center">
          <p className="text-sm font-bold text-white">Couldn't load your dashboard.</p>
          <p className="mt-1 text-xs text-white/50">You need a creator profile first — then this page becomes your money command center.</p>
          <Link href="/choose-artist">
            <span className="mt-4 inline-block cursor-pointer rounded-full bg-gradient-to-b from-[#e8c547] to-[#b8860b] px-5 py-2 text-sm font-black text-black">
              Set up your creator profile →
            </span>
          </Link>
        </div>
      ) : !checklist ? (
        <div className="flex justify-center py-20 text-white/40"><Loader2 className="h-8 w-8 animate-spin" /></div>
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
          <EarningsHero data={checklist} />

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

          {tab === "overview" && (
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

function DigitalSalesTab() {
  const { getAccessToken } = useAuth();
  const { stars } = useUserMode();
  const [data, setData] = useState<DigitalSalesData | null>(null);
  const [checklist, setChecklist] = useState<DigitalChecklistStep[] | null>(null);
  const [checklistComplete, setChecklistComplete] = useState(false);
  const [products, setProducts] = useState<DigitalProductsData | null>(null);
  const [guide, setGuide] = useState<{ smart: string; low: string; high: string; blurb: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [logging, setLogging] = useState<string | null>(null);
  const [pricing, setPricing] = useState<string | null>(null);
  const [customPrices, setCustomPrices] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const [salesRes, checkRes, prodRes] = await Promise.all([
        digitalAuthed("/api/store/sales", token),
        digitalAuthed("/api/store/checklist", token),
        digitalAuthed("/api/store/products", token),
      ]);
      const salesBody = (await salesRes.json().catch(() => ({}))) as DigitalSalesData & { error?: string; message?: string };
      if (!salesRes.ok) throw new Error(salesBody.message || salesBody.error || "Couldn't load your sales.");
      setData(salesBody);
      if (checkRes.ok) {
        const c = (await checkRes.json().catch(() => ({}))) as { steps?: DigitalChecklistStep[]; complete?: boolean };
        setChecklist(c.steps ?? []);
        setChecklistComplete(!!c.complete);
      }
      if (prodRes.ok) {
        const p = (await prodRes.json().catch(() => ({}))) as DigitalProductsData;
        setProducts(p);
        /* Empty-state guide: what creators in YOUR vertical charge. */
        if (p.products.length === 0) {
          const g = await fetch(`/api/store/price-guide?vertical=${encodeURIComponent(p.vertical)}&kind=track`);
          const gb = (await g.json().catch(() => ({}))) as {
            guide?: { track?: { smart: string; low: string; high: string; blurb: string } };
          };
          if (gb.guide?.track) setGuide(gb.guide.track);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load your sales.");
    } finally {
      setLoading(false);
    }
  }, [getAccessToken]);

  useEffect(() => {
    load();
  }, [load]);

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
      await load();
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
      await load();
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

      {loading ? (
        <div className="mt-16 flex justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-amber-400" />
        </div>
      ) : error ? (
        <div className="mt-8 rounded-2xl border border-amber-500/30 bg-gradient-to-b from-[#171204] to-black p-10 text-center">
          <div className="text-4xl">🎤</div>
          <h2 className="mt-4 text-xl font-bold text-amber-200">No creator profile yet</h2>
          <p className="mt-2 text-amber-100/60">
            Set up your creator profile first — then every drop you sell shows up here.
          </p>
        </div>
      ) : (
        <>
          {/* ── GET PAID CHECKLIST — the finale, leading the dashboard ── */}
          {checklist && (
            <div className="mt-6 rounded-2xl border border-amber-400/40 bg-gradient-to-b from-[#1d1606] to-black p-6 shadow-[0_0_30px_rgba(201,162,39,0.15)]">
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
                      s.done ? "border-green-500/30 bg-green-950/20" : "border-amber-500/15 bg-black/40"
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
          <div id="pricing" className="mt-6 scroll-mt-6 rounded-2xl border border-amber-500/20 bg-gradient-to-b from-[#141004] to-black p-6">
            <h2 className="flex items-center gap-2 text-lg font-bold text-amber-200">
              <Tag className="h-5 w-5" /> Price your content
            </h2>
            <p className="mt-1 text-sm text-amber-100/60">
              {stars === 1
                ? "One tap and it's priced — the smart default does the thinking."
                : stars <= 3
                  ? "Pick a proven price point, or let the smart default decide."
                  : "Full control: any price you want, with the fee math live."}{" "}
              You always keep 90%.
            </p>

            {products && products.products.length === 0 ? (
              <div className="mt-4 rounded-xl border border-amber-500/20 bg-black/40 p-6 text-center">
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
                    <div key={key} className="rounded-xl border border-amber-500/10 bg-black/40 p-4">
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

          {/* ── Totals (never gated) ── */}
          {data && (
            <>
              <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
                <div className="rounded-2xl border border-amber-500/20 bg-gradient-to-b from-[#141004] to-black p-5">
                  <div className="text-xs uppercase tracking-widest text-amber-400/70">Sales</div>
                  <div className="mt-1 text-2xl font-bold text-amber-200">{data.totals.sales}</div>
                </div>
                <div className="rounded-2xl border border-amber-500/20 bg-gradient-to-b from-[#141004] to-black p-5">
                  <div className="text-xs uppercase tracking-widest text-amber-400/70">Gross</div>
                  <div className="mt-1 text-2xl font-bold text-amber-200">{data.totals.gross}</div>
                </div>
                <div className="rounded-2xl border border-amber-500/20 bg-gradient-to-b from-[#141004] to-black p-5">
                  <div className="text-xs uppercase tracking-widest text-amber-400/70">
                    Platform fee ({data.platformFeePct}%)
                  </div>
                  <div className="mt-1 text-2xl font-bold text-amber-100/70">{data.totals.platformFee}</div>
                </div>
                <div className="rounded-2xl border border-amber-400/40 bg-gradient-to-b from-[#1d1606] to-black p-5 shadow-[0_0_30px_rgba(201,162,39,0.15)]">
                  <div className="flex items-center gap-1.5 text-xs uppercase tracking-widest text-amber-300">
                    <PiggyBank className="h-4 w-4" /> Your cut · pending payout
                  </div>
                  <div className="mt-1 text-2xl font-bold text-amber-300">{data.totals.pendingPayout}</div>
                </div>
              </div>

              <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-500/20 bg-black/40 p-4 text-xs text-amber-100/60">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                <span>
                  {data.payoutNote} Real money, real dollars — completely separate from Visual Bucs (AI credits).
                </span>
              </div>

              {data.byKind.length > 0 && (
                <div className="mt-6 rounded-2xl border border-amber-500/20 bg-gradient-to-b from-[#141004] to-black p-6">
                  <h2 className="flex items-center gap-2 text-lg font-bold text-amber-200">
                    <Sparkles className="h-5 w-5" /> What's selling
                  </h2>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                    {data.byKind.map((k) => (
                      <div key={k.kind} className="rounded-xl border border-amber-500/10 bg-black/40 p-4">
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

              <div className="mt-6 rounded-2xl border border-amber-500/20 bg-gradient-to-b from-[#141004] to-black p-6">
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
                      <div key={s.id} className="flex items-center gap-4 rounded-xl border border-amber-500/10 bg-black/40 p-4">
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
