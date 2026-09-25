import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import {
  Crown, Loader2, Download, AlertTriangle, CheckCircle2,
  ArrowLeft, Sparkles, RefreshCw, Image as ImageIcon,
} from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { OutOfCredits } from "@/components/OutOfCredits";
import { usePageTitle } from "@/hooks/use-page-title";

/* ─── Logo Maker ──────────────────────────────────────────────────────────
   AI brand logos for creators: channel name + style preset → generated
   logo image. Premium (GPT Image 2.5, 2 credits, instant) or Standard
   (Runway Gen4, 1 credit, polled). Pure gold/black luxury brand. */

type LogoStyleKey = "luxury-gold" | "gaming" | "minimal" | "mascot";
type LogoModel = "premium" | "standard";

const STYLES: Array<{ key: LogoStyleKey; label: string; blurb: string; swatch: string }> = [
  { key: "luxury-gold", label: "Luxury Gold", blurb: "Black & gold, premium finish", swatch: "linear-gradient(135deg,#0a0a0a 40%,#d4af37 100%)" },
  { key: "gaming", label: "Gaming", blurb: "Bold esports energy", swatch: "linear-gradient(135deg,#0a0a0a 40%,#7c3aed 100%)" },
  { key: "minimal", label: "Minimal", blurb: "Clean, modern, timeless", swatch: "linear-gradient(135deg,#111 40%,#e5e5e5 100%)" },
  { key: "mascot", label: "Mascot", blurb: "Character-driven, memorable", swatch: "linear-gradient(135deg,#0a0a0a 40%,#f97316 100%)" },
];

const MODELS: Array<{ key: LogoModel; label: string; cost: number; blurb: string }> = [
  { key: "premium", label: "Premium", cost: 2, blurb: "Best quality · instant" },
  { key: "standard", label: "Standard", cost: 1, blurb: "Great quality · ~1 min" },
];

type JobStatus = "idle" | "working" | "processing" | "done" | "failed";

interface LogoResponse {
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

interface RecentLogo {
  url: string;
  brandName: string;
  style: string;
  at: number;
}

export default function LogoMaker() {
  usePageTitle("Logo Maker", "AI logo designer for creators — professional brand marks in seconds.");
  const { user } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const [brandName, setBrandName] = useState("");
  const [tagline, setTagline] = useState("");
  const [style, setStyle] = useState<LogoStyleKey>("luxury-gold");
  const [model, setModel] = useState<LogoModel>("premium");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [status, setStatus] = useState<JobStatus>("idle");
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creditsRemaining, setCreditsRemaining] = useState<number | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [recent, setRecent] = useState<RecentLogo[]>([]);
  const pollRef = useRef<number | null>(null);

