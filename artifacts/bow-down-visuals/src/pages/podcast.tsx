import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  Podcast as PodcastIcon, Loader2, Play, Pause, Download, Rss,
  AlertTriangle, Sparkles, FileText, Timer, Coins, Copy, Check,
  Users, User, Music, Video, PenLine, Lightbulb,
} from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import {
  estimatePodcastCost,
  estimateTopicModeCost,
  formatDuration,
  formatTimestamp,
  MAX_SCRIPT_CHARS,
  type PodcastMode,
  type PodcastFormat,
  type PodcastChapter,
} from "@/lib/podcast";

/* ─── AI Podcast Studio ─────────────────────────────────────────────────
   Turn a script, a topic, or a video's audio into a finished podcast
   episode: AI host voices (single or dual), optional synth intro/outro
   bed, chapter markers, MP3 export, and a podcast RSS feed you can submit
   to Spotify / Apple. 3 credits per 10 minutes of audio. */

interface Voice {
  voice_id: string;
  name: string;
  preview_url?: string | null;
  category?: string | null;
}

interface GenerateResponse {
  audioUrl?: string;
  audioRef?: string;
  title?: string;
  mode?: string;
  format?: string;
  musicBed?: boolean;
  chapters?: PodcastChapter[];
  rssXml?: string;
  durationSeconds?: number;
  scriptUsed?: string;
  creditsUsed?: number;
  creditsRemaining?: number;
  creditsRequired?: number;
  error?: string;
  message?: string;
}

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

const pillClass = (active: boolean) =>
  `rounded-full px-4 py-2 text-sm font-medium transition border ${
    active
      ? "bg-primary text-black border-primary shadow-[0_0_18px_rgba(212,175,55,0.35)]"
      : "bg-white/[0.03] text-white/60 border-white/10 hover:text-white hover:border-white/25"
  }`;

const MODES: { key: PodcastMode; label: string; icon: typeof PenLine; blurb: string }[] = [
  { key: "script", label: "Script", icon: PenLine, blurb: "You write it — AI voices read it." },
  { key: "topic", label: "Topic", icon: Lightbulb, blurb: "AI writes the script, then voices it." },
  { key: "video", label: "Video", icon: Video, blurb: "Extract your video's audio as the episode." },
];

