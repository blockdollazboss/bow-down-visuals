import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { Gift, Loader2, BadgeCheck, Search } from "lucide-react";
import { loadStripe } from "@stripe/stripe-js/pure";
import { useAuth } from "@/contexts/AuthContext";
import { loginPathWithNext } from "@/lib/auth-next";

/* ─── Gift a membership ──────────────────────────────────────────────────
   Docks on /creator-pricing under the plan cards (the upgrade path's
   home — a gift IS an upgrade, for someone else). Checkout is Stripe
   Embedded Checkout mounted on THIS page: the buyer never leaves
   bowdownvisuals.com. Lifecycle truth, stated before payment and on
   every receipt: a gift is a one-time payment — it does not
   auto-renew, no card is charged again, and when the gifted period
   ends the recipient glides back to Free unless they subscribe.
   Collision truth: gifts queue behind an active gift (no time lost)
   and run alongside the recipient's own plan (higher tier wins).   */

const NO_RENEW_COPY =
  "A gift is a one-time payment — it does not auto-renew and no card is charged again. When the gifted period ends, the recipient glides back to Free unless they subscribe on their own.";
const COLLISION_COPY =
  "If they already have this tier from another gift, your gift queues up and starts when that gift ends — no paid time is lost. If they pay for their own plan, the gift runs alongside it and they always keep the higher tier.";

interface GiftRow {
  id: string;
  tier: string;
  months: number;
  amountCents: number | null;
  periodStart: string;
  periodEnd: string;
  displayStatus: string;
  counterpartyName: string;
  counterpartySlug: string;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString();
}

