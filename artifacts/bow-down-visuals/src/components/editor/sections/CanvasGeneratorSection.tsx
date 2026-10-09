import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  Clapperboard, Loader2, Download, AlertCircle, Share2, Check,
  FolderInput, Sparkles, BadgeCheck,
} from "lucide-react";
import { EditorCard } from "@/components/editor/controls";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import { useHubProject } from "@/lib/hub-project";

interface CanvasGeneratorSectionProps {
  audioUrl?: string | null;
  coverUrl?: string | null;
  songTitle?: string;
  artistName?: string;
}

interface CanvasStyle {
  key: string;
  label: string;
  blurb: string;
}

const FALLBACK_STYLES: CanvasStyle[] = [
  { key: "zoom", label: "Slow Zoom", blurb: "Cinematic push-in on your cover art, perfectly looping" },
  { key: "pulse", label: "Beat Pulse", blurb: "Cover art breathes to your song's energy (audio optional)" },
  { key: "particles", label: "Gold Dust", blurb: "Shimmering gold particles drift over your artwork" },
  { key: "lyricFlicker", label: "Lyric Flicker", blurb: "Your lyric line flickers like a neon sign over the art" },
];

const CANVAS_COST = 150;
const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

/* ─── Spotify Canvas Generator ────────────────────────────────────────────
   DistroKid Canvas parity, docked in the video editor's export/promo chain.
   Renders an 8-second seamless-looping vertical (720x1280, silent) MP4 from
   cover art + optional song audio via POST /api/canvas/generate (150 VB,
   402 pre-check, auto-refund on failure). Deep-link prefill:
   /video-editor?tab=export&canvas=1&canvasCover=<url>&canvasAudio=<url>…
   (used by "Make a Canvas" on song results and "Animate as Canvas" on the
   cover-art page). */
