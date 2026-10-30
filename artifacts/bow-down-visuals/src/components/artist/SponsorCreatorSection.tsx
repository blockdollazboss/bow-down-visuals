import { apiErrorMessage, plainErrorText } from "../../lib/api-error";
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { loadStripe } from "@stripe/stripe-js/pure";
import type { Stripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { Handshake, Loader2, ShieldCheck, CheckCircle2, AlertTriangle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { sponsorSplitPreview } from "@/lib/sponsors";

/* ─── Sponsor this creator — /artist/:slug ─────────────────────────────────
   Direct profile sponsorship (payfix sponsor-purchase lane). A signed-in
   visitor sponsors THIS creator at an amount THEY choose — the platform
   sets no sponsor price (none exists in the codebase) — and sees the
   exact price + split BEFORE paying: the sponsor rail's fee constant
   (SPONSOR_PLATFORM_FEE_BPS, 1500 = 15% platform / 85% creator by
   default) comes from the server quote, never hardcoded here.

   Money rides the existing sponsor escrow: create the deal, fund it
   ON-SITE (Stripe TEST PaymentIntent confirmed in this page via
   Stripe.js — the Express Pay pattern; sandbox fund/confirm when no
   Stripe key is configured), creator starts + delivers, sponsor
   releases. The creator sees it in their sponsor dashboard from the
   moment it is created; funded sponsors are recognised right here. */

interface SponsorQuote {
  creator: { slug: string; displayName: string; vertical: string };
  isSelf: boolean;
  feeBps: number;
  feePct: number;
  creatorPct: number;
  sponsors: { brandName: string; amountCents: number | null; escrowStatus: string; status: string; createdAt: string }[];
}

interface Split {
  grossCents: number;
  feeCents: number;
  netCents: number;
  feeBps: number;
  feePct: number;
  creatorPct: number;
}

function money(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* Stripe.js loads lazily, only when a card step actually mounts (same
   discipline as ExpressPayButton — a blocked CDN must never break the
   profile page around it). */
let stripePromise: Promise<Stripe | null> | null = null;
function getStripePromise(): Promise<Stripe | null> {
  if (!stripePromise) {
    stripePromise = loadStripe(
      import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string,
    ).catch(() => null);
  }
  return stripePromise;
}

function CardStep({
  dealId,
  amountCents,
  onFunded,
  onError,
}: {
  dealId: string;
  amountCents: number;
  onFunded: () => void;
  onError: (message: string) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const { getAccessToken } = useAuth();
  const [paying, setPaying] = useState(false);

  async function pay() {
    if (!stripe || !elements) return;
    setPaying(true);
    try {
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: window.location.href },
        redirect: "if_required",
      });
      if (error) {
        onError(error.message || "That card didn't go through — try again.");
        return;
      }
      if (!paymentIntent || paymentIntent.status !== "succeeded") {
        onError("Payment didn't complete — no charge was settled. Try again.");
        return;
      }
      const token = await getAccessToken();
      const res = await fetch("/api/sponsors/escrow/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ dealId, paymentIntentId: paymentIntent.id }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        onError(data.error || "Your payment went through but settling the escrow failed — it reconciles automatically; check your sponsor dashboard.");
        return;
      }
      onFunded();
    } catch {
      onError("Something went wrong confirming that payment — check your sponsor dashboard before trying again.");
    } finally {
      setPaying(false);
    }
  }

  return (
    <div className="space-y-3">
      <PaymentElement />
      <button
        type="button"
        onClick={() => void pay()}
        disabled={!stripe || !elements || paying}
        className="flex w-full items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold transition hover:scale-[1.02] disabled:opacity-50"
        style={{ backgroundColor: "var(--ap-primary)", color: "#000" }}
        data-testid="sponsor-pay-button"
      >
        {paying ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
        Pay {money(amountCents)} into escrow
      </button>
    </div>
  );
}

export default function SponsorCreatorSection({
  slug,
  displayName,
}: {
  slug: string;
  displayName: string;
}) {
  const { user, getAccessToken } = useAuth();
  const [quote, setQuote] = useState<SponsorQuote | null>(null);
  const [quoteError, setQuoteError] = useState(false);
  const [brandName, setBrandName] = useState("");
  const [amountDollars, setAmountDollars] = useState("");
  const [deliverables, setDeliverables] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dealId, setDealId] = useState<string | null>(null);
  const [serverSplit, setServerSplit] = useState<Split | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [funded, setFunded] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch(`/api/sponsors/creator/${encodeURIComponent(slug)}`, {
          headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        });
        if (!res.ok) throw new Error("quote failed");
        const data = (await res.json()) as SponsorQuote;
        if (!cancelled) setQuote(data);
      } catch {
        if (!cancelled) setQuoteError(true);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, slug, reloadNonce, funded]);

  const amountCents = useMemo(() => {
    const n = Number(amountDollars);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.round(n * 100);
  }, [amountDollars]);

  const preview = useMemo(
    () => (quote && amountCents > 0 ? sponsorSplitPreview(amountCents, quote.feeBps) : null),
    [quote, amountCents],
  );

  async function authedFetch(path: string, init: RequestInit = {}) {
    const token = await getAccessToken();
    const res = await fetch(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: string };
    if (!res.ok) throw new Error(apiErrorMessage(data, "Something went wrong — try again."));
    return data;
  }

  async function startSponsorship() {
    setError(null);
    if (amountCents < 100) { setError("Sponsorships start at $1."); return; }
    if (!brandName.trim()) { setError("Tell the creator who is sponsoring them (your name or brand)."); return; }
    if (!deliverables.trim()) { setError("Say what this sponsorship covers."); return; }
    setBusy(true);
    try {
      const created = await authedFetch(`/api/sponsors/creator/${encodeURIComponent(slug)}`, {
        method: "POST",
        body: JSON.stringify({
          amountCents,
          brandName: brandName.trim(),
          deliverables: deliverables.trim(),
          message: message.trim(),
        }),
      });
      const deal = created.deal as { id: string } | null;
      if (!deal?.id) throw new Error("The sponsorship didn't come back — try again.");
      setDealId(deal.id);
      setServerSplit(created.split as Split);

      const intent = await authedFetch(`/api/sponsors/deals/${deal.id}/fund-intent`, { method: "POST", body: "{}" });
      if (intent.sandbox) {
        /* Sandbox mode (no Stripe keys): the existing fund + confirm
           pair simulates the same escrow movement, still on-site. */
        const fund = await authedFetch(`/api/sponsors/deals/${deal.id}/fund`, {
          method: "POST",
          body: JSON.stringify({ amountCents }),
        });
        await authedFetch("/api/sponsors/escrow/confirm", {
          method: "POST",
          body: JSON.stringify({ dealId: deal.id, sessionId: fund.sessionId }),
        });
        setFunded(true);
      } else if (typeof intent.clientSecret === "string") {
        setClientSecret(intent.clientSecret);
      } else {
        throw new Error("Card payment isn't available right now — try again shortly.");
      }
    } catch (err) {
      setError(plainErrorText(err, "Something went wrong — try again."));
    } finally {
      setBusy(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    backgroundColor: "var(--ap-card)",
    borderColor: "var(--ap-border)",
    color: "var(--ap-text)",
  };

  return (
    <section className="mx-auto w-full max-w-2xl px-4 pb-6" data-testid="sponsor-creator-section">
      <div
        className="rounded-2xl border p-5"
        style={{ backgroundColor: "var(--ap-surface)", borderColor: "var(--ap-border)" }}
      >
        <h2
          className="flex items-center gap-2 text-lg font-black"
          style={{ color: "var(--ap-text)", fontFamily: "var(--ap-heading-font)" }}
        >
          <Handshake className="h-5 w-5" style={{ color: "var(--ap-primary)" }} />
          Sponsor {displayName}
        </h2>

        {/* Public recognition — only sponsors whose escrow actually funded. */}
        {quote && quote.sponsors.length > 0 && (
          <div className="mt-3 space-y-1.5" data-testid="sponsor-recognition">
            {quote.sponsors.map((s, i) => (
              <p key={i} className="text-sm" style={{ color: "var(--ap-muted)" }}>
                <strong style={{ color: "var(--ap-text)" }}>{s.brandName}</strong>
                {" · "}{money(s.amountCents)} sponsorship
                {" · "}{new Date(s.createdAt).toLocaleDateString()}
              </p>
            ))}
          </div>
        )}

        {!user ? (
          <div className="mt-3">
            <p className="text-sm" style={{ color: "var(--ap-muted)" }}>
              Put your name behind {displayName} — funds are held in escrow until they deliver.
            </p>
            <Link
              href={`/login?next=/artist/${encodeURIComponent(slug)}`}
              className="mt-3 inline-flex items-center gap-1.5 rounded-full px-5 py-2 text-sm font-bold transition hover:scale-105"
              style={{ backgroundColor: "var(--ap-primary)", color: "#000" }}
              data-testid="sponsor-signin"
            >
              Sign in to sponsor
            </Link>
          </div>
        ) : quoteError ? (
          <p className="mt-3 flex items-center gap-2 text-sm" style={{ color: "var(--ap-muted)" }}>
            <AlertTriangle className="h-4 w-4" /> Sponsorship couldn't load right now.
            <button type="button" className="underline" onClick={() => { setQuoteError(false); setReloadNonce((n) => n + 1); }}>
              Try again
            </button>
          </p>
        ) : !quote ? (
          <p className="mt-3 flex items-center gap-2 text-sm" style={{ color: "var(--ap-muted)" }}>
            <Loader2 className="h-4 w-4 animate-spin" /> Loading sponsorship…
          </p>
        ) : quote.isSelf ? (
          <p className="mt-3 text-sm" style={{ color: "var(--ap-muted)" }}>
            This is your page — sponsorships of you land in your{" "}
            <Link href="/sponsors/dashboard" className="underline">sponsor dashboard</Link>.
          </p>
        ) : funded ? (
          <div className="mt-3" data-testid="sponsor-funded">
            <p className="flex items-center gap-2 text-sm font-bold" style={{ color: "var(--ap-text)" }}>
              <CheckCircle2 className="h-5 w-5 text-emerald-400" />
              Sponsorship funded — {money(serverSplit?.grossCents ?? amountCents)} is held in escrow.
            </p>
            <p className="mt-1 text-sm" style={{ color: "var(--ap-muted)" }}>
              {displayName} keeps {money(serverSplit?.netCents)} when you release payment after they deliver;
              the platform fee is {money(serverSplit?.feeCents)} ({serverSplit?.feePct ?? quote.feePct}%).
              Track it in your <Link href="/sponsors/dashboard" className="underline">sponsor dashboard</Link>
              {dealId && <> or on the <Link href={`/sponsors/${dealId}`} className="underline">deal page</Link></>}.
            </p>
          </div>
        ) : clientSecret && dealId ? (
          <div className="mt-4 space-y-3">
            <p className="text-sm" style={{ color: "var(--ap-muted)" }}>
              One step left — pay into escrow without leaving this page. You release the money
              only after {displayName} delivers.
            </p>
            {serverSplit && (
              <p className="text-sm" style={{ color: "var(--ap-text)" }}>
                You pay <strong>{money(serverSplit.grossCents)}</strong> · {displayName} keeps{" "}
                <strong>{money(serverSplit.netCents)}</strong> ({serverSplit.creatorPct}%) · platform fee{" "}
                {money(serverSplit.feeCents)} ({serverSplit.feePct}%)
              </p>
            )}
            {error && <p className="text-sm text-red-400">{error}</p>}
            <Elements stripe={getStripePromise()} options={{ clientSecret }}>
              <CardStep
                dealId={dealId}
                amountCents={serverSplit?.grossCents ?? amountCents}
                onFunded={() => setFunded(true)}
                onError={setError}
              />
            </Elements>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <p className="text-sm" style={{ color: "var(--ap-muted)" }}>
              You set the amount. It sits in escrow until {displayName} delivers, then you release it —
              they keep {quote.creatorPct}%, the platform fee is {quote.feePct}%.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-bold uppercase tracking-wider" style={{ color: "var(--ap-muted)" }}>
                Your name / brand
                <input
                  value={brandName}
                  onChange={(e) => setBrandName(e.target.value)}
                  maxLength={120}
                  placeholder="e.g. Volt Energy"
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm normal-case tracking-normal outline-none"
                  style={inputStyle}
                  data-testid="sponsor-brand-name"
                />
              </label>
              <label className="block text-xs font-bold uppercase tracking-wider" style={{ color: "var(--ap-muted)" }}>
                Amount (USD)
                <input
                  value={amountDollars}
                  onChange={(e) => setAmountDollars(e.target.value)}
                  inputMode="decimal"
                  placeholder="250"
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm normal-case tracking-normal outline-none"
                  style={inputStyle}
                  data-testid="sponsor-amount"
                />
              </label>
            </div>
            <label className="block text-xs font-bold uppercase tracking-wider" style={{ color: "var(--ap-muted)" }}>
              What this sponsorship covers
              <input
                value={deliverables}
                onChange={(e) => setDeliverables(e.target.value)}
                maxLength={500}
                placeholder="Logo on stream + one shoutout post"
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm normal-case tracking-normal outline-none"
                style={inputStyle}
                data-testid="sponsor-deliverables"
              />
            </label>
            <label className="block text-xs font-bold uppercase tracking-wider" style={{ color: "var(--ap-muted)" }}>
              Message (optional)
              <input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={2000}
                placeholder="Why you're backing them"
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm normal-case tracking-normal outline-none"
                style={inputStyle}
              />
            </label>
            {preview && (
              <p className="text-sm" data-testid="sponsor-split-preview" style={{ color: "var(--ap-text)" }}>
                You pay <strong>{money(amountCents)}</strong> · {displayName} keeps{" "}
                <strong>{money(preview.netCents)}</strong> ({quote.creatorPct}%) · platform fee{" "}
                {money(preview.feeCents)} ({quote.feePct}%)
              </p>
            )}
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button
              type="button"
              onClick={() => void startSponsorship()}
              disabled={busy}
              className="flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold transition hover:scale-105 disabled:opacity-50"
              style={{ backgroundColor: "var(--ap-primary)", color: "#000" }}
              data-testid="sponsor-start-button"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Handshake className="h-4 w-4" />}
              Sponsor {displayName}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
