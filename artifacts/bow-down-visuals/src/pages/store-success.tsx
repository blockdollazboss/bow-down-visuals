import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Loader2, Download, PartyPopper, ReceiptText, Music2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

/* ─── /store/success — the "you just got paid" moment (buyer edition) ─────
   Verifies the Stripe session server-side, records the sale idempotently,
   and hands the buyer their instant download link. */

interface VerifyResult {
  success: boolean;
  duplicate?: boolean;
  sale: { id: string; itemKind: string; amount: string };
  download: { token: string; url: string; expiresAt: string; maxUses: number };
}

export default function StoreSuccess() {
  const { getAccessToken } = useAuth();
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        const res = await fetch("/api/store/verify", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ sessionId }),
        });
        const body = (await res.json().catch(() => ({}))) as VerifyResult & { error?: string };
        if (!alive) return;
        if (!res.ok || !body.success) throw new Error(body.error || "Verification failed.");
        setResult(body);
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
        <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-b from-[#171204] to-black p-10 text-center shadow-[0_0_60px_rgba(201,162,39,0.15)]">
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
              <div className="mt-6 flex justify-center gap-4 text-sm">
                <Link href="/my-music" className="inline-flex items-center gap-1.5 text-amber-300 hover:underline">
                  <Music2 className="h-4 w-4" /> My Music
                </Link>
                <span className="inline-flex items-center gap-1.5 text-amber-100/40">
                  <ReceiptText className="h-4 w-4" /> Receipt emailed by Stripe
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