export default function GiftMembership({ isLight }: { isLight: boolean }) {
  const { user, getAccessToken } = useAuth();
  const [lookup, setLookup] = useState("");
  const [tier, setTier] = useState<"pro" | "elite">("pro");
  const [months, setMonths] = useState(1);
  const [preview, setPreview] = useState<{ displayName: string; slug: string } | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sent, setSent] = useState<GiftRow[]>([]);
  const [received, setReceived] = useState<GiftRow[]>([]);
  const checkoutRef = useRef<HTMLDivElement>(null);
  const verifyRan = useRef(false);

  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const token = await getAccessToken();
    return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  }, [getAccessToken]);

  const loadMine = useCallback(async () => {
    if (!user) return;
    try {
      const res = await fetch("/api/membership-gifts/mine", { headers: await authHeaders() });
      if (res.ok) {
        const data = await res.json();
        setSent(data.sent ?? []);
        setReceived(data.received ?? []);
      }
    } catch { /* gift desk is additive — a load failure never breaks pricing */ }
  }, [user, authHeaders]);

  useEffect(() => { void loadMine(); }, [loadMine]);

  /* Embedded-checkout return: ?gift=return&session_id=… → verify once
     (the webhook is the other door; both claim on the session id, so
     this can never double-grant). */
  useEffect(() => {
    if (!user || verifyRan.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("gift") !== "return") return;
    const sessionId = params.get("session_id");
    if (!sessionId) return;
    verifyRan.current = true;
    (async () => {
      try {
        const res = await fetch("/api/membership-gifts/verify", {
          method: "POST",
          headers: await authHeaders(),
          body: JSON.stringify({ sessionId }),
        });
        const data = await res.json();
        if (res.ok && data.success) {
          setNotice(
            data.duplicate
              ? "That gift was already granted — the receipt below is the original. It was not charged or granted twice."
              : `Gift granted — ${data.receipt.tier === "elite" ? "Elite" : "Pro"} until ${fmtDate(data.receipt.periodEnd)}. ${NO_RENEW_COPY}`,
          );
          void loadMine();
        } else if (!res.ok) {
          setError(data.error ?? "Payment went through but the gift is still landing — check below in a few minutes.");
        }
      } catch {
        setError("Payment went through but we couldn't confirm the gift yet — it lands automatically via our payment webhook.");
      }
    })();
  }, [user, authHeaders, loadMine]);

  /* Mount the embedded checkout on this page when a session exists. */
  useEffect(() => {
    if (!clientSecret || !checkoutRef.current) return;
    let embedded: { destroy: () => void } | null = null;
    let cancelled = false;
    (async () => {
      const publishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined;
      if (!publishableKey) {
        setError("Payments aren't configured on this device yet — the publishable key is missing.");
        return;
      }
      const stripe = await loadStripe(publishableKey);
      if (!stripe || cancelled) return;
      embedded = await stripe.initEmbeddedCheckout({ clientSecret });
      if (cancelled) { embedded.destroy(); return; }
      embedded.mount(checkoutRef.current!);
    })();
    return () => {
      cancelled = true;
      embedded?.destroy();
    };
  }, [clientSecret]);

  async function previewRecipient() {
    if (!lookup.trim()) return;
    setBusy(true);
    setError(null);
    setPreview(null);
    try {
      const res = await fetch(`/api/membership-gifts/recipient?lookup=${encodeURIComponent(lookup.trim())}`, {
        headers: await authHeaders(),
      });
      const data = await res.json();
      if (res.ok) setPreview(data.recipient);
      else setError(data.message ?? data.error ?? "We couldn't find that creator.");
    } catch {
      setError("Network hiccup — try again.");
    } finally {
      setBusy(false);
    }
  }

  async function startCheckout() {
    if (!user) {
      window.location.href = loginPathWithNext("/creator-pricing");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/membership-gifts/checkout", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ recipient: lookup.trim(), tier, months, returnTo: "/creator-pricing" }),
      });
      const data = await res.json();
      if (res.ok && data.clientSecret) {
        setPreview({ displayName: data.recipient.displayName, slug: data.recipient.slug });
        setClientSecret(data.clientSecret);
      } else {
        setError(data.message ?? data.error ?? "Checkout didn't start. Try again in a minute.");
      }
    } catch {
      setError("Network hiccup — try again.");
    } finally {
      setBusy(false);
    }
  }

  const cardCls = isLight
    ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3] text-[#2A1E07]"
    : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]";
  const inputCls = isLight
    ? "border-[#C9A84C]/50 bg-white/70 text-[#2A1E07] placeholder:text-[#6B5B36]/60"
    : "border-white/15 bg-black/40 text-white placeholder:text-white/35";

  return (
    <section id="gift-membership" className={`mt-12 rounded-3xl border p-6 sm:p-8 ${cardCls}`}>
      <h2 className="text-2xl font-black">
        <Gift className={`mr-2 inline h-6 w-6 ${isLight ? "text-[#7A5A12]" : "text-amber-300"}`} />
        Gift a membership
      </h2>
      <p className="mt-2 max-w-2xl text-sm text-white/55">
        Send Pro or Elite to another creator — by their @handle or the email on their account.
        You pay once, right here on this page. They hold the tier for the gifted period and get a
        notification naming you.
      </p>
      <p className="mt-2 max-w-2xl text-sm text-white/55">{NO_RENEW_COPY}</p>
      <p className="mt-1 max-w-2xl text-sm text-white/55">{COLLISION_COPY}</p>

      {!user ? (
        <p className="mt-5 text-sm">
          <Link href={loginPathWithNext("/creator-pricing")} className={`font-bold ${isLight ? "text-[#7A5A12]" : "text-amber-300"}`}>
            Sign in to gift a membership →
          </Link>
        </p>
      ) : (
        <>
          <div className="mt-5 flex flex-wrap items-end gap-3">
            <label className="min-w-56 flex-1">
              <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-white/45">Recipient — @handle or email</span>
              <input
                value={lookup}
                onChange={(e) => { setLookup(e.target.value); setPreview(null); setClientSecret(null); }}
                placeholder="@their-handle or them@email.com"
                className={`w-full rounded-xl border px-4 py-2.5 text-sm outline-none ${inputCls}`}
              />
            </label>
            <label>
              <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-white/45">Tier</span>
              <select value={tier} onChange={(e) => setTier(e.target.value as "pro" | "elite")} className={`rounded-xl border px-3 py-2.5 text-sm ${inputCls}`}>
                <option value="pro">Pro — $12/mo</option>
                <option value="elite">Elite — $29/mo</option>
              </select>
            </label>
            <label>
              <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-white/45">Months</span>
              <select value={months} onChange={(e) => setMonths(Number(e.target.value))} className={`rounded-xl border px-3 py-2.5 text-sm ${inputCls}`}>
                {[1, 2, 3, 6, 12].map((m) => (
                  <option key={m} value={m}>{m} month{m === 1 ? "" : "s"} — ${(tier === "elite" ? 29 : 12) * m}</option>
                ))}
              </select>
            </label>
            <button
              onClick={previewRecipient}
              disabled={busy || !lookup.trim()}
              className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-2.5 text-sm font-bold disabled:opacity-50 ${isLight ? "border-[#C9A84C]/60 text-[#2A1E07]" : "border-white/25 text-white"}`}
            >
              <Search className="h-4 w-4" /> Find them
            </button>
            <button
              onClick={startCheckout}
              disabled={busy || !lookup.trim()}
              className="rounded-full bg-gradient-to-b from-amber-200 to-amber-500 px-5 py-2.5 text-sm font-black text-black transition hover:brightness-110 disabled:opacity-50"
            >
              {busy ? <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Working…</span> : `Gift ${tier === "elite" ? "Elite" : "Pro"} — $${(tier === "elite" ? 29 : 12) * months}`}
            </button>
          </div>

          {preview && (
            <p className="mt-3 text-sm text-white/70">
              Gifting to <strong className="text-white">{preview.displayName}</strong> (@{preview.slug}) — check that's the right person before you pay.
            </p>
          )}
          {notice && (
            <div className="mt-4 rounded-xl border border-emerald-400/40 bg-emerald-400/10 p-4 text-sm text-emerald-200">
              <BadgeCheck className="mr-1.5 inline h-4 w-4" /> {notice}
            </div>
          )}
          {error && (
            <div className="mt-4 rounded-xl border border-red-400/40 bg-red-400/10 p-4 text-sm text-red-200">{error}</div>
          )}
          {clientSecret && (
            <div className="mt-5 rounded-2xl bg-white p-2">
              <div ref={checkoutRef} />
            </div>
          )}

          {(sent.length > 0 || received.length > 0) && (
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div>
                <h3 className="text-sm font-black uppercase tracking-wider text-white/50">Gifts you sent — your receipts</h3>
                <ul className="mt-2 space-y-2">
                  {sent.map((g) => (
                    <li key={g.id} className={`rounded-xl border p-3 text-sm ${isLight ? "border-[#C9A84C]/30 bg-[#FBF6E9]" : "border-white/10 bg-black/40"}`}>
                      <strong>{g.tier === "elite" ? "Elite" : "Pro"}</strong> × {g.months}mo for {g.counterpartyName} (@{g.counterpartySlug})
                      {g.amountCents != null ? ` — $${(g.amountCents / 100).toFixed(2)}` : ""}<br />
                      <span className="text-white/50">{g.displayStatus} · {fmtDate(g.periodStart)} → {fmtDate(g.periodEnd)} · one-time payment, does not auto-renew</span>
                    </li>
                  ))}
                  {sent.length === 0 && <li className="text-sm text-white/40">No gifts sent yet.</li>}
                </ul>
              </div>
              <div>
                <h3 className="text-sm font-black uppercase tracking-wider text-white/50">Gifts you received</h3>
                <ul className="mt-2 space-y-2">
                  {received.map((g) => (
                    <li key={g.id} className={`rounded-xl border p-3 text-sm ${isLight ? "border-[#C9A84C]/30 bg-[#FBF6E9]" : "border-white/10 bg-black/40"}`}>
                      <strong>{g.tier === "elite" ? "Elite" : "Pro"}</strong> × {g.months}mo from {g.counterpartyName || "a member"}<br />
                      <span className="text-white/50">{g.displayStatus} · {fmtDate(g.periodStart)} → {fmtDate(g.periodEnd)} · when it ends you glide back to Free unless you subscribe — no card is ever charged</span>
                    </li>
                  ))}
                  {received.length === 0 && <li className="text-sm text-white/40">No gifts received yet.</li>}
                </ul>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
