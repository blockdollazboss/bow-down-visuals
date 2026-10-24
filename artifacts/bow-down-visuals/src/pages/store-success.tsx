import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Loader2, Download, PartyPopper, ReceiptText, Music2, Share2, User, ExternalLink } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { shareDrop } from "@/lib/share-drop";
import { usePageTitle } from "@/hooks/use-page-title";
import {
  acceptUpsell,
  declineUpsell,
  type UpsellOfferDTO,
  type UpsellOrderDTO,
} from "@/lib/storefront-api";

/* ─── /store/success — the "you just got paid" moment (buyer edition) ─────
   Verifies the Stripe session server-side, records the sale idempotently,
   and hands the buyer their instant download link.

   Link graph (no dead ends after payment — the highest-trust moment):
   download · buyer library · creator's profile · the drop page · share. */

interface VerifyResult {
  success: boolean;
  duplicate?: boolean;
  sale: { id: string; itemKind: string; amount: string };
  item: {
    kind: string;
    id: string;
    title: string;
    artistName: string;
    artistSlug: string;
    buyUrl: string;
    artistUrl: string | null;
  };
  /* Downloads carry a link; series purchases carry an unlock instead —
     exactly one of the two is non-null per sale. Bundles carry both
     shapes per component: a download per file item, an unlock per
     series item. */
  download: { token: string; url: string; expiresAt: string; maxUses: number } | null;
  access?: { unlocked: boolean; watchUrl: string } | null;
  bundle?: {
    downloads: {
      itemKind: string;
      itemId: string;
      title: string;
      token: string;
      url: string;
      expiresAt: string;
      maxUses: number;
    }[];
    unlockedSeries: { id: string; title: string; watchUrl: string }[];
  } | null;
}

/* Storefront (Sell Everything) sessions verify on their own rail —
   MOUNT.md §4: /store/verify fails for them, /storefront/verify
   records the order and returns the post-purchase upsell offer. */
interface SfVerifyResult {
  success: boolean;
  duplicate?: boolean;
  order: { id: string; amount: string; fulfillmentNote: string | null };
  delivery: { url: string; expiresAt: string; maxUses: number } | null;
  bumpDelivery: { url: string; expiresAt: string; maxUses: number } | null;
  upsell: UpsellOfferDTO | null;
  links: { productUrl: string | null; creatorUrl: string | null };
}

/* ─── Post-purchase upsell card (Wave 3) ─────────────────────────────
   Shown once, right after payment: the seller's designated add-on at
   its listed price (or their % off), charged in ONE click to the
   card the buyer just paid with. The fee math is on the card — the
   flat 5% comes out of the creator's cut, never on top. Declining
   closes the offer for this order for good. */
