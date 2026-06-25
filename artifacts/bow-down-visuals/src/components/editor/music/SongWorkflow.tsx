import { useState } from "react";
import { Mic, FileText, Clapperboard, CheckCircle2, Loader2, AlertCircle, Music2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EditorCard } from "@/components/editor/controls";
import type { EditorSettings } from "@/lib/editor-settings";

interface SongWorkflowProps {
  audioUrl: string;
  getAccessToken: () => Promise<string | null>;
  transcriptText: string | null;
  onTranscriptReady: (text: string) => void;
  onGoToCaptions: () => void;
  settings: EditorSettings;
  onSettingsChange: (s: EditorSettings) => void;
}

type TranscribeState = "idle" | "running" | "done" | "error";

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

  const ms = settings.musicStudio;
  const usingUploadedAudio = ms.videoAudio.source === "uploaded";

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
      const data = (await res.json()) as { transcript?: string; error?: string };
      if (!res.ok || !data.transcript) throw new Error(data.error ?? "Transcription failed");
      onTranscriptReady(data.transcript);
      setTxState("done");
    } catch (err) {
      setTxError(err instanceof Error ? err.message : "Could not transcribe song");
      setTxState("error");
    }
  }

  function useForVideo() {
    onSettingsChange({
      ...settings,
      musicStudio: { ...ms, videoAudio: { ...ms.videoAudio, source: "uploaded" } },
    });
  }

  const lyricsReady = !!transcriptText || txState === "done";

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
              txState === "done" ? "text-green-400 border-green-500/30" : "text-white/85"
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
                : "Get Lyrics From Song"}
          </Button>

          {/* Re-transcribe if done */}
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

          {/* Use For Captions */}
          <Button
            onClick={onGoToCaptions}
            disabled={!lyricsReady}
            variant="outline"
            className={`h-11 text-sm font-bold justify-start border-white/12 bg-white/[0.03] hover:bg-white/[0.06] text-white/85 disabled:opacity-40 ${
              txState !== "done" ? "sm:col-span-2" : ""
            }`}
            data-testid="btn-use-for-captions"
          >
            <FileText className="h-4 w-4 mr-2" />
            {lyricsReady ? "Use Lyrics For Captions →" : "Use Lyrics For Captions"}
          </Button>

          {/* Use In Final Video */}
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

        {/* Transcript preview */}
        {transcriptText && (
          <div className="rounded-lg border border-green-500/20 bg-green-500/[0.04] p-3 space-y-1.5">
            <p className="text-[10px] font-black text-green-400 uppercase tracking-wide">Lyrics Found</p>
            <p className="text-xs text-white/65 leading-relaxed line-clamp-4">{transcriptText}</p>
            <p className="text-[10px] text-white/35">
              Open the Captions tab to generate timed captions from these lyrics.
            </p>
          </div>
        )}

        {/* Error */}
        {txState === "error" && txError && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/[0.08] border border-red-500/20">
            <AlertCircle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-red-200/90 leading-relaxed">
              Could not transcribe song: {txError}
            </p>
          </div>
        )}

        {/* Credits note */}
        {txState === "idle" && (
          <p className="text-[10px] text-white/30 px-1">
            Transcription uses OpenAI Whisper. No credits charged — billed to platform usage.
          </p>
        )}
      </div>
    </EditorCard>
  );
}
