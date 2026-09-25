import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  Mic, Loader2, Play, Pause, Download, Clapperboard, Volume2,
  AlertTriangle, Sparkles, FileText, Timer, Coins,
} from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { OutOfCredits } from "@/components/OutOfCredits";
import {
  EMOTIONS,
  estimateVoiceoverCost,
  formatDuration,
  saveVoiceoverHandoff,
  type VoiceoverEmotion,
} from "@/lib/voiceover";

/* ─── AI Voiceover Studio ───────────────────────────────────────────────
   Paste a script, pick a voice + emotional direction, get studio-quality
   narration audio (ElevenLabs TTS) at 2 credits per minute. Export MP3/WAV,
   or hand the voiceover straight to the video editor. */

interface Voice {
  voice_id: string;
  name: string;
  preview_url?: string | null;
  category?: string | null;
}

interface GenerateResponse {
  audioUrl?: string;
  audioRef?: string;
  format?: "mp3" | "wav";
  emotion?: string;
  voiceId?: string;
  wordCount?: number;
  estimatedSeconds?: number;
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

export default function VoiceoverStudio() {
  const { user, getAccessToken, refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();

  /* voices */
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voicesLoading, setVoicesLoading] = useState(true);
  const [voiceId, setVoiceId] = useState("");
  const [previewing, setPreviewing] = useState<string | null>(null);

  /* script + options */
  const [script, setScript] = useState("");
  const [emotion, setEmotion] = useState<VoiceoverEmotion>("conversational");
  const [format, setFormat] = useState<"mp3" | "wav">("mp3");
  const [speed, setSpeed] = useState(1.0);

  /* result */
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [generating, setGenerating] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  const estimate = estimateVoiceoverCost(script);

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
        if (list.length > 0 && !voiceId) setVoiceId(list[0]!.voice_id);
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

  function togglePreview(v: Voice) {
    if (!v.preview_url) return;
    const audio = document.getElementById("voice-preview") as HTMLAudioElement | null;
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

  async function generate() {
    if (generating || !user) return;
    if (!script.trim()) {
      setError("Paste your script first.");
      return;
    }
    if (!voiceId) {
      setError("Pick a voice first.");
      return;
    }
    setGenerating(true);
    setError(null);
    setOutOfCredits(false);
    setResult(null);
    try {
      const token = await getAccessToken();
      const res = await confirmedFetch("/api/voiceover/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          script: script.trim(),
          voiceId,
          emotion,
          format,
          speed,
        }),
        overrideCost: estimate.credits,
        overrideFeature: "AI Voiceover",
      });
      if (!res) return; // user cancelled the credit confirmation (finally resets state)
      const data = (await res.json().catch(() => ({}))) as GenerateResponse;
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || !data.audioUrl) {
        throw new Error(data.message || data.error || "Voiceover failed — try again.");
      }
      setResult(data);
      refreshProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Voiceover failed — try again.");
    } finally {
      setGenerating(false);
    }
  }

  function sendToEditor() {
    if (!result?.audioUrl) return;
    saveVoiceoverHandoff({
      audioUrl: result.audioUrl,
      format: result.format ?? "mp3",
      wordCount: result.wordCount ?? 0,
      createdAt: Date.now(),
    });
    window.location.href = "/video-editor";
  }

  const selectedVoice = voices.find((v) => v.voice_id === voiceId);

  return (
    <div className="min-h-screen bg-black text-white">
      <MarketingNav />
      <audio id="voice-preview" className="hidden" />

      <main className="mx-auto max-w-4xl px-4 pb-24 pt-10">
        {/* header */}
        <div className="mb-8 text-center">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-primary">
            <Mic className="h-3.5 w-3.5" />
            AI Voiceover Studio
          </div>
          <h1 className="text-3xl font-bold sm:text-4xl">
            Studio narration, <span className="text-primary">on demand</span>
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-sm text-white/55">
            Paste your script, pick a voice and a direction — get broadcast-quality
            voiceover audio ready to layer under your video. 2 credits per minute.
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
          {/* ── left: script + options ── */}
          <div className="space-y-6">
            {/* script editor */}
            <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-white/70">
                  <FileText className="h-4 w-4 text-primary" />
                  Your script
                </h2>
                <div className="flex items-center gap-4 text-xs text-white/45">
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
              </div>
              <textarea
                value={script}
                onChange={(e) => setScript(e.target.value)}
                rows={10}
                maxLength={18000}
                placeholder="Paste your narration script here…

Tip: write it the way you'd say it. Short sentences land better than long ones."
                className={`${inputClass} resize-y leading-relaxed`}
              />
            </section>

            {/* voice picker */}
            <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-white/70">
                <Volume2 className="h-4 w-4 text-primary" />
                Voice
              </h2>
              {voicesLoading ? (
                <div className="flex items-center gap-2 text-sm text-white/40">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading voices…
                </div>
              ) : voices.length === 0 ? (
                <p className="text-sm text-white/40">
                  {user
                    ? "Couldn't load voices — check your connection and refresh."
                    : <Link href="/login" className="text-primary underline">Sign in</Link>}
                  {" "}to browse the voice library.
                </p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {voices.map((v) => (
                    <div
                      key={v.voice_id}
                      className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 transition ${
                        voiceId === v.voice_id
                          ? "border-primary/60 bg-primary/[0.07]"
                          : "border-white/10 bg-black/40 hover:border-white/25"
                      }`}
                    >
                      <button
                        onClick={() => setVoiceId(v.voice_id)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="truncate text-sm font-medium">{v.name}</div>
                        {v.category && (
                          <div className="text-xs text-white/35">{v.category}</div>
                        )}
                      </button>
                      {v.preview_url && (
                        <button
                          onClick={() => togglePreview(v)}
                          className="rounded-full border border-white/15 p-2 text-white/60 transition hover:border-primary/50 hover:text-primary"
                          aria-label={`Preview ${v.name}`}
                        >
                          {previewing === v.voice_id ? (
                            <Pause className="h-3.5 w-3.5" />
                          ) : (
                            <Play className="h-3.5 w-3.5" />
                          )}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* emotion */}
            <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-white/70">
                <Sparkles className="h-4 w-4 text-primary" />
                Direction
              </h2>
              <div className="flex flex-wrap gap-2">
                {EMOTIONS.map((e) => (
                  <button
                    key={e.key}
                    onClick={() => setEmotion(e.key)}
                    className={pillClass(emotion === e.key)}
                    title={e.blurb}
                  >
                    {e.label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-white/35">
                {EMOTIONS.find((e) => e.key === emotion)?.blurb}
              </p>

              {/* speed */}
              <div className="mt-4">
                <label className="mb-1 flex justify-between text-xs text-white/50">
                  <span>Speaking speed</span>
                  <span className="text-white/70">{speed.toFixed(2)}×</span>
                </label>
                <input
                  type="range"
                  min={0.7}
                  max={1.2}
                  step={0.05}
                  value={speed}
                  onChange={(e) => setSpeed(Number(e.target.value))}
                  className="w-full accent-[#d4af37]"
                />
              </div>

              {/* format */}
              <div className="mt-4 flex gap-2">
                {(["mp3", "wav"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFormat(f)}
                    className={pillClass(format === f)}
                  >
                    {f.toUpperCase()}
                  </button>
                ))}
                <span className="self-center text-xs text-white/35">
                  WAV is lossless — better for mixing under video.
                </span>
              </div>
            </section>

            {/* generate */}
            <button
              onClick={generate}
              disabled={generating || !user || !script.trim() || !voiceId}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 py-4 text-base font-bold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {generating ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Directing your voiceover…
                </>
              ) : (
                <>
                  <Mic className="h-5 w-5" />
                  Generate voiceover · {estimate.credits} credits
                </>
              )}
            </button>
            {!user && (
              <p className="text-center text-sm text-white/40">
                <Link href="/login" className="text-primary underline">Sign in</Link> to generate voiceovers.
              </p>
            )}
          </div>

          {/* ── right: result ── */}
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-white/70">
                Your voiceover
              </h2>
              {!result ? (
                <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 text-center">
                  <Mic className="h-10 w-10 text-white/15" />
                  <p className="max-w-[220px] text-sm text-white/35">
                    Your finished narration will appear here — ready to download
                    or send to the video editor.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-xl border border-primary/30 bg-primary/[0.06] p-3 text-xs text-white/60">
                    <div className="font-medium text-white">{selectedVoice?.name ?? "Voiceover"}</div>
                    <div className="mt-1 capitalize">{result.emotion} · {result.format?.toUpperCase()}</div>
                    <div className="mt-1">
                      {result.wordCount} words · ~{formatDuration(result.estimatedSeconds ?? 0)}
                    </div>
                  </div>
                  <audio
                    key={result.audioUrl}
                    controls
                    src={result.audioUrl}
                    className="w-full"
                    onPlay={() => setPlaying(true)}
                    onPause={() => setPlaying(false)}
                  />
                  <div className="flex flex-col gap-2">
                    <a
                      href={result.audioUrl}
                      download={`voiceover.${result.format ?? "mp3"}`}
                      className="flex items-center justify-center gap-2 rounded-xl border border-white/15 px-4 py-2.5 text-sm font-medium transition hover:border-primary/50 hover:text-primary"
                    >
                      <Download className="h-4 w-4" />
                      Download {result.format?.toUpperCase()}
                    </a>
                    <button
                      onClick={sendToEditor}
                      className="flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-black transition hover:brightness-110"
                    >
                      <Clapperboard className="h-4 w-4" />
                      Use in video editor
                    </button>
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
