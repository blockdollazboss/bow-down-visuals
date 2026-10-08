import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Loader2, Download, PartyPopper, ReceiptText, Music2, Share2, User, ExternalLink } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { shareDrop } from "@/lib/share-drop";

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
  download: { token: string; url: string; expiresAt: string; maxUses: number };
}

export default function StoreSuccess() {
  const { getAccessToken } = useAuth();
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [result, setResult] = useState<VerifyResult | null>(null);
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
        </div>
      </div>
    </div>
  );
}
