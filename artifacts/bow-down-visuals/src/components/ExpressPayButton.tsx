import { useState } from "react";
import { Wallet, Loader2 } from "lucide-react";

/* Apple Pay / Google Pay via Payment Request API.
   Shows the native payment sheet on supported devices/browsers. */
export function ExpressPayButton({
  amount,
  label,
  onSuccess,
}: {
  amount: number; // in cents
  label: string;
  onSuccess: (paymentData: any) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supported =
    typeof window !== "undefined" && "PaymentRequest" in window;

  if (!supported) return null;

  const pay = async () => {
    setLoading(true);
    setError(null);
    try {
      const request = new PaymentRequest(
        [
          {
            supportedMethods: "basic-card",
            data: {
              supportedNetworks: ["visa", "mastercard", "amex"],
            },
          },
        ],
        {
          total: {
            label,
            amount: { currency: "USD", value: (amount / 100).toFixed(2) },
          },
        },
        {
          requestPayerEmail: true,
        }
      );

      const canPay = await request.canMakePayment();
      if (!canPay) {
        setError("No payment method available on this device");
        setLoading(false);
        return;
      }

      const response = await request.show();
      // Send to backend for processing
      const res = await fetch("/api/payments/express", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount,
          label,
          paymentData: response.details,
          payerEmail: (response as any).payerEmail,
        }),
      });
      const data = await res.json();

      if (data.success) {
        await response.complete("success");
        onSuccess(data);
      } else {
        await response.complete("fail");
        setError(data.error ?? "Payment failed");
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        // User cancelled - not an error
      } else {
        setError(err instanceof Error ? err.message : "Payment failed");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full">
      <button
        onClick={pay}
        disabled={loading}
        className="flex items-center justify-center gap-2 w-full px-4 py-3 rounded-lg bg-black border border-white/20 text-white hover:bg-white/10 transition-colors disabled:opacity-50 font-semibold"
      >
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <Wallet className="h-5 w-5" />
        )}
        <span>{loading ? "Processing..." : "Pay"}</span>
      </button>
      {error && <p className="text-destructive text-xs mt-2 text-center">{error}</p>}
      <p className="text-xs text-muted-foreground text-center mt-1">
        Apple Pay / Google Pay
      </p>
    </div>
  );
}