function UpsellCard({
  offer,
  getAccessToken,
}: {
  offer: UpsellOfferDTO;
  getAccessToken: () => Promise<string | null>;
}) {
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [accepted, setAccepted] = useState<{
    order: UpsellOrderDTO;
    delivery: { url: string; expiresAt: string; maxUses: number } | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState(false);

  if (gone) return null;

  if (accepted) {
    return (
      <div className="mt-6 rounded-xl border border-emerald-400/40 bg-emerald-400/10 p-4 text-left">
        <p className="font-bold text-emerald-200">Added — “{accepted.order.productTitle}” is yours. 👑</p>
        <p className="mt-1 text-sm text-amber-100/70">
          Charged {accepted.order.amount} to the card you paid with. The creator keeps{" "}
          {accepted.order.creatorAmount} after the {accepted.order.platformFeePct}% platform fee.
        </p>
        {accepted.delivery && (
          <a
            href={accepted.delivery.url}
            className="mt-3 inline-flex items-center gap-2 rounded-full bg-gradient-to-b from-amber-300 to-amber-600 px-5 py-2.5 font-bold text-black hover:brightness-110"
          >
            <Download className="h-4 w-4" /> Download the add-on
          </a>
        )}
        {accepted.order.fulfillmentNote && (
          <p className="mt-2 text-xs text-amber-100/50">{accepted.order.fulfillmentNote}</p>
        )}
      </div>
    );
  }

  async function onAccept() {
    setBusy("accept");
    setError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Sign in again to add this — no charge was made.");
      const r = await acceptUpsell(token, offer.orderId);
      if (!r.order) throw new Error("The add-on couldn't be completed — no charge was made.");
      setAccepted({ order: r.order, delivery: r.delivery });
    } catch (err) {
      setError(err instanceof Error ? err.message : "The add-on couldn't be completed — no charge was made.");
    } finally {
      setBusy(null);
    }
  }

  async function onDecline() {
    setBusy("decline");
    try {
      const token = await getAccessToken();
      if (token) await declineUpsell(token, offer.orderId);
    } catch {
      /* Closing the card is the buyer's act either way; the server
         records the decline when it can. */
    } finally {
      setBusy(null);
      setGone(true);
    }
  }

  return (
    <div className="mt-6 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-left">
      <p className="text-xs font-bold uppercase tracking-wider text-amber-300">One more thing — before you go</p>
      <p className="mt-1 text-lg font-bold text-amber-100">
        Add “{offer.title}” for {offer.price}
        {offer.percentOff > 0 && (
          <span className="ml-2 text-sm font-normal text-amber-100/60">
            <s>{offer.listPrice}</s> · {offer.percentOff}% off
          </span>
        )}
      </p>
      <p className="mt-1 text-sm text-amber-100/70">
        The creator keeps {offer.creatorAmount} after the {offer.platformFeePct}% platform fee — you pay
        exactly {offer.price}, nothing extra.
        {offer.paymentMethod?.last4
          ? ` One click charges your ${offer.paymentMethod.brand ?? "card"} •••• ${offer.paymentMethod.last4} — the card you just paid with.`
          : " One click charges the card you just paid with."}
      </p>
      {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={onAccept}
          disabled={busy !== null}
          className="inline-flex items-center gap-2 rounded-full bg-gradient-to-b from-amber-300 to-amber-600 px-5 py-2.5 font-bold text-black hover:brightness-110 disabled:opacity-60"
        >
          {busy === "accept" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Add it — one click
        </button>
        <button
          onClick={onDecline}
          disabled={busy !== null}
          className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 px-5 py-2.5 text-amber-200 hover:bg-amber-500/10 disabled:opacity-60"
        >
          No thanks
        </button>
      </div>
    </div>
  );
}

export default function StoreSuccess() {
  const isLight = useIsLightTheme();
  usePageTitle("Order Confirmed", "Order confirmed — your purchase details and next steps on Bow Down Visuals.");
  const { getAccessToken } = useAuth();
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [sfResult, setSfResult] = useState<SfVerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shareMsg, setShareMsg] = useState<string | null>(null);

  async function onShare() {
    if (!result) return;
    setShareMsg(null);
    const outcome = await shareDrop({
      title: result.item.title,
      text: `I just copped “${result.item.title}” by ${result.item.artistName} on Bow Down Visuals 👑`,
      url: result.item.buyUrl,
    });
    setShareMsg(outcome === "shared" ? "Shared. 👑" : outcome === "copied" ? "Link copied — spread the word." : null);
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      const sessionId = new URLSearchParams(window.location.search).get("session_id");
      if (!sessionId) {
        if (alive) {
          setState("error");
          setError("No checkout session found. If you paid, your download is in My Music.");
        }
        return;
      }
      try {
        const token = await getAccessToken();
        const headers = {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        };
        const res = await fetch("/api/store/verify", {
          method: "POST",
          headers,
          body: JSON.stringify({ sessionId }),
        });
        const body = (await res.json().catch(() => ({}))) as VerifyResult & { error?: string };
        if (!alive) return;
        if (res.ok && body.success) {
          setResult(body);
          setState("ok");
          return;
        }
        /* Storefront (Sell Everything) sessions aren't digital-store
           sales — verify them on their own rail (MOUNT.md §4), which
           also returns the post-purchase upsell offer. */
        const sfRes = await fetch("/api/storefront/verify", {
          method: "POST",
          headers,
          body: JSON.stringify({ sessionId }),
        });
        const sfBody = (await sfRes.json().catch(() => ({}))) as SfVerifyResult & { error?: string };
        if (!alive) return;
        if (!sfRes.ok || !sfBody.success) {
          throw new Error(sfBody.error || body.error || "Verification failed.");
        }
        setSfResult(sfBody);
        setState("ok");
      } catch (err) {
        if (alive) {
          setState("error");
          setError(err instanceof Error ? err.message : "Verification failed.");
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [getAccessToken]);

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-xl px-4 py-16">
        <div className={`${isLight ? "rounded-2xl border border-amber-500/30 bg-gradient-to-b from-[#F7ECD2] to-[#FCF7EA] p-10 text-center shadow-[0_0_60px_rgba(201,162,39,0.15)]" : "rounded-2xl border border-amber-500/30 bg-gradient-to-b from-[#171204] to-[#0d0a04] p-10 text-center shadow-[0_0_60px_rgba(201,162,39,0.15)]"}`}>
          {state === "loading" && (
            <>
              <Loader2 className="mx-auto h-10 w-10 animate-spin text-amber-400" />
              <h1 className="mt-4 text-2xl font-bold text-amber-200">Locking in your purchase…</h1>
              <p className="mt-2 text-amber-100/60">Confirming payment with Stripe.</p>
            </>
          )}
          {state === "error" && (
            <>
              <div className="text-5xl">😬</div>
              <h1 className="mt-4 text-2xl font-bold text-amber-200">Hmm, that didn't confirm</h1>
              <p className="mt-2 text-amber-100/60">{error}</p>
              <Link
                href="/my-music"
                className="mt-6 inline-flex items-center gap-2 rounded-full bg-gradient-to-b from-amber-300 to-amber-600 px-6 py-3 font-bold text-black hover:brightness-110"
              >
                <Music2 className="h-5 w-5" /> Check My Music
              </Link>
            </>
          )}
          {state === "ok" && result && (
            <>
              <PartyPopper className="mx-auto h-12 w-12 text-amber-300" />
              <h1 className="mt-4 text-3xl font-bold text-amber-200">It's yours. 👑</h1>
              {result.access?.unlocked ? (
                <>
                  <p className="mt-2 text-amber-100/70">
                    Payment confirmed{result.sale.amount ? ` (${result.sale.amount})` : ""} — the full series
                    is unlocked on your account right now. Every episode, anytime. That's the cheat code.
                  </p>
                  <Link
                    href={result.access.watchUrl}
                    className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-b from-amber-300 to-amber-600 px-6 py-4 text-lg font-bold text-black hover:brightness-110"
                  >
                    <PartyPopper className="h-5 w-5" /> Watch the series
                  </Link>
                  <p className="mt-3 text-xs text-amber-100/50">
                    Your unlock lives on the series page and in My Music — no link to lose, no expiry to beat.
                  </p>
                </>
              ) : result.bundle ? (
                <>
                  <p className="mt-2 text-amber-100/70">
                    Payment confirmed{result.sale.amount ? ` (${result.sale.amount})` : ""} — the whole
                    bundle is in your library right now. Every item, one purchase. That's the cheat code.
                  </p>
                  <div className="mt-6 space-y-2 text-left">
                    {result.bundle.downloads.map((d) => (
                      <a
                        key={d.token}
                        href={d.url}
                        className="flex w-full items-center justify-between gap-3 rounded-xl border border-amber-500/30 px-4 py-3 text-amber-200 transition hover:bg-amber-500/10"
                      >
                        <span className="font-semibold">{d.title}</span>
                        <span className="inline-flex shrink-0 items-center gap-1.5 text-sm font-bold text-amber-300">
                          <Download className="h-4 w-4" /> Download
                        </span>
                      </a>
                    ))}
                    {result.bundle.unlockedSeries.map((s) => (
                      <Link
                        key={s.id}
                        href={s.watchUrl}
                        className="flex w-full items-center justify-between gap-3 rounded-xl border border-amber-500/30 px-4 py-3 text-amber-200 transition hover:bg-amber-500/10"
                      >
                        <span className="font-semibold">{s.title}</span>
                        <span className="inline-flex shrink-0 items-center gap-1.5 text-sm font-bold text-amber-300">
                          <PartyPopper className="h-4 w-4" /> Watch the series
                        </span>
                      </Link>
                    ))}
                  </div>
                  <p className="mt-3 text-xs text-amber-100/50">
                    Download links work 5 times · 48 hours at a time · everything re-downloads anytime from My Music
                  </p>
                </>
              ) : result.download ? (
                <>
                  <p className="mt-2 text-amber-100/70">
                    Payment confirmed{result.sale.amount ? ` (${result.sale.amount})` : ""} — your download
                    is ready right now. No waiting rooms. That's the cheat code.
                  </p>
                  <a
                    href={result.download.url}
                    className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-b from-amber-300 to-amber-600 px-6 py-4 text-lg font-bold text-black hover:brightness-110"
                  >
                    <Download className="h-5 w-5" /> Download now
                  </a>
                  <p className="mt-3 text-xs text-amber-100/50">
                    Link works {result.download.maxUses} times · expires{" "}
                    {new Date(result.download.expiresAt).toLocaleString()} · re-download anytime from My Music
                  </p>
                </>
              ) : null}
              {/* Link graph: library · creator profile · drop page · share */}
              <div className="mt-6 grid grid-cols-2 gap-2 text-sm">
                <Link
                  href="/my-music"
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-amber-500/30 px-3 py-2.5 text-amber-200 hover:bg-amber-500/10"
                >
                  <Music2 className="h-4 w-4" /> My Music
                </Link>
                {result.item.artistUrl && (
                  <Link
                    href={result.item.artistUrl}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-amber-500/30 px-3 py-2.5 text-amber-200 hover:bg-amber-500/10"
                  >
                    <User className="h-4 w-4" /> More from {result.item.artistName}
                  </Link>
                )}
                <Link
                  href={result.item.buyUrl}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-amber-500/30 px-3 py-2.5 text-amber-200 hover:bg-amber-500/10"
                >
                  <ExternalLink className="h-4 w-4" /> The drop page
                </Link>
                <button
                  onClick={onShare}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-amber-500/30 px-3 py-2.5 text-amber-200 hover:bg-amber-500/10"
                >
                  <Share2 className="h-4 w-4" /> Share this drop
                </button>
              </div>
              {shareMsg && <p className="mt-2 text-xs text-amber-300">{shareMsg}</p>}
              <div className="mt-4 flex items-center justify-center gap-1.5 text-xs text-amber-100/40">
                <ReceiptText className="h-4 w-4" /> Receipt emailed by Stripe · Bow Down Visuals
              </div>
            </>
          )}
          {state === "ok" && sfResult && (
            <>
              <PartyPopper className="mx-auto h-12 w-12 text-amber-300" />
              <h1 className="mt-4 text-3xl font-bold text-amber-200">It's yours. 👑</h1>
              <p className="mt-2 text-amber-100/70">
                Payment confirmed ({sfResult.order.amount}) — your order is recorded.
                {sfResult.order.fulfillmentNote ? ` ${sfResult.order.fulfillmentNote}` : ""}
              </p>
              {sfResult.delivery && (
                <>
                  <a
                    href={sfResult.delivery.url}
                    className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-b from-amber-300 to-amber-600 px-6 py-4 text-lg font-bold text-black hover:brightness-110"
                  >
                    <Download className="h-5 w-5" /> Download now
                  </a>
                  <p className="mt-3 text-xs text-amber-100/50">
                    Link works {sfResult.delivery.maxUses} times · expires{" "}
                    {new Date(sfResult.delivery.expiresAt).toLocaleString()}
                  </p>
                </>
              )}
              {sfResult.bumpDelivery && (
                <a
                  href={sfResult.bumpDelivery.url}
                  className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-full border border-amber-500/40 px-6 py-3 font-bold text-amber-200 hover:bg-amber-500/10"
                >
                  <Download className="h-5 w-5" /> Download your add-on
                </a>
              )}
              {/* The one-click post-purchase offer — shown once, only
                  while it's pending with a reusable saved card. */}
              {sfResult.upsell && (
                <UpsellCard offer={sfResult.upsell} getAccessToken={getAccessToken} />
              )}
              <div className="mt-6 grid grid-cols-2 gap-2 text-sm">
                {sfResult.links.productUrl && (
                  <Link
                    href={sfResult.links.productUrl}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-amber-500/30 px-3 py-2.5 text-amber-200 hover:bg-amber-500/10"
                  >
                    <ExternalLink className="h-4 w-4" /> Back to the product
                  </Link>
                )}
                {sfResult.links.creatorUrl && (
                  <Link
                    href={sfResult.links.creatorUrl}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-amber-500/30 px-3 py-2.5 text-amber-200 hover:bg-amber-500/10"
                  >
                    <User className="h-4 w-4" /> More from this creator
                  </Link>
                )}
              </div>
              <div className="mt-4 flex items-center justify-center gap-1.5 text-xs text-amber-100/40">
                <ReceiptText className="h-4 w-4" /> Receipt emailed by Stripe · Bow Down Visuals
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
