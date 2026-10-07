import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  Mic, Loader2, Play, Pause, Download, Clapperboard, Volume2,
  AlertTriangle, Sparkles, FileText, Timer,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { VisualBucsIcon } from "@/components/VisualBucsIcon";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { OutOfCredits } from "@/components/OutOfCredits";
import { ProjectFlowBar } from "@/components/hub/ProjectFlowBar";
import { useHubProject } from "@/lib/hub-project";
import { useTranslation } from "react-i18next";
import { useActiveArtist } from "@/contexts/ActiveArtistContext";
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
  audioPlayUrl?: string;
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
  const { t } = useTranslation();
  const { activeArtist } = useActiveArtist();
  const { addAsset } = useHubProject();
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

  /* Sponsor read handoff — the Sponsorship Outreach page's "Send to Voiceover
     Pro" stores the read script here; prefill the script box on arrival. */
  useEffect(() => {
    try {
      const raw = localStorage.getItem("bdv_sponsor_read_handoff");
      if (!raw) return;
      const handoff = JSON.parse(raw) as { script?: string; brandName?: string };
      if (handoff && typeof handoff.script === "string" && handoff.script.trim()) {
        setScript(handoff.script.trim());
        setTimeout(() => {
          document.getElementById("voiceover-script")?.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 300);
      }
      localStorage.removeItem("bdv_sponsor_read_handoff");
    } catch {
      /* bad payload — drop it and carry on */
      try {
        localStorage.removeItem("bdv_sponsor_read_handoff");
      } catch {
        /* ignore */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        /* Prefer the vault's cloned voice — the user cloned it for exactly this. */
        const vaultVoice = activeArtist?.voice_id;
        if (!voiceId) {
          if (vaultVoice && list.some((v) => v.voice_id === vaultVoice)) setVoiceId(vaultVoice);
          else if (list.length > 0) setVoiceId(list[0]!.voice_id);
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
      setError(t("voiceover.scriptRequiredError"));
      return;
    }
    if (!voiceId) {
      setError(t("voiceover.voiceRequiredError"));
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
        overrideFeature: t("voiceover.confirmFeatureName"),
      });
      if (!res) return; // user cancelled the credit confirmation (finally resets state)
      const data = (await res.json().catch(() => ({}))) as GenerateResponse;
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || !data.audioUrl) {
        throw new Error(data.message || data.error || t("voiceover.generateFailedError"));
      }
      setResult(data);
      refreshProfile();
      if (data.audioUrl) {
        addAsset({
          kind: "song",
          url: data.audioUrl,
          label: t("voiceover.assetLabel", { script: script.trim().slice(0, 40) || t("voiceover.scriptFallback") }),
          detail: t("voiceover.assetDetail", { words: data.wordCount ?? 0, format: data.format ?? "mp3" }),
          meta: voiceId ? { voiceover: "true", voiceId } : { voiceover: "true" },
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("voiceover.generateFailedError"));
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
      <audio id="voice-preview" className="hidden" />

      <main className="mx-auto max-w-4xl px-4 pb-24 pt-10">
        {/* header */}
        <div className="mb-8 text-center">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-primary">
            <Mic className="h-3.5 w-3.5" />
            {t("voiceover.pageTitle")}
          </div>
          <h1 className="text-3xl font-bold sm:text-4xl">
            {t("voiceover.heading")} <span className="text-primary">{t("voiceover.headingAccent")}</span>
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-sm text-white/55">
            {t("voiceover.pageDescription")}
          </p>
        </div>

        {outOfCredits && (
          <div className="mb-6">
            <OutOfCredits />
          </div>
        )}

        <ProjectFlowBar
          kinds={["script"]}
          actionLabel={t("voiceover.flowAction")}
          onPick={(asset) => {
            const text = asset.meta?.text || "";
            if (text) setScript(text);
          }}
        />

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
                  {t("voiceover.scriptTitle")}
                </h2>
                <div className="flex items-center gap-4 text-xs text-white/45">
                  <span className="flex items-center gap-1">
                    <FileText className="h-3.5 w-3.5" />
                    {t("voiceover.wordCount", { count: estimate.wordCount })}
                  </span>
                  <span className="flex items-center gap-1">
                    <Timer className="h-3.5 w-3.5" />
                    ~{formatDuration(estimate.estimatedSeconds)}
                  </span>
                  <span className="flex items-center gap-1 text-primary">
                    <VisualBucsIcon className="h-3.5 w-3.5" />
                    {t("voiceover.creditsEstimate", { count: estimate.credits })}
                  </span>
                </div>
              </div>
              <textarea
                id="voiceover-script"
                value={script}
                onChange={(e) => setScript(e.target.value)}
                rows={10}
                maxLength={18000}
                placeholder={t("voiceover.scriptPlaceholder")}
                className={`${inputClass} resize-y leading-relaxed`}
              />
            </section>

            {/* voice picker */}
            <section data-min-stars="2" className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-white/70">
                <Volume2 className="h-4 w-4 text-primary" />
                {t("voiceover.voiceTitle")}
              </h2>
              {voicesLoading ? (
                <div className="flex items-center gap-2 text-sm text-white/40">
                  <Loader2 className="h-4 w-4 animate-spin" /> {t("voiceover.loadingVoices")}
                </div>
              ) : voices.length === 0 ? (
                <p className="text-sm text-white/40">
                  {user
                    ? t("voiceover.voicesLoadFailed")
                    : <Link href="/login" className="text-primary underline">{t("voiceover.signIn")}</Link>}
                  {" "}{t("voiceover.signInBrowseVoices")}
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
                          aria-label={t("voiceover.previewVoice", { name: v.name })}
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
                {t("voiceover.directionTitle")}
              </h2>
              <div data-min-stars="2" className="flex flex-wrap gap-2">
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
              <p data-min-stars="2" className="mt-2 text-xs text-white/35">
                {EMOTIONS.find((e) => e.key === emotion)?.blurb}
              </p>

              {/* speed */}
              <div data-min-stars="3" className="mt-4">
                <label className="mb-1 flex justify-between text-xs text-white/50">
                  <span>{t("voiceover.speakingSpeed")}</span>
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
              <div data-min-stars="3" className="mt-4 flex gap-2">
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
                  {t("voiceover.wavNote")}
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
                  {t("voiceover.generating")}
                </>
              ) : (
                <>
                  <Mic className="h-5 w-5" />
                  {t("voiceover.generateButton", { count: estimate.credits })}
                </>
              )}
            </button>
            {!user && (
              <p className="text-center text-sm text-white/40">
                <Link href="/login" className="text-primary underline">{t("voiceover.signIn")}</Link> {t("voiceover.signInGenerate")}
              </p>
            )}
          </div>

          {/* ── right: result ── */}
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-white/70">
                {t("voiceover.resultTitle")}
              </h2>
              {!result ? (
                <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 text-center">
                  <Mic className="h-10 w-10 text-white/15" />
                  <p className="max-w-[220px] text-sm text-white/35">
                    {t("voiceover.resultEmpty")}
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-xl border border-primary/30 bg-primary/[0.06] p-3 text-xs text-white/60">
                    <div className="font-medium text-white">{selectedVoice?.name ?? t("voiceover.voiceoverFallback")}</div>
                    <div className="mt-1 capitalize">{result.emotion} · {result.format?.toUpperCase()}</div>
                    <div className="mt-1">
                      {t("voiceover.resultMeta", { words: result.wordCount, time: formatDuration(result.estimatedSeconds ?? 0) })}
                    </div>
                  </div>
                  <audio
                    key={result.audioUrl}
                    controls
                    src={result.audioPlayUrl ?? result.audioUrl}
                    className="w-full"
                    onPlay={() => setPlaying(true)}
                    onPause={() => setPlaying(false)}
                  />
                  <div className="flex flex-col gap-2">
                    <a
                      href={result.audioPlayUrl ?? result.audioUrl}
                      download={`voiceover.${result.format ?? "mp3"}`}
                      className="flex items-center justify-center gap-2 rounded-xl border border-white/15 px-4 py-2.5 text-sm font-medium transition hover:border-primary/50 hover:text-primary"
                    >
                      <Download className="h-4 w-4" />
                      {t("voiceover.downloadFormat", { format: result.format?.toUpperCase() })}
                    </a>
                    <button
                      onClick={sendToEditor}
                      className="flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-black transition hover:brightness-110"
                    >
                      <Clapperboard className="h-4 w-4" />
                      {t("voiceover.useInEditor")}
                    </button>
                  </div>
                  <p className="text-xs text-white/35">
                    {t("voiceover.creditsUsedNote", { used: result.creditsUsed, remaining: result.creditsRemaining })}
                  </p>
                </div>
              )}
            </div>
          </aside>
        </div>
      </main>


    </div>
  );
}
