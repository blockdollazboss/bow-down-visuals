import { apiErrorMessage, plainErrorText } from "../../lib/api-error";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { Mic2, Loader2, PenLine, ShieldCheck, PackageCheck, AlertTriangle, RotateCcw, BadgeDollarSign } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import {
  FEATURE_VERSE_LISTINGS_PATH,
  FEATURE_VERSE_MY_LISTING_PATH,
  FEATURE_VERSE_NOTICE,
  FEATURE_VERSE_ORDERS_PATH,
  featureSplitValidationError,
  featureVerseActionPath,
  featureVerseStatusLabel,
  featureVerseViewerActions,
  newFeatureOrderKey,
  type FeatureVerseAction,
  type FeatureVerseListing,
  type FeatureVerseOrder,
  type FeatureVerseSplitRow,
} from "@/lib/feature-verse";

/* ─── Feature Verse Market panel (Stack-200 N7) ──────────────────────────
   DOCKED, never a standalone page: this panel lives as a tab on the
   Collabs surface (the creator/collab home — market + my listing +
   orders) and, in its "orders" variant, as a tab in Thy Library (the
   buyer's orders surface). Artist profiles link here to buy.

   Honesty rules: prices are creator-entered only (the form has no
   default — an empty price cannot save); a creator with no listing
   does not appear in the market at all; empty states say so plainly. */

type Authed = (path: string, opts?: { method?: string; body?: unknown }) => Promise<{ res: Response; data: Record<string, unknown> }>;

const ACTION_LABELS: Record<FeatureVerseAction, string> = {
  sign: "Sign the written terms",
  decline: "Decline",
  fund: "Fund escrow (hold my fee)",
  deliver: "Deliver the feature",
  confirm: "Confirm delivery — release escrow",
  dispute: "Dispute delivery",
  refund: "Refund the held fee in full",
};

