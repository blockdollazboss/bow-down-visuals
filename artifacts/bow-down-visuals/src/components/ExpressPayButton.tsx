import { useState, useEffect, useCallback } from "react";
import { loadStripe, type Stripe, type PaymentRequest } from "@stripe/stripe-js";
import {
  Elements,
  PaymentRequestButtonElement,
  useStripe,
} from "@stripe/react-stripe-js";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

/* Apple Pay / Google Pay via Stripe Payment Request Button.
   Proper flow: PaymentIntent is created server-side (pack-keyed, amount
   resolved from the Stripe Price), confirmed with stripe.confirmCardPayment,
   then fulfilled via /api/payments/express/verify which credits Visual Bucs.
   The button only renders when the device supports Apple Pay / Google Pay. */

const stripePromise = loadStripe(
  import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string
);

type ExpressPayResult = {
  added: number;
  pack: string;
  credits?: number;
  duplicate?: boolean;
};

function ExpressPayInner({
  packKey,
  onSuccess,
  onError,
}: {
  packKey: string;
  onSuccess: (result: ExpressPayResult) => void;
  onError?: (message: string) => void;
}) {
  const stripe = useStripe();
  const { getAccessToken } = useAuth();
  const [paymentRequest, setPaymentRequest] = useState<PaymentRequest | null>(null);
  const [canPay, setCanPay] = useState(false);
  const [checking, setChecking] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [intent, setIntent] = useState<{
    clientSecret: string;
    paymentIntentId: string;
    amount: number;
    currency: string;
    label: string;
  } | null>(null);

  const fail = useCallback(
    (message: string) => {
      setError(message);
      onError?.(message);
      setProcessing(false);
    },
    [onError]
  );

  useEffect(() => {
    if (!stripe) return;
    let cancelled = false;

    (async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/payments/express", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ pack: packKey }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok || !data.success || !data.clientSecret) {
          setChecking(false);
          return;
        }
        setIntent({
          clientSecret: data.clientSecret,
          paymentIntentId: data.paymentIntentId,
          amount: data.amount,
          currency: data.currency ?? "usd",
          label: data.label,
        });

        const pr = stripe.paymentRequest({
          country: "US",
          currency: (data.currency ?? "usd").toLowerCase(),
          total: { label: data.label, amount: data.amount },
          requestPayerEmail: true,
        });

        const result = await pr.canMakePayment();
        if (cancelled) return;
        if (result) {
          pr.on("paymentmethod", async (ev) => {
            setProcessing(true);
            setError(null);
            try {
              // Confirm the PaymentIntent with the wallet payment method
              const { error: confirmError, paymentIntent } =
                await stripe.confirmCardPayment(data.clientSecret, {
                  payment_method: ev.paymentMethod.id,
                });

              if (confirmError) {
                ev.complete("fail");
                fail(confirmError.message ?? "Payment failed");
                return;
              }

              if (paymentIntent?.status !== "succeeded") {
                ev.complete("fail");
                fail("Payment was not completed.");
                return;
              }

              ev.complete("success");

              // Fulfill: verify server-side and credit Visual Bucs
              const vToken = await getAccessToken();
              const vRes = await fetch("/api/payments/express/verify", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  ...(vToken ? { Authorization: `Bearer ${vToken}` } : {}),
                },
                body: JSON.stringify({ paymentIntentId: paymentIntent.id }),
              });
              const vData = await vRes.json();
              if (!vRes.ok || !vData.success) {
                fail(
                  vData.error ??
                    "Payment succeeded but credits could not be applied. Contact support."
                );
                return;
              }
              setProcessing(false);
              onSuccess(vData);
            } catch (e) {
              ev.complete("fail");
              fail(e instanceof Error ? e.message : "Payment failed");
            }
          });

          setPaymentRequest(pr);
          setCanPay(true);
        }
      } catch {
        // Network or Stripe.js failure — silently hide express pay
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [stripe, packKey, getAccessToken, onSuccess, fail]);

  if (checking) {
    return (
      <div className="flex items-center justify-center py-2">
        <Loader2 className="h-4 w-4 animate-spin text-white/40" />
      </div>
    );
  }

  if (!canPay || !paymentRequest) return null;

  return (
    <div className="w-full">
      <PaymentRequestButtonElement
        options={{
          paymentRequest,
          style: { paymentRequestButton: { theme: "dark", height: "44px" } },
        }}
      />
      {processing && (
        <p className="text-xs text-white/50 text-center mt-2 flex items-center justify-center gap-2">
          <Loader2 className="h-3 w-3 animate-spin" /> Confirming payment…
        </p>
      )}
      {error && (
        <p className="text-red-400 text-xs mt-2 text-center">{error}</p>
      )}
    </div>
  );
}

export function ExpressPayButton({
  packKey,
  onSuccess,
  onError,
}: {
  packKey: string;
  onSuccess: (result: ExpressPayResult) => void;
  onError?: (message: string) => void;
}) {
  const publishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as
    | string
    | undefined;
  if (!publishableKey) return null;
  return (
    <Elements stripe={stripePromise}>
      <ExpressPayInner
        packKey={packKey}
        onSuccess={onSuccess}
        onError={onError}
      />
    </Elements>
  );
}
