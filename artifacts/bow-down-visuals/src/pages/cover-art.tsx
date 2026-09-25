import { useState } from "react";
import { Link } from "wouter";
import {
  Disc3, Loader2, Download, AlertTriangle, ArrowLeft, RefreshCw,
  Sparkles, Type, Palette,
} from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { OutOfCredits } from "@/components/OutOfCredits";
import {
  COVER_ART_STYLES,
  COVER_ART_RATIOS,
  COVER_ART_TIERS,
  getCoverArtTier,
  type CoverArtResult,
} from "@/lib/cover-art";

/* ─── AI Cover Art Generator ────────────────────────────────────────────────
   Professional album/single/EP cover art. GPT-6 art-directs the concept +
   typography layout, then GPT Image renders the artwork (2cr standard,
   3cr premium — refunded automatically if generation fails). */

interface GenerateResponse extends CoverArtResult {
  error?: string;
}

export default function CoverArt() {
  const { user } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const [songTitle, setSongTitle] = useState("");
  const [artistName, setArtistName] = useState("");
  const [mood, setMood] = useState("");
  const [style, setStyle] = useState("luxury-gold");
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [tier, setTier] = useState<"standard" | "premium">("standard");
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<CoverArtResult | null>(null);
  const [history, setHistory] = useState<CoverArtResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  const tierInfo = getCoverArtTier(tier);
  const canGenerate = songTitle.trim().length > 0 && artistName.trim().length > 0 && !generating;

  async function generate() {
    if (!canGenerate) return;
    setGenerating(true);
    setError(null);
    setOutOfCredits(false);
    try {
      const res = await confirmedFetch("/api/cover-art", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          songTitle: songTitle.trim(),
          artistName: artistName.trim(),
          mood: mood.trim(),
          style,
          aspectRatio,
          tier,
        }),
      });
      if (!res) return;
      const data = (await res.json()) as GenerateResponse;
      if (res.status === 402) {
        setOutOfCredits(true);
        return;
      }
      if (!res.ok) {
        throw new Error(data.error || "Cover art generation failed.");
      }
      const cover: CoverArtResult = {
        url: data.url,
        path: data.path,
        artDirection: data.artDirection,
        typography: data.typography,
        creditsUsed: data.creditsUsed,
        creditsRemaining: data.creditsRemaining,
      };
      setResult(cover);
      setHistory((h) => [cover, ...h].slice(0, 12));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cover art generation failed.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <MarketingNav />
      <main className="mx-auto max-w-4xl px-4 py-10">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-white/40 hover:text-white/70 mb-6">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>

        <div className="flex items-center gap-3 mb-2">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Disc3 className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-black">AI Cover Art Generator</h1>
            <p className="text-sm text-white/45">
              Release-ready artwork with pro typography direction — {tierInfo.credits} credits
            </p>
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

        <div className="mt-6 grid gap-6 md:grid-cols-2">
          {/* ── Controls ── */}
          <div className="space-y-5 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-white/40">
                Song title
              </label>
              <input
                value={songTitle}
                onChange={(e) => setSongTitle(e.target.value)}
                placeholder="Midnight Crown"
                maxLength={120}
                className="mt-1.5 w-full rounded-xl border border-white/[0.1] bg-black/60 px-4 py-2.5 text-sm text-white placeholder:text-white/25 focus:border-primary/60 focus:outline-none"
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-white/40">
                Artist name
              </label>
              <input
                value={artistName}
                onChange={(e) => setArtistName(e.target.value)}
                placeholder="Thy Cheat Code"
                maxLength={120}
                className="mt-1.5 w-full rounded-xl border border-white/[0.1] bg-black/60 px-4 py-2.5 text-sm text-white placeholder:text-white/25 focus:border-primary/60 focus:outline-none"
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-white/40">
                Mood / genre <span className="normal-case text-white/25">(optional)</span>
              </label>
              <input
                value={mood}
                onChange={(e) => setMood(e.target.value)}
                placeholder="dark hip-hop, triumphant, late-night drive"
                maxLength={300}
                className="mt-1.5 w-full rounded-xl border border-white/[0.1] bg-black/60 px-4 py-2.5 text-sm text-white placeholder:text-white/25 focus:border-primary/60 focus:outline-none"
              />
            </div>

            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-white/40">
                Style
              </label>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {COVER_ART_STYLES.map((s) => (
                  <button
                    key={s.key}
                    onClick={() => setStyle(s.key)}
                    className={`rounded-xl border p-2.5 text-left transition ${
                      style === s.key
                        ? "border-primary/70 bg-primary/10"
                        : "border-white/[0.08] bg-white/[0.02] hover:border-white/20"
                    }`}
                  >
                    <span className={`block h-8 rounded-lg bg-gradient-to-br ${s.swatch} mb-1.5`} />
                    <span className="block text-xs font-bold">{s.label}</span>
                    <span className="block text-[10px] text-white/40">{s.blurb}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-white/40">
                Format
              </label>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {COVER_ART_RATIOS.map((r) => (
                  <button
                    key={r.key}
                    onClick={() => setAspectRatio(r.key)}
                    className={`rounded-xl border px-3 py-2.5 text-center transition ${
                      aspectRatio === r.key
                        ? "border-primary/70 bg-primary/10"
                        : "border-white/[0.08] bg-white/[0.02] hover:border-white/20"
                    }`}
                  >
                    <span className="block text-xs font-bold">{r.label}</span>
                    <span className="block text-[10px] text-white/40">{r.blurb}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-white/40">
                Detail level
              </label>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {COVER_ART_TIERS.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setTier(t.key)}
                    className={`rounded-xl border px-3 py-2.5 text-left transition ${
                      tier === t.key
                        ? "border-primary/70 bg-primary/10"
                        : "border-white/[0.08] bg-white/[0.02] hover:border-white/20"
                    }`}
                  >
                    <span className="block text-xs font-bold">
                      {t.label} <span className="text-primary">· {t.credits} cr</span>
                    </span>
                    <span className="block text-[10px] text-white/40">{t.blurb}</span>
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={generate}
              disabled={!canGenerate}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-black text-black transition hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {generating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Art-directing your cover…
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" /> Generate cover · {tierInfo.credits} credits
                </>
              )}
            </button>
            {!user && (
              <p className="text-xs text-white/35 text-center">
                Sign in to generate — your covers save to your library.
              </p>
            )}
          </div>

          {/* ── Result ── */}
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
            {!result && !generating && (
              <div className="flex h-full min-h-[320px] flex-col items-center justify-center text-center">
                <Disc3 className="h-10 w-10 text-white/15 mb-3" />
                <p className="text-sm text-white/40 max-w-[220px]">
                  Your cover art appears here — enter a song title and artist name to start.
                </p>
              </div>
            )}
            {generating && !result && (
              <div className="flex h-full min-h-[320px] flex-col items-center justify-center text-center">
                <Loader2 className="h-8 w-8 text-primary animate-spin mb-3" />
                <p className="text-sm text-white/50">AI is art-directing your cover…</p>
                <p className="text-xs text-white/30 mt-1">Concept, typography, then the artwork.</p>
              </div>
            )}
            {result && (
              <div>
                <div className="overflow-hidden rounded-xl border border-white/[0.1]">
                  <img src={result.url} alt={`${songTitle} cover art`} className="w-full" />
                </div>
                <div className="mt-3 flex gap-2">
                  <a
                    href={result.url}
                    download={`${songTitle || "cover-art"}.png`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl border border-primary/50 bg-primary/10 px-4 py-2.5 text-sm font-bold text-primary hover:bg-primary/20 transition"
                  >
                    <Download className="h-4 w-4" /> Download
                  </a>
                  <button
                    onClick={generate}
                    disabled={generating}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/[0.12] px-4 py-2.5 text-sm font-bold text-white/70 hover:border-white/25 hover:text-white transition disabled:opacity-40"
                  >
                    {generating ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                    Variation
                  </button>
                </div>
                {result.typography && (
                  <div className="mt-3 rounded-xl border border-white/[0.08] bg-black/40 p-3">
                    <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-primary/90 mb-1">
                      <Type className="h-3 w-3" /> Typography direction
                    </p>
                    <p className="text-xs text-white/55 leading-relaxed">{result.typography}</p>
                  </div>
                )}
                {result.artDirection?.palette && result.artDirection.palette.length > 0 && (
                  <div className="mt-2 flex items-center gap-2">
                    <Palette className="h-3.5 w-3.5 text-white/30" />
                    {result.artDirection.palette.map((c) => (
                      <span
                        key={c}
                        title={c}
                        className="h-6 w-6 rounded-full border border-white/20"
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Recent generations ── */}
        {history.length > 1 && (
          <div className="mt-8">
            <h2 className="text-sm font-black uppercase tracking-wider text-white/40 mb-3">
              This session
            </h2>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
              {history.map((h, i) => (
                <button
                  key={`${h.path ?? h.url}-${i}`}
                  onClick={() => setResult(h)}
                  className={`overflow-hidden rounded-xl border transition ${
                    result?.url === h.url
                      ? "border-primary/70"
                      : "border-white/[0.08] hover:border-white/25"
                  }`}
                >
                  <img src={h.url} alt={`Cover variation ${i + 1}`} className="w-full aspect-square object-cover" />
                </button>
              ))}
            </div>
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
