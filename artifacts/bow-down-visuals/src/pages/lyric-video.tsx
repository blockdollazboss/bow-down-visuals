import { useEffect, useRef, useState } from "react";
import {
  Music4, Loader2, Sparkles, Upload, ListMusic, Type, SlidersHorizontal,
  Play, Download, AlertTriangle, Check, Minus, Plus, MonitorPlay, Smartphone,
} from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import {
  formatLyricTime,
  parseLyricTime,
  validateLineTiming,
  nudgeLine,
  countUnmatchedLines,
  STYLE_META,
  ALIGN_CREDITS,
  RENDER_CREDITS,
  type LyricVideoLine,
  type LyricVideoStyleKey,
  type LyricVideoAspect,
} from "@/lib/lyric-video";

/* ─── Thy Cheat Code's AI Lyric Video Maker ───────────────────────────────
   Upload a song (or pick from your library) → paste lyrics → AI aligns
   every line to the audio with word-level karaoke timing → pick a style →
   server renders an animated lyric video (16:9 or 9:16).
   2 credits to align, 5 credits to render. Timing review is free. */

interface SongEntry {
  id: string;
  title: string;
  audio_url?: string;
}

interface AlignResponse {
  audioRef?: string;
  lines?: LyricVideoLine[];
  matchRate?: number;
  durationSec?: number | null;
  creditsRemaining?: number;
  error?: string;
  message?: string;
}

interface RenderJobResponse {
  jobId?: string;
  status?: "queued" | "processing" | "done" | "failed";
  outputUrl?: string | null;
  error?: string | null;
  message?: string;
}

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

const ASPECTS: { key: LyricVideoAspect; label: string; icon: typeof MonitorPlay }[] = [
  { key: "16:9", label: "Widescreen 16:9", icon: MonitorPlay },
  { key: "9:16", label: "Vertical 9:16", icon: Smartphone },
];

