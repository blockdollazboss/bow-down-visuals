import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { useEffect, useState } from "react";
import { Link, useParams, useLocation } from "wouter";
import { Loader2, ShieldCheck, Zap, BadgeDollarSign, ArrowLeft, Lock, Share2, Minus, Plus, Timer, BellRing, Mail, CheckCircle2, Users } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { shareDrop } from "@/lib/share-drop";
import { clampQuantity, maxQuantity } from "@/lib/storefront-product";
import ProductReviews from "@/components/product-reviews/ProductReviews";
import { dropCountdown, formatDropLocal, pad2 } from "@/lib/product-drop";
import type { ProductDropDTO } from "@/lib/storefront-api";
import { usePageTitle } from "@/hooks/use-page-title";
import CourseOutline from "@/components/courses/CourseOutline";

/* ─── /storefront/product/:id — the public product page ────────────────────
   The landing page for one store product (downloads, merch, digital
   goods, services, tickets from the creator's store rail). The profile
   store catalog, the store's link graph, and checkout's cancel path all
   land here — this is the page that completes the sale via
   POST /api/storefront/checkout.

   Money copy rule: this is REAL MONEY via secure checkout, never
   Visual Bucs. */

export const PRODUCT_KIND_LABELS: Record<string, string> = {
  download: "Download",
  merch: "Merch",
  digital: "Digital product",
  service: "Service",
  ticket: "Ticket",
  course: "Course",
  gift_card: "Gift card",
};

/** The add-on offer (feature #13): resolved server-side — present only
    while the attached product is live, priced and in stock. */
interface BumpOfferData {
  productId: string;
  title: string;
  kind: string;
  listPriceCents: number;
  listPrice: string;
  percentOff: number;
  priceCents: number;
  price: string;
  productUrl: string;
}

interface ProductData {
  product: {
    id: string;
    kind: string;
    title: string;
    description: string | null;
    priceCents: number;
    price: string;
    /** $0 = lead magnet (0190): claimed by email, never checked out. */
    free?: boolean;
    compareAtCents: number | null;
    inventory: number;
    soldOut: boolean;
    unlimited: boolean;
    mediaUrls: string[];
    /** One tick-to-add add-on, or null when none is on offer. */
    bump?: BumpOfferData | null;
    /* #16: the creator's published affiliate offer, when on. */
    affiliatesEnabled?: boolean;
    affiliateCommissionPct?: string | null;
    /* Timed drop (#25): non-null while a drop is scheduled/live. */
    drop?: ProductDropDTO | null;
    /* #29: index-aligned accessibility descriptions for mediaUrls. */
    mediaAltTexts?: string[];
    /** kind='gift_card': seller-set amounts (cents) to pick from. */
    giftCardDenominationsCents?: number[] | null;
    /* #36: co-seller splits as presented — every seller sharing this
       product's net, with names/slugs; null when the product is solo. */
    splits?: { userId: string; sharePct: number; name?: string | null; slug?: string | null }[] | null;
    links: {
      creatorUrl: string;
      creatorName: string;
      productUrl: string;
    };
  };
  /** Drop page payload (#25): capture count while upcoming. */
  drop?: (ProductDropDTO & { captureCount: number; productUrl: string }) | null;
  /** Present on the detail payload for $0 products. */
  free?: boolean;
  note?: string;
  feeSplit: {
    priceCents: number;
    price: string;
    platformFeeCents: number;
    platformFee: string;
    platformFeePct: number;
    creatorCents: number;
    creatorAmount: string;
  };
}

interface ClaimResult {
  duplicate: boolean;
  delivery: { url: string; expiresAt: string; maxUses: number } | null;
  fulfillmentNote: string | null;
  listName: string;
}

/* ─── Drop section (#25) ─────────────────────────────────────────────────
   While the drop is upcoming, the product page IS the drop page: a live
   countdown to the UTC drop instant (rendered in the viewer's local
   time) + the email capture. Joining subscribes the fan to the
   creator's existing email list server-side and puts them on the
   one-email-at-drop list. When the countdown lands, the section flips
   to "live" and invites a refresh — the buy box below takes over
   (the server already reads the product as live at the same instant). */
