import { apiErrorMessage, plainErrorText } from "../lib/api-error";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { useEffect, useRef, useState } from "react";
import {
  Languages, Loader2, Upload, Play, Download, AlertTriangle, Check,
  FileText, Globe, Mic2, X, RefreshCw,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { OutOfCredits } from "@/components/OutOfCredits";
import {
  TARGET_LANGUAGES,
  estimateTranslateCost,
  formatDuration,
  languageLabel,
  pickDefaultVoiceId,
  TRANSLATOR_MAX_LANGUAGES,
  TRANSLATOR_MAX_BYTES,
  JOB_POLL_MS,
  HONESTY_NOTE,
  type TranslateJobState,
} from "@/lib/video-translator";
import { useActiveArtist } from "@/contexts/ActiveArtistContext";
import { useTranslation } from "react-i18next";
import { useHubProject } from "@/lib/hub-project";
import { Link } from "wouter";
import {
  parseGlobalDropIntake,
  withoutGlobalDropParams,
} from "@/lib/global-drop-intake";

/* ─── Thy Cheat Code's AI Video Translator ───────────────────────────────
   Upload a video → pick target languages → AI transcribes, translates,
   and dubs it with a voice-matched AI voice. 500 Visual Bucs per minute
   per language. SRT subtitles for every language are free to download.
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

export default function Translate({ embedded }: { embedded?: boolean } = {}) {
  const isLight = useIsLightTheme();
  const { t } = useTranslation();
  const { user, getAccessToken, refreshProfile } = useAuth();
  const { activeArtist } = useActiveArtist();
  const { confirmedFetch } = useConfirmedApi();
  const { addAsset } = useHubProject();

  /* step 1: video */
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);
  const [durationSec, setDurationSec] = useState<number | null>(null);

  /* step 2: languages + voice */
  const [selectedLangs, setSelectedLangs] = useState<string[]>(["es"]);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voicesLoading, setVoicesLoading] = useState(true);
  const [voicesFailed, setVoicesFailed] = useState(false);
  const [voicesNonce, setVoicesNonce] = useState(0);
  const [voiceId, setVoiceId] = useState("");
  const [previewing, setPreviewing] = useState<string | null>(null);

  /* job */
  const [job, setJob] = useState<TranslateJobState | null>(null);
  const [translating, setTranslating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const pollRef = useRef<number | null>(null);

  /* Global Drop preload (#165): when this visit arrived through a
     version's preloaded door (?gd=<releaseId>&lang=<code>) AND the
     pair verified against the caller's own package, the surface is
     making THAT version — its language was preselected on arrival,
     and the finished dub's video URL returns into the version's
     review slot on its own (as a draft; approval stays the
     creator's hand in Distribute). A pair that doesn't resolve is
     refused in plain words (gdUnresolved) and nothing is preloaded
     or returned. */
  const [gdContext, setGdContext] = useState<{
    releaseId: string;
    language: string;
    label: string;
    releaseTitle: string;
  } | null>(null);
  const [gdUnresolved, setGdUnresolved] = useState(false);
  const [gdSaveState, setGdSaveState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const gdContextRef = useRef<typeof gdContext>(null);
  const gdReturnJobRef = useRef<string | null>(null);
  const gdOutputRef = useRef<{ language: string; videoUrl: string } | null>(null);

  useEffect(() => { gdContextRef.current = gdContext; }, [gdContext]);

  const estimate = estimateTranslateCost(durationSec, selectedLangs.length);

  /* load voices */
  useEffect(() => {
    let cancelled = false;
    async function loadVoices() {
      setVoicesLoading(true);
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/voices", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error("voices load failed");
        const data = (await res.json().catch(() => ({}))) as { voices?: Voice[] };
        if (cancelled) return;
        const list = Array.isArray(data.voices) ? data.voices : [];
        setVoices(list);
        setVoicesFailed(false);
        /* EVERYTHING-SMART (stack900 K1): open on the creator's own
           cloned vault voice when they have one — the same rule the
           Voiceover desk follows — not whatever the API listed first.
           Dubbing your own video should start from YOUR voice. */
        if (!voiceId) setVoiceId(pickDefaultVoiceId(list, activeArtist?.voice_id));
      } catch {
        /* Empty-lie fix: a failed load is NOT "no voices available" —
           keep whatever is already loaded and raise the honest failed
           state below so the creator can retry instead of being told
           their cloned voices don't exist. */
        if (!cancelled) setVoicesFailed(true);
      } finally {
        if (!cancelled) setVoicesLoading(false);
      }
    }
    if (user) loadVoices();
    else setVoicesLoading(false);
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, voicesNonce]);

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

  /* Global Drop preload intake: consume the door's pair once. The
     language preselects immediately; the context only arms when the
     pair verifies against the caller's OWN package (a foreign or
     stale release id resolves to nothing and is refused in plain
     words — the params themselves are never shown as content). The
     pair is stripped from the URL once the intake settles, so a
     refresh doesn't re-fire the door. */
  useEffect(() => {
    if (!user) return;
    const intake = parseGlobalDropIntake(window.location.search);
    if (!intake) return;
    let cancelled = false;
    setSelectedLangs([intake.language]);
    void (async () => {
      let resolved: { label: string; releaseTitle: string } | null = null;
      try {
        const token = await getAccessToken();
        const res = await fetch(`/api/global-drop/${encodeURIComponent(intake.releaseId)}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.ok) {
          const data = (await res.json().catch(() => null)) as {
            versions?: Record<string, { label?: string; sourceTitle?: string }>;
          } | null;
          const v = data?.versions?.[intake.language];
          if (v) {
            resolved = {
              label: v.label ?? languageLabel(intake.language),
              releaseTitle: v.sourceTitle ?? "",
            };
          }
        }
      } catch {
        /* unresolved — refused below in plain words */
      }
      if (cancelled) return;
      if (resolved) {
        setGdContext({ releaseId: intake.releaseId, language: intake.language, ...resolved });
      } else {
        setGdUnresolved(true);
      }
      const rest = withoutGlobalDropParams(window.location.search);
      window.history.replaceState(null, "", `${window.location.pathname}${rest ? `?${rest}` : ""}`);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  /* Return the finished dub's video URL into the version's review
     slot. The PATCH carries ONLY the url — the version stays a draft
     under the creator's own review, and its translated title stays
     the creator's own entry (no translation is invented here). */
  async function saveGdReturn() {
    const ctx = gdContextRef.current;
    const out = gdOutputRef.current;
    if (!ctx || !out || out.language !== ctx.language) return;
    setGdSaveState("saving");
    try {
      const token = await getAccessToken();
      const res = await fetch(
        `/api/global-drop/${encodeURIComponent(ctx.releaseId)}/languages/${ctx.language}`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ url: out.videoUrl }),
        },
      );
      if (!res.ok) throw new Error("Global Drop return failed");
      setGdSaveState("saved");
    } catch {
      setGdSaveState("failed");
    }
  }

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
        setError(apiErrorMessage(data, t("translate.statusCheckFailed")));
        stopPolling();
        setTranslating(false);
        return;
      }
      setJob(data as TranslateJobState);
      if (data.status === "done" || data.status === "failed") {
        stopPolling();
        setTranslating(false);
        refreshProfile().catch(() => {});
        /* Translated videos flow into the hub project — scheduler and the editor pick them up. */
        if (data.status === "done") {
          for (const o of (data as TranslateJobState).outputs ?? []) {
            if (o.videoUrl) {
              try { addAsset({ kind: "video", url: o.videoUrl, label: `Translated video (${o.label || o.language})`, detail: "Video translator" }); } catch { /* non-fatal */ }
            }
          }
          /* Global Drop return: the version this visit is making gets
             its finished dub's URL in its review slot — once per job. */
          const gdCtx = gdContextRef.current;
          const finishedJob = data as TranslateJobState;
          if (gdCtx && finishedJob.jobId && gdReturnJobRef.current !== finishedJob.jobId) {
            const out = (finishedJob.outputs ?? []).find((o) => o.language === gdCtx.language && o.videoUrl);
            if (out?.videoUrl) {
              gdReturnJobRef.current = finishedJob.jobId;
              gdOutputRef.current = { language: out.language, videoUrl: out.videoUrl };
              void saveGdReturn();
            }
          }
        }
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
    if (!videoFile) { setError(t("translate.videoRequired")); return; }
    if (selectedLangs.length === 0) { setError(t("translate.languageRequired")); return; }
    if (!voiceId) { setError(t("translate.voiceRequired")); return; }
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
        overrideFeature: "Video Translator (500 VB per minute per language)",
      });
      if (!res) return; // user cancelled the credit confirmation (finally resets state)
      const data = (await res.json().catch(() => ({}))) as {
        jobId?: string; error?: string; message?: string; creditsRequired?: number;
      };
      if (res.status === 402) {
        setOutOfCredits(true);
        setError(apiErrorMessage(data, t("translate.outOfCreditsMessage")));
        setTranslating(false);
        return;
      }
      if (!res.ok || !data.jobId) {
        setError(apiErrorMessage(data, t("translate.startFailed")));
        setTranslating(false);
        return;
      }
      refreshProfile().catch(() => {});
      if (token) {
        pollRef.current = window.setInterval(() => pollJob(data.jobId!, token), JOB_POLL_MS);
        pollJob(data.jobId!, token);
      }
    } catch (e) {
      setError(plainErrorText(e, t("translate.startFailed")));
      setTranslating(false);
    }
  }

  function reset() {
    stopPolling();
    setJob(null);
    setError(null);
    setOutOfCredits(false);
    setVideoFile(null);
    /* The Global Drop context itself survives — the next dub made
       here is still for the same version — but its save line starts
       fresh for the new job. */
    setGdSaveState("idle");
  }

  const doneOutputs = job?.outputs.filter((o) => o.videoUrl) ?? [];
  const failedOutputs = job?.outputs.filter((o) => !o.videoUrl && o.error) ?? [];

  return (
    <div className={embedded ? "text-white" : "min-h-screen bg-black text-white"}>
      <main className={embedded ? "" : "mx-auto max-w-5xl px-4 pb-24 pt-10"}>
        {/* Hero (standalone page only; the shell provides it when embedded) */}
        {!embedded && (
        <div className="mb-8 text-center">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-amber-300">
            <Languages className="h-3.5 w-3.5" />{t("translate.badge")}</div>
          <h1 className="bg-gradient-to-r from-amber-200 via-yellow-400 to-amber-200 bg-clip-text text-4xl font-black text-transparent md:text-5xl">{t("translate.pageTitle")}</h1>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-white/50">{t("translate.pageSubtitle")}</p>
          <p className="mx-auto mt-2 flex max-w-2xl items-center justify-center gap-1.5 text-xs text-amber-300/80">
            <AlertTriangle className="h-3.5 w-3.5" /> {HONESTY_NOTE}
          </p>
        </div>
        )}

        {!user ? (
          <div className={`rounded-2xl border p-10 text-center ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3] text-[#6B5B36]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04] text-white/60"}`}>{t("translate.signInPrompt")}</div>
        ) : (
          <>
            {/* ── Global Drop preload (#165): this visit is making one
                version of one release — say which, and report the
                return of the finished dub's URL into its review slot. */}
            {gdContext && (
              <section className="mb-6 rounded-2xl border border-amber-400/20 bg-amber-400/[0.04] p-5">
                <p className="flex items-start gap-2 text-sm text-white/75">
                  <Globe className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                  <span>{t("translate.globalDropBanner", { label: gdContext.label, title: gdContext.releaseTitle })}</span>
                </p>
                {gdSaveState === "saving" && (
                  <p className="mt-3 flex items-center gap-2 text-xs text-white/50">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />{t("translate.globalDropSaving")}
                  </p>
                )}
                {gdSaveState === "saved" && (
                  <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-emerald-300">
                    <Check className="h-3.5 w-3.5 shrink-0" />
                    <span>{t("translate.globalDropSaved", { label: gdContext.label, title: gdContext.releaseTitle })}</span>
                    <Link href="/distribute" className="font-semibold text-amber-300 underline-offset-2 hover:underline">
                      {t("translate.globalDropReviewLink")}
                    </Link>
                  </p>
                )}
                {gdSaveState === "failed" && (
                  <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-red-300">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    <span>{t("translate.globalDropSaveFailed")}</span>
                    <button
                      type="button"
                      onClick={() => void saveGdReturn()}
                      className="font-semibold text-amber-300 underline-offset-2 hover:underline"
                    >
                      {t("translate.globalDropRetry")}
                    </button>
                  </p>
                )}
              </section>
            )}
            {gdUnresolved && (
              <section className="mb-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <p className="flex items-start gap-2 text-sm text-white/60">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                  <span>{t("translate.globalDropUnresolved")}</span>
                </p>
              </section>
            )}

            {/* ── Step 1: upload ── */}
            <section className={`mb-6 rounded-2xl border p-6 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}>
              <h2 className="mb-4 flex items-center gap-2 text-lg font-bold text-amber-200">
                <Upload className="h-5 w-5" />{t("translate.step1")}</h2>
              <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-white/15 bg-black/40 px-6 py-10 transition hover:border-amber-400/40">
                <Upload className="mb-2 h-8 w-8 text-amber-300/70" />
                <span className="text-sm text-white/70">
                  {videoFile ? videoFile.name : t("translate.dropHint")}
                </span>
                <span className="mt-1 text-xs text-white/35">{t("translate.fileLimits")}</span>
                <input
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      if (f.size > TRANSLATOR_MAX_BYTES) {
                        setError(t("translate.fileTooLarge"));
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
                    {t("translate.durationLabel")} <span className="font-semibold text-white">{formatDuration(durationSec)}</span>
                  </div>
                </div>
              )}
            </section>

            {/* ── Step 2: languages ── */}
            <section className={`mb-6 rounded-2xl border p-6 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}>
              <h2 className="mb-4 flex items-center gap-2 text-lg font-bold text-amber-200">
                <Globe className="h-5 w-5" />{t("translate.step2")}<span className="text-xs font-normal text-white/40">
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
            <section className={`mb-6 rounded-2xl border p-6 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}>
              <h2 className="mb-4 flex items-center gap-2 text-lg font-bold text-amber-200">
                <Mic2 className="h-5 w-5" />{t("translate.step3")}</h2>
              {voicesLoading ? (
                <div className="flex items-center gap-2 text-sm text-white/50">
                  <Loader2 className="h-4 w-4 animate-spin" />{t("translate.loadingVoices")}</div>
              ) : voicesFailed && voices.length === 0 ? (
                <div data-testid="translate-voices-load-error">
                  <p className="text-sm text-red-300">{t("translate.voicesLoadError")}</p>
                  <button type="button" onClick={() => setVoicesNonce((n) => n + 1)}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 px-3.5 py-1.5 text-xs font-semibold text-amber-200/80 transition hover:bg-amber-500/10">
                    {t("translate.voicesRetry")}
                  </button>
                </div>
              ) : voices.length === 0 ? (
                <p className="text-sm text-white/50">{t("translate.noVoices")}</p>
              ) : (
                <>
                {voicesFailed && (
                  <p className="mb-3 flex flex-wrap items-center gap-2 text-sm text-red-300" data-testid="translate-voices-reload-error">
                    {t("translate.voicesLoadError")}
                    <button type="button" onClick={() => setVoicesNonce((n) => n + 1)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 px-3 py-1 text-xs font-semibold text-amber-200/80 transition hover:bg-amber-500/10">
                      {t("translate.voicesRetry")}
                    </button>
                  </p>
                )}
                <div className="grid gap-2 sm:grid-cols-2">
                  {voices.slice(0, 8).map((v) => (
                    <button
                      key={v.voice_id}
                      onClick={() => setVoiceId(v.voice_id)}
                      className={`flex items-center justify-between rounded-xl border px-4 py-2.5 text-left text-sm transition ${
                        voiceId === v.voice_id
                          ? (isLight ? "border-[#C9A84C] bg-[#F7ECD2] shadow-[0_0_0_1px_#C9A84C,0_10px_28px_rgba(201,168,76,0.22)]" : "border-primary bg-primary/[0.16] shadow-[0_0_0_1px_rgba(212,175,55,0.55)]")
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
                          aria-label={t("translate.previewVoiceAria", { name: v.name ?? t("translate.voiceFallback") })}
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
                </>
              )}
              <audio id="translate-voice-preview" className="hidden" />
              <p className="mt-3 text-xs text-white/35">{t("translate.voiceNote")}</p>
            </section>

            {/* ── Cost + CTA ── */}
            <section className="mb-6 rounded-2xl border border-amber-400/20 bg-amber-400/[0.04] p-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="text-sm text-white/65">
                  <div>
                    <span className="font-semibold text-white">{t("translate.billableMinutes", { n: estimate.billableMinutes })}</span>
                    {" × "}
                    <span className="font-semibold text-white">{t("translate.languageCount", { n: selectedLangs.length })}</span>
                    {t("translate.perMinuteCost")}
                  </div>
                  <div className="mt-1 text-xs text-white/40">{t("translate.srtFree")}</div>
                </div>
                <div className="text-right">
                  <div className="text-3xl font-black text-amber-300">{estimate.credits}</div>
                  <div className="text-xs uppercase tracking-widest text-white/40">{t("translate.creditsLabel")}</div>
                </div>
              </div>
              <button onClick={startTranslation} disabled={translating || !videoFile} className={`${goldBtn} mt-4 w-full`}>
                {translating ? (
                  <><Loader2 className="h-4 w-4 animate-spin" />{t("translate.translating")}</>
                ) : (
                  <><Languages className="h-4 w-4" /> {t("translate.translateButton", { credits: estimate.credits })}</>
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
              <section className={`mb-6 rounded-2xl border p-6 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}>
                <h2 className="mb-4 flex items-center gap-2 text-lg font-bold text-amber-200">
                  {job.status === "processing" || job.status === "queued" ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : job.status === "done" ? (
                    <Check className="h-5 w-5 text-green-400" />
                  ) : (
                    <AlertTriangle className="h-5 w-5 text-red-400" />
                  )}
                  {job.status === "done"
                    ? t("translate.jobDone")
                    : job.status === "failed"
                      ? t("translate.jobFailed")
                      : t("translate.jobWorking")}
                </h2>
                {job.error && <p className="mb-4 text-sm text-red-300">{job.error}</p>}

                <div className="grid gap-4 md:grid-cols-2">
                  {job.outputs.map((out) => (
                    <div key={out.language} className="rounded-xl border border-white/10 bg-black/40 p-4">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="font-bold text-white">{out.label}</span>
                        {out.videoUrl ? (
                          <span className="flex items-center gap-1 text-xs text-green-400">
                            <Check className="h-3.5 w-3.5" />{t("translate.outputDone")}</span>
                        ) : out.error ? (
                          <span className="text-xs text-red-300">{t("translate.outputFailed")}</span>
                        ) : (
                          <span className="flex items-center gap-1 text-xs text-amber-300">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />{t("translate.outputWorking")}</span>
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
                            <Download className="h-3.5 w-3.5" />{t("translate.videoDownload")}</a>
                        )}
                        {out.srtUrl && (
                          <a
                            href={out.srtUrl}
                            download={`subtitles-${out.language}.srt`}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/70 transition hover:bg-white/10 hover:text-white"
                          >
                            <FileText className="h-3.5 w-3.5" />{t("translate.srtDownload")}</a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {failedOutputs.length > 0 && doneOutputs.length > 0 && (
                  <p className="mt-4 text-xs text-white/45">
                    {t("translate.partialFail", { count: failedOutputs.length })}
                  </p>
                )}

                {(job.status === "done" || job.status === "failed") && (
                  <button
                    onClick={reset}
                    className="mt-6 inline-flex items-center gap-2 rounded-xl border border-white/15 px-5 py-2.5 text-sm font-semibold text-white/70 transition hover:border-white/30 hover:text-white"
                  >
                    <RefreshCw className="h-4 w-4" />{t("translate.translateAnother")}</button>
                )}
              </section>
            )}
          </>
        )}
      </main>

    </div>
  );
}