export default function LyricVideo() {
  const { user, getAccessToken, refreshProfile } = useAuth();

  /* step 1: song */
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [songs, setSongs] = useState<SongEntry[]>([]);
  const [songsLoading, setSongsLoading] = useState(false);
  const [selectedSongId, setSelectedSongId] = useState<string>("");

  /* step 2: lyrics + alignment */
  const [lyrics, setLyrics] = useState("");
  const [aligning, setAligning] = useState(false);
  const [alignment, setAlignment] = useState<AlignResponse | null>(null);
  const [lines, setLines] = useState<LyricVideoLine[]>([]);

  /* step 3: style + render */
  const [style, setStyle] = useState<LyricVideoStyleKey>("gold-luxury");
  const [aspect, setAspect] = useState<LyricVideoAspect>("16:9");
  const [rendering, setRendering] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<RenderJobResponse | null>(null);
  const pollRef = useRef<number | null>(null);

  /* shared */
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  useEffect(() => {
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, []);

  useEffect(() => {
    if (user) void loadSongs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function authedFetch(url: string, init: RequestInit) {
    const token = await getAccessToken();
    return fetch(url, {
      ...init,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    });
  }

  function handlePaidFailure(res: Response, data: { error?: string | null }): boolean {
    if (res.status === 402 || data.error === "out_of_credits") {
      setOutOfCredits(true);
      refreshProfile();
      return true;
    }
    return false;
  }

  async function loadSongs() {
    setSongsLoading(true);
    try {
      const res = await authedFetch("/api/songs", { method: "GET" });
      const data = (await res.json().catch(() => ({}))) as { songs?: SongEntry[] };
      if (res.ok && Array.isArray(data.songs)) setSongs(data.songs);
    } catch {
      /* library is optional — upload still works */
    } finally {
      setSongsLoading(false);
    }
  }

  async function alignLyrics() {
    if (aligning || !user) return;
    if (!lyrics.trim()) {
      setError("Paste your lyrics first.");
      return;
    }
    if (!audioFile && !selectedSongId) {
      setError("Upload an audio file or pick a song from your library first.");
      return;
    }
    setAligning(true);
    setError(null);
    setOutOfCredits(false);
    setAlignment(null);
    setLines([]);
    setJob(null);
    setJobId(null);
    try {
      const form = new FormData();
      form.append("lyrics", lyrics);
      if (audioFile) form.append("audio", audioFile);
      else form.append("songId", selectedSongId);
      const res = await authedFetch("/api/lyric-video/align", {
        method: "POST",
        body: form,
      });
      const data = (await res.json().catch(() => ({}))) as AlignResponse;
      if (handlePaidFailure(res, data)) return;
      if (!res.ok || !Array.isArray(data.lines) || !data.audioRef) {
        throw new Error(data.message || data.error || "Lyric alignment failed — try again.");
      }
      setAlignment(data);
      setLines(data.lines);
      refreshProfile();
      setTimeout(() => {
        document.getElementById("lyric-timing")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lyric alignment failed — try again.");
    } finally {
      setAligning(false);
    }
  }

  function updateLine(index: number, patch: Partial<LyricVideoLine>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function nudge(index: number, delta: number) {
    setLines((prev) => prev.map((l, i) => (i === index ? nudgeLine(l, delta) : l)));
  }

  async function renderVideo() {
    if (rendering || !user || !alignment?.audioRef) return;
    const bad = lines.map(validateLineTiming).find(Boolean);
    if (bad) {
      setError(bad);
      return;
    }
    setRendering(true);
    setError(null);
    setOutOfCredits(false);
    setJob(null);
    try {
      const res = await authedFetch("/api/lyric-video/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audioRef: alignment.audioRef,
          lines,
          style,
          aspect,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as RenderJobResponse;
      if (handlePaidFailure(res, data)) return;
      if (!res.ok || !data.jobId) {
        throw new Error(data.message || "Render failed to start — try again.");
      }
      setJobId(data.jobId);
      refreshProfile();
      pollRef.current = window.setInterval(() => void pollJob(data.jobId!), 4000);
      void pollJob(data.jobId!);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Render failed to start — try again.");
      setRendering(false);
    }
  }

  async function pollJob(id: string) {
    try {
      const res = await authedFetch(`/api/lyric-video/render/${id}`, { method: "GET" });
      const data = (await res.json().catch(() => ({}))) as RenderJobResponse;
      if (!res.ok) return;
      setJob(data);
      if (data.status === "done" || data.status === "failed") {
        if (pollRef.current) window.clearInterval(pollRef.current);
        pollRef.current = null;
        setRendering(false);
        refreshProfile();
        if (data.status === "failed") {
          setError(data.error || "Render failed — your credits were refunded.");
        }
      }
    } catch {
      /* keep polling */
    }
  }

  const unmatched = countUnmatchedLines(lines);
  const matchPct = alignment?.matchRate != null ? Math.round(alignment.matchRate * 100) : null;

  return (
    <div className="min-h-screen bg-black text-white">
      <MarketingNav />
      <main className="mx-auto max-w-5xl px-4 pb-24 pt-10">
        <div className="mb-8 text-center">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-primary">
            <Music4 className="h-3.5 w-3.5" /> AI Lyric Video Maker
          </div>
          <h1 className="text-3xl font-black tracking-tight sm:text-4xl">
            Turn your song into a <span className="text-primary">karaoke lyric video</span>
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-white/55">
            AI syncs every word to your audio with karaoke highlighting, then renders
            an animated video in your style. {ALIGN_CREDITS} credits to align ·{" "}
            {RENDER_CREDITS} credits to render.
          </p>
        </div>

        {outOfCredits && (
          <div className="mb-6"><OutOfCredits /></div>
        )}
        {error && (
          <div className="mb-6 flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* ── Step 1: song ── */}
        <section className="mb-6 rounded-2xl border border-white/10 bg-white/[0.02] p-6">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-bold">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/20 text-xs font-black text-primary">1</span>
            Your song
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 bg-black/40 px-4 py-8 text-center transition hover:border-primary/50">
              <Upload className="h-6 w-6 text-primary" />
              <span className="text-sm font-semibold">
                {audioFile ? audioFile.name : "Upload audio (MP3/WAV, ≤25 MB)"}
              </span>
              <span className="text-xs text-white/40">or drag & drop here</span>
              <input
                type="file"
                accept="audio/*,.mp3,.wav,.m4a,.ogg,.flac"
                className="hidden"
                onChange={(e) => {
                  setAudioFile(e.target.files?.[0] ?? null);
                  setSelectedSongId("");
                }}
              />
            </label>
            <div className="rounded-xl border border-white/10 bg-black/40 p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <ListMusic className="h-4 w-4 text-primary" /> From your song library
              </div>
              {songsLoading ? (
                <div className="flex items-center gap-2 text-xs text-white/40">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading songs…
                </div>
              ) : songs.length === 0 ? (
                <p className="text-xs text-white/40">No songs yet — upload one above, or make one in Song Studio.</p>
              ) : (
                <select
                  value={selectedSongId}
                  onChange={(e) => {
                    setSelectedSongId(e.target.value);
                    setAudioFile(null);
                  }}
                  className={inputClass}
                >
                  <option value="">Pick a song…</option>
                  {songs.map((s) => (
                    <option key={s.id} value={s.id}>{s.title}</option>
                  ))}
                </select>
              )}
            </div>
          </div>
        </section>

        {/* ── Step 2: lyrics ── */}
        <section className="mb-6 rounded-2xl border border-white/10 bg-white/[0.02] p-6">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-bold">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/20 text-xs font-black text-primary">2</span>
            Paste your lyrics
          </h2>
          <textarea
            value={lyrics}
            onChange={(e) => setLyrics(e.target.value)}
            rows={8}
            placeholder={"[Verse 1]\nWe bow down to no one…\n\n[Chorus]\nGold on gold, let the anthem play…"}
            className={`${inputClass} font-mono leading-relaxed`}
          />
          <button
            onClick={alignLyrics}
            disabled={aligning || !user}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-bold text-black transition hover:brightness-110 disabled:opacity-50"
          >
            {aligning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {aligning ? "Listening to your song…" : `Align lyrics · ${ALIGN_CREDITS} credits`}
          </button>
          <p className="mt-2 text-xs text-white/40">
            AI transcribes your audio word-by-word and maps each lyric line to its moment.
            Refunded automatically if it hears no vocals or the lyrics don't match.
          </p>
        </section>

        {/* ── Step 3: timing review ── */}
        {lines.length > 0 && (
          <section id="lyric-timing" className="mb-6 rounded-2xl border border-white/10 bg-white/[0.02] p-6">
            <h2 className="mb-2 flex items-center gap-2 text-lg font-bold">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/20 text-xs font-black text-primary">3</span>
              Fine-tune the timing <span className="text-xs font-normal text-white/40">(free)</span>
            </h2>
            {matchPct != null && (
              <p className="mb-4 text-sm text-white/55">
                Matched <span className="font-bold text-primary">{matchPct}%</span> of your words to the audio.
                {unmatched > 0 && (
                  <span className="text-amber-300"> {unmatched} line{unmatched === 1 ? "" : "s"} couldn't be matched confidently — check {unmatched === 1 ? "its" : "their"} timing below.</span>
                )}
              </p>
            )}
            <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
              {lines.map((line, i) => {
                const err = validateLineTiming(line);
                return (
                  <div
                    key={i}
                    className={`flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center ${
                      line.matched ? "border-white/10 bg-black/40" : "border-amber-400/40 bg-amber-400/5"
                    }`}
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-mono text-white/35">L{i + 1}</span>
                        {!line.matched && (
                          <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                            check timing
                          </span>
                        )}
                        {err && <span className="text-[10px] text-red-300">{err}</span>}
                      </div>
                      <p className="mt-0.5 truncate text-sm">{line.text}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => nudge(i, -0.5)}
                        title="Shift earlier 0.5s"
                        className="rounded-lg border border-white/10 p-1.5 text-white/60 hover:border-primary/50 hover:text-primary"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <input
                        value={formatLyricTime(line.startSec)}
                        onChange={(e) => {
                          const v = parseLyricTime(e.target.value);
                          if (v != null) {
                            const delta = v - line.startSec;
                            updateLine(i, nudgeLine(line, delta));
                          }
                        }}
                        className="w-20 rounded-lg border border-white/10 bg-black/60 px-2 py-1.5 text-center font-mono text-xs text-white outline-none focus:border-primary/60"
                        aria-label={`Line ${i + 1} start time`}
                      />
                      <span className="text-white/30">→</span>
                      <input
                        value={formatLyricTime(line.endSec)}
                        onChange={(e) => {
                          const v = parseLyricTime(e.target.value);
                          if (v != null) updateLine(i, { endSec: Math.round(v * 100) / 100 });
                        }}
                        className="w-20 rounded-lg border border-white/10 bg-black/60 px-2 py-1.5 text-center font-mono text-xs text-white outline-none focus:border-primary/60"
                        aria-label={`Line ${i + 1} end time`}
                      />
                      <button
                        onClick={() => nudge(i, 0.5)}
                        title="Shift later 0.5s"
                        className="rounded-lg border border-white/10 p-1.5 text-white/60 hover:border-primary/50 hover:text-primary"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Step 4: style + render ── */}
        {lines.length > 0 && (
          <section className="mb-6 rounded-2xl border border-white/10 bg-white/[0.02] p-6">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-bold">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/20 text-xs font-black text-primary">4</span>
              Style it & render
            </h2>

            <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(Object.keys(STYLE_META) as LyricVideoStyleKey[]).map((key) => (
                <button
                  key={key}
                  onClick={() => setStyle(key)}
                  className={`overflow-hidden rounded-xl border text-left transition ${
                    style === key ? "border-primary ring-1 ring-primary/50" : "border-white/10 hover:border-white/25"
                  }`}
                >
                  <div className="h-16" style={{ background: STYLE_META[key].swatch }} />
                  <div className="bg-black/60 p-3">
                    <div className="flex items-center gap-1.5 text-sm font-bold">
                      {style === key && <Check className="h-3.5 w-3.5 text-primary" />}
                      {STYLE_META[key].label}
                    </div>
                    <div className="mt-0.5 text-[11px] leading-snug text-white/45">{STYLE_META[key].blurb}</div>
                  </div>
                </button>
              ))}
            </div>

            <div className="mb-5 flex gap-2">
              {ASPECTS.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => setAspect(key)}
                  className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition ${
                    aspect === key ? "border-primary bg-primary/10 text-primary" : "border-white/10 text-white/60 hover:border-white/25"
                  }`}
                >
                  <Icon className="h-4 w-4" /> {label}
                </button>
              ))}
            </div>

            <button
              onClick={renderVideo}
              disabled={rendering || !user}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-bold text-black transition hover:brightness-110 disabled:opacity-50"
            >
              {rendering ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {rendering ? "Rendering your video…" : `Render lyric video · ${RENDER_CREDITS} credits`}
            </button>
            <p className="mt-2 flex items-center gap-1.5 text-xs text-white/40">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Server renders the full video — close the tab, it'll be waiting. Refunded automatically if the render fails.
            </p>

            {job && (
              <div className="mt-5 rounded-xl border border-white/10 bg-black/40 p-4">
                {job.status === "done" && job.outputUrl ? (
                  <div>
                    <div className="mb-3 flex items-center gap-2 text-sm font-bold text-emerald-300">
                      <Check className="h-4 w-4" /> Your lyric video is ready
                    </div>
                    <video src={job.outputUrl} controls className="w-full rounded-xl border border-white/10" />
                    <a
                      href={job.outputUrl}
                      download
                      className="mt-3 inline-flex items-center gap-2 rounded-xl border border-primary/40 px-4 py-2 text-sm font-semibold text-primary transition hover:bg-primary/10"
                    >
                      <Download className="h-4 w-4" /> Download MP4
                    </a>
                  </div>
                ) : job.status === "failed" ? (
                  <div className="flex items-center gap-2 text-sm text-red-300">
                    <AlertTriangle className="h-4 w-4" /> {job.error || "Render failed — your credits were refunded."}
                  </div>
                ) : (
                  <div className="flex items-center gap-3 text-sm text-white/60">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    {job.status === "queued" ? "Queued — your video is up next…" : "Rendering — animated background, karaoke text, your audio…"}
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {!user && (
          <p className="text-center text-sm text-white/40">
            <Type className="mr-1 inline h-4 w-4" /> Sign in to make lyric videos.
          </p>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
