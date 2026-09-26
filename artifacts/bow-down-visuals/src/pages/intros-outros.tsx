import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import {
  Clapperboard, Loader2, Download, AlertTriangle, CheckCircle2,
  ArrowLeft, RefreshCw, Film,
} from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { OutOfCredits } from "@/components/OutOfCredits";
import { usePageTitle } from "@/hooks/use-page-title";

/* ─── Intros & Outros ───────────────────────────────────────────────────
   Branded 5-second video stings for creators: channel name + tagline →
   Seedance-generated intro/outro in the gold/black luxury house style.
   8 credits per sting (5s × 1.5 cr/sec). Optional logo image reference. */

type StingType = "intro" | "outro";

const TYPES: Array<{ key: StingType; label: string; blurb: string }> = [
  { key: "intro", label: "Intro", blurb: "Open every video with a bang" },
  { key: "outro", label: "Outro", blurb: "Close with style, drive the subscribe" },
];

const DURATION_SEC = 5;
const CREDITS_PER_SEC = 1.5;
const CREDIT_COST = Math.ceil(DURATION_SEC * CREDITS_PER_SEC); // 8

type JobStatus = "idle" | "working" | "processing" | "done" | "failed";

interface StingResponse {
  taskId?: string;
  status?: string;
  url?: string | null;
  path?: string | null;
  error?: string;
  message?: string;
  creditCost?: number;
  creditsRemaining?: number;
  progress?: number | null;
}

interface RecentSting {
  url: string;
  channelName: string;
  type: StingType;
  at: number;
}

