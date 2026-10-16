import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, RotateCcw } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/social-api";
import { formatBucs } from "@/lib/visual-bucs";

/* ─── Post-stream summary ─────────────────────────────────────────────────
   Shown on the ended stream's watch page — to its owner (the API
   answers 403 to everyone else, and the card simply doesn't render
   for them). Every figure comes from the summary endpoint's real
   rows; an average with no samples behind it reads "Unavailable",
   never a number dressed up from the peak. */

interface SummaryDto {
  streamId: string;
  title: string;
  status: string;
  durationSec: number;
  peakViewers: number;
  averageViewers: number | null;
  chatMessageCount: number;
  tipsTotalVb: number;
  tipCount: number;
  newFollowers: number;
}

type State = "loading" | "ready" | "hidden" | "error";

function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export default function StreamSummaryCard({ streamId }: { streamId: string }) {
  const { user, getAccessToken } = useAuth();
  const [state, setState] = useState<State>("loading");
  const [summary, setSummary] = useState<SummaryDto | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!user) {
      setState("hidden");
      return;
    }
    let cancelled = false;
    (async () => {
      setState("loading");
      try {
        const res = await apiFetch(getAccessToken, `/api/live/${streamId}/summary`);
        if (cancelled) return;
        if (res.status === 403 || res.status === 404) {
          setState("hidden");
          return;
        }
        if (res.status !== 200) throw new Error("summary failed");
        const json = await res.json().catch(() => null);
        if (!json?.summary) throw new Error("summary failed");
        setSummary(json.summary as SummaryDto);
        setState("ready");
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [streamId, user, nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  if (state === "hidden") return null;
  if (state === "loading") {
    return (
      <div className="mt-4 flex items-center gap-2 rounded-2xl border border-[#C9A84C]/25 bg-[#0d0a04] p-4 text-sm text-white/60" data-testid="stream-summary-loading">
        <Loader2 className="h-4 w-4 animate-spin text-amber-400" /> Loading your stream summary…
      </div>
    );
  }
  if (state === "error" || !summary) {
    return (
      <div className="mt-4 rounded-2xl border border-[#C9A84C]/25 bg-[#0d0a04] p-4" data-testid="stream-summary-error">
        <p className="flex items-center gap-2 text-sm font-bold text-white">
          <AlertTriangle className="h-4 w-4 text-amber-400" /> Your stream summary couldn&rsquo;t load.
        </p>
        <button
          type="button"
          onClick={() => setNonce((n) => n + 1)}
          className="mt-2 inline-flex items-center gap-2 rounded-full bg-amber-400 px-4 py-1.5 text-xs font-bold text-black transition hover:scale-105"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Try again
        </button>
      </div>
    );
  }

  const stats: Array<{ label: string; value: string }> = [
    { label: "Duration", value: formatDuration(summary.durationSec) },
    { label: "Peak viewers", value: String(summary.peakViewers) },
    { label: "Average viewers", value: summary.averageViewers === null ? "Unavailable" : String(summary.averageViewers) },
    { label: "Chat messages", value: String(summary.chatMessageCount) },
    { label: "Tips", value: summary.tipCount > 0 ? `${formatBucs(summary.tipsTotalVb)} · ${summary.tipCount} tip${summary.tipCount === 1 ? "" : "s"}` : "0" },
    { label: "New followers", value: String(summary.newFollowers) },
  ];

  return (
    <section
      data-dark-lock
      className="mt-4 rounded-2xl border border-[#C9A84C]/25 bg-[#0d0a04] p-4 text-white"
      data-testid="stream-summary"
    >
      <h3 className="text-sm font-black uppercase tracking-widest text-[#fbbf24]">Stream summary</h3>
      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
            <dt className="text-[10px] font-bold uppercase tracking-widest text-white/40">{s.label}</dt>
            <dd className="mt-0.5 text-base font-black text-white">{s.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
