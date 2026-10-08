import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearch } from "wouter";
import {
  Loader2, Wallet, TrendingUp, BadgeDollarSign, PiggyBank, Copy, Check,
  Plus, Minus, Tag, ShoppingBag, CalendarClock, ExternalLink, AlertCircle,
  CheckCircle2, Sparkles, ArrowRight, CircleDollarSign,
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
            </div>
          )}
          {tab === "products" && <ProductsTab slug={slug} onChanged={load} />}
          {tab === "orders" && <OrdersTab />}
          {tab === "discounts" && <DiscountsTab />}
        </>
      )}
    </div>
  );
}
