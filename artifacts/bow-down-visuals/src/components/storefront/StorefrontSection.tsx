import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { Loader2, ShoppingBag, Tag, MapPin, Clock, ExternalLink, BadgeCheck } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  listProducts, checkoutProduct, validateDiscount,
  KIND_LABELS, KIND_EMOJI,
  type StoreProductDTO,
} from "@/lib/storefront-api";
import PromoteButton from "./PromoteButton";

/* ─── StorefrontSection — the creator's store, woven into /artist/:slug ───
 *
 * MOUNT (Worker 4): render inside the public artist page —
 *   import StorefrontSection from "@/components/storefront/StorefrontSection";
 *   <StorefrontSection slug={profile.slug} manageMode={isOwner} />
 * manageMode shows inventory/edit shortcuts + the Promote chain. It never
 * edits Worker 4's files — this component is fully self-contained.
 *
 * Link graph: every product links to the creator profile, its related
 * content (track / video / drop page), its event (tickets), and the promo
 * tools (Promote button). No dead ends.
 */

const KIND_STYLES: Record<string, string> = {
  download: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  merch: "bg-purple-500/15 text-purple-300 border-purple-500/30",
  digital: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  service: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  ticket: "bg-rose-500/15 text-rose-300 border-rose-500/30",
};

