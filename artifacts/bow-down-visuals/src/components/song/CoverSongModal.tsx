import { useEffect, useRef, useState } from "react";
import { Loader2, X, Disc3, Mic2, Palette, Scale, Link2, Check, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useToast } from "@/hooks/use-toast";
import { CoverComparePlayer } from "./CoverComparePlayer";

/* ─── CoverSongModal ────────────────────────────────────────────────────────
   "Make a cover" — Suno Cover parity, docked inside Song Maker results and
   the song library (no new page, no new sidebar item).

   Simple mode (default): pick a style preset → one click.
   Custom mode: cover title, full style prompt, vocal direction
   (Auto/Male/Female — matching Song Maker), tempo shift, lyrics.

   After generation the result chains into:
     → Make lyric video  (karaoke-video on the cover, needs lyrics)
     → Design cover art  (cover-art for the cover title)
     → Compare A/B       (original vs cover side-by-side player)
   Virality: one-click share link carries ?ref=CODE and every shared player
   shows the "Made with Bow Down Visuals" line. */

export interface CoverSource {
  /** Library song id — becomes the cover's parent_song_id. */
  songId?: string;
  title: string;
  /** Must be a real URL (not blob:) — the server downloads it for the duration probe. */
  audioUrl: string;
  artistName?: string;
}

export interface CoverRecord {
  id: string;
  title: string;
  audio_url: string;
  source: string;
  parent_song_id: string | null;
  created_at: string;
}

interface CoverSongModalProps {
  open: boolean;
  onClose: () => void;
  source: CoverSource | null;
  initialLyrics?: string;
  initialTitle?: string;
  onCoverCreated?: (cover: CoverRecord) => void;
}

interface StylePreset {
  key: string;
  label: string;
  stylePrompt: string;
}

type Phase = "form" | "generating" | "done";

const MADE_WITH = "Made with Bow Down Visuals";

function formatLrcTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  const cs = Math.floor((totalSeconds % 1) * 100);
  return `[${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}]`;
}

/** Evenly distribute lyric lines across the audio duration as LRC. */
function lyricsToLrc(lyrics: string, durationSec: number): string {
  const lines = lyrics
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^\[.*\]$/.test(l) && !/^(verse|chorus|hook|bridge|outro|intro|pre-chorus)/i.test(l));
  if (lines.length === 0) return "";
  const step = Math.max(durationSec / lines.length, 1);
  return lines.map((l, i) => `${formatLrcTime(1 + i * step)}${l}`).join("\n");
}

function audioDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    const el = document.createElement("audio");
    el.preload = "metadata";
    el.onloadedmetadata = () => resolve(el.duration && isFinite(el.duration) ? el.duration : 180);
    el.onerror = () => resolve(180);
    el.src = url;
    setTimeout(() => resolve(180), 8000);
  });
}

