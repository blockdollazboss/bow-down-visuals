import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import {
  Loader2, TrendingUp, Wallet, BadgeDollarSign, PiggyBank,
  CheckCircle2, PlusCircle, AlertTriangle, Sparkles, ExternalLink,
  ListChecks, CircleDashed, Wand2, Tag,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useUserMode } from "@/contexts/UserModeContext";
import { KIND_LABELS } from "./store-buy";

/* ─── /music-sales — creator sales dashboard ──────────────────────────────
   "You just got paid" energy: every sale, your cut, per-drop breakdown, and
   one-tap logging into the Money Tracker. Copy stays vertical-neutral —
   tracks, courses, series passes, packs, presets: it's all YOUR content.

   GUIDE THEM TO THE MONEY: the dashboard LEADS with the Get Paid checklist
   (list → price → share → first sale → log). Empty states show what creators
   in your vertical charge.

   Difficulty ladder (Creator Level stars — checkout & payout NEVER gated):
     1★ "Smart price it for me" · 2-3★ guided presets · 4-6★ full control.

   Pending payouts are tracked in real dollars. Real payouts need Stripe
   Connect — that build comes before anyone gets paid out. */

interface Sale {
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

interface SalesData {
  totals: { sales: number; gross: string; platformFee: string; pendingPayout: string; pendingPayoutCents: number };
  byKind: { kind: string; sales: number; gross: string; creatorAmount: string }[];
  sales: Sale[];
  platformFeePct: number;
  payoutNote: string;
  profileUrl: string;
}

interface ChecklistStep {
  id: string;
  label: string;
  detail: string;
  done: boolean;
  cta: { label: string; href: string };
}

interface Product {
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

interface ProductsData {
  vertical: string;
  verticalLabel: string;
  profileUrl: string;
  products: Product[];
}

async function authed(path: string, token: string | null, init?: RequestInit) {
  return fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

export default function MusicSales() {
  const { getAccessToken } = useAuth();
  const { stars } = useUserMode();
  const [data, setData] = useState<SalesData | null>(null);
  const [checklist, setChecklist] = useState<ChecklistStep[] | null>(null);
  const [checklistComplete, setChecklistComplete] = useState(false);
  const [products, setProducts] = useState<ProductsData | null>(null);
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
        authed("/api/store/sales", token),
        authed("/api/store/checklist", token),
        authed("/api/store/products", token),
      ]);
      const salesBody = (await salesRes.json().catch(() => ({}))) as SalesData & { error?: string; message?: string };
      if (!salesRes.ok) throw new Error(salesBody.message || salesBody.error || "Couldn't load your sales.");
      setData(salesBody);
      if (checkRes.ok) {
        const c = (await checkRes.json().catch(() => ({}))) as { steps?: ChecklistStep[]; complete?: boolean };
        setChecklist(c.steps ?? []);
        setChecklistComplete(!!c.complete);
      }
      if (prodRes.ok) {
        const p = (await prodRes.json().catch(() => ({}))) as ProductsData;
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
      const res = await authed("/api/store/price", token, {
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

  async function smartPrice(p: Product) {
    const key = `${p.kind}:${p.id}`;
    setPricing(key);
    setNotice(null);
    try {
      const token = await getAccessToken();
      const res = await authed("/api/store/suggest-price", token, {
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
      const res = await authed("/api/store/log-to-tracker", token, {
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
    <div className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-4xl px-4 py-10">
        <div className="flex items-center gap-3">
          <TrendingUp className="h-8 w-8 text-amber-300" />
          <div>
            <h1 className="text-3xl font-bold text-amber-200">Sales Dashboard</h1>
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
                              {KIND_LABELS[p.kind] ?? p.kind}
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
                            <PresetButtons
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
                            {KIND_LABELS[k.kind] ?? k.kind}
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
                              {KIND_LABELS[s.itemKind] ?? s.itemKind}
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
    </div>
  );
}

/* Guided presets (2-3★): fetched per kind from the price guide. */
function PresetButtons({ kind, busy, onPick }: { kind: string; busy: boolean; onPick: (cents: number) => void }) {
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