export function CanvasGeneratorSection({
  audioUrl: propAudioUrl,
  coverUrl: propCoverUrl,
  songTitle: propSongTitle,
  artistName: propArtistName,
}: CanvasGeneratorSectionProps) {
  const { confirmedFetch } = useConfirmedApi();
  const { getAccessToken } = useAuth();
  const { addAsset } = useHubProject();

  const [coverUrl, setCoverUrl] = useState(propCoverUrl ?? "");
  const [audioUrl, setAudioUrl] = useState(propAudioUrl ?? "");
  const [songTitle, setSongTitle] = useState(propSongTitle ?? "");
  const [artistName, setArtistName] = useState(propArtistName ?? "");
  const [overlayText, setOverlayText] = useState("");
  const [style, setStyle] = useState("zoom");
  const [styles, setStyles] = useState<CanvasStyle[]>(FALLBACK_STYLES);
  const [attribution, setAttribution] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [addedToAssets, setAddedToAssets] = useState(false);
  const [shared, setShared] = useState(false);

  /* Deep-link prefill: ?canvasCover= ?canvasAudio= ?canvasTitle= ?canvasArtist= */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("canvas") !== "1") return;
    const cc = params.get("canvasCover");
    const ca = params.get("canvasAudio");
    const ct = params.get("canvasTitle");
    const car = params.get("canvasArtist");
    if (cc) setCoverUrl(cc);
    if (ca) setAudioUrl(ca);
    if (ct) setSongTitle(ct);
    if (car) setArtistName(car);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Load the style list from the server (drives the picker). */
  useEffect(() => {
    (async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/canvas/styles", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data.styles) && data.styles.length > 0) {
          setStyles(data.styles);
        }
      } catch {
        /* offline fallback styles stay */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canGenerate = coverUrl.trim().length > 0 && !generating &&
    (style !== "lyricFlicker" || overlayText.trim().length > 0);

  async function handleGenerate() {
    if (!canGenerate) return;
    setGenerating(true);
    setError(null);
    setOutOfCredits(false);
    setResultUrl(null);
    setAddedToAssets(false);
    try {
      const res = await confirmedFetch("/api/canvas/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          coverUrl: coverUrl.trim(),
          audioUrl: audioUrl.trim() || undefined,
          style,
          overlayText: style === "lyricFlicker" ? overlayText.trim() : undefined,
          songTitle: songTitle.trim() || undefined,
          artistName: artistName.trim() || undefined,
          /* Virality: burn the gold "Made with Bow Down Visuals" tag (opt-in; paid export). */
          attribution,
        }),
      });
      if (!res) {
        /* User cancelled the credit confirmation. */
        setGenerating(false);
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 402) {
          setOutOfCredits(true);
        } else {
          setError(data.error || "Canvas generation failed. Your Visual Bucs were refunded.");
        }
        return;
      }
      setResultUrl(data.url as string);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Canvas generation failed.");
    } finally {
      setGenerating(false);
    }
  }

  function handleAddToReleaseAssets() {
    if (!resultUrl) return;
    const label = [artistName.trim(), songTitle.trim()].filter(Boolean).join(" — ") || "Spotify Canvas";
    addAsset({
      kind: "video",
      url: resultUrl,
      label: `Spotify Canvas — ${label}`,
      detail: `8s seamless 720x1280 loop (${styles.find((s) => s.key === style)?.label ?? style})`,
      meta: { canvas: "true", canvasStyle: style, attribution: attribution ? "true" : "false" },
    });
    setAddedToAssets(true);
  }

  async function handleShare() {
    if (!resultUrl) return;
    const caption = [artistName.trim(), songTitle.trim()].filter(Boolean).join(" — ");
    const text = `My new Spotify Canvas${caption ? ` for “${caption}”` : ""} — an 8-second loop that plays behind my track.${attribution ? " Made with Bow Down Visuals 🦈" : ""}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "My Spotify Canvas", text, url: resultUrl });
      } else {
        await navigator.clipboard.writeText(`${text}\n${resultUrl}`);
      }
      setShared(true);
      setTimeout(() => setShared(false), 2000);
    } catch {
      /* user cancelled or clipboard unavailable */
    }
  }

  return (
    <EditorCard
      title="Spotify Canvas Generator"
      subtitle="8-second seamless vertical loop (720×1280, silent) — the visual that plays behind your track on Spotify. DistroKid Canvas parity, rendered locally."
      icon={<Clapperboard className="h-4 w-4" />}
      right={
        <span className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[11px] font-black text-primary">
          {CANVAS_COST} VB
        </span>
      }
    >
      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-widest text-white/50">
              Cover art URL <span className="text-primary">*</span>
            </label>
            <input
              className={inputClass}
              value={coverUrl}
              onChange={(e) => setCoverUrl(e.target.value)}
              placeholder="https://… your single/EP cover art"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-widest text-white/50">
              Song audio URL <span className="font-normal normal-case text-white/30">(optional — drives the Beat Pulse energy)</span>
            </label>
            <input
              className={inputClass}
              value={audioUrl}
              onChange={(e) => setAudioUrl(e.target.value)}
              placeholder="https://… your song audio (kept silent in the Canvas per Spotify spec)"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-widest text-white/50">Song title</label>
              <input className={inputClass} value={songTitle} onChange={(e) => setSongTitle(e.target.value)} placeholder="Midnight Gold" />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-widest text-white/50">Artist name</label>
              <input className={inputClass} value={artistName} onChange={(e) => setArtistName(e.target.value)} placeholder="Your artist name" />
            </div>
          </div>
          {style === "lyricFlicker" && (
            <div>
              <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-widest text-white/50">
                Lyric line <span className="text-primary">*</span>
              </label>
              <input
                className={inputClass}
                value={overlayText}
                maxLength={60}
                onChange={(e) => setOverlayText(e.target.value)}
                placeholder="The one line that defines the song"
              />
            </div>
          )}
          <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3">
            <input
              type="checkbox"
              checked={attribution}
              onChange={(e) => setAttribution(e.target.checked)}
              className="h-4 w-4 accent-[#d4af37]"
            />
            <span className="text-sm text-white/70">
              <BadgeCheck className="mr-1.5 inline h-4 w-4 text-primary" />
              Add “Made with Bow Down Visuals” credit — burned into the video + on share
            </span>
          </label>
          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {outOfCredits && <OutOfCredits onClose={() => setOutOfCredits(false)} />}
          <button
            type="button"
            onClick={handleGenerate}
            disabled={!canGenerate}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#d4af37] to-[#f5d76e] px-6 py-3 text-sm font-black uppercase tracking-wider text-black shadow-[0_0_24px_rgba(212,175,55,0.35)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
          >
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {generating ? "Rendering your loop…" : `Generate Canvas — ${CANVAS_COST} VB`}
          </button>
          {generating && (
            <p className="text-xs text-white/40">
              Compositing cover art → animating a seamless 8s loop → encoding 720×1280 MP4. Keep this tab open; it usually takes under a minute.
            </p>
          )}
        </div>

        <div className="space-y-3">
          <p className="text-[11px] font-bold uppercase tracking-widest text-white/50">Loop style</p>
          <div className="grid grid-cols-2 gap-2">
            {styles.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setStyle(s.key)}
                className={`rounded-xl border p-3 text-left transition ${
                  style === s.key
                    ? "border-primary/70 bg-primary/10 shadow-[0_0_16px_rgba(212,175,55,0.25)]"
                    : "border-white/10 bg-white/[0.02] hover:border-white/25"
                }`}
              >
                <p className={`text-xs font-black ${style === s.key ? "text-primary" : "text-white/80"}`}>{s.label}</p>
                <p className="mt-1 text-[11px] leading-snug text-white/40">{s.blurb}</p>
              </button>
            ))}
          </div>
          {resultUrl && (
            <div className="rounded-xl border border-primary/30 bg-primary/[0.06] p-3">
              <video
                src={resultUrl}
                className="mx-auto aspect-[9/16] w-full max-w-[180px] rounded-lg border border-white/10"
                autoPlay
                loop
                muted
                playsInline
              />
              <div className="mt-3 flex flex-col gap-2">
                <a
                  href={resultUrl}
                  download="spotify-canvas.mp4"
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-white/10 px-4 py-2.5 text-xs font-black uppercase tracking-wider text-white transition hover:bg-white/20"
                >
                  <Download className="h-4 w-4" /> Download MP4
                </a>
                <button
                  type="button"
                  onClick={handleAddToReleaseAssets}
                  disabled={addedToAssets}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-primary/50 bg-primary/10 px-4 py-2.5 text-xs font-black uppercase tracking-wider text-primary transition hover:bg-primary/20 disabled:opacity-60"
                >
                  {addedToAssets ? <Check className="h-4 w-4" /> : <FolderInput className="h-4 w-4" />}
                  {addedToAssets ? "Added to release assets" : "Add to release assets"}
                </button>
                {addedToAssets && (
                  <Link
                    href="/coach?tab=distribute"
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-xs font-black uppercase tracking-wider text-white/70 transition hover:text-white"
                  >
                    Continue to Distribute →
                  </Link>
                )}
                <button
                  type="button"
                  onClick={handleShare}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-xs font-black uppercase tracking-wider text-white/70 transition hover:text-white"
                >
                  {shared ? <Check className="h-4 w-4 text-emerald-400" /> : <Share2 className="h-4 w-4" />}
                  {shared ? "Shared!" : "Share canvas"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </EditorCard>
  );
}