function ProductCard({ product, manageMode }: { product: StoreProductDTO; manageMode: boolean }) {
  const { user, getAccessToken } = useAuth();
  const [buying, setBuying] = useState(false);
  const [code, setCode] = useState("");
  const [codeState, setCodeState] = useState<"idle" | "checking" | "ok" | "bad">("idle");
  const [codeMsg, setCodeMsg] = useState("");
  const [error, setError] = useState("");

  const checkCode = useCallback(async () => {
    if (!code.trim()) {
      setCodeState("idle");
      setCodeMsg("");
      return;
    }
    setCodeState("checking");
    try {
      const r = await validateDiscount(product.profileId, code.trim());
      if (r.valid) {
        setCodeState("ok");
        setCodeMsg(`${r.percentOff}% off applied at checkout.`);
      } else {
        setCodeState("bad");
        setCodeMsg(r.reason ?? "That code doesn't work here.");
      }
    } catch {
      setCodeState("bad");
      setCodeMsg("Couldn't check that code.");
    }
  }, [code, product.profileId]);

  const buy = async () => {
    setError("");
    if (!user) return; // the button renders as a login link instead
    setBuying(true);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Sign in to buy.");
      const r = await checkoutProduct(token, {
        productId: product.id,
        quantity: 1,
        discountCode: codeState === "ok" && code.trim() ? code.trim() : undefined,
      });
      if (r.url) window.location.href = r.url;
      else throw new Error("Checkout didn't return a payment link.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start checkout.");
      setBuying(false);
    }
  };

  const img = product.mediaUrls[0];

  return (
    <div
      id={`product-${product.id}`}
      className="lux-card group relative flex scroll-mt-24 flex-col overflow-hidden rounded-2xl border border-white/10"
    >
      {img ? (
        <div className="relative aspect-[4/3] overflow-hidden bg-black/40">
          <img
            src={img}
            alt={product.title}
            loading="lazy"
            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
          />
          {product.compareAtCents != null && product.compareAtCents > product.priceCents && (
            <span className="absolute left-3 top-3 rounded-full bg-red-600 px-2.5 py-1 text-[11px] font-black text-white">
              SALE
            </span>
          )}
        </div>
      ) : (
        <div className="flex aspect-[4/3] items-center justify-center bg-gradient-to-br from-[#1a1408] to-black text-5xl">
          {KIND_EMOJI[product.kind]}
        </div>
      )}

      <div className="flex flex-1 flex-col p-4">
        <div className="mb-2 flex items-center gap-2">
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${KIND_STYLES[product.kind] ?? "bg-white/10 text-white/70"}`}>
            {KIND_EMOJI[product.kind]} {KIND_LABELS[product.kind]}
          </span>
          {manageMode && (
            <span className="ml-auto text-[10px] text-white/35">
              {product.unlimited ? "∞ stock" : product.soldOut ? "SOLD OUT" : `${product.inventory} left`}
            </span>
          )}
        </div>

        <h3 className="text-base font-bold leading-tight text-white">{product.title}</h3>
        {product.description && (
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-white/50">{product.description}</p>
        )}

        {/* Service details — calendar link is a STUB, labeled honestly. */}
        {product.kind === "service" && product.serviceDetails && (
          <div className="mt-2 space-y-1 text-[11px] text-white/55">
            {product.serviceDetails.duration_min != null && (
              <p className="flex items-center gap-1.5"><Clock className="h-3 w-3 text-primary" /> {product.serviceDetails.duration_min} min</p>
            )}
            {product.serviceDetails.location && (
              <p className="flex items-center gap-1.5"><MapPin className="h-3 w-3 text-primary" /> {product.serviceDetails.location}</p>
            )}
            {product.serviceDetails.booking_calendar_link && (
              <a
                href={product.serviceDetails.booking_calendar_link}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 text-primary hover:underline"
              >
                <ExternalLink className="h-3 w-3" /> Pick a time
                <span className="text-white/30">(calendar link)</span>
              </a>
            )}
          </div>
        )}

        {/* Ticket → the event it belongs to (Worker 9's events). */}
        {product.kind === "ticket" && product.links.eventUrl && (
          <Link href={product.links.eventUrl}>
            <span className="mt-2 inline-flex cursor-pointer items-center gap-1 text-[11px] font-bold text-primary hover:underline">
              🎟️ {product.links.eventTitle ?? "View the event"} →
            </span>
          </Link>
        )}

        {/* Merch boundary: fulfillment lives in the merch system. */}
        {product.kind === "merch" && (
          <p className="mt-2 flex items-start gap-1 text-[10px] leading-relaxed text-white/35">
            <BadgeCheck className="mt-0.5 h-3 w-3 shrink-0" />
            Printed & shipped by the creator's merch pipeline.
          </p>
        )}

        {/* Related content links — the track, the video, the drop page. */}
        {product.relatedLinks.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {product.relatedLinks.map((l, i) => (
              <a
                key={i}
                href={l.url}
                target={l.url.startsWith("http") ? "_blank" : undefined}
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/60 transition hover:border-primary/40 hover:text-white"
              >
                <ExternalLink className="h-2.5 w-2.5" /> {l.label}
              </a>
            ))}
          </div>
        )}

        <div className="mt-3 flex items-end justify-between border-t border-white/10 pt-3">
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-black text-primary">{product.price}</span>
              {product.compareAtCents != null && product.compareAtCents > product.priceCents && (
                <span className="text-xs text-white/35 line-through">
                  ${(product.compareAtCents / 100).toFixed(2)}
                </span>
              )}
            </div>
            <p className="text-[10px] text-white/30">Real money via Stripe · not Visual Bucs</p>
          </div>
          {manageMode && <PromoteButton product={product} />}
        </div>

        {/* Discount code (guided, 2★+) — never blocks the buy button. */}
        <div className="mt-2" data-min-stars="2">
          <div className="flex gap-1.5">
            <input
              value={code}
              onChange={(e) => { setCode(e.target.value); setCodeState("idle"); setCodeMsg(""); }}
              onBlur={checkCode}
              placeholder="Discount code (optional)"
              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 text-xs text-white placeholder:text-white/25"
            />
            <button
              onClick={checkCode}
              className="rounded-lg border border-white/10 px-2.5 text-xs font-bold text-white/60 hover:text-white"
              title="Check code"
            >
              <Tag className="h-3.5 w-3.5" />
            </button>
          </div>
          {codeMsg && (
            <p className={`mt-1 text-[11px] ${codeState === "ok" ? "text-green-400" : codeState === "bad" ? "text-red-400" : "text-white/40"}`}>
              {codeMsg}
            </p>
          )}
        </div>

        {error && <p className="mt-2 text-[11px] text-red-400">{error}</p>}

        {product.soldOut ? (
          <button disabled className="mt-3 w-full cursor-not-allowed rounded-xl bg-white/[0.06] py-2.5 text-sm font-bold text-white/35">
            Sold out
          </button>
        ) : user ? (
          <button
            onClick={buy}
            disabled={buying}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-[#e8c547] to-[#b8860b] py-2.5 text-sm font-black text-black transition hover:brightness-110 disabled:opacity-60"
          >
            {buying ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingBag className="h-4 w-4" />}
            {buying ? "Starting checkout…" : `Buy now — ${product.price}`}
          </button>
        ) : (
          <Link href={`/login?next=${encodeURIComponent(product.links.productUrl)}`}>
            <span className="mt-3 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-[#e8c547] to-[#b8860b] py-2.5 text-sm font-black text-black transition hover:brightness-110">
              <ShoppingBag className="h-4 w-4" /> Sign in to buy — {product.price}
            </span>
          </Link>
        )}
      </div>
    </div>
  );
}

export default function StorefrontSection({
  slug,
  manageMode = false,
  title = "The Store",
}: {
  slug: string;
  manageMode?: boolean;
  title?: string;
}) {
  const [products, setProducts] = useState<StoreProductDTO[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await listProducts(slug);
        if (!cancelled) setProducts(r.products);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [slug]);

  if (failed) return null; // a broken store never blocks the profile
  if (products && products.length === 0 && !manageMode) return null; // empty store stays invisible to fans

  return (
    <section aria-label="Creator store" className="mx-auto w-full max-w-6xl px-4 py-10">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-black tracking-tight text-white">
            👑 {title}
          </h2>
          <p className="mt-1 text-xs text-white/45">
            Everything the creator sells, in one place. Real-money checkout via Stripe — never Visual Bucs.
          </p>
        </div>
        {manageMode && (
          <Link href="/store/dashboard?tab=products">
            <span className="cursor-pointer rounded-full border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary hover:bg-primary/20">
              Manage store →
            </span>
          </Link>
        )}
      </div>

      {!products ? (
        <div className="flex items-center justify-center py-12 text-white/40">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : products.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/15 p-8 text-center">
          <p className="text-sm font-bold text-white/70">Nothing for sale yet.</p>
          {manageMode && (
            <Link href="/store/dashboard?tab=products">
              <span className="mt-2 inline-block cursor-pointer text-xs font-bold text-primary hover:underline">
                List your first product — that's the first step to getting paid →
              </span>
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((p) => (
            <ProductCard key={p.id} product={p} manageMode={manageMode} />
          ))}
        </div>
      )}
    </section>
  );
}