export function FeatureVersePanel({
  authed: authedProp,
  variant = "full",
  onOrdersLoaded,
}: {
  authed?: Authed;
  variant?: "full" | "orders";
  onOrdersLoaded?: (count: number) => void;
}) {
  const isLight = useIsLightTheme();
  const { user, getAccessToken } = useAuth();
  const [fallbackAuthed] = useState<Authed>(() => async (path: string, opts: { method?: string; body?: unknown } = {}) => {
    const token = await getAccessToken();
    const res = await fetch(path, {
      method: opts.method ?? "GET",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { res, data };
  });
  /* The Collabs page rebuilds its authed helper on every render —
     hold the latest in a ref so load() stays stable and never loops. */
  const authedRef = useRef<Authed>(authedProp ?? fallbackAuthed);
  authedRef.current = authedProp ?? fallbackAuthed;
  const authed = useCallback<Authed>((path, opts) => authedRef.current(path, opts), []);

  const [listings, setListings] = useState<FeatureVerseListing[]>([]);
  const [myListing, setMyListing] = useState<FeatureVerseListing | null>(null);
  const [orders, setOrders] = useState<FeatureVerseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  /* my-listing form — price starts EMPTY: creator-entered only */
  const [price, setPrice] = useState("");
  const [title, setTitle] = useState("Feature verse");
  const [description, setDescription] = useState("");
  const [turnaround, setTurnaround] = useState("");
  const [active, setActive] = useState(true);

  /* order form */
  const [selected, setSelected] = useState<FeatureVerseListing | null>(null);
  const [trackContext, setTrackContext] = useState("");
  const [usageTerms, setUsageTerms] = useState("");
  const [deadlineAsk, setDeadlineAsk] = useState("");
  const [splits, setSplits] = useState<FeatureVerseSplitRow[]>([
    { name: "", sharePct: 50 },
    { name: "", sharePct: 50 },
  ]);
  const [orderKey, setOrderKey] = useState<string>(() => newFeatureOrderKey());
  const [deliveryNote, setDeliveryNote] = useState<Record<string, string>>({});
  const [disputeReason, setDisputeReason] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [l, m, o] = await Promise.all([
        authed(FEATURE_VERSE_LISTINGS_PATH),
        authed(FEATURE_VERSE_MY_LISTING_PATH),
        authed(FEATURE_VERSE_ORDERS_PATH),
      ]);
      if (!l.res.ok || !o.res.ok) throw new Error("load failed");
      setListings((l.data.listings as FeatureVerseListing[]) ?? []);
      const mine = (m.data.listing as FeatureVerseListing | null) ?? null;
      setMyListing(mine);
      if (mine) {
        setPrice(String(mine.priceVb));
        setTitle(mine.title);
        setDescription(mine.description);
        setTurnaround(mine.turnaroundDays ? String(mine.turnaroundDays) : "");
        setActive(mine.active);
      }
      const mine2 = (o.data.orders as FeatureVerseOrder[]) ?? [];
      setOrders(mine2);
      onOrdersLoaded?.(mine2.length);
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [authed, onOrdersLoaded]);

  useEffect(() => { void load(); }, [load]);

  const card = isLight
    ? "rounded-2xl border border-[#7A5A12]/30 bg-[#FCF7EA] p-5 text-[#2A2110]"
    : "rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-white";
  const input = isLight
    ? "w-full rounded-xl border border-[#7A5A12]/30 bg-white px-3 py-2.5 text-sm text-[#2A2110] placeholder:text-[#2A2110]/35 outline-none focus:border-[#C9A84C]"
    : "w-full rounded-xl border border-white/10 bg-black/60 px-3 py-2.5 text-sm text-white placeholder:text-white/25 outline-none focus:border-amber-400/60";
  const sub = isLight ? "text-[#2A2110]/60" : "text-white/50";
  const goldBtn = "inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-amber-300 to-yellow-600 px-4 py-2.5 text-sm font-extrabold text-black transition hover:brightness-110 disabled:opacity-50";
  const ghostBtn = isLight
    ? "inline-flex items-center justify-center gap-2 rounded-xl border border-[#7A5A12]/35 px-3 py-2 text-xs font-bold text-[#7A5A12] transition hover:bg-[#C9A84C]/15 disabled:opacity-50"
    : "inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs font-bold text-white/80 transition hover:border-amber-400/50 hover:text-white disabled:opacity-50";

  async function saveListing() {
    const priceVb = Number(price);
    if (!Number.isInteger(priceVb) || priceVb <= 0) {
      setMsg("Set your own feature price in Visual Bucs — a whole number above zero. There is no platform default price.");
      return;
    }
    setBusy("listing");
    try {
      const { res, data } = await authed(FEATURE_VERSE_MY_LISTING_PATH, {
        method: "PUT",
        body: {
          priceVb,
          title: title.trim() || "Feature verse",
          description: description.trim(),
          turnaroundDays: turnaround ? Number(turnaround) : null,
          active,
          creatorName: (user as { user_metadata?: { full_name?: string } } | null)?.user_metadata?.full_name,
        },
      });
      if (!res.ok) throw new Error(apiErrorMessage(data, "Could not save your listing."));
      setMsg("Your feature listing is saved at your price.");
      await load();
    } catch (e) {
      setMsg(plainErrorText(e, "Could not save your listing."));
    } finally { setBusy(null); }
  }

  const splitError = selected ? featureSplitValidationError(splits) : null;

  async function placeOrder() {
    if (!selected || splitError) return;
    setBusy("order");
    try {
      const { res, data } = await authed(FEATURE_VERSE_ORDERS_PATH, {
        method: "POST",
        body: {
          listingId: selected.id,
          trackContext: trackContext.trim(),
          usageTerms: usageTerms.trim(),
          deadlineAsk: deadlineAsk.trim() || undefined,
          splits,
          idempotencyKey: orderKey,
        },
      });
      if (!res.ok) throw new Error(apiErrorMessage(data, "Could not place that order."));
      setMsg("Terms proposed. Nothing is charged and no recording starts until BOTH of you sign — then you fund the escrow hold.");
      setSelected(null);
      setOrderKey(newFeatureOrderKey());
      await load();
    } catch (e) {
      setMsg(plainErrorText(e, "Could not place that order."));
    } finally { setBusy(null); }
  }

  async function act(order: FeatureVerseOrder, action: FeatureVerseAction) {
    setBusy(`${order.id}:${action}`);
    try {
      const body =
        action === "deliver" ? { deliveryNote: (deliveryNote[order.id] ?? "").trim() }
        : action === "dispute" ? { reason: (disputeReason[order.id] ?? "").trim() }
        : undefined;
      if (action === "deliver" && !body?.deliveryNote) { setMsg("Add a delivery note (or say where the delivered feature is) first."); return; }
      if (action === "dispute" && !body?.reason) { setMsg("Say what went wrong with the delivery first."); return; }
      const { res, data } = await authed(featureVerseActionPath(order.id, action), { method: "POST", body });
      if (!res.ok) throw new Error(apiErrorMessage(data, "That action didn't go through."));
      await load();
    } catch (e) {
      setMsg(plainErrorText(e, "That action didn't go through."));
    } finally { setBusy(null); }
  }

  if (!user) {
    return (
      <div className={card}>
        <p className={sub}>Sign in to buy a feature verse, list your own feature price, and see your feature orders.</p>
      </div>
    );
  }
  if (loading) {
    return <div className={`${card} flex items-center gap-2`}><Loader2 className="h-4 w-4 animate-spin" /> Loading the Feature Verse Market…</div>;
  }
  if (loadError) {
    return (
      <div className={card}>
        <p className="flex items-center gap-2 font-bold"><AlertTriangle className="h-4 w-4" /> The market didn't load.</p>
        <button onClick={() => void load()} className={`${ghostBtn} mt-3`}><RotateCcw className="h-3.5 w-3.5" /> Try again</button>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="feature-verse-panel">
      <div className={card}>
        <h3 className="flex items-center gap-2 text-lg font-extrabold"><ShieldCheck className="h-5 w-5 text-amber-400" /> Feature Verse Market</h3>
        <p className={`mt-2 text-sm ${sub}`}>{FEATURE_VERSE_NOTICE}</p>
        <p className={`mt-1 text-xs ${sub}`}>Prices are set by each creator in Visual Bucs. Bow Down Visuals sets no price and no fee for a feature.</p>
        {msg && <p className="mt-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm">{msg}</p>}
      </div>

      {variant === "full" && (
        <>
          {/* ── Market ── */}
          <section className={card}>
            <h4 className="mb-3 flex items-center gap-2 font-extrabold"><Mic2 className="h-4 w-4 text-amber-400" /> Creators open for features</h4>
            {listings.length === 0 ? (
              <p className={sub}>No creator has listed a feature price yet. A creator with no listing isn't buyable — when one lists their price, they show up here.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {listings.map((l) => (
                  <div key={l.id} className={`rounded-xl border p-4 ${isLight ? "border-[#7A5A12]/25" : "border-white/10"}`}>
                    <p className="font-bold">{l.creatorName}</p>
                    <p className={`text-sm ${sub}`}>{l.title}{l.description ? ` — ${l.description}` : ""}</p>
                    <p className="mt-2 text-sm font-extrabold text-amber-400">{l.priceVb.toLocaleString("en-US")} VB</p>
                    {l.turnaroundDays ? <p className={`text-xs ${sub}`}>Turnaround: {l.turnaroundDays} days (creator-stated)</p> : null}
                    {l.isMine ? (
                      <p className={`mt-2 text-xs ${sub}`}>This is your listing.</p>
                    ) : (
                      <button className={`${goldBtn} mt-3`} onClick={() => { setSelected(l); setSplits([{ name: "", sharePct: 50 }, { name: l.creatorName, sharePct: 50 }]); }}>
                        <PenLine className="h-4 w-4" /> Propose terms
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ── Order form: the WRITTEN terms ── */}
          {selected && (
            <section className={card}>
              <h4 className="font-extrabold">Propose terms — feature from {selected.creatorName} · {selected.priceVb.toLocaleString("en-US")} VB</h4>
              <p className={`mt-1 text-sm ${sub}`}>These written terms — including the track splits — are what both of you will sign. Once either of you signs, they freeze.</p>
              <div className="mt-4 space-y-3">
                <input aria-label="The track: title, where this feature goes" className={input} value={trackContext} onChange={(e) => setTrackContext(e.target.value)} placeholder="The track: title, where this feature goes" />
                <textarea aria-label="Usage terms both sides are signing (where the feature may be used, credits, limits)" className={input} value={usageTerms} onChange={(e) => setUsageTerms(e.target.value)} placeholder="Usage terms both sides are signing (where the feature may be used, credits, limits)" rows={3} />
                <input aria-label="Deadline ask (optional)" className={input} value={deadlineAsk} onChange={(e) => setDeadlineAsk(e.target.value)} placeholder="Deadline ask (optional)" />
                <div>
                  <p className={`mb-2 text-xs font-bold uppercase tracking-widest ${sub}`}>Track splits — must total 100%</p>
                  {splits.map((s, i) => (
                    <div key={i} className="mb-2 flex gap-2">
                      <input aria-label="Writer name" className={input} value={s.name} onChange={(e) => setSplits(splits.map((r, j) => j === i ? { ...r, name: e.target.value } : r))} placeholder="Writer name" />
                      <input className={`${input} max-w-[110px]`} type="number" min="0" max="100" step="0.01" value={s.sharePct} onChange={(e) => setSplits(splits.map((r, j) => j === i ? { ...r, sharePct: Number(e.target.value) } : r))} aria-label="Share percent" />
                    </div>
                  ))}
                  <button className={ghostBtn} onClick={() => setSplits([...splits, { name: "", sharePct: 0 }])}>Add a writer</button>
                  {splitError && <p className="mt-2 text-sm text-red-400">{splitError}</p>}
                </div>
                <div className="flex gap-2">
                  <button className={goldBtn} disabled={!!splitError || !trackContext.trim() || !usageTerms.trim() || busy === "order"} onClick={() => void placeOrder()}>
                    {busy === "order" ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenLine className="h-4 w-4" />} Propose these terms
                  </button>
                  <button className={ghostBtn} onClick={() => setSelected(null)}>Cancel</button>
                </div>
              </div>
            </section>
          )}

          {/* ── My listing ── */}
          <section className={card}>
            <h4 className="mb-1 flex items-center gap-2 font-extrabold"><BadgeDollarSign className="h-4 w-4 text-amber-400" /> Sell your feature</h4>
            <p className={`mb-3 text-sm ${sub}`}>{myListing ? "Your listing is live at YOUR price — edit it any time; orders already proposed keep the price they were proposed at." : "Set your own feature price to become buyable. No listing, no orders — the platform never sets a price for you."}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <input className={input} type="number" min="1" step="1" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Your price in Visual Bucs" aria-label="Your feature price in Visual Bucs" />
              <input className={input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Listing title" aria-label="Listing title" />
              <input className={input} value={turnaround} onChange={(e) => setTurnaround(e.target.value)} type="number" min="1" placeholder="Turnaround days (optional)" aria-label="Turnaround days" />
              <label className={`flex items-center gap-2 text-sm ${sub}`}>
                <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Open for features
              </label>
            </div>
            <textarea aria-label="What the buyer gets (a 16-bar verse, a hook, an appearance…)" className={`${input} mt-3`} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What the buyer gets (a 16-bar verse, a hook, an appearance…)" rows={2} />
            <button className={`${goldBtn} mt-3`} disabled={busy === "listing"} onClick={() => void saveListing()}>
              {busy === "listing" ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {myListing ? "Update my listing" : "List my feature"}
            </button>
          </section>
        </>
      )}

      {/* ── Orders (both sides) ── */}
      <section className={card}>
        <h4 className="mb-3 flex items-center gap-2 font-extrabold"><PackageCheck className="h-4 w-4 text-amber-400" /> {variant === "orders" ? "My feature orders" : "Feature orders — bought and sold"}</h4>
        {variant === "orders" && (
          <p className={`mb-3 text-sm ${sub}`}>Buying or selling a feature? The market and your listing live on the <Link href="/collabs?tab=featureverse" className="font-bold text-amber-400 underline">Collabs page</Link>.</p>
        )}
        {orders.length === 0 ? (
          <p className={sub}>No feature orders yet. When you propose terms or someone proposes them to you, the whole lifecycle shows here — signatures, escrow, delivery, release or full refund.</p>
        ) : (
          <div className="space-y-3">
            {orders.map((o) => {
              const actions = featureVerseViewerActions(o);
              return (
                <div key={o.id} className={`rounded-xl border p-4 ${isLight ? "border-[#7A5A12]/25" : "border-white/10"}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-bold">{o.isBuyer ? "You are buying" : "You are the feature"} · {o.priceVb.toLocaleString("en-US")} VB</p>
                    <span className="rounded-full bg-amber-400/15 px-2.5 py-0.5 text-[11px] font-bold text-amber-300">{featureVerseStatusLabel(o.status)}</span>
                  </div>
                  <p className={`mt-1 text-sm ${sub}`}>{o.trackContext}</p>
                  <p className={`text-sm ${sub}`}>Terms: {o.usageTerms}</p>
                  <p className={`text-sm ${sub}`}>
                    Splits: {o.splits.map((s) => `${s.name} ${s.sharePct}%`).join(" · ")} — {o.escrowLabel}.
                    Buyer signed: {o.buyerSignedAt ? "yes" : "not yet"} · Creator signed: {o.creatorSignedAt ? "yes" : "not yet"}.
                  </p>
                  {o.deliveryNote && <p className={`text-sm ${sub}`}>Delivery: {o.deliveryNote}{o.deliveryUrl ? <> · <a className="text-amber-400 underline" href={o.deliveryUrl} target="_blank" rel="noreferrer">open</a></> : null}</p>}
                  {o.disputeReason && <p className="text-sm text-red-400">Dispute: {o.disputeReason}</p>}
                  {actions.includes("deliver") && (
                    <input aria-label="Delivery note — where the finished feature is" className={`${input} mt-3`} value={deliveryNote[o.id] ?? ""} onChange={(e) => setDeliveryNote({ ...deliveryNote, [o.id]: e.target.value })} placeholder="Delivery note — where the finished feature is" />
                  )}
                  {actions.includes("dispute") && (
                    <input aria-label="If disputing: what went wrong" className={`${input} mt-3`} value={disputeReason[o.id] ?? ""} onChange={(e) => setDisputeReason({ ...disputeReason, [o.id]: e.target.value })} placeholder="If disputing: what went wrong" />
                  )}
                  {actions.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {actions.map((a) => (
                        <button key={a} className={a === "sign" || a === "fund" || a === "confirm" ? goldBtn : ghostBtn} disabled={busy === `${o.id}:${a}`} onClick={() => void act(o, a)}>
                          {busy === `${o.id}:${a}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} {ACTION_LABELS[a]}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

export default FeatureVersePanel;
