import { useEffect, useState } from "react";
import { HandCoins, Heart, Loader2 } from "lucide-react";
import {
  apiErrorLine,
  parseTipPage,
  tipAmountProblem,
  tipCheckoutPath,
  tipCheckoutUrl,
  tipIntentPath,
  tipPagePath,
  tipSendPayload,
  type TipPageData,
} from "@/lib/world/money-desks-2";

/* ─── PortraitTip — tip this creator, from their Portrait Card
   (Stack-100 #66). The card renders this ONLY when the creator's
   profile carries tip_jar_enabled (the website profile chrome's
   own gate before it links the tip page). The flow is the public
   tip page's (pages/tip-page.tsx), verbatim on its rails:
   GET /api/tips/page/:handle for the creator's own suggested
   amounts, goal and the API's honesty notice (rendered as-is);
   sending tries POST /api/tips/:handle/checkout first — its hosted
   checkout opens in a NEW TAB (the sanctioned exit) — and a 503
   (payments not configured in this environment) falls back to
   recording the tip intent on POST /api/tips/:handle/tip, exactly
   the page's own fallback, saying so plainly. A creator with the
   jar on but no tip page at their handle reads as "no tip page
   set up yet" — honest, never a dead button. Guests can tip on
   the website's public page without an account; here they get
   the same door the card's follow button gives: the amounts are
   visible, sending is members' business in the palace. */