function useNowMs(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function DropSection({ productId, title, creatorName, drop }: {
  productId: string;
  title: string;
  creatorName: string;
  drop: ProductDropDTO & { captureCount?: number };
}) {
  const now = useNowMs();
  const countdown = dropCountdown(drop.dropAt, now);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [joinState, setJoinState] = useState<"idle" | "joining" | "done" | "error">("idle");
  const [joinMsg, setJoinMsg] = useState<string | null>(null);
  const [already, setAlready] = useState(false);
  const [count, setCount] = useState(drop.captureCount ?? 0);

  if (!countdown) return null;

  if (countdown.isLive) {
    return (
      <div className="mt-6 rounded-xl border border-emerald-400/40 bg-emerald-400/10 p-5 text-center" data-testid="drop-live">
        <div className="text-lg font-bold text-emerald-200">It&apos;s live. 🎉</div>
        <p className="mt-1 text-sm text-emerald-100/80">
          “{title}” just dropped — grab it below before it&apos;s gone.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="mt-4 inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-b from-amber-300 to-amber-600 px-6 py-3 font-bold text-black transition hover:brightness-110"
        >
          <Zap className="h-4 w-4" /> Shop the drop
        </button>
      </div>
    );
  }

  async function joinDrop() {
    const clean = email.trim().toLowerCase();
    if (!EMAIL_RE.test(clean)) {
      setJoinState("error");
      setJoinMsg("Enter a valid email address.");
      return;
    }
    setJoinState("joining");
    setJoinMsg(null);
    try {
      const res = await fetch(`/api/storefront/products/${productId}/drop/capture`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: clean, ...(name.trim() ? { name: name.trim() } : {}) }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        alreadyCaptured?: boolean; captureCount?: number; error?: string; message?: string;
      };
      if (!res.ok) throw new Error(body.message || body.error || "Couldn't join the drop list.");
      setAlready(body.alreadyCaptured === true);
      if (typeof body.captureCount === "number") setCount(body.captureCount);
      setJoinState("done");
    } catch (err) {
      setJoinState("error");
      setJoinMsg(err instanceof Error ? err.message : "Couldn't join the drop list.");
    }
  }

  const units = [
    { v: String(countdown.days), label: "days" },
    { v: pad2(countdown.hours), label: "hrs" },
    { v: pad2(countdown.minutes), label: "min" },
    { v: pad2(countdown.seconds), label: "sec" },
  ];

  return (
    <div className="mt-6 rounded-xl border border-amber-500/30 bg-black/40 p-5" data-testid="drop-upcoming">
      <div className="flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-[0.25em] text-amber-400">
        <Timer className="h-4 w-4" /> Drops in
      </div>
      <div className="mt-3 flex items-start justify-center gap-2" role="timer" aria-label="Countdown to the drop">
        {units.map((u, i) => (
          <div key={u.label} className="flex items-start gap-2">
            <div className="text-center">
              <div className="min-w-14 rounded-lg border border-amber-500/25 bg-black/60 px-2 py-2 text-3xl font-black tabular-nums text-amber-200">
                {u.v}
              </div>
              <div className="mt-1 text-[10px] uppercase tracking-widest text-amber-100/50">{u.label}</div>
            </div>
            {i < units.length - 1 && <div className="pt-2 text-2xl font-black text-amber-500/60">:</div>}
          </div>
        ))}
      </div>
      <p className="mt-3 text-center text-sm text-amber-100/70">
        {formatDropLocal(drop.dropAt) ? <>Live {formatDropLocal(drop.dropAt)} — your time.</> : null}
        {count > 0 && <> {count} {count === 1 ? "fan is" : "fans are"} on the list.</>}
      </p>

      {joinState === "done" ? (
        <div className="mt-4 rounded-xl border border-emerald-400/40 bg-emerald-400/10 p-4 text-center">
          <div className="inline-flex items-center gap-2 font-bold text-emerald-200">
            <CheckCircle2 className="h-5 w-5" /> {already ? "You're already on the list." : "You're on the list. 👑"}
          </div>
          <p className="mt-1 text-xs text-emerald-100/70">
            One email the moment “{title}” drops — that&apos;s the deal. No spam, ever.
          </p>
        </div>
      ) : (
        <div className="mt-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              placeholder="Email for the drop alert"
              aria-label="Email for the drop alert"
              className="rounded-full border border-amber-500/30 bg-black/60 px-4 py-3 text-sm text-amber-100 outline-none placeholder:text-amber-100/35 focus:border-amber-400"
            />
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name (optional)"
              aria-label="Your name"
              className="rounded-full border border-amber-500/30 bg-black/60 px-4 py-3 text-sm text-amber-100 outline-none placeholder:text-amber-100/35 focus:border-amber-400"
            />
          </div>
          {joinMsg && <p className="mt-3 text-sm font-bold text-red-300">{joinMsg}</p>}
          <button
            onClick={joinDrop}
            disabled={joinState === "joining"}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-b from-amber-300 to-amber-600 px-6 py-4 text-lg font-bold text-black transition hover:brightness-110 disabled:opacity-60"
          >
            {joinState === "joining" ? <Loader2 className="h-5 w-5 animate-spin" /> : <BellRing className="h-5 w-5" />}
            {joinState === "joining" ? "Joining…" : "Notify me at the drop"}
          </button>
          <p className="mt-3 flex items-start gap-1.5 text-xs text-amber-100/50">
            <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Joining adds your email to {creatorName}&apos;s list — one email when this drops, unsubscribe anytime.
          </p>
        </div>
      )}
    </div>
  );
}

