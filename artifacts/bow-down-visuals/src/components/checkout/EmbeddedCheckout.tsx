import { useState } from "react";
import { loadStripe } from "@stripe/stripe-js/pure";
import type { Stripe, StripeElementsOptions } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  EmbeddedCheckout as StripeEmbeddedCheckout,
  EmbeddedCheckoutProvider,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { Loader2, Lock } from "lucide-react";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";

/* ─── Embedded checkout (owner law 2026-10-26: never leave the site) ────
   Two on-page Stripe Elements surfaces, both TEST mode (the server
   refuses live keys) and both themed for light AND dark via the
   Stripe appearance API:

   - <EmbeddedPaymentForm clientSecret onConfirmed /> — PaymentElement
     for one-time credit packs and plan subscriptions. Confirming runs
     stripe.confirmPayment with redirect:"if_required", so the buyer
     stays on this page; the caller then verifies server-side.
   - <EmbeddedSessionCheckout clientSecret /> — Stripe Embedded
     Checkout for the store rail: the server creates the SAME Checkout
     Session as the legacy hosted flow (ui_mode embedded) and this
     mounts its form in place; completion returns to our own
     /store/success page inside the site.

   Stripe.js loads LAZILY via the /pure entry, exactly like
   ExpressPayButton: a blocked Stripe CDN can never break the rest of
   the site, and a missing publishable key renders nothing (callers
   show their own honest error). */

let stripePromise: Promise<Stripe | null> | null = null;
function getStripePromise(): Promise<Stripe | null> {
  if (!stripePromise) {
    stripePromise = loadStripe(
      import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string,
    ).catch(() => null);
  }
  return stripePromise;
}

export function hasStripePublishableKey(): boolean {
  return Boolean(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);
}

/** Appearance for both themes — light is a designed surface too. */
export function stripeAppearance(isLight: boolean): StripeElementsOptions["appearance"] {
  return isLight
    ? {
        theme: "stripe",
        variables: {
          colorPrimary: "#A8871F",
          colorBackground: "#FCF7EA",
          colorText: "#2A1E07",
          colorDanger: "#B3261E",
          borderRadius: "12px",
          fontFamily: "Manrope, system-ui, sans-serif",
        },
      }
    : {
        theme: "night",
        variables: {
          colorPrimary: "#C9A84C",
          colorBackground: "#14100A",
          colorText: "#F5EDD6",
          colorDanger: "#F87171",
          borderRadius: "12px",
          fontFamily: "Manrope, system-ui, sans-serif",
        },
      };
}

/* ── PaymentElement form ─────────────────────────────────────────────── */

function PaymentFormInner({
  submitLabel,
  onConfirmed,
  onError,
}: {
  submitLabel: string;
  onConfirmed: (paymentIntentId: string) => void | Promise<void>;
  onError?: (message: string) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setPaying(true);
    setError(null);
    const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
      confirmParams: {
        // Only used if a payment method forces a redirect (e.g. a bank
        // hop) — it lands back on THIS site, never a Stripe-hosted page.
        return_url: window.location.href,
      },
    });
    if (confirmError) {
      const msg = confirmError.message ?? "Payment failed. Nothing was charged.";
      setError(msg);
      onError?.(msg);
      setPaying(false);
      return;
    }
    if (paymentIntent?.status === "succeeded") {
      await onConfirmed(paymentIntent.id);
      setPaying(false);
      return;
    }
    const msg = "Payment wasn't completed — nothing was charged. Try again.";
    setError(msg);
    onError?.(msg);
    setPaying(false);
  }

  return (
    <form onSubmit={handleSubmit} className="w-full space-y-4" data-testid="embedded-payment-form">
      <PaymentElement options={{ layout: "tabs" }} />
      {error && <p className="text-xs text-red-400 leading-snug">{error}</p>}
      <button
        type="submit"
        disabled={!stripe || !elements || paying}
        className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-b from-amber-200 to-amber-500 py-2.5 text-sm font-black text-black transition hover:brightness-110 disabled:opacity-50"
      >
        {paying ? (
          <><Loader2 className="h-4 w-4 animate-spin" /> Processing…</>
        ) : (
          <><Lock className="h-3.5 w-3.5" /> {submitLabel}</>
        )}
      </button>
      <p className="text-center text-[11px] opacity-50">
        Secure payment by Stripe — your card details never touch our servers, and you never leave this page.
      </p>
    </form>
  );
}

export function EmbeddedPaymentForm({
  clientSecret,
  submitLabel,
  onConfirmed,
  onError,
}: {
  clientSecret: string;
  submitLabel: string;
  onConfirmed: (paymentIntentId: string) => void | Promise<void>;
  onError?: (message: string) => void;
}) {
  const isLight = useIsLightTheme();
  if (!hasStripePublishableKey()) return null;
  return (
    <div
      className={`w-full rounded-2xl border p-4 ${
        isLight
          ? "border-[#C9A84C]/50 bg-[#FCF7EA] text-[#2A1E07]"
          : "border-primary/30 bg-[#14100A] text-white"
      }`}
      data-testid="embedded-payment-panel"
    >
      <Elements
        stripe={getStripePromise()}
        options={{ clientSecret, appearance: stripeAppearance(isLight) }}
      >
        <PaymentFormInner submitLabel={submitLabel} onConfirmed={onConfirmed} onError={onError} />
      </Elements>
    </div>
  );
}

/* ── Embedded Checkout Session (store rail) ──────────────────────────── */

export function EmbeddedSessionCheckout({ clientSecret }: { clientSecret: string }) {
  const isLight = useIsLightTheme();
  if (!hasStripePublishableKey()) return null;
  return (
    <div
      className={`w-full rounded-2xl border p-3 ${
        isLight
          ? "border-[#C9A84C]/50 bg-[#FCF7EA]"
          : "border-primary/30 bg-[#14100A]"
      }`}
      data-testid="embedded-session-checkout"
    >
      <EmbeddedCheckoutProvider stripe={getStripePromise()} options={{ clientSecret }}>
        <StripeEmbeddedCheckout />
      </EmbeddedCheckoutProvider>
    </div>
  );
}
