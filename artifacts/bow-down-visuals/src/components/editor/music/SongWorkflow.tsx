import { useState, useEffect } from "react";
import {
  Mic, FileText, Clapperboard, CheckCircle2, Loader2, AlertCircle,
  Music2, RotateCcw, PenLine, Sparkles, Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { EditorCard } from "@/components/editor/controls";
import type { CaptionLine, EditorSettings } from "@/lib/editor-settings";
import { smartSplitLyrics } from "@/lib/lyric-splitter";

interface WhisperSegment {
  id: number;
  start: number;
  end: number;
  text: string;
}

interface SongWorkflowProps {
  audioUrl: string;
  getAccessToken: () => Promise<string | null>;
  transcriptText: string | null;
  onTranscriptReady: (text: string) => void;
  onGoToCaptions: () => void;
  settings: EditorSettings;
  onSettingsChange: (s: EditorSettings) => void;
}

type TranscribeState = "idle" | "running" | "done" | "too-large" | "error";

function newLineId() {
  return `line-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function segmentsToCaptionLines(segments: WhisperSegment[]): CaptionLine[] {
  return segments
    .filter((s) => s.text.trim().length > 0)
    .map((s) => ({
      id: newLineId(),
      startSec: parseFloat(s.start.toFixed(1)),
      endSec: parseFloat(s.end.toFixed(1)),
      text: s.text.trim(),
    }));
}

function estimatedCaptionLines(
  lyricsText: string,
  splitStyle: "short" | "medium" | "long",
  songDuration?: number,
): CaptionLine[] {
  const phrases = smartSplitLyrics(lyricsText, splitStyle);
  if (phrases.length === 0) return [];
  const secPer = songDuration && songDuration > 0 ? songDuration / phrases.length : 2;
  return phrases.map((text, i): CaptionLine => ({
    id: newLineId(),
    startSec: parseFloat((i * secPer).toFixed(1)),
    endSec: parseFloat(((i + 1) * secPer).toFixed(1)),
    text,
  }));
}

export function SongWorkflow({
  audioUrl,
  getAccessToken,
  transcriptText,
  onTranscriptReady,
  onGoToCaptions,
  settings,
  onSettingsChange,
}: SongWorkflowProps) {
  const [txState, setTxState] = useState<TranscribeState>(transcriptText ? "done" : "idle");
  const [txError, setTxError] = useState<string | null>(null);
  const [manualLyrics, setManualLyrics] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [sentToCaptions, setSentToCaptions] = useState(false);
  const [localTranscript, setLocalTranscript] = useState<string | null>(null);
  const [localSegments, setLocalSegments] = useState<WhisperSegment[] | null>(null);
  const [songDuration, setSongDuration] = useState<number | null>(null);

  const ms = settings.musicStudio;
  const usingUploadedAudio = ms.videoAudio.source === "uploaded";
  const activeTranscript = localTranscript ?? transcriptText ?? null;

  /* Probe duration from the audio URL on mount and whenever the URL changes */
  useEffect(() => {
    if (!audioUrl) return;
    const audio = new Audio();
    audio.preload = "metadata";
    audio.crossOrigin = "anonymous";
    let disposed = false;
    audio.addEventListener("loadedmetadata", () => {
      if (!disposed && isFinite(audio.duration) && audio.duration > 0) {
        setSongDuration(audio.duration);
      }
    });
    audio.src = audioUrl;
    return () => {
      disposed = true;
      audio.src = "";
    };
  }, [audioUrl]);

  const fileName = (() => {
    try {
      return decodeURIComponent(new URL(audioUrl).pathname.split("/").pop() ?? "song");
    } catch {
      return "uploaded song";
    }
  })();

  async function getLyrics() {
    setTxState("running");
    setTxError(null);
    setSentToCaptions(false);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/transcribe-url", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token ?? ""}`,
        },
        body: JSON.stringify({ audioUrl }),
      });
      const data = (await res.json()) as {
        transcript?: string;
        segments?: WhisperSegment[];
        duration?: number;
        error?: string;
        message?: string;
      };

      if (res.status === 413 || data.error === "FILE_TOO_LARGE") {
        setTxError(
          data.message ??
            "This song file is too large to transcribe. Please upload a smaller MP3 or paste lyrics manually.",
        );
        setTxState("too-large");
        setShowManual(true);
        return;
      }

      if (!res.ok || !data.transcript) throw new Error(data.error ?? data.message ?? "Transcription failed");

      const text = data.transcript;
      setLocalTranscript(text);
      setLocalSegments(data.segments ?? null);
      setSongDuration(data.duration ?? null);
      onTranscriptReady(text);
      setTxState("done");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not transcribe song";
      setTxError(msg);
      setTxState("error");
    }
  }

  function useForVideo() {
    onSettingsChange({
      ...settings,
      musicStudio: {
        ...ms,
        videoAudio: {
          ...ms.videoAudio,
          source: "uploaded",
          /* Also persist the duration if already probed, so Captions + Timeline
             can read it immediately without re-probing on the next render.     */
          ...(songDuration != null ? { duration: songDuration } : {}),
        },
      },
    });
  }

  /**
   * Push lyrics directly into settings.captions so CaptionsSection sees them immediately.
   * If Whisper returned segments, use exact timestamps. Otherwise estimate at 2 s/line.
   */
  function sendLyricsToCaptions(text: string, segments?: WhisperSegment[] | null) {
    const trimmed = text.trim();
    if (!trimmed) return;

    const splitStyle = settings.captions.captionSplitStyle ?? "short";
    const captionLines =
      segments && segments.length > 0
        ? segmentsToCaptionLines(segments)
        : estimatedCaptionLines(trimmed, splitStyle, songDuration ?? undefined);

    onSettingsChange({
      ...settings,
      captions: {
        ...settings.captions,
        lyricsText: trimmed,
        mode: settings.captions.mode === "none" ? "auto" : settings.captions.mode,
        lines: captionLines,
      },
    });
    setSentToCaptions(true);
    onGoToCaptions();
  }

  function submitManualLyrics() {
    const trimmed = manualLyrics.trim();
    if (!trimmed) return;
    setLocalTranscript(trimmed);
    onTranscriptReady(trimmed);
    setTxState("done");
    sendLyricsToCaptions(trimmed, null);
  }

  const lyricsReady = !!activeTranscript || txState === "done";
  const hasTimestamps = (localSegments?.length ?? 0) > 0;

  return (
    <EditorCard
      title="Song Ready"
      subtitle={fileName}
      icon={<Music2 className="h-4 w-4" />}
    >
      <div className="space-y-3">
        {/* File name chip */}
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06]">
          <div className="h-2 w-2 rounded-full bg-green-400 shrink-0" />
          <p className="text-xs text-white/60 truncate flex-1">{fileName}</p>
          {usingUploadedAudio && (
            <span className="text-[10px] font-bold text-primary">In Video ✓</span>
          )}
        </div>

        {/* Action buttons */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {/* Get Lyrics */}
          <Button
            onClick={getLyrics}
            disabled={txState === "running"}
            variant="outline"
            className={`h-11 text-sm font-bold justify-start border-white/12 bg-white/[0.03] hover:bg-white/[0.06] ${
              txState === "done"
                ? "text-green-400 border-green-500/30"
                : txState === "too-large" || txState === "error"
                  ? "text-amber-400 border-amber-500/25"
                  : "text-white/85"
            }`}
            data-testid="btn-get-lyrics"
          >
            {txState === "running" ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : txState === "done" ? (
              <CheckCircle2 className="h-4 w-4 mr-2" />
            ) : (
              <Mic className="h-4 w-4 mr-2" />
            )}
            {txState === "done"
              ? "Lyrics Found ✓"
              : txState === "running"
                ? "Transcribing…"
                : txState === "too-large"
                  ? "Retry Transcription"
                  : "Get Lyrics From Song"}
          </Button>

          {/* Re-transcribe once done */}
          {txState === "done" && (
            <Button
              onClick={getLyrics}
              variant="outline"
              className="h-11 text-sm font-bold justify-start border-white/12 bg-white/[0.03] hover:bg-white/[0.06] text-white/50"
              data-testid="btn-retranscribe"
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              Re-transcribe
            </Button>
          )}

          {/* Paste Lyrics Manually toggle */}
          {txState !== "done" && (
            <Button
              onClick={() => setShowManual((v) => !v)}
              variant="outline"
              className={`h-11 text-sm font-bold justify-start border-white/12 bg-white/[0.03] hover:bg-white/[0.06] ${
                showManual ? "text-primary border-primary/30" : "text-white/60"
              }`}
              data-testid="btn-paste-lyrics"
            >
              <PenLine className="h-4 w-4 mr-2" />
              Paste Lyrics Manually
            </Button>
          )}

          {/* Use For Captions — writes to settings.captions directly */}
          <Button
            onClick={() => activeTranscript && sendLyricsToCaptions(activeTranscript, localSegments)}
            disabled={!lyricsReady}
            variant="outline"
            className={`h-11 text-sm font-bold justify-start border-white/12 bg-white/[0.03] hover:bg-white/[0.06] text-white/85 disabled:opacity-40 ${
              txState !== "done" ? "sm:col-span-2" : ""
            } ${sentToCaptions ? "text-green-400 border-green-500/30" : ""}`}
            data-testid="btn-use-for-captions"
          >
            <FileText className="h-4 w-4 mr-2" />
            {sentToCaptions
              ? "Lyrics Sent to Captions ✓"
              : lyricsReady
                ? "Use Lyrics For Captions →"
                : "Use Lyrics For Captions"}
          </Button>

          {/* Use In Final Video — always enabled */}
          <Button
            onClick={useForVideo}
            variant="outline"
            className={`h-11 text-sm font-bold justify-start sm:col-span-2 border-white/12 ${
              usingUploadedAudio
                ? "text-primary border-primary/40 bg-primary/[0.04]"
                : "bg-white/[0.03] hover:bg-white/[0.06] text-white/85"
            }`}
            data-testid="btn-use-for-video"
          >
            <Clapperboard className="h-4 w-4 mr-2" />
            {usingUploadedAudio ? "Song Set As Video Audio ✓" : "Use Song In Final Video"}
          </Button>
        </div>

        {/* ── File too large notice ── */}
        {txState === "too-large" && txError && (
          <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.06] p-3 space-y-2">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-[11px] text-amber-200/90 leading-relaxed">{txError}</p>
            </div>
            <p className="text-[10px] text-amber-300/60 pl-5">
              Large song transcription (auto-chunking) — coming soon. For now, paste your lyrics below.
            </p>
          </div>
        )}

        {/* ── Generic error ── */}
        {txState === "error" && txError && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/[0.08] border border-red-500/20">
            <AlertCircle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-red-200/90 leading-relaxed">
              Could not transcribe song: {txError}
            </p>
          </div>
        )}

        {/* ── Manual lyrics paste box ── */}
        {showManual && txState !== "done" && (
          <div className="space-y-2 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
            <label className="block text-[10px] font-black text-white/50 uppercase tracking-wide">
              Lyrics For Captions
            </label>
            <textarea
              value={manualLyrics}
              onChange={(e) => setManualLyrics(e.target.value)}
              placeholder={"Paste your song lyrics here…\n\nEach line becomes one caption.\n[Verse], [Hook], [Chorus] labels are stripped automatically."}
              rows={8}
              data-testid="textarea-manual-lyrics"
              className="w-full bg-white/[0.03] border border-white/[0.08] rounded-lg px-3 py-2 text-xs text-white/80 placeholder:text-white/25 focus:outline-none focus:border-primary/40 resize-none leading-relaxed"
            />
            <Button
              onClick={submitManualLyrics}
              disabled={!manualLyrics.trim()}
              className="w-full h-10 text-sm font-black bg-primary text-black hover:bg-primary/90 disabled:opacity-40"
              data-testid="btn-generate-captions-from-lyrics"
            >
              <Sparkles className="h-4 w-4 mr-2" />
              Generate Captions From Lyrics
            </Button>
            <p className="text-[10px] text-white/30">
              Lyrics saved to project and sent to Captions tab.
            </p>
          </div>
        )}

        {/* ── Transcript preview ── */}
        {activeTranscript && (
          <div className="rounded-lg border border-green-500/20 bg-green-500/[0.04] p-3 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-black text-green-400 uppercase tracking-wide">Lyrics Ready</p>
              {hasTimestamps ? (
                <span className="flex items-center gap-1 text-[10px] text-green-400/70">
                  <Clock className="h-2.5 w-2.5" />
                  Exact timestamps ✓
                </span>
              ) : (
                <span className="text-[10px] text-white/30">2 s/line estimated</span>
              )}
            </div>
            <p className="text-xs text-white/65 leading-relaxed line-clamp-4">{activeTranscript}</p>
            <p className="text-[10px] text-white/35">
              Click <span className="text-white/55 font-semibold">Use Lyrics For Captions →</span> to fill the Captions tab and generate caption cards.
            </p>
          </div>
        )}

        {/* ── Credits note (idle only) ── */}
        {txState === "idle" && (
          <p className="text-[10px] text-white/30 px-1">
            Transcription uses OpenAI Whisper. No credits charged — billed to platform usage.
          </p>
        )}
      </div>
    </EditorCard>
  );
}