export default function StorefrontProduct() {
  const isLight = useIsLightTheme();
  usePageTitle("Product", "Buy directly from the creator on Bow Down Visuals.");
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { user, getAccessToken } = useAuth();
  const [data, setData] = useState<ProductData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [buying, setBuying] = useState(false);
  const [buyError, setBuyError] = useState<string | null>(null);
  const [shared, setShared] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [discountCode, setDiscountCode] = useState("");
  /* Order bump (feature #13): the buyer ticks the add-on; the server
     re-prices it at checkout — the tick alone never sets a price. */
  const [includeBump, setIncludeBump] = useState(false);
  /* Gift cards (Stack-100 #3 #26): tender beside the discount code on
     normal products; a full purchase flow on gift-card products. */
  const [giftCardCode, setGiftCardCode] = useState("");
  const [giftAmount, setGiftAmount] = useState<number | null>(null);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [giftMessage, setGiftMessage] = useState("");
  const [giftIssued, setGiftIssued] = useState<{ code: string | null; note: string } | null>(null);
  const [paidWithGiftCard, setPaidWithGiftCard] = useState(false);
  /* Lead-magnet claim state (0190). */
  const [claimEmail, setClaimEmail] = useState("");
  const [claimName, setClaimName] = useState("");
  const [claimConsent, setClaimConsent] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimed, setClaimed] = useState<ClaimResult | null>(null);

  async function onShare() {
    if (!data) return;
    const outcome = await shareDrop({
      title: data.product.title,
      text: `“${data.product.title}” by ${data.product.links.creatorName} — cop it on Bow Down Visuals 👑`,
      url: `/storefront/product/${data.product.id}`,
    });
    if (outcome === "copied") {
      setShared(true);
      setTimeout(() => setShared(false), 2500);
    }
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/storefront/product/${params.id}`);
        const body = (await res.json().catch(() => ({}))) as ProductData & { error?: string };
        if (!alive) return;
        if (!res.ok) {
          setError(body.error || "Couldn't load this product.");
          return;
        }
        setData(body);
      } catch {
        if (alive) setError("Couldn't load this product. Check your connection.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [params.id]);

  const maxQty = data ? maxQuantity(data.product.inventory, data.product.unlimited) : 99;
  const isFree = !!data && (data.free === true || data.product.free === true || data.product.priceCents === 0);
  /* Timed drop (#25): while upcoming, this page is the drop page —
     countdown + capture replace the buy/claim box (the server refuses
     checkout/claim until the moment anyway). */
  const dropInfo = data ? (data.drop ?? data.product.drop ?? null) : null;
  const isDropUpcoming = !!dropInfo?.isUpcoming;

  /* Claim a free lead magnet: the exchange is the email — it joins the
     creator's list (consent checkbox, mirrored server-side) and the
     product delivers instantly on the house delivery rail. No card,
     no checkout session, ever. */
  async function claimNow() {
    if (!data) return;
    if (!user) {
      navigate("/login");
      return;
    }
    if (!claimConsent) {
      setClaimError("Tick the box to claim it — your email joining the creator's list is the exchange for the freebie.");
      return;
    }
    setClaiming(true);
    setClaimError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/storefront/claim", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          productId: data.product.id,
          emailConsent: true,
          ...(claimEmail.trim() ? { email: claimEmail.trim() } : {}),
          ...(claimName.trim() ? { name: claimName.trim() } : {}),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        duplicate?: boolean;
        delivery?: ClaimResult["delivery"];
        order?: { fulfillmentNote?: string | null };
        subscribed?: { listName?: string };
        error?: string;
        message?: string;
      };
      if (!res.ok) throw new Error(body.message || body.error || "Couldn't claim this product.");
      setClaimed({
        duplicate: body.duplicate === true,
        delivery: body.delivery ?? null,
        fulfillmentNote: body.order?.fulfillmentNote ?? null,
        listName: body.subscribed?.listName ?? "the creator's list",
      });
    } catch (err) {
      setClaimError(err instanceof Error ? err.message : "Couldn't claim this product.");
    } finally {
      setClaiming(false);
    }
  }

  const isGiftCard = data?.product.kind === "gift_card";

  /* Returning from a gift-card checkout: verify the paid session,
     which issues the card and emails the code to the recipient. */
  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    const sessionId = qs.get("session_id");
    if (qs.get("gift") !== "success" || !sessionId || !user) return;
    let alive = true;
    (async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/gift-cards/verify", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ sessionId }),
        });
        const body = (await res.json().catch(() => ({}))) as { code?: string | null; codeNote?: string; error?: string; message?: string };
        if (!alive) return;
        if (!res.ok) {
          setBuyError(body.message || body.error || "Your payment landed but the gift card needs a hand — contact support with your receipt.");
          return;
        }
        setGiftIssued({ code: body.code ?? null, note: body.codeNote ?? "" });
      } catch {
        if (alive) setBuyError("Couldn't confirm the gift card just now — your payment is recorded; reload to try again.");
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function buyNow() {
    if (!data) return;
    if (!user) {
      navigate("/login");
      return;
    }
    setBuying(true);
    setBuyError(null);
    try {
      const token = await getAccessToken();
      if (isGiftCard) {
        /* A gift card is bought FOR someone: amount from the seller's
           denominations, delivery to the recipient's email. */
        const amount = giftAmount ?? data.product.giftCardDenominationsCents?.[0];
        if (!amount) throw new Error("Pick an amount first.");
        if (!recipientEmail.trim()) throw new Error("Add the recipient's email — the gift card is delivered there, not to you.");
        const res = await fetch("/api/gift-cards/checkout", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            productId: data.product.id,
            amountCents: amount,
            recipientEmail: recipientEmail.trim(),
            ...(recipientName.trim() ? { recipientName: recipientName.trim() } : {}),
            ...(giftMessage.trim() ? { message: giftMessage.trim() } : {}),
          }),
        });
        const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string; message?: string };
        if (!res.ok || !body.url) throw new Error(body.message || body.error || "Checkout failed.");
        window.location.href = body.url;
        return;
      }
      const res = await fetch("/api/storefront/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          productId: data.product.id,
          quantity,
          ...(discountCode.trim() ? { discountCode: discountCode.trim() } : {}),
          ...(includeBump && data.product.bump ? { includeBump: true } : {}),
          /* #16: a fan's share link lands here with ?ref=CODE — pass it
             through so the sale attributes to them. The server validates
             it; a stale code refuses honestly at checkout. */
          ...(new URLSearchParams(window.location.search).get("ref")?.trim()
            ? { affiliateCode: new URLSearchParams(window.location.search).get("ref")!.trim() }
            : {}),
          ...(giftCardCode.trim() ? { giftCardCode: giftCardCode.trim() } : {}),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { url?: string | null; paidWithGiftCard?: boolean; error?: string; message?: string };
      if (!res.ok) throw new Error(body.message || body.error || "Checkout failed.");
      /* The gift card covered the whole bill — no hosted checkout. */
      if (body.paidWithGiftCard) {
        setPaidWithGiftCard(true);
        return;
      }
      if (!body.url) throw new Error("Checkout failed.");
      window.location.href = body.url;
    } catch (err) {
      setBuyError(err instanceof Error ? err.message : "Checkout failed.");
      setBuying(false);
    }
  }

  const panel = isLight
    ? "bg-gradient-to-b from-[#F7ECD2] to-[#FCF7EA]"
    : "bg-gradient-to-b from-[#171204] to-[#0d0a04]";

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-2xl px-4 py-10">
        <div className="flex items-center justify-between">
          <Link href="/" className="inline-flex items-center gap-2 text-sm text-amber-200/60 hover:text-amber-200">
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
          {data && (
            <button
              onClick={onShare}
              className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 px-4 py-2 text-sm text-amber-200 hover:bg-amber-500/10"
            >
              <Share2 className="h-4 w-4" /> {shared ? "Link copied!" : "Share"}
            </button>
          )}
        </div>

        {error ? (
          <div className={`mt-8 rounded-2xl border border-amber-500/30 p-10 text-center ${panel}`}>
            <div className="text-4xl">🔒</div>
            <h1 className="mt-4 text-2xl font-bold text-amber-300">Not available right now</h1>
            <p className="mt-2 text-amber-100/70">{error}</p>
          </div>
        ) : !data ? (
          <div className="mt-16 flex justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-amber-400" />
          </div>
        ) : (
          <div className={`mt-8 overflow-hidden rounded-2xl border border-amber-500/30 shadow-[0_0_60px_rgba(201,162,39,0.15)] ${panel}`}>
            {data.product.mediaUrls[0] ? (
              <img src={data.product.mediaUrls[0]} alt={data.product.mediaAltTexts?.[0] ?? data.product.title} className="h-64 w-full object-cover" />
            ) : (
              <div className="flex h-48 w-full items-center justify-center bg-gradient-to-br from-amber-900/40 to-black text-6xl">
                👑
              </div>
            )}
            <div className="p-8">
              <div className="text-xs uppercase tracking-[0.25em] text-amber-400/80">
                {PRODUCT_KIND_LABELS[data.product.kind] ?? data.product.kind}
              </div>
              <h1 className="mt-2 text-3xl font-bold text-amber-200">{data.product.title}</h1>
              <p className="mt-1 text-amber-100/70">
                by{" "}
                <Link href={data.product.links.creatorUrl} className="text-amber-300 underline-offset-2 hover:underline">
                  {data.product.links.creatorName}
                </Link>
              </p>
              {data.product.description && (
                <p className="mt-3 whitespace-pre-line text-sm text-amber-100/70">{data.product.description}</p>
              )}

              {/* #16: affiliate transparency — who earns what from this sale. */}
              {new URLSearchParams(window.location.search).get("ref") ? (
                <p className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-100/70">
                  You came through a fan&apos;s link — if you buy, they earn a commission out of the creator&apos;s cut. You pay the same price either way.
                </p>
              ) : data.product.affiliatesEnabled && data.product.affiliateCommissionPct ? (
                <p className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-100/70">
                  Resell this and earn {data.product.affiliateCommissionPct} of the creator&apos;s cut on every sale through your link — grab yours on the Earnings page.
                </p>
              ) : null}
              {dropInfo && (
                <DropSection
                  productId={data.product.id}
                  title={data.product.title}
                  creatorName={data.product.links.creatorName}
                  drop={dropInfo}
                />
              )}

              <div className="mt-6 rounded-xl border border-amber-500/20 bg-black/40 p-5">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm text-amber-100/60">Your price</span>
                  <span className="flex items-baseline gap-2">
                    {data.product.compareAtCents != null && data.product.compareAtCents > data.product.priceCents && (
                      <span className="text-lg text-amber-100/40 line-through">
                        ${(data.product.compareAtCents / 100).toFixed(2)}
                      </span>
                    )}
                    {isFree ? (
                      <span className="text-3xl font-bold text-amber-300">FREE</span>
                    ) : (
                      <span className="text-3xl font-bold text-amber-300">{isGiftCard ? `from ${data.product.price}` : data.product.price}</span>
                    )}
                  </span>
                </div>
                {isFree ? (
                  <p className="mt-3 flex items-start gap-1.5 border-t border-amber-500/10 pt-3 text-xs text-amber-100/60">
                    <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                    Free from {data.product.links.creatorName} — claim it with your email and it's delivered instantly. Claiming adds your email to their list; every email carries an unsubscribe link. No card, no charge.
                  </p>
                ) : isGiftCard ? (
                  <p className="mt-3 flex items-start gap-1.5 border-t border-amber-500/10 pt-3 text-xs text-amber-100/60">
                    <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                    Every cent you buy is a cent they can spend — no platform fee is taken from a gift card. It works on anything in {data.product.links.creatorName}'s store, a little at a time or all at once.
                  </p>
                ) : (
                  <>
                    <div className="mt-3 space-y-1.5 border-t border-amber-500/10 pt-3 text-sm">
                      <div className="flex justify-between text-amber-100/70">
                        <span className="inline-flex items-center gap-1.5">
                          <BadgeDollarSign className="h-4 w-4 text-amber-400" /> Goes to {data.product.links.creatorName}
                        </span>
                        <span className="font-semibold text-amber-200">{data.feeSplit.creatorAmount}</span>
                      </div>
                      <div className="flex justify-between text-amber-100/50">
                        <span>Platform fee ({data.feeSplit.platformFeePct}%)</span>
                        <span>{data.feeSplit.platformFee}</span>
                      </div>
                    </div>
                    <p className="mt-3 flex items-start gap-1.5 text-xs text-amber-100/50">
                      <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      Real-money purchase through secure checkout. This is not Visual Bucs (AI credits).
                    </p>
                  </>
                )}
              </div>

              {isDropUpcoming ? null : data.product.soldOut ? (
                <div className="mt-6 rounded-full border border-amber-500/30 px-6 py-4 text-center text-lg font-bold text-amber-200/70">
                  Sold out — the creator's restocking
                </div>
              ) : isFree ? (
                <div className="mt-6">
                  {claimed ? (
                    <div className="rounded-2xl border border-emerald-400/40 bg-emerald-400/10 p-5 text-center">
                      <div className="text-lg font-bold text-emerald-200">
                        {claimed.duplicate ? "You've already claimed this one — here's your copy again." : "It's yours. 🎉"}
                      </div>
                      {claimed.fulfillmentNote && (
                        <p className="mt-1 text-sm text-emerald-100/80">{claimed.fulfillmentNote}</p>
                      )}
                      {claimed.delivery && (
                        <a
                          href={claimed.delivery.url}
                          className="mt-4 inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-b from-amber-300 to-amber-600 px-6 py-3 font-bold text-black transition hover:brightness-110"
                        >
                          <Zap className="h-4 w-4" /> Download it now
                        </a>
                      )}
                      <p className="mt-3 text-xs text-emerald-100/60">
                        Your email joined {claimed.listName} — that's the exchange for the freebie. Unsubscribe anytime.
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <input
                          value={claimEmail}
                          onChange={(e) => setClaimEmail(e.target.value)}
                          type="email"
                          placeholder="Email for delivery (blank = your account email)"
                          aria-label="Email for delivery"
                          className="rounded-full border border-amber-500/30 bg-black/60 px-4 py-3 text-sm text-amber-100 outline-none placeholder:text-amber-100/50 focus:border-amber-400 focus-visible:ring-2 focus-visible:ring-amber-400/60"
                        />
                        <input
                          value={claimName}
                          onChange={(e) => setClaimName(e.target.value)}
                          placeholder="Your name (optional)"
                          aria-label="Your name"
                          className="rounded-full border border-amber-500/30 bg-black/60 px-4 py-3 text-sm text-amber-100 outline-none placeholder:text-amber-100/50 focus:border-amber-400 focus-visible:ring-2 focus-visible:ring-amber-400/60"
                        />
                      </div>
                      <label className="mt-3 flex cursor-pointer items-start gap-2 text-left text-xs text-amber-100/70">
                        <input
                          type="checkbox"
                          checked={claimConsent}
                          onChange={(e) => setClaimConsent(e.target.checked)}
                          className="mt-0.5 h-4 w-4 shrink-0 accent-amber-500"
                        />
                        <span>
                          Add my email to {data.product.links.creatorName}'s list — that's the exchange for this free product. Every email carries an unsubscribe link.
                        </span>
                      </label>
                      {claimError && <p className="mt-3 text-sm font-bold text-red-300">{claimError}</p>}
                      <button
                        onClick={claimNow}
                        disabled={claiming}
                        className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-b from-amber-300 to-amber-600 px-6 py-4 text-lg font-bold text-black transition hover:brightness-110 disabled:opacity-60"
                      >
                        {claiming ? <Loader2 className="h-5 w-5 animate-spin" /> : <Zap className="h-5 w-5" />}
                        {claiming ? "Claiming…" : user ? "Claim it free" : "Sign in to claim it free"}
                      </button>
                    </>
                  )}
                </div>
              ) : giftIssued ? (
                <div className="mt-6 rounded-2xl border border-emerald-400/40 bg-emerald-400/10 p-5 text-center">
                  <div className="text-lg font-bold text-emerald-200">Gift card sent! 🎁</div>
                  <p className="mt-1 text-sm text-emerald-100/80">
                    It's on its way to the recipient's email — they can spend it on anything in {data.product.links.creatorName}'s store.
                  </p>
                  {giftIssued.code && (
                    <p className="mt-3 text-sm text-emerald-100/80">
                      The code (shown once): <span className="font-mono font-bold text-emerald-100">{giftIssued.code}</span>
                    </p>
                  )}
                  {giftIssued.note && <p className="mt-2 text-xs text-emerald-100/60">{giftIssued.note}</p>}
                </div>
              ) : paidWithGiftCard ? (
                <div className="mt-6 rounded-2xl border border-emerald-400/40 bg-emerald-400/10 p-5 text-center">
                  <div className="text-lg font-bold text-emerald-200">Paid in full with your gift card 🎉</div>
                  <p className="mt-1 text-sm text-emerald-100/80">No card payment was taken — whatever balance is left stays on your gift card for next time.</p>
                </div>
              ) : isGiftCard ? (
                <div className="mt-6">
                  <div className="flex flex-wrap gap-2">
                    {(data.product.giftCardDenominationsCents ?? []).map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setGiftAmount(c)}
                        className={`rounded-full border px-5 py-2.5 font-bold transition ${
                          (giftAmount ?? data.product.giftCardDenominationsCents?.[0]) === c
                            ? "border-amber-300 bg-amber-400 text-black"
                            : "border-amber-500/30 text-amber-100 hover:bg-amber-500/10"
                        }`}
                      >
                        ${(c / 100).toFixed(0)}
                      </button>
                    ))}
                  </div>
                  <div className="mt-4 grid gap-3">
                    <input
                      value={recipientEmail}
                      onChange={(e) => setRecipientEmail(e.target.value)}
                      type="email"
                      placeholder="Recipient's email — the card is delivered there"
                      aria-label="Recipient email"
                      className="rounded-full border border-amber-500/30 bg-black/60 px-4 py-3 text-sm text-amber-100 outline-none placeholder:text-amber-100/35 focus:border-amber-400"
                    />
                    <input
                      value={recipientName}
                      onChange={(e) => setRecipientName(e.target.value)}
                      placeholder="Recipient's name (optional)"
                      aria-label="Recipient name"
                      className="rounded-full border border-amber-500/30 bg-black/60 px-4 py-3 text-sm text-amber-100 outline-none placeholder:text-amber-100/35 focus:border-amber-400"
                    />
                    <input
                      value={giftMessage}
                      onChange={(e) => setGiftMessage(e.target.value)}
                      placeholder="Add a note (optional)"
                      aria-label="Gift message"
                      className="rounded-full border border-amber-500/30 bg-black/60 px-4 py-3 text-sm text-amber-100 outline-none placeholder:text-amber-100/35 focus:border-amber-400"
                    />
                  </div>
                  {buyError && <p className="mt-3 text-sm font-bold text-red-300">{buyError}</p>}
                  <button
                    onClick={buyNow}
                    disabled={buying}
                    className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-b from-amber-300 to-amber-600 px-6 py-4 text-lg font-bold text-black transition hover:brightness-110 disabled:opacity-60"
                  >
                    {buying ? <Loader2 className="h-5 w-5 animate-spin" /> : <Zap className="h-5 w-5" />}
                    {buying ? "Opening secure checkout…" : user ? "Send this gift card" : "Sign in to send a gift card"}
                  </button>
                </div>
              ) : (
                <>
                  {data.product.bump && (
                    <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-left transition hover:bg-amber-500/10">
                      <input
                        type="checkbox"
                        checked={includeBump}
                        onChange={(e) => setIncludeBump(e.target.checked)}
                        aria-label={`Add ${data.product.bump.title} to this order`}
                        className="mt-1 h-5 w-5 shrink-0 accent-amber-500"
                      />
                      <span className="flex-1">
                        <span className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="text-xs font-bold uppercase tracking-[0.2em] text-amber-400">
                            Add-on — one more from {data.product.links.creatorName}
                          </span>
                          <span className="flex items-baseline gap-2">
                            {data.product.bump.percentOff > 0 && (
                              <span className="text-sm text-amber-100/40 line-through">{data.product.bump.listPrice}</span>
                            )}
                            <span className="text-xl font-bold text-amber-200">{data.product.bump.price}</span>
                          </span>
                        </span>
                        <span className="mt-1 block font-semibold text-amber-100">{data.product.bump.title}</span>
                        <span className="mt-0.5 block text-xs text-amber-100/60">
                          {data.product.bump.percentOff > 0
                            ? `${data.product.bump.percentOff}% off as an add-on — `
                            : ""}
                          tick the box and it's added to this same checkout. One charge, both delivered.
                        </span>
                        {includeBump && (
                          <span className="mt-2 block border-t border-amber-500/15 pt-2 text-sm text-amber-100/80">
                            Total with add-on:{" "}
                            <span className="font-bold text-amber-200">
                              ${((data.product.priceCents * quantity + data.product.bump.priceCents) / 100).toFixed(2)}
                            </span>
                            {discountCode.trim() && (
                              <span className="text-xs text-amber-100/50">
                                {" "}(your code applies to {data.product.title} at checkout)
                              </span>
                            )}
                          </span>
                        )}
                      </span>
                    </label>
                  )}
                  <div className="mt-6 flex flex-wrap items-center gap-3">
                    {/* A course is one unlock per buyer — no quantity picker. */}
                    {data.product.kind !== "course" && (
                    <div className="inline-flex items-center rounded-full border border-amber-500/30">
                      <button
                        type="button"
                        aria-label="One less"
                        onClick={() => setQuantity((q) => clampQuantity(q - 1, data.product.inventory, data.product.unlimited))}
                        className="px-3 py-2 text-amber-200 hover:text-amber-100 disabled:opacity-40"
                        disabled={quantity <= 1}
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                      <span className="min-w-8 text-center font-bold text-amber-100">{quantity}</span>
                      <button
                        type="button"
                        aria-label="One more"
                        onClick={() => setQuantity((q) => clampQuantity(q + 1, data.product.inventory, data.product.unlimited))}
                        className="px-3 py-2 text-amber-200 hover:text-amber-100 disabled:opacity-40"
                        disabled={quantity >= maxQty}
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                    )}
                    <input
                      value={discountCode}
                      onChange={(e) => setDiscountCode(e.target.value)}
                      placeholder="Discount code (optional)"
                      aria-label="Discount code"
                      className="min-w-44 flex-1 rounded-full border border-amber-500/30 bg-black/60 px-4 py-2 text-sm text-amber-100 outline-none placeholder:text-amber-100/50 focus:border-amber-400 focus-visible:ring-2 focus-visible:ring-amber-400/60"
                    />
                  </div>
                  <div className="mt-3">
                    <input
                      value={giftCardCode}
                      onChange={(e) => setGiftCardCode(e.target.value)}
                      placeholder="Gift card code (optional) — BDV-XXXX-XXXX-XXXX-XXXX"
                      aria-label="Gift card code"
                      className="w-full rounded-full border border-amber-500/30 bg-black/60 px-4 py-2 font-mono text-sm text-amber-100 outline-none placeholder:text-amber-100/35 focus:border-amber-400"
                    />
                    <p className="mt-1.5 text-xs text-amber-100/45">
                      Paying with a gift card? It covers what it can and the rest goes on your card — whatever's left stays on the gift card.
                    </p>
                  </div>
                  {buyError && <p className="mt-3 text-sm font-bold text-red-300">{buyError}</p>}
                  <button
                    onClick={buyNow}
                    disabled={buying}
                    className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-b from-amber-300 to-amber-600 px-6 py-4 text-lg font-bold text-black transition hover:brightness-110 disabled:opacity-60"
                  >
                    {buying ? <Loader2 className="h-5 w-5 animate-spin" /> : <Zap className="h-5 w-5" />}
                    {buying ? "Opening secure checkout…" : user ? "Buy it now" : "Sign in to buy"}
                  </button>
                </>
              )}

              <div className="mt-5 flex items-center justify-center gap-2 text-xs text-amber-100/50">
                <ShieldCheck className="h-4 w-4 text-amber-400" />
                Sold by {data.product.links.creatorName} on Bow Down Visuals
              </div>

              {/* #36: a shared product names its co-sellers — the same
                  presented truth the seller sees, shares included. */}
              {data.product.splits && data.product.splits.length > 1 && (
                <div className="mt-2 flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-xs text-amber-100/50">
                  <Users className="h-3.5 w-3.5 text-amber-400" />
                  <span>Sold with</span>
                  {data.product.splits.map((s, i) => (
                    <span key={s.userId}>
                      {i > 0 && <span>{i === data.product.splits!.length - 1 ? " & " : ", "}</span>}
                      {s.slug ? (
                        <Link href={`/artist/${s.slug}`} className="font-semibold text-amber-200/80 transition hover:text-amber-200">
                          {s.name ?? s.slug}
                        </Link>
                      ) : (
                        <span className="font-semibold text-amber-200/80">{s.name ?? "a co-seller"}</span>
                      )}
                      <span className="text-amber-100/40"> · {Number.isInteger(s.sharePct) ? s.sharePct : s.sharePct.toFixed(2)}%</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Verified-purchase reviews docked on the product page itself
            (Stack-100 #3, #14) — summary + list + the buyer's form. */}
        {data && <ProductReviews productType="store_product" productId={data.product.id} />}
        {/* A course's sales page carries its curriculum outline: the
            full structure + drip schedule + free preview, with lesson
            content enforced server-side (never in this page's payload). */}
        {data && data.product.kind === "course" && (
          <CourseOutline productId={data.product.id} />
        )}
      </div>
    </div>
  );
}
