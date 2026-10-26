import { useEffect, useState } from "react";
import {
  Mic, Lightbulb, Zap, Package, Loader2, ShoppingCart, Upload,
  CheckCircle2, ShieldCheck, Truck, FileCheck2, X, Plus, Minus, Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import {
  STUDIO_GEAR_PRODUCTS,
  STUDIO_GEAR_FULFILLMENT,
  STUDIO_SET_SAVING_CENTS,
  gearPriceCents,
  gearProofRequired,
  formatGearMoney,
  type GearProductId,
  type GearVariant,
} from "@/lib/studio-gear";

/* ─── Studio Gear — Branding Shop studio-gear department ────────────────
   Docked inside the Branding Shop (shop tab → "Studio Gear" department),
   never a standalone page. Prices + fulfillment are the owner's Oct 25
   ruling, carried in @/lib/studio-gear: made-to-order partners only, no
   inventory, partner ships direct; every creator-custom piece gets a
   design proof the creator approves BEFORE production; honest timelines
   on every card; replacement for defects/misprints and a 12-month,
   partner-backed electronics warranty on lights. TEST MODE: checkout is
   simulated — no real charge is ever taken on this rail. */

const ICONS: Record<GearProductId, LucideIcon> = {
  "mic-wrap": Mic,
  "neon-sign": Sparkles,
  "light-panel": Lightbulb,
  "light-bar": Zap,
  "studio-set": Package,
};

interface GearCartItem {
  product: GearProductId;
  variant: GearVariant;
  option: string;
  qty: number;
  customText?: string;
  specNotes?: string;
  artworkUrl?: string;
}

interface GearOrder {
  id: string;
  items: Array<GearCartItem & { unitPriceCents: number }>;
  totalCents: number;
  status: string;
  proofStatus: string;
  proofUrl: string | null;
  proofNote: string | null;
  paid: boolean;
  createdAt: string;
}

interface Selection {
  variant: GearVariant;
  option: string;
  qty: number;
  customText: string;
  specNotes: string;
  artworkUrl: string;
  artworkName: string;
}

const PROOF_LABELS: Record<string, string> = {
  not_required: "House design — no proof needed",
  pending: "Proof being prepared",
  sent: "Proof ready — your call",
  approved: "Proof approved",
  revision_requested: "Revision requested",
};

const STATUS_LABELS: Record<string, string> = {
  received: "Received",
  proof_pending: "Waiting on proof",
  proof_sent: "Proof sent",
  in_production: "In production",
  shipped: "Shipped",
  delivered: "Delivered",
  canceled: "Canceled",
};

export default function StudioGearShop() {
  const isLight = useIsLightTheme();
  const { user, getAccessToken } = useAuth();

  const [sel, setSel] = useState<Record<GearProductId, Selection>>(() =>
    Object.fromEntries(
      STUDIO_GEAR_PRODUCTS.map((p) => [
        p.id,
        {
          variant: "house" as GearVariant,
          option: p.options[0]!.key,
          qty: 1,
          customText: "",
          specNotes: "",
          artworkUrl: "",
          artworkName: "",
        },
      ]),
    ) as Record<GearProductId, Selection>,
  );
  const [cart, setCart] = useState<GearCartItem[]>([]);
  const [uploading, setUploading] = useState<GearProductId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  /* checkout form */
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state_, setState_] = useState("");
  const [zip, setZip] = useState("");
  const [placing, setPlacing] = useState(false);

  /* orders */
  const [orders, setOrders] = useState<GearOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [proofBusy, setProofBusy] = useState<string | null>(null);
  const [revisionNotes, setRevisionNotes] = useState<Record<string, string>>({});

  const cartTotal = cart.reduce(
    (n, i) => n + gearPriceCents(i.product, i.variant, i.option) * i.qty,
    0,
  );

  const cardCls = isLight
    ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]"
    : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]";
  const inputCls =
    "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";
  const goldBtn =
    "inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 px-6 py-3 text-sm font-bold text-black transition hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed";

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

  function patchSel(id: GearProductId, patch: Partial<Selection>) {
    setSel((prev) => ({ ...prev, [id]: { ...prev[id]!, ...patch } }));
  }

  async function handleArtworkUpload(id: GearProductId, file: File) {
    if (!file.type.startsWith("image/")) {
      setError("Please upload an image file (PNG, JPG) for your artwork.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("Artwork must be under 10MB.");
      return;
    }
    setUploading(id);
    setError(null);
    try {
      const token = await getAccessToken();
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/branding-shop/upload-logo", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error || "Upload failed");
      patchSel(id, { artworkUrl: data.url, artworkName: file.name });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(null);
    }
  }

  function addToCart(id: GearProductId) {
    const s = sel[id]!;
    if (
      s.variant === "custom" &&
      !s.customText.trim() &&
      !s.specNotes.trim() &&
      !s.artworkUrl
    ) {
      setError(
        "For your custom design, add your text, notes, or artwork first — your design proof is built from it.",
      );
      return;
    }
    setError(null);
    setCart((prev) => [
      ...prev,
      {
        product: id,
        variant: s.variant,
        option: s.option,
        qty: s.qty,
        ...(s.variant === "custom"
          ? {
              customText: s.customText.trim() || undefined,
              specNotes: s.specNotes.trim() || undefined,
              artworkUrl: s.artworkUrl || undefined,
            }
          : {}),
      },
    ]);
    setSuccess("Added to your gear cart.");
  }

  async function loadOrders() {
    if (!user) return;
    setOrdersLoading(true);
    try {
      const res = await authed("/api/studio-gear/orders");
      const data = (await res.json().catch(() => ({}))) as { orders?: GearOrder[] };
      setOrders(Array.isArray(data.orders) ? data.orders : []);
    } catch {
      /* orders list is best-effort */
    } finally {
      setOrdersLoading(false);
    }
  }

  useEffect(() => {
    if (user) loadOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function placeOrder() {
    if (placing || !user || cart.length === 0) return;
    if (!name.trim() || !email.trim() || !address.trim() || !city.trim() || !state_.trim() || !zip.trim()) {
      setError("Add your shipping details so the partner can ship direct to you.");
      return;
    }
    setPlacing(true);
    setError(null);
    try {
      const res = await authed("/api/studio-gear/orders", {
        method: "POST",
        body: JSON.stringify({
          items: cart,
          name: name.trim(),
          email: email.trim(),
          address: address.trim(),
          city: city.trim(),
          state: state_.trim(),
          zip: zip.trim(),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        order?: { id: string };
        error?: string;
        message?: string;
      };
      if (!res.ok || !data.order?.id) throw new Error(data.message || data.error || "Order failed.");
      const coRes = await authed("/api/studio-gear/checkout", {
        method: "POST",
        body: JSON.stringify({ orderId: data.order.id }),
      });
      const coData = (await coRes.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
      };
      if (!coRes.ok) throw new Error(coData.error || "Test checkout failed — your order is saved.");
      setSuccess(coData.message || "Order placed (test mode — no real charge).");
      setCart([]);
      await loadOrders();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Order failed.");
    } finally {
      setPlacing(false);
    }
  }

  async function proofAction(orderId: string, action: "approve" | "request-revision") {
    if (proofBusy) return;
    if (action === "request-revision" && !revisionNotes[orderId]?.trim()) {
      setError("Tell us what to change on the proof first.");
      return;
    }
    setProofBusy(orderId);
    setError(null);
    try {
      const res = await authed(`/api/studio-gear/orders/${orderId}/proof/${action}`, {
        method: "POST",
        body: JSON.stringify(
          action === "request-revision" ? { note: revisionNotes[orderId]!.trim() } : {},
        ),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!res.ok) throw new Error(data.error || "Proof update failed.");
      setSuccess(data.message || "Proof updated.");
      await loadOrders();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Proof update failed.");
    } finally {
      setProofBusy(null);
    }
  }

  return (
    <div>
      {/* Fulfillment model — stated up front on the gear department. */}
      <div className={`mb-6 rounded-2xl border p-5 ${cardCls}`}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            <Truck className="h-3.5 w-3.5" /> Studio Gear
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs font-semibold text-amber-300">
            Test mode — no real charges
          </span>
        </div>
        <p className="mt-3 text-sm text-white/60">{STUDIO_GEAR_FULFILLMENT.model}</p>
        <p className="mt-1.5 flex items-start gap-2 text-sm text-white/60">
          <FileCheck2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          {STUDIO_GEAR_FULFILLMENT.proofRule}
        </p>
        <p className="mt-1.5 flex items-start gap-2 text-sm text-white/60">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          {STUDIO_GEAR_FULFILLMENT.returnsRule}
        </p>
      </div>

      {error && (
        <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
          <p className="flex-1 text-sm text-emerald-200">{success}</p>
          <button onClick={() => setSuccess(null)} className="p-0.5 text-white/40 hover:text-white" aria-label="Dismiss">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Listings */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {STUDIO_GEAR_PRODUCTS.map((p) => {
          const Icon = ICONS[p.id];
          const s = sel[p.id]!;
          const price = gearPriceCents(p.id, s.variant, s.option);
          return (
            <div key={p.id} className={`overflow-hidden rounded-2xl border transition hover:border-primary/30 ${cardCls}`}>
              <div className={`flex h-36 items-center justify-center ${isLight ? "bg-gradient-to-br from-[#F1E5C8] via-[#E9DCBC] to-[#DFCFA3]" : "bg-gradient-to-br from-neutral-900 via-black to-neutral-900"}`}>
                <div className="flex h-20 w-20 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10">
                  <Icon className="h-9 w-9 text-primary" />
                </div>
              </div>
              <div className="p-5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-bold">{p.label}</h3>
                    <p className="mt-0.5 text-xs text-white/45">{p.blurb}</p>
                  </div>
                  <span className="text-lg font-black text-primary">{formatGearMoney(price)}</span>
                </div>
                {p.id === "studio-set" && (
                  <p className="mt-2 text-xs font-semibold text-emerald-300">
                    Bundle saves {formatGearMoney(STUDIO_SET_SAVING_CENTS)} vs buying the pieces separately.
                  </p>
                )}
                {p.includes && (
                  <ul className="mt-2 space-y-0.5 text-xs text-white/50">
                    {p.includes.map((inc) => (
                      <li key={inc}>• {inc}</li>
                    ))}
                  </ul>
                )}
                <p className="mt-3 flex items-center gap-1.5 text-xs text-white/45">
                  <Truck className="h-3.5 w-3.5" /> {p.timelineLabel}
                </p>
                {p.electronicsWarranty && (
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-white/45">
                    <ShieldCheck className="h-3.5 w-3.5" /> 12-month electronics warranty, partner-backed
                  </p>
                )}

                {/* Variant: house vs creator-custom */}
                <div className="mt-4 grid grid-cols-2 gap-2">
                  {(
                    [
                      { key: "house", label: "Bow Down house" },
                      { key: "custom", label: "My design" },
                    ] as Array<{ key: GearVariant; label: string }>
                  ).map((v) => (
                    <button
                      key={v.key}
                      onClick={() => patchSel(p.id, { variant: v.key })}
                      className={`rounded-xl border px-3 py-2 text-xs font-bold transition ${
                        s.variant === v.key
                          ? isLight
                            ? "border-[#C9A84C] bg-[#F7ECD2] text-[#7A5A12] shadow-[0_0_0_1px_#C9A84C]"
                            : "border-primary bg-primary/20 text-primary shadow-[0_0_0_1px_rgba(212,175,55,0.5)]"
                          : "border-white/10 text-white/50 hover:border-white/25"
                      }`}
                    >
                      {v.label}
                      <span className="block text-[11px] font-semibold opacity-70">
                        {formatGearMoney(gearPriceCents(p.id, v.key, s.option))}
                      </span>
                    </button>
                  ))}
                </div>
                {gearProofRequired(s.variant) && (
                  <p className="mt-2 text-[11px] text-white/40">
                    Custom pieces get a design proof — you approve it before production starts.
                  </p>
                )}

                {/* Options */}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {p.options.map((o) => (
                    <button
                      key={o.key}
                      onClick={() => patchSel(p.id, { option: o.key })}
                      className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${
                        s.option === o.key
                          ? isLight
                            ? "border-[#C9A84C] bg-[#F7ECD2] text-[#7A5A12] shadow-[0_0_0_1px_#C9A84C]"
                            : "border-primary bg-primary/20 text-primary shadow-[0_0_0_1px_rgba(212,175,55,0.5)]"
                          : "border-white/10 text-white/50 hover:border-white/25"
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>

                {/* Custom spec fields */}
                {s.variant === "custom" && (
                  <div className="mt-4 space-y-2">
                    <input
                      value={s.customText}
                      onChange={(e) => patchSel(p.id, { customText: e.target.value })}
                      placeholder="Text for your design (name, channel, slogan…)"
                      maxLength={200}
                      className={inputCls}
                    />
                    <textarea
                      value={s.specNotes}
                      onChange={(e) => patchSel(p.id, { specNotes: e.target.value })}
                      placeholder="Design notes — colors, placement, anything the proof should show"
                      maxLength={1000}
                      rows={2}
                      className={inputCls}
                    />
                    {s.artworkUrl ? (
                      <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
                        <img src={s.artworkUrl} alt="Your artwork" className="h-10 w-10 rounded object-contain bg-white/10" />
                        <p className="min-w-0 flex-1 truncate text-xs font-bold text-primary">{s.artworkName}</p>
                        <button
                          onClick={() => patchSel(p.id, { artworkUrl: "", artworkName: "" })}
                          className="text-xs text-white/40 hover:text-white"
                        >
                          Change
                        </button>
                      </div>
                    ) : (
                      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-primary/30 bg-primary/5 px-4 py-2.5 text-xs font-bold text-primary transition hover:border-primary/60 hover:bg-primary/10">
                        <Upload className="h-4 w-4" />
                        {uploading === p.id ? "Uploading…" : "Upload your artwork"}
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          disabled={uploading === p.id}
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handleArtworkUpload(p.id, f);
                          }}
                        />
                      </label>
                    )}
                  </div>
                )}

                <div className="mt-4 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 rounded-xl border border-white/10 px-2 py-1">
                    <button
                      onClick={() => patchSel(p.id, { qty: Math.max(1, s.qty - 1) })}
                      className="p-1 text-white/60 hover:text-white"
                      aria-label="Decrease quantity"
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <span className="w-6 text-center text-sm font-bold">{s.qty}</span>
                    <button
                      onClick={() => patchSel(p.id, { qty: Math.min(99, s.qty + 1) })}
                      className="p-1 text-white/60 hover:text-white"
                      aria-label="Increase quantity"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <button onClick={() => addToCart(p.id)} className={`${goldBtn} flex-1 !px-4 !py-2.5`}>
                    <ShoppingCart className="h-4 w-4" /> Add to cart
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Gear cart + test checkout */}
      {cart.length > 0 && (
        <div className={`mt-8 rounded-2xl border p-6 ${cardCls}`}>
          <h3 className="flex items-center gap-2 font-bold">
            <ShoppingCart className="h-5 w-5 text-primary" /> Your gear cart
          </h3>
          <div className="mt-4 space-y-2">
            {cart.map((item, i) => {
              const product = STUDIO_GEAR_PRODUCTS.find((x) => x.id === item.product)!;
              const option = product.options.find((o) => o.key === item.option)!;
              return (
                <div key={i} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-white/65">
                    {item.qty}× {product.label} · {option.label} ·{" "}
                    {item.variant === "custom" ? "My design (proof first)" : "Bow Down house"}
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="font-semibold">
                      {formatGearMoney(gearPriceCents(item.product, item.variant, item.option) * item.qty)}
                    </span>
                    <button
                      onClick={() => setCart((prev) => prev.filter((_, j) => j !== i))}
                      className="text-white/35 hover:text-white"
                      aria-label="Remove item"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
          <div className="mt-4 flex justify-between border-t border-white/10 pt-3 text-sm font-bold">
            <span>Total</span>
            <span className="text-primary">{formatGearMoney(cartTotal)}</span>
          </div>
          {!user ? (
            <p className="mt-4 text-sm text-white/50">
              <a href="/login" className="text-primary underline">Sign in</a> to place your gear order.
            </p>
          ) : (
            <>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" maxLength={120} className={inputCls} />
                <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" maxLength={200} className={inputCls} />
                <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street address" maxLength={300} className={`${inputCls} sm:col-span-2`} />
                <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" maxLength={120} className={inputCls} />
                <div className="grid grid-cols-2 gap-3">
                  <input value={state_} onChange={(e) => setState_(e.target.value)} placeholder="State" maxLength={120} className={inputCls} />
                  <input value={zip} onChange={(e) => setZip(e.target.value)} placeholder="ZIP" maxLength={30} className={inputCls} />
                </div>
              </div>
              <button onClick={placeOrder} disabled={placing} className={`${goldBtn} mt-5 w-full`}>
                {placing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Placing order…
                  </>
                ) : (
                  <>Place order — test checkout ({formatGearMoney(cartTotal)})</>
                )}
              </button>
              <p className="mt-2 text-center text-xs text-white/35">
                {STUDIO_GEAR_FULFILLMENT.testModeNote} Custom pieces wait for your proof approval before production.
              </p>
            </>
          )}
        </div>
      )}

      {/* My gear orders + proof gate */}
      {user && (
        <div className="mt-10">
          <h3 className="mb-4 flex items-center gap-2 text-lg font-bold">
            <Package className="h-5 w-5 text-primary" /> My gear orders
          </h3>
          {ordersLoading ? (
            <div className="flex items-center gap-2 text-sm text-white/50">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading your gear orders…
            </div>
          ) : orders.length === 0 ? (
            <p className="text-sm text-white/40">No gear orders yet — your made-to-order pieces will show up here.</p>
          ) : (
            <div className="space-y-4">
              {orders.map((o) => (
                <div key={o.id} className={`rounded-2xl border p-5 ${cardCls}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="font-mono text-white/40">#{o.id.slice(0, 8)}</span>
                    <span className="flex items-center gap-2">
                      <span className="rounded-full border border-white/15 px-3 py-1 text-xs font-semibold text-white/70">
                        {STATUS_LABELS[o.status] ?? o.status}
                      </span>
                      <span className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                        {PROOF_LABELS[o.proofStatus] ?? o.proofStatus}
                      </span>
                      {o.paid && (
                        <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-300">
                          Paid (test)
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="mt-3 space-y-1.5">
                    {o.items.map((it, i) => {
                      const product = STUDIO_GEAR_PRODUCTS.find((x) => x.id === it.product);
                      const option = product?.options.find((x) => x.key === it.option);
                      return (
                        <div key={i} className="flex justify-between text-sm">
                          <span className="text-white/60">
                            {it.qty}× {product?.label ?? it.product} · {option?.label ?? it.option} ·{" "}
                            {it.variant === "custom" ? "My design" : "Bow Down house"}
                          </span>
                          <span className="font-semibold">{formatGearMoney(it.unitPriceCents * it.qty)}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-3 flex justify-between border-t border-white/10 pt-3 text-sm font-bold">
                    <span>Total</span>
                    <span className="text-primary">{formatGearMoney(o.totalCents)}</span>
                  </div>

                  {/* Proof review — the gate: approve or send it back. */}
                  {o.proofStatus === "sent" && (
                    <div className="mt-4 rounded-xl border border-primary/25 bg-primary/[0.06] p-4">
                      <p className="text-sm font-bold">Your design proof is ready</p>
                      <p className="mt-1 text-xs text-white/50">
                        Production starts only when you approve it — take your time.
                      </p>
                      {o.proofUrl && (
                        <img src={o.proofUrl} alt="Design proof" className="mt-3 max-h-64 w-full rounded-xl border border-white/10 object-contain" />
                      )}
                      {o.proofNote && <p className="mt-2 text-xs text-white/50">{o.proofNote}</p>}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          onClick={() => proofAction(o.id, "approve")}
                          disabled={proofBusy === o.id}
                          className={`${goldBtn} !px-4 !py-2.5`}
                        >
                          {proofBusy === o.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                          Approve proof — start production
                        </button>
                      </div>
                      <div className="mt-3 flex gap-2">
                        <input
                          value={revisionNotes[o.id] ?? ""}
                          onChange={(e) => setRevisionNotes((prev) => ({ ...prev, [o.id]: e.target.value }))}
                          placeholder="What should change on the proof?"
                          maxLength={1000}
                          className={inputCls}
                        />
                        <button
                          onClick={() => proofAction(o.id, "request-revision")}
                          disabled={proofBusy === o.id}
                          className="shrink-0 rounded-xl border border-white/15 px-4 py-2.5 text-sm font-semibold text-white/70 transition hover:border-primary/40 hover:text-white disabled:opacity-50"
                        >
                          Request changes
                        </button>
                      </div>
                    </div>
                  )}
                  {o.proofStatus === "pending" && (
                    <p className="mt-3 text-xs text-white/45">
                      Your proof is being prepared from your artwork and notes — production has not started.
                    </p>
                  )}
                  {o.proofStatus === "revision_requested" && (
                    <p className="mt-3 text-xs text-white/45">
                      Revision requested — a new proof will follow. Production has not started.
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
