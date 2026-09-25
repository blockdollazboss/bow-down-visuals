import { useEffect, useRef, useState } from "react";
import {
  Languages, Loader2, Upload, Play, Download, AlertTriangle, Check,
  FileText, Globe, Mic2, X, RefreshCw,
} from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { OutOfCredits } from "@/components/OutOfCredits";
import {
  TARGET_LANGUAGES,
  estimateTranslateCost,
  formatDuration,
  TRANSLATOR_MAX_LANGUAGES,
  TRANSLATOR_MAX_BYTES,
  JOB_POLL_MS,
  HONESTY_NOTE,
  type TranslateJobState,
} from "@/lib/video-translator";

/* ─── Thy Cheat Code's AI Video Translator ───────────────────────────────
   Upload a video → pick target languages → AI transcribes, translates,
   and dubs it with a voice-matched AI voice. 5 credits per minute per
   language. SRT subtitles for every language are free to download.
   AI dubbing, not human translation — review before publishing. */

interface Voice {
  voice_id: string;
  name?: string;
  preview_url?: string;
}

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

const goldBtn =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-400 to-yellow-600 px-6 py-3 text-sm font-bold text-black shadow-lg shadow-amber-500/20 transition hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed";

export default function Translate() {
  const { user, getAccessToken, refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();

  /* step 1: video */
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);
  const [durationSec, setDurationSec] = useState<number | null>(null);

  /* step 2: languages + voice */
  const [selectedLangs, setSelectedLangs] = useState<string[]>(["es"]);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voicesLoading, setVoicesLoading] = useState(true);
  const [voiceId, setVoiceId] = useState("");
  const [previewing, setPreviewing] = useState<string | null>(null);

  /* job */
  const [job, setJob] = useState<TranslateJobState | null>(null);
  const [translating, setTranslating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const pollRef = useRef<number | null>(null);

  const estimate = estimateTranslateCost(durationSec, selectedLangs.length);

  /* load voices */
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
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  /* read video duration from metadata */
  useEffect(() => {
    if (!videoFile) {
      setVideoPreviewUrl(null);
      setDurationSec(null);
      return;
    }
    const url = URL.createObjectURL(videoFile);
    setVideoPreviewUrl(url);
    const el = document.createElement("video");
    el.preload = "metadata";
    el.src = url;
    el.onloadedmetadata = () => {
      if (Number.isFinite(el.duration) && el.duration > 0) setDurationSec(el.duration);
    };
    return () => URL.revokeObjectURL(url);
  }, [videoFile]);

  /* stop polling on unmount */
  useEffect(() => {
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, []);

  function toggleLang(code: string) {
    setSelectedLangs((prev) => {
      if (prev.includes(code)) return prev.filter((c) => c !== code);
      if (prev.length >= TRANSLATOR_MAX_LANGUAGES) return prev;
      return [...prev, code];
    });
  }

  function toggleVoicePreview(v: Voice) {
    if (!v.preview_url) return;
    const audio = document.getElementById("translate-voice-preview") as HTMLAudioElement | null;
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

  async function pollJob(jobId: string, token: string) {
    try {
      const res = await fetch(`/api/video-translator/jobs/${jobId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json().catch(() => ({}))) as Partial<TranslateJobState> & { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not check translation status.");
        stopPolling();
        setTranslating(false);
        return;
      }
      setJob(data as TranslateJobState);
      if (data.status === "done" || data.status === "failed") {
        stopPolling();
        setTranslating(false);
        refreshProfile().catch(() => {});
      }
    } catch {
      /* transient — keep polling */
    }
  }

  function stopPolling() {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  async function startTranslation() {
    if (translating || !user) return;
    if (!videoFile) { setError("Upload a video first."); return; }
    if (selectedLangs.length === 0) { setError("Pick at least one target language."); return; }
    if (!voiceId) { setError("Pick a dubbing voice first."); return; }
    setTranslating(true);
    setError(null);
    setOutOfCredits(false);
    setJob(null);

    try {
      const token = await getAccessToken();
      const form = new FormData();
      form.append("video", videoFile);
      form.append("languages", JSON.stringify(selectedLangs));
      form.append("voiceId", voiceId);
      if (durationSec) form.append("durationSec", String(Math.round(durationSec)));

      const res = await confirmedFetch("/api/video-translator/translate", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
        overrideCost: estimate.credits,
        overrideFeature: "Video Translator",
      });
      if (!res) return; // user cancelled the credit confirmation (finally resets state)
      const data = (await res.json().catch(() => ({}))) as {
        jobId?: string; error?: string; message?: string; creditsRequired?: number;
      };
      if (res.status === 402) {
        setOutOfCredits(true);
        setError(data.message ?? "You're out of credits.");
        setTranslating(false);
        return;
      }
      if (!res.ok || !data.jobId) {
        setError(data.error ?? data.message ?? "Translation failed to start.");
        setTranslating(false);
        return;
      }
      refreshProfile().catch(() => {});
      if (token) {
        pollRef.current = window.setInterval(() => pollJob(data.jobId!, token), JOB_POLL_MS);
        pollJob(data.jobId!, token);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Translation failed to start.");
      setTranslating(false);
    }
  }

  function reset() {
    stopPolling();
    setJob(null);
    setError(null);
    setOutOfCredits(false);
    setVideoFile(null);
  }

  const doneOutputs = job?.outputs.filter((o) => o.videoUrl) ?? [];
  const failedOutputs = job?.outputs.filter((o) => !o.videoUrl && o.error) ?? [];

  return (
    <div className="min-h-screen bg-black text-white">
      <MarketingNav />
      <main className="mx-auto max-w-5xl px-4 pb-24 pt-10">
        <div className="mb-8 text-center">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-amber-300">
            <Languages className="h-3.5 w-3.5" /> AI Video Translator
          </div>
          <h1 className="bg-gradient-to-r from-amber-200 via-yellow-400 to-amber-200 bg-clip-text text-4xl font-black text-transparent md:text-5xl">
            Dub Your Videos Into Any Language
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-white/50">
            Upload a video, pick your languages — AI transcribes, translates, and dubs it
            with a voice-matched AI voice. Subtitles included free.
          </p>
          <p className="mx-auto mt-2 flex max-w-2xl items-center justify-center gap-1.5 text-xs text-amber-300/80">
            <AlertTriangle className="h-3.5 w-3.5" /> {HONESTY_NOTE}
          </p>
        </div>

        {!user ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-10 text-center text-white/60">
            Sign in to translate your videos.
          </div>
        ) : (
          <>
            {/* ── Step 1: upload ── */}
            <section className="mb-6 rounded-2xl border border-white/10 bg-white/[0.02] p-6">
              <h2 className="mb-4 flex items-center gap-2 text-lg font-bold text-amber-200">
                <Upload className="h-5 w-5" /> 1. Upload your video
              </h2>
              <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-white/15 bg-black/40 px-6 py-10 transition hover:border-amber-400/40">
                <Upload className="mb-2 h-8 w-8 text-amber-300/70" />
                <span className="text-sm text-white/70">
                  {videoFile ? videoFile.name : "Drop a video or click to browse"}
                </span>
                <span className="mt-1 text-xs text-white/35">MP4/MOV/WebM up to 80 MB</span>
                <input
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      if (f.size > TRANSLATOR_MAX_BYTES) {
                        setError("That video exceeds the 80 MB upload limit.");
                        return;
                      }
                      setError(null);
                      setVideoFile(f);
                    }
                  }}
                />
              </label>
              {videoPreviewUrl && (
                <div className="mt-4 flex items-center gap-4">
                  <video src={videoPreviewUrl} className="h-24 rounded-lg border border-white/10" controls={false} />
                  <div className="text-sm text-white/60">
                    Duration: <span className="font-semibold text-white">{formatDuration(durationSec)}</span>
                  </div>
                </div>
              )}
            </section>

            {/* ── Step 2: languages ── */}
            <section className="mb-6 rounded-2xl border border-white/10 bg-white/[0.02] p-6">
              <h2 className="mb-4 flex items-center gap-2 text-lg font-bold text-amber-200">
                <Globe className="h-5 w-5" /> 2. Pick target languages
                <span className="text-xs font-normal text-white/40">
                  ({selectedLangs.length}/{TRANSLATOR_MAX_LANGUAGES})
                </span>
              </h2>
              <div className="flex flex-wrap gap-2">
                {TARGET_LANGUAGES.map((lang) => {
                  const active = selectedLangs.includes(lang.code);
                  return (
                    <button
                      key={lang.code}
                      onClick={() => toggleLang(lang.code)}
                      className={`flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium transition ${
                        active
                          ? "border-amber-400/60 bg-amber-400/15 text-amber-200"
                          : "border-white/10 bg-black/40 text-white/55 hover:border-white/25 hover:text-white"
                      }`}
                    >
                      {active && <Check className="h-3.5 w-3.5" />}
                      {lang.label}
                    </button>
                  );
                })}
              </div>
            </section>

            {/* ── Step 3: voice ── */}
            <section className="mb-6 rounded-2xl border border-white/10 bg-white/[0.02] p-6">
              <h2 className="mb-4 flex items-center gap-2 text-lg font-bold text-amber-200">
                <Mic2 className="h-5 w-5" /> 3. Pick the dubbing voice
              </h2>
              {voicesLoading ? (
                <div className="flex items-center gap-2 text-sm text-white/50">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading voices…
                </div>
              ) : voices.length === 0 ? (
                <p className="text-sm text-white/50">No voices available right now.</p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {voices.slice(0, 8).map((v) => (
                    <button
                      key={v.voice_id}
                      onClick={() => setVoiceId(v.voice_id)}
                      className={`flex items-center justify-between rounded-xl border px-4 py-2.5 text-left text-sm transition ${
                        voiceId === v.voice_id
                          ? "border-amber-400/60 bg-amber-400/10 text-amber-100"
                          : "border-white/10 bg-black/40 text-white/65 hover:border-white/25"
                      }`}
                    >
                      <span className="font-medium">{v.name ?? v.voice_id}</span>
                      {v.preview_url && (
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => { e.stopPropagation(); toggleVoicePreview(v); }}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); toggleVoicePreview(v); } }}
                          className="rounded-full p-1.5 text-white/50 hover:bg-white/10 hover:text-white"
                          aria-label={`Preview ${v.name ?? "voice"}`}
                        >
                          {previewing === v.voice_id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Play className="h-4 w-4" />
                          )}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
              <audio id="translate-voice-preview" className="hidden" />
              <p className="mt-3 text-xs text-white/35">
                The same voice dubs every language, keeping your sound consistent worldwide.
              </p>
            </section>

            {/* ── Cost + CTA ── */}
            <section className="mb-6 rounded-2xl border border-amber-400/20 bg-amber-400/[0.04] p-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="text-sm text-white/65">
                  <div>
                    <span className="font-semibold text-white">{estimate.billableMinutes} min</span>
                    {" × "}
                    <span className="font-semibold text-white">{selectedLangs.length} language{selectedLangs.length === 1 ? "" : "s"}</span>
                    {" × 5 credits"}
                  </div>
                  <div className="mt-1 text-xs text-white/40">
                    Subtitle files (SRT) for every language are free.
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-3xl font-black text-amber-300">{estimate.credits}</div>
                  <div className="text-xs uppercase tracking-widest text-white/40">credits</div>
                </div>
              </div>
              <button onClick={startTranslation} disabled={translating || !videoFile} className={`${goldBtn} mt-4 w-full`}>
                {translating ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Translating…</>
                ) : (
                  <><Languages className="h-4 w-4" /> Translate · {estimate.credits} credits</>
                )}
              </button>
              {error && (
                <p className="mt-3 flex items-center gap-2 text-sm text-red-300">
                  <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
                </p>
              )}
              {outOfCredits && <OutOfCredits />}
            </section>

            {/* ── Job progress ── */}
            {(translating || job) && job && (
              <section className="mb-6 rounded-2xl border border-white/10 bg-white/[0.02] p-6">
                <h2 className="mb-4 flex items-center gap-2 text-lg font-bold text-amber-200">
                  {job.status === "processing" || job.status === "queued" ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : job.status === "done" ? (
                    <Check className="h-5 w-5 text-green-400" />
                  ) : (
                    <AlertTriangle className="h-5 w-5 text-red-400" />
                  )}
                  {job.status === "done"
                    ? "Your dubbed videos are ready"
                    : job.status === "failed"
                      ? "Translation failed — credits refunded"
                      : "Dubbing in progress… feel free to close this tab"}
                </h2>
                {job.error && <p className="mb-4 text-sm text-red-300">{job.error}</p>}

                <div className="grid gap-4 md:grid-cols-2">
                  {job.outputs.map((out) => (
                    <div key={out.language} className="rounded-xl border border-white/10 bg-black/40 p-4">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="font-bold text-white">{out.label}</span>
                        {out.videoUrl ? (
                          <span className="flex items-center gap-1 text-xs text-green-400">
                            <Check className="h-3.5 w-3.5" /> Done
                          </span>
                        ) : out.error ? (
                          <span className="text-xs text-red-300">Failed</span>
                        ) : (
                          <span className="flex items-center gap-1 text-xs text-amber-300">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Working…
                          </span>
                        )}
                      </div>
                      {out.videoUrl && (
                        <video src={out.videoUrl} controls className="mb-3 w-full rounded-lg border border-white/10" />
                      )}
                      {out.error && !out.videoUrl && (
                        <p className="mb-3 text-xs text-red-300/80">{out.error}</p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        {out.videoUrl && (
                          <a
                            href={out.videoUrl}
                            download={`dubbed-${out.language}.mp4`}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-1.5 text-xs font-semibold text-amber-200 transition hover:bg-amber-400/20"
                          >
                            <Download className="h-3.5 w-3.5" /> Video
                          </a>
                        )}
                        {out.srtUrl && (
                          <a
                            href={out.srtUrl}
                            download={`subtitles-${out.language}.srt`}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/70 transition hover:bg-white/10 hover:text-white"
                          >
                            <FileText className="h-3.5 w-3.5" /> Subtitles (free)
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {failedOutputs.length > 0 && doneOutputs.length > 0 && (
                  <p className="mt-4 text-xs text-white/45">
                    {failedOutputs.length} language{failedOutputs.length === 1 ? "" : "s"} couldn't be
                    dubbed — you were refunded for {failedOutputs.length === 1 ? "it" : "them"} automatically.
                  </p>
                )}

                {(job.status === "done" || job.status === "failed") && (
                  <button
                    onClick={reset}
                    className="mt-6 inline-flex items-center gap-2 rounded-xl border border-white/15 px-5 py-2.5 text-sm font-semibold text-white/70 transition hover:border-white/30 hover:text-white"
                  >
                    <RefreshCw className="h-4 w-4" /> Translate another video
                  </button>
                )}
              </section>
            )}
          </>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
