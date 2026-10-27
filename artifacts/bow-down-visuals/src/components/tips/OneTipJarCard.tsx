import { useEffect, useState } from "react";
import { Coins, Copy, Loader2, Printer, QrCode } from "lucide-react";
import { QRCodeImage } from "@/components/QRCode";
import {
  JAR_DOOR_LABELS,
  ONE_TIP_JAR_COPY,
  formatJarAmount,
  jarAbsoluteUrl,
  type JarView,
} from "@/lib/one-tip-jar";

/* ─── One Tip Jar card — docked into the tips dashboard (N4) ─────────────
   The owner's view of the ONE jar: per-rail totals (dollars and
   Visual Bucs in separate lanes), the merged activity across the tip
   page / live streams / World stage, the canonical link every door
   uses, and the printable QR card (the same card prints for a mic
   wrap or a table tent — the QR encodes the canonical address and
   nothing else). Data: GET /api/tips/jar/:handle. */

export function OneTipJarCard({ handle, isLight }: { handle: string; isLight: boolean }) {
  const [view, setView] = useState<JarView | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch(`/api/tips/jar/${encodeURIComponent(handle)}`);
        if (!res.ok) throw new Error("jar load failed");
        const data = (await res.json()) as JarView;
        if (live) setView(data);
      } catch {
        if (live) setFailed(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [handle]);

  const cardClass = `rounded-2xl border p-6 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`;
  const absolute = typeof window !== "undefined" ? jarAbsoluteUrl(handle, window.location.origin) : jarAbsoluteUrl(handle, "");

  return (
    <section className={cardClass} data-testid="one-tip-jar-card">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .jar-print-area, .jar-print-area * { visibility: visible; }
          .jar-print-area { position: absolute; inset: 0 auto auto 0; background: #fff !important; color: #000 !important; }
          .jar-print-area * { color: #000 !important; border-color: #ddd !important; background: transparent !important; }
        }
      `}</style>
      <div className="flex items-center gap-2 mb-1">
        <Coins className="h-5 w-5 text-amber-400" />
        <h2 className="text-lg font-black">{ONE_TIP_JAR_COPY.heading}</h2>
      </div>
      <p className="text-xs text-white/45 max-w-2xl mb-5">{ONE_TIP_JAR_COPY.sub}</p>

      {failed ? (
        <p className="text-sm text-white/40">Couldn't load your jar right now — your tip page itself is unaffected.</p>
      ) : !view ? (
        <p className="text-sm text-white/40 flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading your jar…</p>
      ) : (
        <>
          {/* Totals — separate lanes, never summed */}
          <div className="grid grid-cols-3 gap-3 mb-5">
            <div className="rounded-xl border border-white/10 bg-black/30 p-3 text-center">
              <div className="text-xl font-black text-emerald-300">${(view.totals.usdCentsPaid / 100).toFixed(2)}</div>
              <div className="text-[10px] uppercase tracking-widest text-white/40 mt-0.5">Tip page · {view.totals.usdTipsCount} paid</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/30 p-3 text-center">
              <div className="text-xl font-black text-amber-300">{view.totals.vbLive.toLocaleString()} VB</div>
              <div className="text-[10px] uppercase tracking-widest text-white/40 mt-0.5">Live streams</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/30 p-3 text-center">
              <div className="text-xl font-black text-amber-300">{view.totals.vbStage.toLocaleString()} VB</div>
              <div className="text-[10px] uppercase tracking-widest text-white/40 mt-0.5">World stage</div>
            </div>
          </div>

          {view.goal && view.goal.progress !== null && (
            <div className="mb-5">
              <div className="flex justify-between text-xs text-white/50 mb-1">
                <span>{view.goal.label || "Funding goal"}</span>
                <span>${(view.goal.raised ?? 0).toFixed(2)} of ${view.goal.targetAmount.toFixed(2)}</span>
              </div>
              <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full bg-gradient-to-r from-amber-300 to-yellow-500" style={{ width: `${Math.min(100, Math.round(view.goal.progress * 100))}%` }} />
              </div>
            </div>
          )}

          {/* Merged activity */}
          {view.activity.length > 0 ? (
            <ul className="space-y-2 mb-6">
              {view.activity.slice(0, 8).map((e, i) => (
                <li key={i} className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.07] bg-black/20 px-3 py-2">
                  <div className="min-w-0">
                    <span className="text-sm font-bold text-white/85">{e.fromLabel}</span>
                    <span className="text-xs text-white/35"> · {JAR_DOOR_LABELS[e.door]}</span>
                    {e.message && <span className="block text-xs text-white/50 truncate">“{e.message}”</span>}
                  </div>
                  <span className={`text-sm font-black ${e.unit === "USD" ? "text-emerald-300" : "text-amber-300"}`}>
                    {formatJarAmount(e)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-white/40 mb-6">No tips yet — share your jar link and the first one lands here, whichever door it comes through.</p>
          )}

          {/* The printable QR card */}
          <div className="jar-print-area rounded-xl border border-[#C9A84C]/30 bg-black/20 p-5 flex flex-col items-center text-center">
            <QrCode className="h-5 w-5 text-amber-400 mb-1" />
            <div className="font-black text-lg">{ONE_TIP_JAR_COPY.printCardTitle} — {view.jar.displayName}</div>
            <p className="text-xs text-white/45 mb-3">{ONE_TIP_JAR_COPY.printCardNote}</p>
            <QRCodeImage data={absolute} size={180} />
            <div className="text-sm font-bold text-amber-200 mt-3 break-all">{absolute}</div>
            <div className="flex gap-2 mt-4 print:hidden">
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(absolute).catch(() => {});
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 px-4 py-2 text-sm font-bold text-white/70 transition hover:border-primary/50 hover:text-white"
              >
                <Copy className="h-4 w-4" /> {copied ? "Copied!" : "Copy jar link"}
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-300 to-yellow-500 px-4 py-2 text-sm font-black text-black transition hover:from-amber-200 hover:to-yellow-400"
              >
                <Printer className="h-4 w-4" /> Print QR card
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
