import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import {
  Upload, Loader2, Download, AlertTriangle, CheckCircle2,
  ArrowLeft, AudioWaveform, Info, RefreshCw, Play, Pause,
  Volume2, VolumeX, SlidersHorizontal, Music4, Mic2, MicOff,
  Music2, AudioLines,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { OutOfCredits } from "@/components/OutOfCredits";
import { useHubProject } from "@/lib/hub-project";
import { ProjectFlowBar } from "@/components/hub/ProjectFlowBar";
import { VocalPolishModal } from "@/components/song/VocalPolishModal";
import { useTranslation } from "react-i18next";

/* ─── AI Stem Splitter ────────────────────────────────────────────────────
   Real 4-stem Demucs separation: upload any song, get back isolated
   vocals, drums, bass, and melody/other as WAVs. Per-stem solo/mute
   playback, individual downloads, and a remix mode that rebalances the
   four stems into a custom mix. 4 credits per split (Demucs on CPU is
   our heaviest job); the remix itself is free — those stems are already
   paid for. Failed jobs refund automatically. Server-owned background
   job: safe to close the tab while it runs. */

const CREDIT_COST = 4;
const MAX_BYTES = 25 * 1024 * 1024;

type StemKey = "vocals" | "drums" | "bass" | "other";

/* Stem display strings are resolved via t() inside the component (below);
   keys stay stable because stem keys drive playback/download logic. */
const STEM_DEFS: Array<{ key: StemKey; labelKey: string; blurbKey: string; accent: string }> = [
  { key: "vocals", labelKey: "stemVocals", blurbKey: "stemVocalsBlurb", accent: "text-amber-300" },
  { key: "drums", labelKey: "stemDrums", blurbKey: "stemDrumsBlurb", accent: "text-red-300" },
  { key: "bass", labelKey: "stemBass", blurbKey: "stemBassBlurb", accent: "text-emerald-300" },
  { key: "other", labelKey: "stemOther", blurbKey: "stemOtherBlurb", accent: "text-sky-300" },
];

type JobStatus = "idle" | "uploading" | "queued" | "processing" | "done" | "failed";

interface StemJobResponse {
  jobId?: string;
  status?: string;
  stems?: Record<StemKey, string> | null;
  error?: string;
  message?: string;
  creditsRemaining?: number;
}

/* ─── Vocals-only preset (merged from the AI Vocal Remover page) ───────
   Upload any song → true Demucs stem separation → instrumental MP3 +
   acapella MP3. Key and tempo are preserved (separation reassigns
   time-frequency bins; nothing is time-stretched or pitch-shifted).
   Optional karaoke mode adds Whisper word-timing lyrics synced to the
   instrumental. 3 credits per song (POST /api/vocal-removal; registry
   key "/api/vocal-removal"), refunded automatically if the job fails.
   Server-owned background job: safe to close the tab while it runs.
   All identifiers are Vocal-prefixed to avoid collisions with the
   full-split flow's JobStatus. */

const VOCAL_CREDIT_COST = 3;
const VOCAL_MAX_MB = 25;

type VocalJobStatus = "idle" | "uploading" | "queued" | "processing" | "done" | "failed";

interface VocalKaraokeWord {
  word: string;
  start: number;
  end: number;
}

interface VocalJobResponse {
  jobId?: string;
  status?: string;
  instrumentalUrl?: string | null;
  acapellaUrl?: string | null;
  karaokeUrl?: string | null;
  error?: string;
  message?: string;
  creditsRemaining?: number;
}

function VocalOnlyPreset() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { addAsset } = useHubProject();
  const { confirmedFetch } = useConfirmedApi();
  const [file, setFile] = useState<File | null>(null);
  const [karaoke, setKaraoke] = useState(true);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<VocalJobStatus>("idle");
  const [instrumentalUrl, setInstrumentalUrl] = useState<string | null>(null);
  const [acapellaUrl, setAcapellaUrl] = useState<string | null>(null);
  const [words, setWords] = useState<VocalKaraokeWord[] | null>(null);
  const [karaokeMissing, setKaraokeMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creditsRemaining, setCreditsRemaining] = useState<number | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [karaokePlaying, setKaraokePlaying] = useState(false);
  const [karaokeTime, setKaraokeTime] = useState(0);
  const pollRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const karaokeAudioRef = useRef<HTMLAudioElement | null>(null);

  /* Poll the server-owned job until it completes. Tab-safe: the job
     lives on the server, so closing this page loses nothing. */
  useEffect(() => {
    if (!jobId || (status !== "queued" && status !== "processing")) return;
    pollRef.current = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/vocal-removal/${jobId}`);
        const data: VocalJobResponse = await res.json();
        if (!res.ok) {
          setStatus("failed");
          setError(data.error || t("vocalRemoval.jobNotFound"));
          return;
        }
        if (data.status === "done") {
          setStatus("done");
          setInstrumentalUrl(data.instrumentalUrl ?? null);
          setAcapellaUrl(data.acapellaUrl ?? null);
          /* The instrumental flows into the project — mastering, mix and the hub rail can pick it up. */
          if (data.instrumentalUrl) {
            addAsset({ kind: "song", url: data.instrumentalUrl, label: "Instrumental", detail: "Vocal removal" });
          }
          if (data.karaokeUrl) {
            try {
              const kr = await fetch(data.karaokeUrl);
              const kj = (await kr.json()) as { words?: VocalKaraokeWord[] };
              if (Array.isArray(kj.words) && kj.words.length > 0) {
                setWords(kj.words);
              } else {
                setKaraokeMissing(true);
              }
            } catch {
              setKaraokeMissing(true);
            }
          } else if (karaoke) {
            setKaraokeMissing(true);
          }
        } else if (data.status === "failed") {
          setStatus("failed");
          setError(data.error || t("vocalRemoval.removalFailedRefunded", { bucs: VOCAL_CREDIT_COST * 100 }));
        } else {
          setStatus(data.status as VocalJobStatus);
        }
      } catch {
        /* keep polling on transient network errors */
      }
    }, 3000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [jobId, status, karaoke]);

  /* Karaoke clock: highlight the word under the playhead. */
  useEffect(() => {
    const audio = karaokeAudioRef.current;
    if (!audio || !karaokePlaying) return;
    const onTime = () => setKaraokeTime(audio.currentTime);
    const onEnd = () => setKaraokePlaying(false);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("ended", onEnd);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("ended", onEnd);
    };
  }, [karaokePlaying, instrumentalUrl]);

  function pickFile(f: File | undefined) {
    if (!f) return;
    const isAudio = f.type.startsWith("audio/") || /\.(mp3|wav)$/i.test(f.name);
    if (!isAudio) {
      setError(t("vocalRemoval.audioFileError"));
      return;
    }
    if (f.size > VOCAL_MAX_MB * 1024 * 1024) {
      setError(t("vocalRemoval.audioSizeError", { max: VOCAL_MAX_MB }));
      return;
    }
    setFile(f);
    setError(null);
    resetResults();
  }

  function resetResults() {
    setJobId(null);
    setStatus("idle");
    setInstrumentalUrl(null);
    setAcapellaUrl(null);
    setWords(null);
    setKaraokeMissing(false);
    setKaraokePlaying(false);
    setKaraokeTime(0);
  }

  async function startRemoval() {
    if (!file || !user) return;
    setStatus("uploading");
    setError(null);
    setOutOfCredits(false);
    try {
      const form = new FormData();
      form.append("audio", file);
      form.append("karaoke", String(karaoke));
      const res = await confirmedFetch("/api/vocal-removal", { method: "POST", body: form });
      if (!res) { setStatus("idle"); return; } // user cancelled the credit confirmation
      const data: VocalJobResponse = await res.json();
      if (res.status === 402) {
        setOutOfCredits(true);
        setStatus("idle");
        return;
      }
      if (!res.ok || !data.jobId) {
        setStatus("failed");
        setError(data.message || data.error || t("vocalRemoval.startFailedError"));
        return;
      }
      setJobId(data.jobId);
      setStatus("queued");
      if (typeof data.creditsRemaining === "number") setCreditsRemaining(data.creditsRemaining);
    } catch {
      setStatus("failed");
      setError(t("vocalRemoval.networkError"));
    }
  }

  function reset() {
    setFile(null);
    resetResults();
    setError(null);
    setOutOfCredits(false);
  }

  function toggleKaraokePlay() {
    const audio = karaokeAudioRef.current;
    if (!audio || !instrumentalUrl) return;
    if (karaokePlaying) {
      audio.pause();
      setKaraokePlaying(false);
    } else {
      void audio.play();
      setKaraokePlaying(true);
    }
  }

  const busy = status === "uploading" || status === "queued" || status === "processing";
  const activeWordIndex = words
    ? words.findIndex((w, i) => {
        const next = words[i + 1];
        return karaokeTime >= w.start && (next ? karaokeTime < next.start : karaokeTime <= w.end + 0.5);
      })
    : -1;

  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
          <Mic2 className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-black">{t("vocalRemoval.pageTitle")}</h1>
          <p className="text-sm text-white/45">{t("vocalRemoval.pageSub", { cost: VOCAL_CREDIT_COST })}</p>
        </div>
      </div>

      {/* Honest framing — true separation, limits stated up front */}
      <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
        <Info className="h-4 w-4 text-primary/70 shrink-0 mt-0.5" />
        <p className="text-xs text-white/55 leading-relaxed">
          {t("vocalRemoval.honestFraming1")}{" "}
          <span className="text-white/80 font-semibold">{t("vocalRemoval.honestFramingStrong")}</span>{" "}
          {t("vocalRemoval.honestFraming2")}
        </p>
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

      <ProjectFlowBar
        kinds={["beat", "song"]}
        actionLabel={t("stems.flowBarAction")}
        onPick={async (asset) => {
          try {
            const res = await fetch(asset.url);
            const blob = await res.blob();
            const safeName = (asset.label || "audio").replace(/[^a-z0-9-_ ]/gi, "").slice(0, 40) || "audio";
            const ext = blob.type.includes("wav") ? "wav" : blob.type.includes("mpeg") ? "mp3" : "wav";
            pickFile(new File([blob], `${safeName}.${ext}`, { type: blob.type || "audio/wav" }));
          } catch {
            setError(t("stems.errorProjectAudio"));
          }
        }}
      />

      {/* Upload zone */}
      {status === "idle" || status === "failed" ? (
        <div className="mt-6 space-y-5">
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); pickFile(e.dataTransfer.files[0]); }}
            className={`cursor-pointer rounded-2xl border-2 border-dashed px-6 py-12 text-center transition ${
              dragOver ? "border-primary/60 bg-primary/5" : "border-white/[0.12] hover:border-white/25"
            }`}
          >
            <Upload className="h-8 w-8 text-white/30 mx-auto mb-3" />
            {file ? (
              <div>
                <p className="font-semibold text-white">{file.name}</p>
                <p className="text-xs text-white/40 mt-1">{t("vocalRemoval.fileChosen", { size: (file.size / 1024 / 1024).toFixed(1) })}</p>
              </div>
            ) : (
              <div>
                <p className="font-semibold text-white/70">{t("vocalRemoval.dropPrompt")}</p>
                <p className="text-xs text-white/35 mt-1">{t("vocalRemoval.dropHint", { max: VOCAL_MAX_MB })}</p>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,.mp3,.wav"
              className="hidden"
              onChange={(e) => pickFile(e.target.files?.[0])}
            />
          </div>

          {/* Karaoke toggle */}
          <label data-min-stars="3" className="flex items-start gap-3 cursor-pointer rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3.5">
            <input
              type="checkbox"
              checked={karaoke}
              onChange={(e) => setKaraoke(e.target.checked)}
              className="mt-1 h-4 w-4 accent-[#C9A84C]"
            />
            <span>
              <span className="block font-bold text-white text-sm">{t("vocalRemoval.karaokeMode")}</span>
              <span className="block text-xs text-white/40 mt-0.5">
                {t("vocalRemoval.karaokeModeDesc")}
              </span>
            </span>
          </label>

          <button
            onClick={startRemoval}
            disabled={!file || !user}
            className="w-full rounded-2xl bg-primary px-6 py-4 font-bold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("vocalRemoval.removeButton", { cost: VOCAL_CREDIT_COST })}
          </button>
          {creditsRemaining != null && (
            <p className="text-center text-xs text-white/35">{t("vocalRemoval.creditsRemaining", { count: creditsRemaining })}</p>
          )}
        </div>
      ) : null}

      {/* Progress */}
      {busy && (
        <div className="mt-6 rounded-2xl border border-white/[0.08] bg-white/[0.02] px-6 py-10 text-center">
          <Loader2 className="h-8 w-8 text-primary animate-spin mx-auto mb-4" />
          <p className="font-bold text-white">
            {status === "uploading" ? t("vocalRemoval.statusUploading") : status === "queued" ? t("vocalRemoval.statusQueued") : t("vocalRemoval.statusProcessing")}
          </p>
          <p className="text-sm text-white/40 mt-1">
            {t("vocalRemoval.progressNote")}
          </p>
        </div>
      )}

      {/* Result */}
      {status === "done" && instrumentalUrl && acapellaUrl && (
        <div className="mt-6 space-y-4">
          <div className="flex items-center gap-2.5 rounded-xl border border-green-500/25 bg-green-500/5 px-4 py-3">
            <CheckCircle2 className="h-5 w-5 text-green-400 shrink-0" />
            <p className="text-sm font-semibold text-white/80">{t("vocalRemoval.resultReady")}</p>
          </div>

          {/* Instrumental */}
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] px-5 py-4">
            <div className="flex items-center gap-2.5 mb-3">
              <Music2 className="h-4 w-4 text-primary" />
              <p className="font-bold text-white text-sm">{t("vocalRemoval.instrumental")}</p>
              <span className="text-[10px] uppercase tracking-wider text-white/30">{t("vocalRemoval.karaokeReady")}</span>
            </div>
            <audio src={instrumentalUrl} controls className="w-full" />
            <a
              href={instrumentalUrl}
              download="instrumental.mp3"
              className="mt-3 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-black transition hover:brightness-110"
            >
              <Download className="h-4 w-4" /> {t("vocalRemoval.downloadInstrumental")}
            </a>
          </div>

          {/* Acapella */}
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] px-5 py-4">
            <div className="flex items-center gap-2.5 mb-3">
              <AudioLines className="h-4 w-4 text-primary" />
              <p className="font-bold text-white text-sm">{t("vocalRemoval.acapella")}</p>
              <span className="text-[10px] uppercase tracking-wider text-white/30">{t("vocalRemoval.isolatedVocals")}</span>
            </div>
            <audio src={acapellaUrl} controls className="w-full" />
            <a
              href={acapellaUrl}
              download="acapella.mp3"
              className="mt-3 inline-flex items-center gap-2 rounded-xl border border-white/[0.12] px-5 py-2.5 text-sm font-semibold text-white/70 hover:border-white/25 transition"
            >
              <Download className="h-4 w-4" /> {t("vocalRemoval.downloadAcapella")}
            </a>
          </div>

          {/* Karaoke player */}
          {words && words.length > 0 && (
            <div className="rounded-2xl border border-primary/25 bg-primary/[0.04] px-5 py-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2.5">
                  <MicOff className="h-4 w-4 text-primary" />
                  <p className="font-bold text-white text-sm">{t("vocalRemoval.karaokeMode")}</p>
                </div>
                <button
                  onClick={toggleKaraokePlay}
                  className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-black transition hover:brightness-110"
                >
                  {karaokePlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  {karaokePlaying ? t("vocalRemoval.pause") : t("vocalRemoval.singAlong")}
                </button>
              </div>
              <audio ref={karaokeAudioRef} src={instrumentalUrl} className="hidden" />
              <div className="max-h-64 overflow-y-auto rounded-xl bg-black/40 px-4 py-4 leading-loose">
                <p className="text-lg">
                  {words.map((w, i) => (
                    <span
                      key={i}
                      className={`transition-colors duration-150 ${
                        i === activeWordIndex
                          ? "text-primary font-black"
                          : i < activeWordIndex
                            ? "text-white/35"
                            : "text-white/75"
                      }`}
                    >
                      {w.word}{" "}
                    </span>
                  ))}
                </p>
              </div>
              <p className="mt-2 text-xs text-white/35">
                {t("vocalRemoval.lyricsNote")}
              </p>
            </div>
          )}
          {karaokeMissing && (
            <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-3">
              <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-200/70">
                {t("vocalRemoval.karaokeMissing")}
              </p>
            </div>
          )}

          <button
            onClick={reset}
            className="inline-flex items-center gap-2 rounded-2xl border border-white/[0.12] px-6 py-3.5 font-semibold text-white/70 hover:border-white/25 transition"
          >
            <RefreshCw className="h-4 w-4" /> {t("vocalRemoval.newSong")}
          </button>
        </div>
      )}
    </div>
  );
}

export default function StemSplitter() {
  const { t } = useTranslation();
  /* Translated stem labels/blurbs for display; keys stay stable. */
  const stemsList = STEM_DEFS.map((s) => ({
    ...s,
    label: t(`stems.${s.labelKey}`),
    blurb: t(`stems.${s.blurbKey}`),
  }));
  const { user } = useAuth();
  const { addAsset } = useHubProject();
  const { confirmedFetch } = useConfirmedApi();
  const [file, setFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<JobStatus>("idle");
  const [stems, setStems] = useState<Record<StemKey, string> | null>(null);
  /* Mode: full 4-stem split vs the merged vocals-only preset. */
  const [stemMode, setStemMode] = useState<"full" | "vocals">("full");

  /* Deep-link: /stems?mode=vocals opens the vocals-only preset. */
  useEffect(() => {
    try {
      if (new URLSearchParams(window.location.search).get("mode") === "vocals") {
        setStemMode("vocals");
      }
    } catch {
      /* non-browser or malformed URL — ignore */
    }
  }, []);
  const [error, setError] = useState<string | null>(null);
  const [creditsRemaining, setCreditsRemaining] = useState<number | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [sourceName, setSourceName] = useState<string>("");

  // Per-stem playback: one <audio> per stem, driven together.
  const audioRefs = useRef<Record<StemKey, HTMLAudioElement | null>>({
    vocals: null, drums: null, bass: null, other: null,
  });
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState<Record<StemKey, boolean>>({
    vocals: false, drums: false, bass: false, other: false,
  });
  const [solo, setSolo] = useState<StemKey | null>(null);
  const [progress, setProgress] = useState(0);

  // Remix mode.
  const [remixOpen, setRemixOpen] = useState(false);
  const [levels, setLevels] = useState<Record<StemKey, number>>({
    vocals: 1, drums: 1, bass: 1, other: 1,
  });
  const [remixing, setRemixing] = useState(false);
  const [remixUrl, setRemixUrl] = useState<string | null>(null);
  const [remixError, setRemixError] = useState<string | null>(null);
  const [polishOpen, setPolishOpen] = useState(false);

  const pollRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* Poll the server-owned job until it completes. */
  useEffect(() => {
    if (!jobId || (status !== "queued" && status !== "processing")) return;
    pollRef.current = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/stems/${jobId}`);
        const data: StemJobResponse = await res.json();
        if (!res.ok) {
          setStatus("failed");
          setError(data.error || t("stems.errorJobNotFound"));
          return;
        }
        if (data.status === "done") {
          setStatus("done");
          setStems(data.stems ?? null);
          const stemUrls = data.stems;
          if (stemUrls) {
            addAsset({
              kind: "stems",
              url: stemUrls.vocals || stemUrls.drums || stemUrls.bass || stemUrls.other || "",
              label: t("stems.hubAssetLabel", { name: file?.name || t("stems.hubAssetDefaultName") }),
              detail: t("stems.hubAssetDetail"),
            });
          }
        } else if (data.status === "failed") {
          setStatus("failed");
          setError(data.error || t("stems.jobFailedRefund", { credits: CREDIT_COST * 100 }));
        } else {
          setStatus(data.status as JobStatus);
        }
      } catch {
        /* keep polling on transient network errors */
      }
    }, 4000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [jobId, status]);

  /* Keep the four stem players in sync while playing. */
  useEffect(() => {
    const tick = window.setInterval(() => {
      const a = audioRefs.current.vocals;
      if (a && a.duration > 0) setProgress(a.currentTime / a.duration);
    }, 250);
    return () => window.clearInterval(tick);
  }, [status]);

  function effectiveMuted(key: StemKey): boolean {
    if (solo) return key !== solo;
    return muted[key];
  }

  function syncPlayback(next: boolean) {
    const els = stemsList.map((s) => audioRefs.current[s.key]).filter(Boolean) as HTMLAudioElement[];
    if (next) {
      // Align all stems to the furthest-played position before starting.
      const latest = Math.max(...els.map((e) => e.currentTime));
      els.forEach((e) => {
        e.currentTime = latest;
        e.muted = effectiveMuted((e.dataset.stem as StemKey) ?? "vocals");
        void e.play().catch(() => {});
      });
    } else {
      els.forEach((e) => e.pause());
    }
    setPlaying(next);
  }

  function seekAll(ratio: number) {
    const els = stemsList.map((s) => audioRefs.current[s.key]).filter(Boolean) as HTMLAudioElement[];
    const dur = els[0]?.duration;
    if (!dur || !Number.isFinite(dur)) return;
    els.forEach((e) => { e.currentTime = ratio * dur; });
    setProgress(ratio);
  }

  function pickFile(f: File | undefined) {
    if (!f) return;
    if (!f.type.startsWith("audio/")) {
      setError(t("stems.errorAudioFile"));
      return;
    }
    if (f.size > MAX_BYTES) {
      setError(t("stems.errorFileTooLarge"));
      return;
    }
    setFile(f);
    setError(null);
    setStems(null);
    setJobId(null);
    setStatus("idle");
    setRemixUrl(null);
    setPlaying(false);
  }

  /* Deep-link protocol: /stems?audioUrl=… pre-loads audio (e.g. a beat from
     beat-maker) via the same fetch→File path as the project flow bar. */
  useEffect(() => {
    try {
      const audioUrl = new URLSearchParams(window.location.search).get("audioUrl");
      if (!audioUrl || file) return;
      (async () => {
        try {
          const res = await fetch(audioUrl);
          const blob = await res.blob();
          const ext = blob.type.includes("wav") ? "wav" : blob.type.includes("mpeg") ? "mp3" : "wav";
          pickFile(new File([blob], `audio.${ext}`, { type: blob.type || "audio/wav" }));
          window.history.replaceState(null, "", window.location.pathname);
        } catch {
          setError(t("stems.errorProjectAudio"));
        }
      })();
    } catch {
      /* non-browser or malformed URL — ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startSplit() {
    if (!file || !user) return;
    setStatus("uploading");
    setError(null);
    setOutOfCredits(false);
    try {
      const form = new FormData();
      form.append("audio", file);
      const res = await confirmedFetch("/api/stems", { method: "POST", body: form });
      if (!res) { setStatus("idle"); return; } // user cancelled the credit confirmation
      const data: StemJobResponse = await res.json();
      if (res.status === 402) {
        setOutOfCredits(true);
        setStatus("idle");
        return;
      }
      if (!res.ok || !data.jobId) {
        setStatus("failed");
        setError(data.message || data.error || t("stems.errorStartSplit"));
        return;
      }
      setJobId(data.jobId);
      setStatus("queued");
      setSourceName(file.name);
      if (typeof data.creditsRemaining === "number") setCreditsRemaining(data.creditsRemaining);
    } catch {
      setStatus("failed");
      setError(t("stems.errorNetwork"));
    }
  }

  async function exportRemix() {
    if (!jobId) return;
    setRemixing(true);
    setRemixError(null);
    setRemixUrl(null);
    try {
      const res = await fetch(`/api/stems/${jobId}/remix`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ levels }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        setRemixError(data.error || t("stems.errorRemix"));
        return;
      }
      setRemixUrl(data.url);
    } catch {
      setRemixError(t("stems.errorNetwork"));
    } finally {
      setRemixing(false);
    }
  }

  function reset() {
    syncPlayback(false);
    setFile(null);
    setJobId(null);
    setStatus("idle");
    setStems(null);
    setError(null);
    setOutOfCredits(false);
    setRemixUrl(null);
    setRemixOpen(false);
    setProgress(0);
    setSolo(null);
    setMuted({ vocals: false, drums: false, bass: false, other: false });
    setLevels({ vocals: 1, drums: 1, bass: 1, other: 1 });
  }

  const busy = status === "uploading" || status === "queued" || status === "processing";
  const levelPct = (v: number) => `${Math.round((v / 2) * 100)}%`;

  return (
    <div className="min-h-screen bg-black text-white">
      <main className="mx-auto max-w-3xl px-4 py-10">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-white/40 hover:text-white/70 mb-6">
          <ArrowLeft className="h-4 w-4" /> {t("stems.back")}
        </Link>

        <div className="flex items-center gap-3 mb-2">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <AudioWaveform className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-black">{t("stems.pageTitle")}</h1>
            <p className="text-sm text-white/45">{t("stems.pageSubtitle", { cost: CREDIT_COST })}</p>
          </div>
        </div>

        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
          <Info className="h-4 w-4 text-primary/70 shrink-0 mt-0.5" />
          <p className="text-xs text-white/55 leading-relaxed">
            {t("stems.infoBox", { credits: CREDIT_COST * 100 })}
          </p>
        </div>

        {/* Mode toggle: full 4-stem split vs vocals-only preset */}
        <div className="mt-6 flex justify-center">
          <div className="inline-flex rounded-2xl border border-white/10 bg-white/[0.03] p-1.5" role="tablist" aria-label={t("stems.modeLabel", { defaultValue: "Separation mode" })}>
            <button
              role="tab"
              aria-selected={stemMode === "full"}
              onClick={() => setStemMode("full")}
              className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold transition ${
                stemMode === "full" ? "bg-primary text-black" : "text-white/55 hover:text-white"
              }`}
            >
              <AudioWaveform className="h-4 w-4" />
              {t("stems.modeFull", { defaultValue: "Full split · 4cr" })}
            </button>
            <button
              role="tab"
              aria-selected={stemMode === "vocals"}
              onClick={() => setStemMode("vocals")}
              className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold transition ${
                stemMode === "vocals" ? "bg-primary text-black" : "text-white/55 hover:text-white"
              }`}
            >
              <Mic2 className="h-4 w-4" />
              {t("stems.modeVocalsOnly", { defaultValue: "Vocals only · 3cr" })}
            </button>
          </div>
        </div>

        {stemMode === "vocals" ? (
          <VocalOnlyPreset />
        ) : (
        <>
        {outOfCredits && (
          <div className="mt-4"><OutOfCredits /></div>
        )}

        {error && (
          <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-red-500/25 bg-red-500/5 px-4 py-3">
            <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
            <p className="text-sm text-red-200/80">{error}</p>
          </div>
        )}

        <ProjectFlowBar
          kinds={["beat", "song"]}
          actionLabel={t("stems.flowBarAction")}
          onPick={async (asset) => {
            try {
              const res = await fetch(asset.url);
              const blob = await res.blob();
              const safeName = (asset.label || "audio").replace(/[^a-z0-9-_ ]/gi, "").slice(0, 40) || "audio";
              const ext = blob.type.includes("wav") ? "wav" : blob.type.includes("mpeg") ? "mp3" : "wav";
              pickFile(new File([blob], `${safeName}.${ext}`, { type: blob.type || "audio/wav" }));
            } catch {
              setError(t("stems.errorProjectAudio"));
            }
          }}
        />

        {/* Upload zone */}
        {(status === "idle" || status === "failed") && (
          <div className="mt-6 space-y-5">
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); pickFile(e.dataTransfer.files[0]); }}
              className={`cursor-pointer rounded-2xl border-2 border-dashed px-6 py-12 text-center transition ${
                dragOver ? "border-primary/60 bg-primary/5" : "border-white/[0.12] hover:border-white/25"
              }`}
            >
              <Upload className="h-8 w-8 text-white/30 mx-auto mb-3" />
              {file ? (
                <div>
                  <p className="font-semibold text-white">{file.name}</p>
                  <p className="text-xs text-white/40 mt-1">{t("stems.fileSelected", { mb: (file.size / 1024 / 1024).toFixed(1) })}</p>
                </div>
              ) : (
                <div>
                  <p className="font-semibold text-white/70">{t("stems.dropHint")}</p>
                  <p className="text-xs text-white/35 mt-1">{t("stems.dropFormats")}</p>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(e) => pickFile(e.target.files?.[0])}
              />
            </div>

            <button
              onClick={startSplit}
              disabled={!file || !user}
              className="w-full rounded-2xl bg-primary px-6 py-4 font-bold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t("stems.splitButton", { cost: CREDIT_COST })}
            </button>
            {creditsRemaining != null && (
              <p className="text-center text-xs text-white/35">{t("stems.creditsRemaining", { count: creditsRemaining })}</p>
            )}
          </div>
        )}

        {/* Progress */}
        {busy && (
          <div className="mt-6 rounded-2xl border border-white/[0.08] bg-white/[0.02] px-6 py-10 text-center">
            <Loader2 className="h-8 w-8 text-primary animate-spin mx-auto mb-4" />
            <p className="font-bold text-white">
              {status === "uploading" ? t("stems.statusUploading") : status === "queued" ? t("stems.statusQueued") : t("stems.statusProcessing")}
            </p>
            <p className="text-sm text-white/40 mt-1">
              {t("stems.progressHint")}
            </p>
            {sourceName && <p className="text-xs text-white/30 mt-2">{sourceName}</p>}
          </div>
        )}

        {/* Result — per-stem player */}
        {status === "done" && stems && (
          <div className="mt-6 space-y-4">
            <div className="flex items-center gap-2.5 rounded-xl border border-green-500/25 bg-green-500/5 px-4 py-3">
              <CheckCircle2 className="h-5 w-5 text-green-400 shrink-0" />
              <p className="text-sm font-semibold text-white/80">{t("stems.splitComplete")}</p>
            </div>

            {/* Post-chain step: polish the isolated vocal stem. */}
            {stems.vocals && (
              <>
                <button
                  type="button"
                  onClick={() => setPolishOpen(true)}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-primary/40 bg-primary/[0.06] px-4 py-3 text-sm font-bold text-primary hover:bg-primary/10 transition-all"
                >
                  <AudioWaveform className="h-4 w-4" />
                  {t("vocalPolish.buttonLabel")} ({t("vocalPolish.buttonCost")})
                </button>
                <VocalPolishModal
                  open={polishOpen}
                  onClose={() => setPolishOpen(false)}
                  source={{
                    audioUrl: stems.vocals,
                    title: `${sourceName || t("stems.hubAssetDefaultName")} — vocals`,
                  }}
                />
              </>
            )}

            {/* Master transport */}
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] px-5 py-4">
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => syncPlayback(!playing)}
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary text-black transition hover:brightness-110"
                  title={playing ? t("stems.pauseAll") : t("stems.playAll")}
                >
                  {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 ml-0.5" />}
                </button>
                <div className="flex-1">
                  <div
                    className="relative h-2.5 cursor-pointer rounded-full bg-white/[0.08]"
                    onClick={(e) => {
                      const r = e.currentTarget.getBoundingClientRect();
                      seekAll((e.clientX - r.left) / r.width);
                    }}
                  >
                    <div
                      className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-primary/70 to-primary"
                      style={{ width: `${Math.min(100, progress * 100)}%` }}
                    />
                  </div>
                  <p className="mt-1.5 text-xs text-white/35">
                    {solo ? t("stems.soloing", { label: stemsList.find((s) => s.key === solo)?.label }) : t("stems.allStems")} ·{" "}
                    {t("stems.seekHint")}
                  </p>
                </div>
              </div>
            </div>

            {/* Stem cards */}
            <div className="grid gap-3 sm:grid-cols-2">
              {stemsList.map((s) => (
                <div key={s.key} className="rounded-2xl border border-white/[0.08] bg-white/[0.02] px-4 py-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className={`font-bold ${s.accent}`}>{s.label}</p>
                      <p className="text-[11px] text-white/35">{s.blurb}</p>
                    </div>
                    <a
                      href={stems[s.key]}
                      download={`${s.key}.wav`}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.1] px-2.5 py-1.5 text-xs font-semibold text-white/60 hover:border-white/25 hover:text-white transition"
                      title={t("stems.downloadWav", { label: s.label })}
                    >
                      <Download className="h-3.5 w-3.5" /> {t("stems.wav")}
                    </a>
                  </div>
                  <audio
                    ref={(el) => { audioRefs.current[s.key] = el; }}
                    data-stem={s.key}
                    src={stems[s.key]}
                    preload="auto"
                    onEnded={() => setPlaying(false)}
                  />
                  <div data-min-stars="3" className="mt-2.5 flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const next = { ...muted, [s.key]: !muted[s.key] };
                        setMuted(next);
                        const el = audioRefs.current[s.key];
                        if (el) el.muted = solo ? s.key !== solo : next[s.key];
                      }}
                      className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs font-semibold transition ${
                        muted[s.key] && !solo
                          ? "border-red-500/40 bg-red-500/10 text-red-300"
                          : "border-white/[0.08] text-white/50 hover:border-white/20 hover:text-white/80"
                      }`}
                      title={muted[s.key] ? t("stems.unmute", { label: s.label }) : t("stems.mute", { label: s.label })}
                    >
                      {muted[s.key] && !solo ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                      {muted[s.key] && !solo ? t("stems.muted") : t("stems.muteButton")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const nextSolo = solo === s.key ? null : s.key;
                        setSolo(nextSolo);
                        stemsList.forEach((st) => {
                          const el = audioRefs.current[st.key];
                          if (el) el.muted = nextSolo ? st.key !== nextSolo : muted[st.key];
                        });
                      }}
                      className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-black tracking-wider transition ${
                        solo === s.key
                          ? "border-primary/60 bg-primary/15 text-primary"
                          : "border-white/[0.08] text-white/50 hover:border-white/20 hover:text-white/80"
                      }`}
                      title={solo === s.key ? t("stems.stopSoloing", { label: s.label }) : t("stems.solo", { label: s.label })}
                    >
                      {t("stems.soloButton")}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Remix mode */}
            <div data-min-stars="4" className="rounded-2xl border border-white/[0.08] bg-white/[0.02] px-5 py-4">
              <button
                type="button"
                onClick={() => setRemixOpen((v) => !v)}
                className="flex w-full items-center justify-between"
              >
                <span className="flex items-center gap-2 font-bold text-white">
                  <SlidersHorizontal className="h-4 w-4 text-primary" />
                  {t("stems.remixMode")}
                  <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] font-bold text-green-300">{t("stems.free")}</span>
                </span>
                <span className="text-xs text-white/40">{remixOpen ? t("stems.hide") : t("stems.show")}</span>
              </button>
              {remixOpen && (
                <div className="mt-4 space-y-3">
                  <p className="text-xs text-white/40">
                    {t("stems.remixHint")}
                  </p>
                  {stemsList.map((s) => (
                    <div key={s.key} className="flex items-center gap-3">
                      <span className="w-24 shrink-0 text-xs font-semibold text-white/60">{s.label}</span>
                      <input
                        type="range"
                        min={0}
                        max={2}
                        step={0.05}
                        value={levels[s.key]}
                        onChange={(e) => setLevels({ ...levels, [s.key]: Number(e.target.value) })}
                        className="flex-1 accent-[#C9A84C]"
                      />
                      <span className="w-12 shrink-0 text-right text-xs tabular-nums text-white/50">
                        {levelPct(levels[s.key])}
                      </span>
                    </div>
                  ))}
                  {remixError && (
                    <p className="text-xs text-red-300/80">{remixError}</p>
                  )}
                  <div className="flex gap-3 pt-1">
                    <button
                      type="button"
                      onClick={exportRemix}
                      disabled={remixing}
                      className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-black transition hover:brightness-110 disabled:opacity-50"
                    >
                      {remixing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Music4 className="h-4 w-4" />}
                      {remixing ? t("stems.mixing") : t("stems.exportMix")}
                    </button>
                    {remixUrl && (
                      <a
                        href={remixUrl}
                        download="remix.wav"
                        className="inline-flex items-center gap-2 rounded-xl border border-green-500/40 bg-green-500/10 px-4 py-3 text-sm font-bold text-green-300 transition hover:bg-green-500/20"
                      >
                        <Download className="h-4 w-4" /> {t("stems.downloadMix")}
                      </a>
                    )}
                  </div>
                  {remixUrl && (
                    <audio src={remixUrl} controls className="w-full" />
                  )}
                </div>
              )}
            </div>

            <button
              onClick={reset}
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/[0.12] px-6 py-3.5 font-semibold text-white/70 hover:border-white/25 transition"
            >
              <RefreshCw className="h-4 w-4" /> {t("stems.splitAnother")}
            </button>
          </div>
        )}
        </>
        )}
      </main>

    </div>
  );
}
