import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  Shirt, Loader2, Download, AlertTriangle, CheckCircle2,
  ArrowLeft, Sparkles, RefreshCw, Store, Pencil, Trash2,
  Tag, Info, ShoppingBag, Plus,
} from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";

/* ─── Merch Designer ──────────────────────────────────────────────────────
   AI-designed merch for creators (dropship model): describe a design or
   pick a style → 3-credit batch generates 2 real product mockups →
   save to store, set your price, see your profit margin. Checkout is
   honestly "coming soon" — manufacturers ship directly when it goes live. */

type ProductKey = "t-shirt" | "hoodie" | "cap" | "poster";
type StyleKey = "streetwear" | "minimal" | "vintage" | "luxury-gold";

const PRODUCTS: Array<{ key: ProductKey; label: string; blurb: string; baseCost: string; swatch: string }> = [
  { key: "t-shirt", label: "T-Shirt", blurb: "Classic crew tee", baseCost: "$12.00 base", swatch: "linear-gradient(135deg,#1a1a1a 40%,#3b82f6 100%)" },
  { key: "hoodie", label: "Hoodie", blurb: "Heavyweight pullover", baseCost: "$28.00 base", swatch: "linear-gradient(135deg,#1a1a1a 40%,#8b5cf6 100%)" },
  { key: "cap", label: "Cap", blurb: "Snapback / dad hat", baseCost: "$15.00 base", swatch: "linear-gradient(135deg,#1a1a1a 40%,#f97316 100%)" },
  { key: "poster", label: "Poster", blurb: '18"×24" matte print', baseCost: "$8.00 base", swatch: "linear-gradient(135deg,#1a1a1a 40%,#10b981 100%)" },
];

const STYLES: Array<{ key: StyleKey; label: string; blurb: string; swatch: string }> = [
  { key: "streetwear", label: "Streetwear", blurb: "Bold graphics, urban energy", swatch: "linear-gradient(135deg,#0a0a0a 40%,#ef4444 100%)" },
  { key: "minimal", label: "Minimal", blurb: "Clean, subtle, timeless", swatch: "linear-gradient(135deg,#111 40%,#e5e5e5 100%)" },
  { key: "vintage", label: "Vintage", blurb: "Retro, worn-in, classic", swatch: "linear-gradient(135deg,#0a0a0a 40%,#d97706 100%)" },
  { key: "luxury-gold", label: "Luxury Gold", blurb: "Black & gold, premium", swatch: "linear-gradient(135deg,#0a0a0a 40%,#d4af37 100%)" },
];

interface Mockup {
  url: string;
  path: string;
}

interface DesignResponse {
  status?: string;
  mockups?: Mockup[];
  product?: string;
  style?: string;
  title?: string;
  baseCostCents?: number;
  suggestedPriceCents?: number;
  commissionPct?: number;
  error?: string;
  message?: string;
  creditsRemaining?: number;
}

interface StoreDesign {
  id: string;
  title: string;
  product: string;
  style: string;
  prompt: string | null;
  image_url: string;
  price_cents: number | null;
  base_cost_cents: number;
  status: string;
  margin: { profitCents: number; marginPct: number; commissionCents: number } | null;
  created_at: string;
}

