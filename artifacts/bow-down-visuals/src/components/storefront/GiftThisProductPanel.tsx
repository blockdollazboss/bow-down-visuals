import { useState } from "react";
import { Gift, Loader2, CheckCircle2, CalendarClock } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";

/* ─── Gift-This-Product (Wave-4 #45) ───────────────────────────────────
   The "Send as a gift" panel on the storefront product page. It docks
   beside the normal buy box — no standalone page. The buyer pays with
   Visual Bucs at the product's real listed price (the x100 rule:
   price_cents IS the Visual Bucs price, shown honestly below), picks
   the recipient, an optional message and an optional delivery date.
   The gift is held for the recipient until they claim it in their
   Library; unclaimed value never expires into anyone else's pocket.
   Gift-card products keep their own gift-card checkout and services
   aren't giftable (server says so too — this panel just hides what
   the server would refuse). */

interface GiftThisProductPanelProps {
  productId: string;
  productKind: string;
  priceCents: number;
  quantity: number;
}

export default function GiftThisProductPanel({ productId, productKind, priceCents, quantity }: GiftThisProductPanelProps) {
  const isLight = useIsLightTheme();
  const { user, getAccessToken } = useAuth();
  const [open, setOpen] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [giftMessage, setGiftMessage] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [intentKey] = useState(() => `gift-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);

  if (productKind === "gift_card" || productKind === "service" || priceCents <= 0) return null;

  const totalCredits = priceCents * Math.max(1, quantity);
  const panel = isLight
    ? "border-[#b98a2f]/40 bg-gradient-to-b from-[#F7ECD2] to-[#FCF7EA] text-[#3d2f10]"
    : "border-amber-500/30 bg-gradient-to-b from-[#171204] to-[#0d0a04] text-amber-50";
  const inputCls = isLight
    ? "w-full rounded-lg border border-[#b98a2f]/40 bg-white/70 px-3 py-2 text-sm text-[#3d2f10] placeholder:text-[#3d2f10]/40 focus:outline-none focus:border-[#b98a2f]"
    : "w-full rounded-lg border border-amber-500/25 bg-black/40 px-3 py-2 text-sm text-amber-50 placeholder:text-amber-100/30 focus:outline-none focus:border-amber-400/60";
  const subtle = isLight ? "text-[#3d2f10]/60" : "text-amber-100/50";

  async function sendGift() {
    if (!user) {
      window.location.href = "/login";
      return;
    }
    setSending(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/product-gifts/purchase", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          productId,
          recipientEmail: recipientEmail.trim(),
          quantity: Math.max(1, quantity),
          idempotencyKey: intentKey,
          ...(giftMessage.trim() ? { giftMessage: giftMessage.trim() } : {}),
          ...(deliveryDate ? { deliveryAt: new Date(`${deliveryDate}T09:00:00`).toISOString() } : {}),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { note?: string; message?: string; error?: string };
      if (!res.ok) throw new Error(body.message || body.error || "Could not send this gift.");
      setSent(body.note ?? "Gift sent — it's held for your recipient until they claim it.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send this gift.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className={`mt-4 rounded-2xl border p-5 ${panel}`} data-testid="gift-this-product-panel">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-left font-bold"
        aria-expanded={open}
      >
        <Gift className="h-5 w-5 text-amber-500" />
        Send this as a gift
        <span className={`ml-auto text-xs font-normal ${subtle}`}>{open ? "Hide" : "For someone else"}</span>
      </button>

      {open && (
        <div className="mt-4 space-y-3">
          {sent ? (
            <p className="flex items-start gap-2 text-sm">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> {sent}
            </p>
          ) : (
            <>
              <div>
                <label className={`mb-1 block text-xs font-semibold uppercase tracking-wide ${subtle}`} htmlFor="gift-recipient-email">
                  Recipient&apos;s email
                </label>
                <input
                  id="gift-recipient-email"
                  type="email"
                  value={recipientEmail}
                  onChange={(e) => setRecipientEmail(e.target.value)}
                  placeholder="them@example.com"
                  className={inputCls}
                />
              </div>
              <div>
                <label className={`mb-1 block text-xs font-semibold uppercase tracking-wide ${subtle}`} htmlFor="gift-message">
                  Gift message <span className="normal-case">(optional)</span>
                </label>
                <textarea
                  id="gift-message"
                  value={giftMessage}
                  onChange={(e) => setGiftMessage(e.target.value)}
                  maxLength={500}
                  rows={2}
                  placeholder="Saw this and thought of you."
                  className={inputCls}
                />
              </div>
              <div>
                <label className={`mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide ${subtle}`} htmlFor="gift-delivery-date">
                  <CalendarClock className="h-3.5 w-3.5" /> Delivery date <span className="normal-case">(optional — blank sends now)</span>
                </label>
                <input
                  id="gift-delivery-date"
                  type="date"
                  value={deliveryDate}
                  onChange={(e) => setDeliveryDate(e.target.value)}
                  className={inputCls}
                />
              </div>
              <p className={`text-xs ${subtle}`}>
                You pay <strong>{totalCredits.toLocaleString()} Visual Bucs</strong> — this product&apos;s real listed price
                (${(priceCents / 100).toFixed(2)}{quantity > 1 ? ` × ${quantity}` : ""}). No markup, no extra gift fee.
                Your recipient claims it free in their Library; if they never claim, the value stays held as their
                claimable credit — it&apos;s never kept by the store.
              </p>
              {error && <p className="text-sm text-red-500">{error}</p>}
              <button
                type="button"
                onClick={sendGift}
                disabled={sending || !recipientEmail.trim()}
                className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-amber-500 px-5 py-2.5 text-sm font-bold text-black transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gift className="h-4 w-4" />}
                {user ? `Send gift — ${totalCredits.toLocaleString()} Visual Bucs` : "Sign in to send a gift"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