  /* Poll the Runway task for Standard-tier logos. Premium returns instantly. */
  useEffect(() => {
    if (!taskId || status !== "processing") return;
    pollRef.current = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/generate-logo/${taskId}`);
        const data: LogoResponse = await res.json();
        if (!res.ok) {
          setStatus("failed");
          setError(data.error || "Logo not found");
          return;
        }
        if (data.status === "succeeded") {
          setStatus("done");
          setOutputUrl(data.url ?? null);
          if (typeof data.creditsRemaining === "number") setCreditsRemaining(data.creditsRemaining);
          if (data.url) {
            setRecent((r) => [{ url: data.url!, brandName, style, at: Date.now() }, ...r].slice(0, 8));
          }
        } else if (data.status === "failed" || data.status === "cancelled") {
          setStatus("failed");
          setError(data.error || "Logo generation failed — no credits were charged.");
        }
      } catch {
        /* keep polling on transient network errors */
      }
    }, 3000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [taskId, status, brandName, style]);

  async function generate() {
    if (!brandName.trim() || !user) return;
    setStatus("working");
    setError(null);
    setOutOfCredits(false);
    setOutputUrl(null);
    try {
      const res = await confirmedFetch("/api/generate-logo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandName: brandName.trim(), style, tagline: tagline.trim() || undefined, model }),
      });
      if (!res) {
        setStatus("idle");
        return;
      }
      const data: LogoResponse = await res.json();
      if (res.status === 402) {
        setOutOfCredits(true);
        setStatus("idle");
        return;
      }
      if (!res.ok) {
        setStatus("failed");
        setError(data.error || "Could not generate the logo.");
        return;
      }
      if (data.status === "succeeded" && data.url) {
        /* Premium: instant result. */
        setStatus("done");
        setOutputUrl(data.url);
        if (typeof data.creditsRemaining === "number") setCreditsRemaining(data.creditsRemaining);
        setRecent((r) => [{ url: data.url!, brandName: brandName.trim(), style, at: Date.now() }, ...r].slice(0, 8));
      } else if (data.taskId) {
        /* Standard: poll until Runway finishes. */
        setTaskId(data.taskId);
        setStatus("processing");
        if (typeof data.creditsRemaining === "number") setCreditsRemaining(data.creditsRemaining);
      } else {
        setStatus("failed");
        setError("Unexpected response from the logo service.");
      }
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
  const cost = MODELS.find((m) => m.key === model)?.cost ?? 2;
  const canGenerate = brandName.trim().length > 0 && !!user && !busy;

  return (
    <div className="min-h-screen bg-black text-white">
      <MarketingNav />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-white/40 hover:text-white/70 mb-6">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>

        <div className="flex items-center gap-3 mb-2">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Crown className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-black">Logo Maker</h1>
            <p className="text-sm text-white/45">AI brand logos for your channel — from {cost} credit{cost === 1 ? "" : "s"}</p>
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
            {/* Brand name */}
            <div>
              <label className="text-xs font-bold text-white/40 uppercase tracking-wider">Brand / channel name</label>
              <input
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
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

            {/* Style picker */}
            <div>
              <p className="text-xs font-bold text-white/40 uppercase tracking-wider mb-2">Style</p>
              <div className="grid grid-cols-2 gap-3">
                {STYLES.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setStyle(s.key)}
                    className={`rounded-xl border p-3 text-left transition ${
                      style === s.key
                        ? "border-primary/60 bg-primary/[0.08]"
                        : "border-white/[0.08] bg-white/[0.02] hover:border-white/20"
                    }`}
                  >
                    <span className="block h-10 rounded-lg mb-2" style={{ background: s.swatch }} />
                    <p className="font-bold text-white text-sm">{s.label}</p>
                    <p className="text-xs text-white/40 mt-0.5">{s.blurb}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Quality tier */}
            <div>
              <p className="text-xs font-bold text-white/40 uppercase tracking-wider mb-2">Quality</p>
              <div className="grid grid-cols-2 gap-3">
                {MODELS.map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => setModel(m.key)}
                    className={`rounded-xl border px-4 py-3.5 text-left transition ${
                      model === m.key
                        ? "border-primary/60 bg-primary/[0.08]"
                        : "border-white/[0.08] bg-white/[0.02] hover:border-white/20"
                    }`}
                  >
                    <p className="font-bold text-white">{m.label} <span className="text-primary text-sm">· {m.cost} cr</span></p>
                    <p className="text-xs text-white/40 mt-0.5">{m.blurb}</p>
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={generate}
              disabled={!canGenerate}
              className="w-full rounded-2xl bg-primary px-6 py-4 font-bold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span className="inline-flex items-center gap-2"><Sparkles className="h-4 w-4" /> Generate logo · {cost} credits</span>
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
            <p className="font-bold text-white">{status === "working" ? "Designing your logo…" : "Rendering your logo…"}</p>
            <p className="text-sm text-white/40 mt-1">Crafting the brand mark — hang tight.</p>
          </div>
        )}

        {/* Result */}
        {status === "done" && outputUrl && (
          <div className="mt-6 space-y-4">
            <div className="flex items-center gap-2.5 rounded-xl border border-green-500/25 bg-green-500/5 px-4 py-3">
              <CheckCircle2 className="h-5 w-5 text-green-400 shrink-0" />
              <p className="text-sm font-semibold text-white/80">Logo ready — {brandName}</p>
            </div>
            <img src={outputUrl} alt={`${brandName} logo`} className="w-full rounded-2xl border border-white/[0.08] bg-white/[0.02]" />
            <div className="flex gap-3">
              <a
                href={outputUrl}
                download={`${brandName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}-logo.png`}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-primary px-6 py-3.5 font-bold text-black transition hover:brightness-110"
              >
                <Download className="h-4 w-4" /> Download
              </a>
              <button
                onClick={reset}
                className="inline-flex items-center gap-2 rounded-2xl border border-white/[0.12] px-6 py-3.5 font-semibold text-white/70 hover:border-white/25 transition"
              >
                <RefreshCw className="h-4 w-4" /> New logo
              </button>
            </div>
          </div>
        )}

        {/* Recent generations */}
        {recent.length > 0 && status !== "done" && (
          <div className="mt-10">
            <p className="text-xs font-bold text-white/40 uppercase tracking-wider mb-3 flex items-center gap-2">
              <ImageIcon className="h-3.5 w-3.5" /> Recent logos
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {recent.map((r) => (
                <a key={r.at} href={r.url} target="_blank" rel="noreferrer" className="group">
                  <img src={r.url} alt={r.brandName} className="aspect-square w-full rounded-xl border border-white/[0.08] object-cover group-hover:border-primary/50 transition" />
                  <p className="text-xs text-white/50 mt-1 truncate">{r.brandName}</p>
                </a>
              ))}
            </div>
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