function fmt(cents: number | null | undefined): string {
  if (cents == null) return "—";
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

export default function Merch() {
  const { user } = useAuth();
  const [tab, setTab] = useState<"design" | "store">("design");

  /* ── Design studio state ── */
  const [product, setProduct] = useState<ProductKey>("t-shirt");
  const [style, setStyle] = useState<StyleKey>("luxury-gold");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [mockups, setMockups] = useState<Mockup[]>([]);
  const [batchMeta, setBatchMeta] = useState<{ baseCostCents: number; suggestedPriceCents: number; title: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [creditsRemaining, setCreditsRemaining] = useState<number | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

  /* ── Store state ── */
  const [designs, setDesigns] = useState<StoreDesign[]>([]);
  const [storeLoading, setStoreLoading] = useState(false);
  const [priceEdits, setPriceEdits] = useState<Record<string, string>>({});
  const [orderMsg, setOrderMsg] = useState<string | null>(null);

  async function loadStore() {
    setStoreLoading(true);
    try {
      const res = await fetch("/api/merch/designs");
      if (res.ok) {
        const data = await res.json();
        setDesigns(data.designs ?? []);
      }
    } catch {
      /* store stays empty on network error */
    } finally {
      setStoreLoading(false);
    }
  }

  useEffect(() => {
    if (tab === "store" && user) void loadStore();
  }, [tab, user]);

  async function generate() {
    if (!user || busy) return;
    setBusy(true);
    setError(null);
    setOutOfCredits(false);
    setMockups([]);
    setBatchMeta(null);
    setSavedIds(new Set());
    try {
      const res = await fetch("/api/merch/design", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product,
          style,
          description: description.trim(),
          title: title.trim(),
        }),
      });
      const data: DesignResponse = await res.json();
      if (res.status === 402) {
        setOutOfCredits(true);
        return;
      }
      if (!res.ok || data.status !== "succeeded" || !data.mockups?.length) {
        setError(data.error || data.message || "Could not generate the designs — no credits were charged.");
        return;
      }
      setMockups(data.mockups);
      setBatchMeta({
        baseCostCents: data.baseCostCents ?? 0,
        suggestedPriceCents: data.suggestedPriceCents ?? 0,
        title: data.title ?? "Merch Design",
      });
      if (typeof data.creditsRemaining === "number") setCreditsRemaining(data.creditsRemaining);
    } catch {
      setError("Network error — please try again. No credits were charged.");
    } finally {
      setBusy(false);
    }
  }

  async function saveToStore(m: Mockup) {
    try {
      const res = await fetch("/api/merch/designs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: (title.trim() || batchMeta?.title || "Merch Design").slice(0, 80),
          product,
          style,
          prompt: description.trim(),
          imageUrl: m.url,
          imagePath: m.path,
          priceCents: batchMeta?.suggestedPriceCents ?? undefined,
          status: "draft",
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setSavedIds((s) => new Set(s).add(m.url));
        void data;
      }
    } catch {
      /* silent — user can retry */
    }
  }

  async function updateDesign(id: string, patch: { priceCents?: number | null; status?: string; title?: string }) {
    try {
      const res = await fetch(`/api/merch/designs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (res.ok) void loadStore();
    } catch {
      /* silent */
    }
  }

  async function deleteDesign(id: string) {
    if (!window.confirm("Delete this design? This can't be undone.")) return;
    try {
      const res = await fetch(`/api/merch/designs/${id}`, { method: "DELETE" });
      if (res.ok) void loadStore();
    } catch {
      /* silent */
    }
  }

  async function orderIntent(id: string) {
    setOrderMsg(null);
    try {
      const res = await fetch(`/api/merch/designs/${id}/order`, { method: "POST" });
      const data = await res.json();
      setOrderMsg(data.message ?? "Checkout is coming soon.");
    } catch {
      setOrderMsg("Checkout is coming soon.");
    }
  }

  const canGenerate = !!user && !busy;

  return (
    <div className="min-h-screen bg-black text-white">
      <MarketingNav />
      <main className="mx-auto max-w-4xl px-4 py-10">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-white/40 hover:text-white/70 mb-6">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>

        <div className="flex items-center gap-3 mb-2">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Shirt className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-black">Merch Designer</h1>
            <p className="text-sm text-white/45">AI-designed merch for your brand — 3 credits per design batch</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="mt-6 flex gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-1.5">
          {(
            [
              { key: "design", label: "Design Studio", icon: Sparkles },
              { key: "store", label: "My Store", icon: Store },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition ${
                tab === t.key ? "bg-primary text-black" : "text-white/50 hover:text-white"
              }`}
            >
              <t.icon className="h-4 w-4" /> {t.label}
            </button>
          ))}
        </div>

        {outOfCredits && (
          <div className="mt-4"><OutOfCredits /></div>
        )}
        {error && (
          <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-red-500/25 bg-red-500/5 px-4 py-3">
            <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
            <p className="text-sm text-red-200/80">{error}</p>
          </div>
        )}

        {/* ═══════════ DESIGN STUDIO ═══════════ */}
        {tab === "design" && (
          <div className="mt-6 space-y-5">
            {/* Product picker */}
            <div>
              <p className="text-xs font-bold text-white/40 uppercase tracking-wider mb-2">Product</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {PRODUCTS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => setProduct(p.key)}
                    className={`rounded-xl border p-3 text-left transition ${
                      product === p.key
                        ? "border-primary/60 bg-primary/[0.08]"
                        : "border-white/[0.08] bg-white/[0.02] hover:border-white/20"
                    }`}
                  >
                    <span className="block h-10 rounded-lg mb-2" style={{ background: p.swatch }} />
                    <p className="font-bold text-white text-sm">{p.label}</p>
                    <p className="text-xs text-white/40 mt-0.5">{p.blurb}</p>
                    <p className="text-[11px] text-primary/80 mt-1 font-semibold">{p.baseCost}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Style picker */}
            <div>
              <p className="text-xs font-bold text-white/40 uppercase tracking-wider mb-2">Style</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {STYLES.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setStyle(s.key)}
                    className={`rounded-xl border p-3 text-left transition ${
                      style === s.key
                        ? "border-primary/60 bg-primary/[0.08]"
                        : "border-white/[0.08] bg-white/[0.02] hover:border-white/20"
                    }`}
                  >
                    <span className="block h-10 rounded-lg mb-2" style={{ background: s.swatch }} />
                    <p className="font-bold text-white text-sm">{s.label}</p>
                    <p className="text-xs text-white/40 mt-0.5">{s.blurb}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Title + description */}
            <div>
              <label className="text-xs font-bold text-white/40 uppercase tracking-wider">Design title</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Shark King Tour Tee"
                maxLength={80}
                className="mt-2 w-full rounded-xl border border-white/[0.12] bg-white/[0.03] px-4 py-3.5 text-white placeholder:text-white/25 outline-none focus:border-primary/60"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-white/40 uppercase tracking-wider">
                Describe your design <span className="text-white/25 normal-case font-normal">(AI handles the rest)</span>
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. A crowned shark with lightning, 'BOW DOWN' in bold gold letters underneath"
                maxLength={500}
                rows={3}
                className="mt-2 w-full rounded-xl border border-white/[0.12] bg-white/[0.03] px-4 py-3.5 text-white placeholder:text-white/25 outline-none focus:border-primary/60 resize-none"
              />
            </div>

            <button
              onClick={generate}
              disabled={!canGenerate}
              className="w-full rounded-2xl bg-primary px-6 py-4 font-bold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span className="inline-flex items-center gap-2"><Sparkles className="h-4 w-4" /> Generate 2 mockups · 3 credits</span>
            </button>
            {creditsRemaining != null && (
              <p className="text-center text-xs text-white/35">{creditsRemaining} credits remaining</p>
            )}

            {/* Progress */}
            {busy && (
              <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] px-6 py-10 text-center">
                <Loader2 className="h-8 w-8 text-primary animate-spin mx-auto mb-4" />
                <p className="font-bold text-white">Designing your merch…</p>
                <p className="text-sm text-white/40 mt-1">Rendering 2 product mockups — hang tight.</p>
              </div>
            )}

            {/* Batch results */}
            {mockups.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center gap-2.5 rounded-xl border border-green-500/25 bg-green-500/5 px-4 py-3">
                  <CheckCircle2 className="h-5 w-5 text-green-400 shrink-0" />
                  <p className="text-sm font-semibold text-white/80">
                    2 mockups ready{batchMeta ? <> — suggested retail {fmt(batchMeta.suggestedPriceCents)}</> : null}
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {mockups.map((m) => (
                    <div key={m.url} className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-3">
                      <img src={m.url} alt="Merch mockup" className="w-full rounded-xl aspect-square object-cover" />
                      <div className="mt-3 flex gap-2">
                        <a
                          href={m.url}
                          download="merch-mockup.png"
                          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-white/[0.06] px-4 py-2.5 text-sm font-bold text-white hover:bg-white/[0.1] transition"
                        >
                          <Download className="h-4 w-4" /> Download
                        </a>
                        <button
                          onClick={() => void saveToStore(m)}
                          disabled={savedIds.has(m.url)}
                          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-black hover:brightness-110 transition disabled:opacity-50"
                        >
                          {savedIds.has(m.url) ? <CheckCircle2 className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                          {savedIds.has(m.url) ? "Saved" : "Save to store"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => { setMockups([]); setBatchMeta(null); setSavedIds(new Set()); }}
                  className="inline-flex items-center gap-2 rounded-2xl border border-white/[0.12] px-6 py-3.5 font-semibold text-white/70 hover:border-white/25 transition"
                >
                  <RefreshCw className="h-4 w-4" /> New batch
                </button>
              </div>
            )}
          </div>
        )}

        {/* ═══════════ MY STORE ═══════════ */}
        {tab === "store" && (
          <div className="mt-6 space-y-4">
            <div className="flex items-start gap-2.5 rounded-xl border border-primary/25 bg-primary/[0.06] px-4 py-3">
              <Info className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <p className="text-sm text-white/70">
                <span className="font-bold text-white">Dropship model:</span> you design, manufacturers print &amp; ship
                directly — Bow Down Visuals never touches inventory. Checkout is{" "}
                <span className="font-bold text-primary">coming soon</span>; listing is free.
              </p>
            </div>

            {orderMsg && (
              <div className="flex items-start gap-2.5 rounded-xl border border-primary/25 bg-primary/[0.06] px-4 py-3">
                <ShoppingBag className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                <p className="text-sm text-white/75">{orderMsg}</p>
              </div>
            )}

            {storeLoading && (
              <div className="text-center py-10">
                <Loader2 className="h-6 w-6 text-primary animate-spin mx-auto mb-3" />
                <p className="text-sm text-white/40">Loading your store…</p>
              </div>
            )}

            {!storeLoading && designs.length === 0 && (
              <div className="rounded-2xl border border-dashed border-white/[0.12] px-6 py-12 text-center">
                <Store className="h-8 w-8 text-white/25 mx-auto mb-3" />
                <p className="font-bold text-white/70">No designs yet</p>
                <p className="text-sm text-white/40 mt-1">Generate a batch in the Design Studio, then save your favorites here.</p>
                <button
                  onClick={() => setTab("design")}
                  className="mt-4 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-black hover:brightness-110 transition"
                >
                  <Sparkles className="h-4 w-4" /> Start designing
                </button>
              </div>
            )}

            {designs.map((d) => {
              const priceInput = priceEdits[d.id] ?? (d.price_cents != null ? (d.price_cents / 100).toFixed(2) : "");
              const priceCents = Math.round(Number.parseFloat(priceInput || "0") * 100);
              const validPrice = priceInput.trim() !== "" && Number.isFinite(priceCents) && priceCents >= 0;
              const commission = validPrice ? Math.round((priceCents * 15) / 100) : 0;
              const profit = validPrice ? priceCents - d.base_cost_cents - commission : null;
              return (
                <div key={d.id} className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4 sm:flex gap-4">
                  <img src={d.image_url} alt={d.title} className="w-full sm:w-36 aspect-square rounded-xl object-cover shrink-0" />
                  <div className="mt-3 sm:mt-0 flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-bold text-white truncate">{d.title}</p>
                        <p className="text-xs text-white/40 capitalize mt-0.5">{d.product} · {d.style.replace("-", " ")}</p>
                      </div>
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
                        d.status === "listed" ? "bg-green-500/15 text-green-300" : "bg-white/[0.06] text-white/50"
                      }`}>
                        {d.status}
                      </span>
                    </div>

                    {/* Price + margin */}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <div className="flex items-center gap-1.5 rounded-xl border border-white/[0.12] bg-white/[0.03] px-3 py-2">
                        <Tag className="h-3.5 w-3.5 text-white/40" />
                        <input
                          value={priceInput}
                          onChange={(e) => setPriceEdits((p) => ({ ...p, [d.id]: e.target.value }))}
                          placeholder="29.99"
                          inputMode="decimal"
                          className="w-20 bg-transparent text-sm font-bold text-white placeholder:text-white/25 outline-none"
                        />
                      </div>
                      <button
                        onClick={() => validPrice && void updateDesign(d.id, { priceCents })}
                        disabled={!validPrice}
                        className="rounded-xl bg-white/[0.06] px-4 py-2 text-sm font-bold text-white hover:bg-white/[0.1] transition disabled:opacity-40"
                      >
                        Set price
                      </button>
                      {d.status === "draft" ? (
                        <button
                          onClick={() => void updateDesign(d.id, { status: "listed" })}
                          className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-black hover:brightness-110 transition"
                        >
                          List for sale
                        </button>
                      ) : (
                        <button
                          onClick={() => void updateDesign(d.id, { status: "draft" })}
                          className="rounded-xl border border-white/[0.12] px-4 py-2 text-sm font-semibold text-white/70 hover:border-white/25 transition"
                        >
                          Unlist
                        </button>
                      )}
                      <button
                        onClick={() => void deleteDesign(d.id)}
                        className="rounded-xl p-2 text-white/40 hover:text-red-300 hover:bg-red-500/10 transition"
                        aria-label="Delete design"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>

                    {/* Margin readout */}
                    <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                      <span className="text-white/40">Base cost <span className="text-white/70 font-semibold">{fmt(d.base_cost_cents)}</span></span>
                      {profit != null && (
                        <>
                          <span className="text-white/40">Platform fee (future) <span className="text-white/70 font-semibold">{fmt(commission)}</span></span>
                          <span className={`font-bold ${profit >= 0 ? "text-green-300" : "text-red-300"}`}>
                            Your profit {fmt(profit)}{" "}
                            <span className="font-normal opacity-70">
                              ({priceCents > 0 ? Math.round((profit / priceCents) * 100) : 0}% margin)
                            </span>
                          </span>
                        </>
                      )}
                    </div>

                    {d.status === "listed" && (
                      <button
                        onClick={() => void orderIntent(d.id)}
                        className="mt-3 inline-flex items-center gap-2 rounded-xl border border-primary/40 px-4 py-2 text-sm font-bold text-primary hover:bg-primary/10 transition"
                      >
                        <ShoppingBag className="h-4 w-4" /> Preview checkout
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {designs.length > 0 && (
              <p className="flex items-center gap-2 text-xs text-white/35">
                <Pencil className="h-3.5 w-3.5" /> Prices and listing are free to change anytime. The 15% platform
                fee only applies once checkout goes live.
              </p>
            )}
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