export function PortraitTip({ slug, isLight, isGuest }: { slug: string; isLight: boolean; isGuest: boolean }) {
  const [page, setPage] = useState<TipPageData | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "none" | "failed">("loading");
  const [amount, setAmount] = useState<number | null>(null);
  const [custom, setCustom] = useState("");
  const [fanName, setFanName] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<"checkout" | "intent" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    (async () => {
      try {
        const res = await fetch(tipPagePath(slug));
        if (res.status === 404) { if (!cancelled) setState("none"); return; }
        if (!res.ok) throw new Error("tip page");
        const parsed = parseTipPage(await res.json());
        if (cancelled) return;
        if (!parsed) { setState("none"); return; }
        setPage(parsed);
        setAmount(parsed.suggestedAmounts[0] ?? null);
        setState("ready");
      } catch {
        if (!cancelled) setState("failed");
      }
    })();
    return () => { cancelled = true; };
  }, [slug]);

  const effective = custom.trim() ? Number(custom) : amount;
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";

  const send = async () => {
    if (!page || sending) return;
    const problem = tipAmountProblem(effective);
    if (problem) { setError(problem); return; }
    setSending(true);
    setError(null);
    try {
      /* Real checkout first — the page's own order. */
      const co = await fetch(tipCheckoutPath(page.handle), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tipSendPayload(effective as number, fanName, message)),
      });
      if (co.ok) {
        const url = tipCheckoutUrl(await co.json().catch(() => ({})));
        if (url) {
          window.open(url, "_blank", "noopener,noreferrer");
          setSent("checkout");
          return;
        }
      } else if (co.status !== 503) {
        const data = (await co.json().catch(() => ({}))) as Record<string, unknown>;
        throw new Error(apiErrorLine(data, "That tip couldn't be recorded."));
      }
      /* 503: payments aren't configured here — record the intent,
         exactly the pre-checkout behavior, and say so. */
      const res = await fetch(tipIntentPath(page.handle), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tipSendPayload(effective as number, fanName, message)),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorLine(data, "That tip couldn't be recorded."));
      setSent("intent");
    } catch (e) {
      setError(e instanceof Error ? e.message : "That tip couldn't be recorded — try again.");
    } finally {
      setSending(false);
    }
  };

  if (state === "loading") {
    return (
      <p className={`mt-3 inline-flex items-center gap-2 text-xs ${muted}`} data-testid="world-portrait-tip">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-[#d4af37]" /> Opening their tip jar…
      </p>
    );
  }
  if (state === "none" || state === "failed" || !page) {
    return (
      <p className={`mt-3 text-xs ${muted}`} data-testid="world-portrait-tip">
        {state === "failed"
          ? "Their tip jar didn't answer just now — nothing was sent."
          : "This creator's tip jar is switched on, but no tip page is set up at their handle yet."}
      </p>
    );
  }

  return (
    <div className="mt-3" data-testid="world-portrait-tip">
      <p className={`mb-1 flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
        <HandCoins className="h-3.5 w-3.5" /> Tip {page.displayName}
      </p>
      {page.message && <p className={`text-xs ${muted}`}>{page.message}</p>}
      {page.goalAmount !== null && (
        <p className={`mt-1 text-[11px] ${muted}`}>
          {page.goalLabel || "Goal"}: ${(page.goalRaisedDollars ?? page.totalDollars).toFixed(2)} of ${page.goalAmount.toFixed(2)}
          {page.goalProgress !== null ? ` · ${Math.round(page.goalProgress * 100)}%` : ""}
        </p>
      )}
      <p className={`text-[11px] ${muted}`}>{page.tipCount} tips · ${page.totalDollars.toFixed(2)} tipped so far</p>

      {sent ? (
        <p className={`mt-2 text-xs font-semibold ${isLight ? "text-emerald-700" : "text-emerald-300"}`}>
          {sent === "checkout"
            ? "Checkout opened in a new tab — your tip lands the moment the payment confirms."
            : "Tip recorded — it's saved as intent, and the creator sees it on their Tip Jar. No charge was made."}
        </p>
      ) : isGuest ? (
        <p className={`mt-2 text-xs ${muted}`}>Sign in on the website to tip from the palace.</p>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {page.suggestedAmounts.map((a) => (
              <button key={a} type="button" onClick={() => { setAmount(a); setCustom(""); }}
                className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${
                  amount === a && !custom.trim()
                    ? "bg-[#d4af37] text-black"
                    : isLight ? "border border-[#7A5A12]/30 text-[#6B5B36]" : "border border-white/15 text-white/75"
                }`}>
                ${a}
              </button>
            ))}
            <input aria-label="Custom tip amount" value={custom} onChange={(e) => setCustom(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="Custom $" inputMode="decimal"
              className={`w-24 rounded-full border px-3 py-1.5 text-xs outline-none ${isLight ? "border-[#7A5A12]/30 bg-white/60 text-[#2a1e07]" : "border-white/15 bg-white/5 text-white"}`} />
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <input aria-label="Your name" value={fanName} onChange={(e) => setFanName(e.target.value)} placeholder="Your name (optional)" maxLength={60}
              className={`min-w-32 flex-1 rounded-xl border px-3 py-1.5 text-xs outline-none ${isLight ? "border-[#7A5A12]/30 bg-white/60 text-[#2a1e07]" : "border-white/15 bg-white/5 text-white"}`} />
            <input aria-label="Tip message" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Say something kind (optional)" maxLength={280}
              className={`min-w-32 flex-1 rounded-xl border px-3 py-1.5 text-xs outline-none ${isLight ? "border-[#7A5A12]/30 bg-white/60 text-[#2a1e07]" : "border-white/15 bg-white/5 text-white"}`} />
          </div>
          {error && <p className="mt-2 text-xs font-semibold text-red-400">{error}</p>}
          <button type="button" data-testid="world-portrait-tip-send" onClick={() => void send()} disabled={sending}
            className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-4 py-1.5 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50">
            {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Heart className="h-3.5 w-3.5" />}
            {sending ? "Sending…" : `Send tip${effective && effective > 0 ? ` — $${effective.toFixed(2)}` : ""}`}
          </button>
        </>
      )}
      {page.notice && (
        <p className={`mt-2 rounded-xl border border-amber-400/25 bg-amber-400/[0.06] p-2.5 text-[11px] ${isLight ? "text-[#92600a]" : "text-amber-200/85"}`}>{page.notice}</p>
      )}
    </div>
  );
}