export function IntrosOutrosTool() {
  const { user } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const [channelName, setChannelName] = useState("");
  const [tagline, setTagline] = useState("");
  const [type, setType] = useState<StingType>("intro");
  const [logoUrl, setLogoUrl] = useState("");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [status, setStatus] = useState<JobStatus>("idle");
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creditsRemaining, setCreditsRemaining] = useState<number | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [recent, setRecent] = useState<RecentSting[]>([]);
  const pollRef = useRef<number | null>(null);

  /* Poll the Seedance task until it completes. Server-owned: safe to
     keep this tab open or come back later. */
  useEffect(() => {
    if (!taskId || status !== "processing") return;
    pollRef.current = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/generate-intro-outro/${taskId}`);
        const data: StingResponse = await res.json();
        if (!res.ok) {
          setStatus("failed");
          setError(data.error || "Sting not found");
          return;
        }
        if (data.status === "succeeded") {
          setStatus("done");
          setOutputUrl(data.url ?? null);
          if (typeof data.creditsRemaining === "number") setCreditsRemaining(data.creditsRemaining);
          if (data.url) {
            setRecent((r) => [{ url: data.url!, channelName, type, at: Date.now() }, ...r].slice(0, 6));
          }
        } else if (data.status === "failed" || data.status === "cancelled") {
          setStatus("failed");
          setError(data.error || "Generation failed — no credits were charged.");
        }
      } catch {
        /* keep polling on transient network errors */
      }
    }, 4000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [taskId, status, channelName, type]);

  async function generate() {
    if (!channelName.trim() || !user) return;
    setStatus("working");
    setError(null);
    setOutOfCredits(false);
    setOutputUrl(null);
    try {
      const res = await confirmedFetch("/api/generate-intro-outro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelName: channelName.trim(),
          type,
          tagline: tagline.trim() || undefined,
          referenceImageUrl: logoUrl.trim() || undefined,
        }),
      });
      if (!res) {
        setStatus("idle");
        return;
      }
      const data: StingResponse = await res.json();
      if (res.status === 402) {
        setOutOfCredits(true);
        setStatus("idle");
        return;
      }
      if (!res.ok || !data.taskId) {
        setStatus("failed");
        setError(data.error || "Could not start the generation.");
        return;
      }
      setTaskId(data.taskId);
      setStatus("processing");
      if (typeof data.creditsRemaining === "number") setCreditsRemaining(data.creditsRemaining);
    } catch {
      setStatus("failed");
      setError("Network error — please try again.");
    }
  }

  function reset() {
    setTaskId(null);
    setStatus("idle");
    setOutputUrl(null);
    setError(null);
    setOutOfCredits(false);
  }

  const busy = status === "working" || status === "processing";
  const canGenerate = channelName.trim().length > 0 && !!user && !busy;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-white/40 hover:text-white/70 mb-6">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>

        <div className="flex items-center gap-3 mb-2">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Clapperboard className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-black">Intros & Outros</h1>
            <p className="text-sm text-white/45">Branded 5-second video stings — {CREDIT_COST} credits each</p>
          </div>
        </div>

        {outOfCredits && (
          <div className="mt-4"><OutOfCredits /></div>
        )}

        {error && (
          <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-red-500/25 bg-red-500/5 px-4 py-3">
            <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
            <p className="text-sm text-red-200/80">{error}</p>
          </div>
        )}

        {status === "idle" || status === "failed" ? (
          <div className="mt-6 space-y-5">
            {/* Type picker */}
            <div>
              <p className="text-xs font-bold text-white/40 uppercase tracking-wider mb-2">Sting type</p>
              <div className="grid grid-cols-2 gap-3">
                {TYPES.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setType(t.key)}
                    className={`rounded-xl border px-4 py-3.5 text-left transition ${
                      type === t.key
                        ? "border-primary/60 bg-primary/[0.08]"
                        : "border-white/[0.08] bg-white/[0.02] hover:border-white/20"
                    }`}
                  >
                    <p className="font-bold text-white">{t.label}</p>
                    <p className="text-xs text-white/40 mt-0.5">{t.blurb}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Channel name */}
            <div>
              <label className="text-xs font-bold text-white/40 uppercase tracking-wider">Channel name</label>
              <input
                value={channelName}
                onChange={(e) => setChannelName(e.target.value)}
                placeholder="e.g. Bow Down Visuals"
                maxLength={60}
                className="mt-2 w-full rounded-xl border border-white/[0.12] bg-white/[0.03] px-4 py-3.5 text-white placeholder:text-white/25 outline-none focus:border-primary/60"
              />
            </div>

            {/* Tagline */}
            <div>
              <label className="text-xs font-bold text-white/40 uppercase tracking-wider">Tagline <span className="text-white/25 normal-case font-normal">(optional)</span></label>
              <input
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                placeholder="e.g. The Content Creation Cheat Code"
                maxLength={80}
                className="mt-2 w-full rounded-xl border border-white/[0.12] bg-white/[0.03] px-4 py-3.5 text-white placeholder:text-white/25 outline-none focus:border-primary/60"
              />
            </div>

            {/* Logo reference (optional) */}
            <div>
              <label className="text-xs font-bold text-white/40 uppercase tracking-wider">
                Logo image URL <span className="text-white/25 normal-case font-normal">(optional — paste one from the Logo Maker)</span>
              </label>
              <input
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                placeholder="https://…"
                className="mt-2 w-full rounded-xl border border-white/[0.12] bg-white/[0.03] px-4 py-3.5 text-white placeholder:text-white/25 outline-none focus:border-primary/60"
              />
            </div>

            <button
              onClick={generate}
              disabled={!canGenerate}
              className="w-full rounded-2xl bg-primary px-6 py-4 font-bold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Generate {type} · {DURATION_SEC}s · {CREDIT_COST} credits
            </button>
            {creditsRemaining != null && (
              <p className="text-center text-xs text-white/35">{creditsRemaining} credits remaining</p>
            )}
          </div>
        ) : null}

        {/* Progress */}
        {busy && (
          <div className="mt-6 rounded-2xl border border-white/[0.08] bg-white/[0.02] px-6 py-10 text-center">
            <Loader2 className="h-8 w-8 text-primary animate-spin mx-auto mb-4" />
            <p className="font-bold text-white">
              {status === "working" ? "Submitting…" : "Rendering your sting…"}
            </p>
            <p className="text-sm text-white/40 mt-1">
              This runs on our servers — safe to close this tab. Your {type} will be waiting when you return.
            </p>
          </div>
        )}

        {/* Result */}
        {status === "done" && outputUrl && (
          <div className="mt-6 space-y-4">
            <div className="flex items-center gap-2.5 rounded-xl border border-green-500/25 bg-green-500/5 px-4 py-3">
              <CheckCircle2 className="h-5 w-5 text-green-400 shrink-0" />
              <p className="text-sm font-semibold text-white/80">{type === "intro" ? "Intro" : "Outro"} ready — {channelName}</p>
            </div>
            <video src={outputUrl} controls autoPlay loop muted className="w-full rounded-2xl border border-white/[0.08] bg-black" />
            <div className="flex gap-3">
              <a
                href={outputUrl}
                download={`${channelName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${type}.mp4`}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-primary px-6 py-3.5 font-bold text-black transition hover:brightness-110"
              >
                <Download className="h-4 w-4" /> Download
              </a>
              <button
                onClick={reset}
                className="inline-flex items-center gap-2 rounded-2xl border border-white/[0.12] px-6 py-3.5 font-semibold text-white/70 hover:border-white/25 transition"
              >
                <RefreshCw className="h-4 w-4" /> New sting
              </button>
            </div>
          </div>
        )}

        {/* Recent stings */}
        {recent.length > 0 && status !== "done" && (
          <div className="mt-10">
            <p className="text-xs font-bold text-white/40 uppercase tracking-wider mb-3 flex items-center gap-2">
              <Film className="h-3.5 w-3.5" /> Recent stings
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {recent.map((r) => (
                <a key={r.at} href={r.url} target="_blank" rel="noreferrer" className="group">
                  <video src={r.url} muted playsInline className="aspect-video w-full rounded-xl border border-white/[0.08] object-cover group-hover:border-primary/50 transition" />
                  <p className="text-xs text-white/50 mt-1 truncate">{r.channelName} · {r.type}</p>
                </a>
              ))}
            </div>
          </div>
        )}
    </main>
  );
}

export default function IntrosOutros() {
  usePageTitle("Intros & Outros", "AI-generated video intros and outros for your channel.");
  return (
    <div className="min-h-screen bg-black text-white">
      <MarketingNav />
      <IntrosOutrosTool />
      <SiteFooter />
    </div>
  );
}
