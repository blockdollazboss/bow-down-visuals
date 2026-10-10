import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import {
  Crown, Loader2, Download, AlertTriangle, CheckCircle2,
  ArrowLeft, Sparkles, RefreshCw, Image as ImageIcon,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { OutOfCredits } from "@/components/OutOfCredits";
import { usePageTitle } from "@/hooks/use-page-title";
import { useTranslation } from "react-i18next";
import { useHubProject } from "@/lib/hub-project";
import { useActiveArtist } from "@/contexts/ActiveArtistContext";

/* ─── Logo Maker ──────────────────────────────────────────────────────────
   AI brand logos for creators: channel name + style preset → generated
   logo image. Premium (GPT Image 2.5, 2 credits, instant) or Standard
   (Runway Gen4, 1 credit, polled). Pure gold/black luxury brand. */

type LogoStyleKey = "luxury-gold" | "gaming" | "minimal" | "mascot";
type LogoModel = "premium" | "standard";

const STYLES: Array<{ key: LogoStyleKey; labelKey: string; blurbKey: string; swatch: string }> = [
  { key: "luxury-gold", labelKey: "logoMaker.styleLuxuryGold", blurbKey: "logoMaker.styleLuxuryGoldBlurb", swatch: "linear-gradient(135deg,#0a0a0a 40%,#d4af37 100%)" },
  { key: "gaming", labelKey: "logoMaker.styleGaming", blurbKey: "logoMaker.styleGamingBlurb", swatch: "linear-gradient(135deg,#0a0a0a 40%,#7c3aed 100%)" },
  { key: "minimal", labelKey: "logoMaker.styleMinimal", blurbKey: "logoMaker.styleMinimalBlurb", swatch: "linear-gradient(135deg,#111 40%,#e5e5e5 100%)" },
  { key: "mascot", labelKey: "logoMaker.styleMascot", blurbKey: "logoMaker.styleMascotBlurb", swatch: "linear-gradient(135deg,#0a0a0a 40%,#f97316 100%)" },
];

const MODELS: Array<{ key: LogoModel; labelKey: string; cost: number; blurbKey: string }> = [
  { key: "premium", labelKey: "logoMaker.modelPremium", cost: 200, blurbKey: "logoMaker.modelPremiumBlurb" },
  { key: "standard", labelKey: "logoMaker.modelStandard", cost: 100, blurbKey: "logoMaker.modelStandardBlurb" },
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

export function LogoMakerTool() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const { addAsset } = useHubProject();
  const { activeArtist } = useActiveArtist();
  const [brandName, setBrandName] = useState("");
  const [tagline, setTagline] = useState("");

  /* The vault knows the artist's name — prefill so it's never retyped. */
  useEffect(() => {
    if (!brandName && activeArtist?.artist_name) setBrandName(activeArtist.artist_name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeArtist?.artist_name]);
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
          setError(data.error || t("logoMaker.logoNotFound"));
          return;
        }
        if (data.status === "succeeded") {
          setStatus("done");
          setOutputUrl(data.url ?? null);
          if (typeof data.creditsRemaining === "number") setCreditsRemaining(data.creditsRemaining);
          if (data.url) {
            setRecent((r) => [{ url: data.url!, brandName, style, at: Date.now() }, ...r].slice(0, 8));
            /* The logo flows into the hub project — jewelry, merch, NFC cards pick it up. */
            try { addAsset({ kind: "image", url: data.url!, label: `Logo — ${brandName}`, detail: style, meta: { logo: "true", brandName } }); } catch { /* non-fatal */ }
          }
        } else if (data.status === "failed" || data.status === "cancelled") {
          setStatus("failed");
          setError(data.error || t("logoMaker.logoFailedNoCharge"));
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
        overrideCost: cost,
        overrideFeature: "Logo Generator",
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
        setError(data.error || t("logoMaker.couldNotGenerate"));
        return;
      }
      if (data.status === "succeeded" && data.url) {
        /* Premium: instant result. */
        setStatus("done");
        setOutputUrl(data.url);
        if (typeof data.creditsRemaining === "number") setCreditsRemaining(data.creditsRemaining);
        setRecent((r) => [{ url: data.url!, brandName: brandName.trim(), style, at: Date.now() }, ...r].slice(0, 8));
        /* The logo flows into the hub project — jewelry, merch, NFC cards pick it up. */
        try { addAsset({ kind: "image", url: data.url!, label: `Logo — ${brandName.trim()}`, detail: style, meta: { logo: "true", brandName: brandName.trim() } }); } catch { /* non-fatal */ }
      } else if (data.taskId) {
        /* Standard: poll until Runway finishes. */
        setTaskId(data.taskId);
        setStatus("processing");
        if (typeof data.creditsRemaining === "number") setCreditsRemaining(data.creditsRemaining);
      } else {
        setStatus("failed");
        setError(t("logoMaker.unexpectedResponse"));
      }
    } catch {
      setStatus("failed");
      setError(t("logoMaker.networkError"));
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
  const cost = MODELS.find((m) => m.key === model)?.cost ?? 200;
  const canGenerate = brandName.trim().length > 0 && !!user && !busy;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-white/40 hover:text-white/70 mb-6">
          <ArrowLeft className="h-4 w-4" /> {t("logoMaker.back")}
        </Link>

        <div className="flex items-center gap-3 mb-2">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Crown className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-black">{t("logoMaker.title")}</h1>
            <p className="text-sm text-white/45">{t("logoMaker.subtitle", { cost, count: cost })}</p>
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
              <label className="text-xs font-bold text-white/40 uppercase tracking-wider">{t("logoMaker.brandNameLabel")}</label>
              <input
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                placeholder={t("logoMaker.brandNamePlaceholder")}
                maxLength={60}
                className="mt-2 w-full rounded-xl border border-white/[0.12] bg-white/[0.03] px-4 py-3.5 text-white placeholder:text-white/25 outline-none focus:border-primary/60"
              />
            </div>

            {/* Tagline */}
            <div>
              <label className="text-xs font-bold text-white/40 uppercase tracking-wider">{t("logoMaker.taglineLabel")} <span className="text-white/25 normal-case font-normal">{t("logoMaker.optional")}</span></label>
              <input
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                placeholder={t("logoMaker.taglinePlaceholder")}
                maxLength={80}
                className="mt-2 w-full rounded-xl border border-white/[0.12] bg-white/[0.03] px-4 py-3.5 text-white placeholder:text-white/25 outline-none focus:border-primary/60"
              />
            </div>

            {/* Style picker */}
            <div data-min-stars="2">
              <p className="text-xs font-bold text-white/40 uppercase tracking-wider mb-2">{t("logoMaker.styleLabel")}</p>
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
                    <p className="font-bold text-white text-sm">{t(s.labelKey)}</p>
                    <p className="text-xs text-white/40 mt-0.5">{t(s.blurbKey)}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Quality tier */}
            <div data-min-stars="5">
              <p className="text-xs font-bold text-white/40 uppercase tracking-wider mb-2">{t("logoMaker.qualityLabel")}</p>
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
                    <p className="font-bold text-white">{t(m.labelKey)} <span className="text-primary text-sm">· {m.cost} {t("logoMaker.vb")}</span></p>
                    <p className="text-xs text-white/40 mt-0.5">{t(m.blurbKey)}</p>
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={generate}
              disabled={!canGenerate}
              className="w-full rounded-2xl bg-primary px-6 py-4 font-bold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span className="inline-flex items-center gap-2"><Sparkles className="h-4 w-4" /> {t("logoMaker.generateButton", { cost, count: cost })}</span>
            </button>
            {creditsRemaining != null && (
              <p className="text-center text-xs text-white/35">{t("logoMaker.creditsRemaining", { count: creditsRemaining })}</p>
            )}
          </div>
        ) : null}

        {/* Progress */}
        {busy && (
          <div className="mt-6 rounded-2xl border border-white/[0.08] bg-white/[0.02] px-6 py-10 text-center">
            <Loader2 className="h-8 w-8 text-primary animate-spin mx-auto mb-4" />
            <p className="font-bold text-white">{status === "working" ? t("logoMaker.designing") : t("logoMaker.rendering")}</p>
            <p className="text-sm text-white/40 mt-1">{t("logoMaker.craftingHint")}</p>
          </div>
        )}

        {/* Result */}
        {status === "done" && outputUrl && (
          <div className="mt-6 space-y-4">
            <div className="flex items-center gap-2.5 rounded-xl border border-green-500/25 bg-green-500/5 px-4 py-3">
              <CheckCircle2 className="h-5 w-5 text-green-400 shrink-0" />
              <p className="text-sm font-semibold text-white/80">{t("logoMaker.logoReady", { brandName })}</p>
            </div>
            <img src={outputUrl} alt={t("logoMaker.logoAlt", { brandName })} className="w-full rounded-2xl border border-white/[0.08] bg-white/[0.02]" />
            <div className="flex gap-3">
              <a
                href={outputUrl}
                download={`${brandName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}-logo.png`}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-primary px-6 py-3.5 font-bold text-black transition hover:brightness-110"
              >
                <Download className="h-4 w-4" /> {t("logoMaker.download")}
              </a>
              <button
                onClick={reset}
                className="inline-flex items-center gap-2 rounded-2xl border border-white/[0.12] px-6 py-3.5 font-semibold text-white/70 hover:border-white/25 transition"
              >
                <RefreshCw className="h-4 w-4" /> {t("logoMaker.newLogo")}
              </button>
            </div>
          </div>
        )}

        {/* Recent generations */}
        {recent.length > 0 && status !== "done" && (
          <div className="mt-10">
            <p className="text-xs font-bold text-white/40 uppercase tracking-wider mb-3 flex items-center gap-2">
              <ImageIcon className="h-3.5 w-3.5" /> {t("logoMaker.recentLogos")}
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
  );
}

export default function LogoMaker() {
  const { t } = useTranslation();
  usePageTitle(t("logoMaker.pageTitle"), t("logoMaker.pageDescription"));
  return (
    <div className="min-h-screen bg-black text-white">
      <LogoMakerTool />

    </div>
  );
}