function VoicePicker({
  voices,
  loading,
  value,
  onChange,
  label,
}: {
  voices: Voice[];
  loading: boolean;
  value: string;
  onChange: (id: string) => void;
  label: string;
}) {
  const [previewing, setPreviewing] = useState<string | null>(null);

  function togglePreview(v: Voice) {
    if (!v.preview_url) return;
    const audio = document.getElementById("podcast-voice-preview") as HTMLAudioElement | null;
    if (previewing === v.voice_id && audio) {
      audio.pause();
      setPreviewing(null);
      return;
    }
    if (audio) {
      audio.src = v.preview_url;
      audio.play().catch(() => {});
      setPreviewing(v.voice_id);
      audio.onended = () => setPreviewing(null);
    }
  }

  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/50">{label}</h3>
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-white/40">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading voices…
        </div>
      ) : voices.length === 0 ? (
        <p className="text-sm text-white/40">Couldn't load voices — check your connection and refresh.</p>
      ) : (
        <div className="grid max-h-56 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
          {voices.map((v) => (
            <div
              key={v.voice_id}
              className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 transition ${
                value === v.voice_id
                  ? "border-primary/60 bg-primary/[0.07]"
                  : "border-white/10 bg-black/40 hover:border-white/25"
              }`}
            >
              <button onClick={() => onChange(v.voice_id)} className="min-w-0 flex-1 text-left">
                <div className="truncate text-sm font-medium">{v.name}</div>
                {v.category && <div className="text-xs text-white/35">{v.category}</div>}
              </button>
              {v.preview_url && (
                <button
                  onClick={() => togglePreview(v)}
                  className="rounded-full border border-white/15 p-2 text-white/60 transition hover:border-primary/50 hover:text-primary"
                  aria-label={`Preview ${v.name}`}
                >
                  {previewing === v.voice_id ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function PodcastStudio() {
  const { user, getAccessToken, refreshProfile } = useAuth();

  const [voices, setVoices] = useState<Voice[]>([]);
  const [voicesLoading, setVoicesLoading] = useState(true);

  const [mode, setMode] = useState<PodcastMode>("script");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [script, setScript] = useState("");
  const [topic, setTopic] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [format, setFormat] = useState<PodcastFormat>("single");
  const [hostVoiceId, setHostVoiceId] = useState("");
  const [coHostVoiceId, setCoHostVoiceId] = useState("");
  const [musicBed, setMusicBed] = useState(true);

  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [rssCopied, setRssCopied] = useState(false);

  const estimate =
    mode === "script" ? estimatePodcastCost(script) : estimateTopicModeCost();

  useEffect(() => {
    let cancelled = false;
    async function loadVoices() {
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/voices", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const data = (await res.json().catch(() => ({}))) as { voices?: Voice[] };
        if (cancelled) return;
        const list = Array.isArray(data.voices) ? data.voices : [];
        setVoices(list);
        if (list.length > 0) {
          if (!hostVoiceId) setHostVoiceId(list[0]!.voice_id);
          if (!coHostVoiceId && list.length > 1) setCoHostVoiceId(list[1]!.voice_id);
        }
      } catch {
        if (!cancelled) setVoices([]);
      } finally {
        if (!cancelled) setVoicesLoading(false);
      }
    }
    if (user) loadVoices();
    else setVoicesLoading(false);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  function validate(): string | null {
    if (!title.trim()) return "Give your episode a title first.";
    if (mode === "script" && !script.trim()) return "Paste your script first.";
    if (mode === "topic" && !topic.trim()) return "Give a topic first.";
    if (mode === "video" && !videoUrl.trim()) return "Paste a video URL first.";
    if (mode !== "video" && !hostVoiceId) return "Pick a host voice first.";
    if (mode !== "video" && format === "dual" && !coHostVoiceId) return "Pick a co-host voice first.";
    if (mode !== "video" && format === "dual" && coHostVoiceId === hostVoiceId)
      return "Host and co-host should be different voices.";
    return null;
  }

  async function generate() {
    if (generating || !user) return;
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setGenerating(true);
    setError(null);
    setOutOfCredits(false);
    setResult(null);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/podcast/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          mode,
          script: script.trim(),
          topic: topic.trim(),
          videoUrl: videoUrl.trim() || undefined,
          title: title.trim(),
          description: description.trim(),
          hostVoiceId: hostVoiceId || undefined,
          format,
          coHostVoiceId: coHostVoiceId || undefined,
          musicBed,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as GenerateResponse;
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || !data.audioUrl) {
        throw new Error(data.message || data.error || "Podcast generation failed — try again.");
      }
      setResult(data);
      refreshProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Podcast generation failed — try again.");
    } finally {
      setGenerating(false);
    }
  }

  function copyRss() {
    if (!result?.rssXml) return;
    navigator.clipboard.writeText(result.rssXml).then(
      () => {
        setRssCopied(true);
        setTimeout(() => setRssCopied(false), 2000);
      },
      () => setError("Couldn't copy to clipboard — use the download button instead."),
    );
  }

  function downloadRss() {
    if (!result?.rssXml) return;
    const blob = new Blob([result.rssXml], { type: "application/rss+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(result.title ?? "episode").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-feed.xml`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const creditsLabel =
    mode === "video" ? "billed on actual audio length" : `${estimate.credits} credits`;

  return (
    <div className="min-h-screen bg-black text-white">
      <MarketingNav />
      <audio id="podcast-voice-preview" className="hidden" />

      <main className="mx-auto max-w-4xl px-4 pb-24 pt-10">
        {/* header */}
        <div className="mb-8 text-center">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-primary">
            <PodcastIcon className="h-3.5 w-3.5" />
            AI Podcast Studio
          </div>
          <h1 className="text-3xl font-bold sm:text-4xl">
            Your show, <span className="text-primary">produced by AI</span>
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-sm text-white/55">
            Script, topic, or video in — finished episode out. AI hosts, intro/outro
            music, chapters, and a publish-ready RSS feed. 3 credits per 10 minutes.
          </p>
        </div>

        {outOfCredits && (
          <div className="mb-6">
            <OutOfCredits />
          </div>
        )}

        {error && (
          <div className="mb-6 flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          {/* ── left: builder ── */}
          <div className="space-y-6">
            {/* episode basics */}
            <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-white/70">
                <PodcastIcon className="h-4 w-4 text-primary" />
                Episode
              </h2>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                placeholder="Episode title — e.g. “How I blew up on TikTok”"
                className={inputClass}
              />
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                maxLength={2000}
                placeholder="Short description for your RSS feed (optional)"
                className={`${inputClass} mt-3 resize-y`}
              />
            </section>

            {/* input mode */}
            <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-white/70">
                <Sparkles className="h-4 w-4 text-primary" />
                Start from
              </h2>
              <div className="mb-4 flex flex-wrap gap-2">
                {MODES.map((m) => (
                  <button key={m.key} onClick={() => setMode(m.key)} className={pillClass(mode === m.key)}>
                    <span className="inline-flex items-center gap-1.5">
                      <m.icon className="h-3.5 w-3.5" />
                      {m.label}
                    </span>
                  </button>
                ))}
              </div>
              <p className="mb-3 text-xs text-white/35">
                {MODES.find((m) => m.key === mode)?.blurb}
              </p>

              {mode === "script" && (
                <>
                  <div className="mb-2 flex items-center justify-end gap-4 text-xs text-white/45">
                    <span className="flex items-center gap-1">
                      <FileText className="h-3.5 w-3.5" />
                      {estimate.wordCount} words
                    </span>
                    <span className="flex items-center gap-1">
                      <Timer className="h-3.5 w-3.5" />
                      ~{formatDuration(estimate.estimatedSeconds)}
                    </span>
                    <span className="flex items-center gap-1 text-primary">
                      <Coins className="h-3.5 w-3.5" />
                      {estimate.credits} credits
                    </span>
                  </div>
                  <textarea
                    value={script}
                    onChange={(e) => setScript(e.target.value)}
                    rows={10}
                    maxLength={MAX_SCRIPT_CHARS}
                    placeholder={`Paste your episode script…

Tips:
• # Headings become chapter markers
• Dual-host: prefix lines with HOST: / COHOST:`}
                    className={`${inputClass} resize-y leading-relaxed`}
                  />
                </>
              )}

              {mode === "topic" && (
                <>
                  <input
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    maxLength={300}
                    placeholder="e.g. “5 monetization mistakes new creators make”"
                    className={inputClass}
                  />
                  <p className="mt-2 text-xs text-white/35">
                    AI writes an ~8–10 minute script for you (~{estimateTopicModeCost().credits} credits of audio). You can review the script after generation.
                  </p>
                </>
              )}

              {mode === "video" && (
                <>
                  <input
                    value={videoUrl}
                    onChange={(e) => setVideoUrl(e.target.value)}
                    placeholder="https://… — direct link to your video file"
                    className={inputClass}
                  />
                  <p className="mt-2 text-xs text-white/35">
                    We extract your video's audio track and master it as the episode —
                    your own recording, no AI voices. Billed on the actual audio length.
                  </p>
                </>
              )}
            </section>

            {/* hosts — not needed for video mode */}
            {mode !== "video" && (
              <section className="space-y-5 rounded-2xl border border-white/10 bg-white/[0.02] p-5">
                <div className="flex items-center justify-between">
                  <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-white/70">
                    <Users className="h-4 w-4 text-primary" />
                    Hosts
                  </h2>
                  <div className="flex gap-2">
                    <button onClick={() => setFormat("single")} className={pillClass(format === "single")}>
                      <span className="inline-flex items-center gap-1.5">
                        <User className="h-3.5 w-3.5" /> Solo
                      </span>
                    </button>
                    <button onClick={() => setFormat("dual")} className={pillClass(format === "dual")}>
                      <span className="inline-flex items-center gap-1.5">
                        <Users className="h-3.5 w-3.5" /> Duo
                      </span>
                    </button>
                  </div>
                </div>
                {!user ? (
                  <p className="text-sm text-white/40">
                    <Link href="/login" className="text-primary underline">Sign in</Link> to browse the voice library.
                  </p>
                ) : (
                  <>
                    <VoicePicker
                      voices={voices}
                      loading={voicesLoading}
                      value={hostVoiceId}
                      onChange={setHostVoiceId}
                      label="Host voice"
                    />
                    {format === "dual" && (
                      <>
                        <VoicePicker
                          voices={voices}
                          loading={voicesLoading}
                          value={coHostVoiceId}
                          onChange={setCoHostVoiceId}
                          label="Co-host voice"
                        />
                        <p className="text-xs text-white/35">
                          Prefix script lines with <span className="text-white/60">HOST:</span> and{" "}
                          <span className="text-white/60">COHOST:</span> — or leave them off and
                          paragraphs will alternate automatically.
                        </p>
                      </>
                    )}
                  </>
                )}
              </section>
            )}

            {/* finishing touches */}
            <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-white/70">
                <Music className="h-4 w-4 text-primary" />
                Finishing touches
              </h2>
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={musicBed}
                  onChange={(e) => setMusicBed(e.target.checked)}
                  className="mt-1 h-4 w-4 accent-[#d4af37]"
                />
                <span>
                  <span className="text-sm font-medium">Intro / outro music bed</span>
                  <span className="block text-xs text-white/35">
                    A generated ambient synth bed under the open and close — included free with the episode.
                  </span>
                </span>
              </label>
            </section>

            {/* generate */}
            <button
              onClick={generate}
              disabled={generating || !user}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 py-4 text-base font-bold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {generating ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Producing your episode…
                </>
              ) : (
                <>
                  <PodcastIcon className="h-5 w-5" />
                  Produce episode · {creditsLabel}
                </>
              )}
            </button>
            {!user && (
              <p className="text-center text-sm text-white/40">
                <Link href="/login" className="text-primary underline">Sign in</Link> to produce episodes.
              </p>
            )}
          </div>

          {/* ── right: result ── */}
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-white/70">
                Your episode
              </h2>
              {!result ? (
                <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 text-center">
                  <PodcastIcon className="h-10 w-10 text-white/15" />
                  <p className="max-w-[220px] text-sm text-white/35">
                    Your finished episode lands here — MP3, chapters, and a
                    publish-ready RSS feed.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-xl border border-primary/30 bg-primary/[0.06] p-3 text-xs text-white/60">
                    <div className="font-medium text-white">{result.title}</div>
                    <div className="mt-1 capitalize">
                      {result.mode} · {result.format} host{result.format === "dual" ? "s" : ""}
                      {result.musicBed ? " · music bed" : ""}
                    </div>
                    <div className="mt-1">~{formatDuration(result.durationSeconds ?? 0)}</div>
                  </div>

                  <audio key={result.audioUrl} controls src={result.audioUrl} className="w-full" />

                  <a
                    href={result.audioUrl}
                    download={`${(result.title ?? "episode").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.mp3`}
                    className="flex items-center justify-center gap-2 rounded-xl border border-white/15 px-4 py-2.5 text-sm font-medium transition hover:border-primary/50 hover:text-primary"
                  >
                    <Download className="h-4 w-4" />
                    Download MP3
                  </a>

                  {result.scriptUsed && (
                    <details className="rounded-xl border border-white/10 bg-black/40 p-3">
                      <summary className="cursor-pointer text-xs font-medium text-white/60">
                        View AI-written script
                      </summary>
                      <p className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-white/55">
                        {result.scriptUsed}
                      </p>
                    </details>
                  )}

                  {result.chapters && result.chapters.length > 0 && (
                    <div>
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/50">
                        Chapters
                      </h3>
                      <ul className="space-y-1">
                        {result.chapters.map((c, i) => (
                          <li key={i} className="flex items-baseline gap-2 text-xs text-white/55">
                            <span className="font-mono text-primary">{formatTimestamp(c.startSeconds)}</span>
                            <span className="truncate">{c.title}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="rounded-xl border border-white/10 bg-black/40 p-3">
                    <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-white/50">
                      <Rss className="h-3.5 w-3.5 text-primary" />
                      Publish feed
                    </h3>
                    <p className="mb-3 text-xs leading-relaxed text-white/40">
                      Submit this feed to <span className="text-white/60">Spotify for Podcasters</span> and{" "}
                      <span className="text-white/60">Apple Podcasts Connect</span> to go live.
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={copyRss}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-white/15 px-3 py-2 text-xs font-medium transition hover:border-primary/50 hover:text-primary"
                      >
                        {rssCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                        {rssCopied ? "Copied" : "Copy RSS"}
                      </button>
                      <button
                        onClick={downloadRss}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-white/15 px-3 py-2 text-xs font-medium transition hover:border-primary/50 hover:text-primary"
                      >
                        <Download className="h-3.5 w-3.5" />
                        .xml
                      </button>
                    </div>
                  </div>

                  <p className="text-xs text-white/35">
                    Used {result.creditsUsed} credits · {result.creditsRemaining} remaining.
                  </p>
                </div>
              )}
            </div>
          </aside>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