export function CoverSongModal({ open, onClose, source, initialLyrics = "", initialTitle = "", onCoverCreated }: CoverSongModalProps) {
  const { confirmedFetch } = useConfirmedApi();
  const { toast } = useToast();
  const [mode, setMode] = useState<"simple" | "custom">("simple");
  const [presets, setPresets] = useState<StylePreset[]>([]);
  const [presetKey, setPresetKey] = useState<string>("");
  const [title, setTitle] = useState("");
  const [stylePrompt, setStylePrompt] = useState("");
  const [vocalGender, setVocalGender] = useState<"auto" | "male" | "female">("auto");
  const [tempoShift, setTempoShift] = useState(0);
  const [lyrics, setLyrics] = useState("");
  const [phase, setPhase] = useState<Phase>("form");
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [cover, setCover] = useState<CoverRecord | null>(null);
  const [coverUrl, setCoverUrl] = useState("");
  const [coverApproach, setCoverApproach] = useState("");
  const [compareOpen, setCompareOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  // Handoff state
  const [lyricBusy, setLyricBusy] = useState(false);
  const [lyricVideoUrl, setLyricVideoUrl] = useState<string | null>(null);
  const [lyricError, setLyricError] = useState<string | null>(null);
  const [artBusy, setArtBusy] = useState(false);
  const [artUrl, setArtUrl] = useState<string | null>(null);
  const [artError, setArtError] = useState<string | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Reset every time the modal opens on a (possibly new) source.
  useEffect(() => {
    if (!open) return;
    setMode("simple");
    setTitle(initialTitle);
    setStylePrompt("");
    setVocalGender("auto");
    setTempoShift(0);
    setLyrics(initialLyrics);
    setPhase("form");
    setError(null);
    setOutOfCredits(false);
    setCover(null);
    setCoverUrl("");
    setCoverApproach("");
    setCompareOpen(false);
    setCopied(false);
    setLyricVideoUrl(null);
    setLyricError(null);
    setArtUrl(null);
    setArtError(null);
    let cancelled = false;
    (async () => {
      try {
        const res = await confirmedFetch("/api/song-cover/presets", { skipConfirm: true });
        if (!res || cancelled) return;
        const data = (await res.json()) as { presets?: StylePreset[] };
        if (data.presets?.length) {
          setPresets(data.presets);
          setPresetKey((k) => k || data.presets![0]!.key);
        }
      } catch {
        /* presets are optional — the server falls back to a default */
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, source?.songId, source?.audioUrl]);

  if (!open || !source) return null;
  /* Narrowed once — closures below capture `src`, not the nullable prop. */
  const src: CoverSource = source;

  const selectedPreset = presets.find((p) => p.key === presetKey);
  const canGenerate =
    phase === "form" &&
    (mode === "simple" ? !!presetKey : stylePrompt.trim().length > 0);

  async function handleGenerate() {
    if (!canGenerate) return;
    setPhase("generating");
    setError(null);
    setOutOfCredits(false);
    try {
      const body: Record<string, unknown> = {
        audioUrl: src.audioUrl,
        vocalGender,
        tempoShift,
      };
      if (src.songId) body.songId = src.songId;
      if (mode === "simple") body.stylePreset = presetKey;
      else body.stylePrompt = stylePrompt.trim();
      if (lyrics.trim()) body.lyrics = lyrics.trim();
      if (title.trim()) body.title = title.trim();
      if (src.artistName) body.artistName = src.artistName;

      const res = await confirmedFetch("/api/song-cover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res) { setPhase("form"); return; } // user cancelled the credit confirm
      const data = (await res.json()) as {
        song?: CoverRecord; audioUrl?: string; coverApproach?: string;
        error?: string; message?: string;
      };
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        setPhase("form");
        return;
      }
      if (!res.ok || !data.song || !data.audioUrl) {
        throw new Error(data.error || data.message || "Cover generation failed. Please try again.");
      }
      setCover(data.song);
      setCoverUrl(data.audioUrl);
      setCoverApproach(data.coverApproach ?? "");
      setPhase("done");
      onCoverCreated?.(data.song);
      toast({ title: "Cover created", description: `"${data.song.title}" is in your song library.` });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cover generation failed. Please try again.");
      setPhase("form");
    }
  }

  async function handleLyricVideo() {
    if (!cover || lyricBusy) return;
    if (!lyrics.trim()) {
      toast({ title: "Lyrics needed", description: "Add the song lyrics above to make a lyric video.", variant: "destructive" });
      return;
    }
    setLyricBusy(true);
    setLyricError(null);
    try {
      const duration = await audioDuration(coverUrl);
      const lrc = lyricsToLrc(lyrics, duration);
      if (!lrc) throw new Error("Could not build lyric timing from the lyrics.");
      const res = await confirmedFetch("/api/karaoke-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audioUrl: coverUrl,
          lrc,
          title: cover.title,
          artist: src.artistName ?? "",
          theme: "gold-luxury",
        }),
      });
      if (!res) return;
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error || "Lyric video failed. Please try again.");
      setLyricVideoUrl(data.url);
    } catch (e) {
      setLyricError(e instanceof Error ? e.message : "Lyric video failed. Please try again.");
    } finally {
      setLyricBusy(false);
    }
  }

  async function handleCoverArt() {
    if (!cover || artBusy) return;
    setArtBusy(true);
    setArtError(null);
    try {
      const res = await confirmedFetch("/api/cover-art", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          songTitle: cover.title,
          artistName: src.artistName?.trim() || "Unknown Artist",
          mood: selectedPreset ? `Cover artwork in a ${selectedPreset.stylePrompt} mood` : "Cover artwork for this song cover",
        }),
      });
      if (!res) return;
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error || "Cover art failed. Please try again.");
      setArtUrl(data.url);
    } catch (e) {
      setArtError(e instanceof Error ? e.message : "Cover art failed. Please try again.");
    } finally {
      setArtBusy(false);
    }
  }

  async function handleShare() {
    // One-click share: the creator's referral link (every share is an earning loop).
    let code = "";
    try {
      const res = await confirmedFetch("/api/referrals/me", { skipConfirm: true });
      if (res?.ok) {
        const data = (await res.json()) as { code?: string };
        if (data.code) code = data.code;
      }
    } catch {
      /* share works without the code too */
    }
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const link = code ? `${origin}/?ref=${encodeURIComponent(code)}` : `${origin}/`;
    const text = `"${cover?.title ?? src.title}" — a fresh cover ${MADE_WITH} 🎵\n${coverUrl || src.audioUrl}\nGet the cheat code: ${link}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast({ title: "Share text copied", description: "Paste it anywhere — your referral link is inside." });
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast({ title: "Copy failed", description: "Your browser blocked clipboard access.", variant: "destructive" });
    }
  }

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-6"
      onClick={(e) => { if (e.target === overlayRef.current && phase !== "generating") onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Make a cover"
    >
      <div className="w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-[#0a0a0a] border border-primary/25 shadow-[0_0_60px_-10px_rgba(255,200,60,0.25)]">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-5 py-4 bg-[#0a0a0a]/95 backdrop-blur border-b border-white/10">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-9 w-9 rounded-xl bg-primary/10 border border-primary/30 flex items-center justify-center shrink-0">
              <Disc3 className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-white truncate">Make a cover</p>
              <p className="text-xs text-white/40 truncate">of “{src.title}” · 400 Visual Bucs</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={phase === "generating"}
            className="rounded-lg p-2 text-white/50 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-40"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-5 py-5 space-y-5">
          {phase !== "done" && (
            <>
              {/* Mode toggle */}
              <div className="flex gap-2">
                {(["simple", "custom"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={`px-5 py-2.5 rounded-xl font-medium transition-all capitalize ${
                      mode === m ? "bg-primary text-black" : "bg-white/5 text-white/60 hover:bg-white/10"
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>

              {mode === "simple" ? (
                <div>
                  <p className="text-sm font-medium text-white/70 mb-2">Pick a new style</p>
                  <div className="flex flex-wrap gap-2">
                    {presets.map((p) => (
                      <button
                        key={p.key}
                        type="button"
                        onClick={() => setPresetKey(p.key)}
                        className={`px-4 py-2 rounded-lg text-sm transition-all border ${
                          presetKey === p.key
                            ? "bg-primary/15 border-primary/60 text-primary font-semibold"
                            : "bg-white/5 border-white/10 text-white/70 hover:border-primary/40"
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                    {presets.length === 0 && (
                      <p className="text-xs text-white/40">Loading styles…</p>
                    )}
                  </div>
                  {selectedPreset && (
                    <p className="text-xs text-white/40 mt-2">{selectedPreset.stylePrompt}</p>
                  )}
                  <Button
                    type="button"
                    onClick={() => void handleGenerate()}
                    disabled={!canGenerate}
                    className="w-full mt-5 gold-glow font-bold text-base rounded-xl gap-2"
                    style={{ height: "52px" }}
                  >
                    <Disc3 className="h-5 w-5" />
                    Create Cover · 400 Visual Bucs
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-white/70 mb-1.5">Cover title</label>
                    <input
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder={`${src.title} (Cover)`}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/30 focus:outline-none focus:border-primary/50"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-white/70 mb-1.5">New style</label>
                    <textarea
                      value={stylePrompt}
                      onChange={(e) => setStylePrompt(e.target.value)}
                      placeholder="e.g. a smoky jazz-club cover with upright bass, brushed drums and a late-night vocal…"
                      rows={3}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/30 focus:outline-none focus:border-primary/50 resize-none"
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-white/70 mb-1.5">Vocals</label>
                      <div className="flex gap-2">
                        {(["auto", "male", "female"] as const).map((g) => (
                          <button
                            key={g}
                            type="button"
                            onClick={() => setVocalGender(g)}
                            className={`flex-1 px-3 py-2 rounded-lg text-sm capitalize transition-all border ${
                              vocalGender === g
                                ? "bg-primary/15 border-primary/60 text-primary font-semibold"
                                : "bg-white/5 border-white/10 text-white/70 hover:border-primary/40"
                            }`}
                          >
                            {g}
                          </button>
                        ))}
                      </div>
                      <p className="text-[11px] text-white/30 mt-1">Auto keeps the original's vocal feel.</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-white/70 mb-1.5">
                        Tempo shift <span className="text-primary font-bold">{tempoShift > 0 ? `+${tempoShift}` : tempoShift}%</span>
                      </label>
                      <input
                        type="range"
                        min={-20}
                        max={20}
                        step={1}
                        value={tempoShift}
                        onChange={(e) => setTempoShift(Number(e.target.value))}
                        className="w-full accent-[#FFD700]"
                      />
                      <div className="flex justify-between text-[11px] text-white/30">
                        <span>-20% slower</span>
                        <span>original</span>
                        <span>+20% faster</span>
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-white/70 mb-1.5">
                      Lyrics <span className="text-white/30 font-normal">(carried into the cover — optional)</span>
                    </label>
                    <textarea
                      value={lyrics}
                      onChange={(e) => setLyrics(e.target.value)}
                      placeholder="Paste the lyrics so the cover keeps the same words…"
                      rows={4}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/30 focus:outline-none focus:border-primary/50 resize-none"
                    />
                  </div>
                  <Button
                    type="button"
                    onClick={() => void handleGenerate()}
                    disabled={!canGenerate}
                    className="w-full gold-glow font-bold text-base rounded-xl gap-2"
                    style={{ height: "52px" }}
                  >
                    <Disc3 className="h-5 w-5" />
                    Create Cover · 400 Visual Bucs
                  </Button>
                </div>
              )}

              {outOfCredits && (
                <div className="p-4 rounded-xl border border-red-500/20 bg-red-500/5 flex items-start gap-2.5">
                  <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                  <p className="text-sm text-red-300">Not enough Visual Bucs for this cover (400). Top up your balance to keep creating.</p>
                </div>
              )}
              {error && (
                <div className="p-4 rounded-xl border border-red-500/20 bg-red-500/5 flex items-start gap-2.5">
                  <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                  <p className="text-sm text-red-300">{error}</p>
                </div>
              )}
            </>
          )}

          {phase === "generating" && (
            <div className="py-10 flex flex-col items-center text-center gap-3">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
              <p className="text-white font-semibold">Reimagining “{src.title}”…</p>
              <p className="text-xs text-white/40 max-w-sm">
                Generating the cover arrangement in the new style. This takes a little while — keep this open.
              </p>
            </div>
          )}

          {phase === "done" && cover && (
            <div className="space-y-4">
              <div className="rounded-xl border border-primary/30 bg-primary/[0.05] p-4">
                <p className="text-sm font-bold text-white mb-2">{cover.title}</p>
                <audio controls src={coverUrl} className="w-full h-9" />
                <p className="text-[11px] text-white/35 mt-2 leading-relaxed">{coverApproach}</p>
                <p className="text-[11px] text-primary/80 font-semibold mt-1">{MADE_WITH}</p>
              </div>

              {/* Handoff chain */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => void handleLyricVideo()}
                  disabled={lyricBusy || !!lyricVideoUrl}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-3 py-2.5 text-sm font-semibold text-white/80 hover:text-white hover:border-primary/50 hover:bg-primary/5 transition-all disabled:opacity-50"
                >
                  {lyricBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic2 className="h-4 w-4" />}
                  {lyricVideoUrl ? "Lyric video ready" : "Make lyric video"}
                </button>
                <button
                  type="button"
                  onClick={() => void handleCoverArt()}
                  disabled={artBusy || !!artUrl}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-3 py-2.5 text-sm font-semibold text-white/80 hover:text-white hover:border-primary/50 hover:bg-primary/5 transition-all disabled:opacity-50"
                >
                  {artBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Palette className="h-4 w-4" />}
                  {artUrl ? "Cover art ready" : "Design cover art"}
                </button>
                <button
                  type="button"
                  onClick={() => setCompareOpen((v) => !v)}
                  className={`inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold transition-all ${
                    compareOpen
                      ? "border-primary/60 bg-primary/10 text-primary"
                      : "border-white/15 bg-white/[0.04] text-white/80 hover:text-white hover:border-primary/50 hover:bg-primary/5"
                  }`}
                >
                  <Scale className="h-4 w-4" />
                  Compare A/B
                </button>
                <button
                  type="button"
                  onClick={() => void handleShare()}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-3 py-2.5 text-sm font-semibold text-white/80 hover:text-white hover:border-primary/50 hover:bg-primary/5 transition-all"
                >
                  {copied ? <Check className="h-4 w-4 text-green-400" /> : <Link2 className="h-4 w-4" />}
                  {copied ? "Copied!" : "Copy share link"}
                </button>
              </div>
              {lyricError && <p className="text-xs text-red-400">{lyricError}</p>}
              {artError && <p className="text-xs text-red-400">{artError}</p>}

              {lyricVideoUrl && (
                <div className="rounded-xl overflow-hidden border border-white/10">
                  <video controls src={lyricVideoUrl} className="w-full max-h-64 bg-black" />
                </div>
              )}
              {artUrl && (
                <div className="rounded-xl overflow-hidden border border-white/10">
                  <img src={artUrl} alt={`${cover.title} cover art`} className="w-full max-h-64 object-cover" />
                </div>
              )}
              {compareOpen && (
                <CoverComparePlayer
                  original={{ title: src.title, audioUrl: src.audioUrl }}
                  cover={{ title: cover.title, audioUrl: coverUrl }}
                />
              )}

              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                className="w-full rounded-xl border-white/15 text-white/80"
              >
                Done
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
