import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Mic, Upload, X, FileAudio } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";

interface Props {
  onTranscript: (text: string) => void;
  onFileUrl?: (url: string | null) => void;
  /** Exposes the raw uploaded File (e.g. so a parent can read its duration or re-upload it). */
  onFile?: (file: File | null) => void;
  className?: string;
}

/** Backstop against infinite spin — the server times out first (4 min) with a clearer message. */
const TRANSCRIBE_TIMEOUT_MS = 5 * 60 * 1000;

export function AudioTranscribe({ onTranscript, onFileUrl, onFile, className = "" }: Props) {
  const { getAccessToken } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const [file, setFile] = useState<File | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  /** "uploading" while the file posts, "transcribing" while Whisper works. */
  const [phase, setPhase] = useState<"uploading" | "transcribing" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cancelledRef = useRef(false);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setError(null);
    if (onFileUrl) onFileUrl(f ? URL.createObjectURL(f) : null);
    if (onFile) onFile(f);
    e.target.value = "";
  }

  function clearFile() {
    setFile(null);
    setError(null);
    if (onFileUrl) onFileUrl(null);
    if (onFile) onFile(null);
  }

  function cancelTranscribe() {
    cancelledRef.current = true;
    abortRef.current?.abort();
  }

  async function handleTranscribe() {
    if (!file || transcribing) return;
    setTranscribing(true);
    setPhase("uploading");
    setError(null);
    cancelledRef.current = false;
    const controller = new AbortController();
    abortRef.current = controller;
    /* Longer than the server's own Whisper timeout so the server's clearer
       error message wins the race; this is the backstop against infinite spin. */
    const timeout = setTimeout(() => controller.abort(), TRANSCRIBE_TIMEOUT_MS);
    try {
      const token = await getAccessToken();
      const fd = new FormData();
      fd.append("audio", file);
      setPhase("transcribing");
      const res = await confirmedFetch("/api/transcribe", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
        signal: controller.signal,
      });
      if (!res) return; // user cancelled the credit confirmation (finally resets state)
      const data = (await res.json().catch(() => null)) as {
        transcript?: string;
        error?: string;
        message?: string;
      } | null;
      if (!res.ok) {
        throw new Error(data?.message ?? data?.error ?? "Transcription failed");
      }
      const transcript = data?.transcript?.trim();
      if (!transcript) {
        throw new Error(
          "The transcription came back empty — your song may have no clear vocals. Try a shorter clip or paste your lyrics manually.",
        );
      }
      onTranscript(transcript);
    } catch (err) {
      if (cancelledRef.current) {
        /* User cancelled — just reset quietly. */
      } else if (controller.signal.aborted) {
        setError(
          "Transcription timed out — your song may be too long. Try a shorter MP3 or paste your lyrics manually.",
        );
      } else {
        setError("We could not transcribe this audio. Please paste your lyrics manually.");
      }
    } finally {
      clearTimeout(timeout);
      abortRef.current = null;
      cancelledRef.current = false;
      setTranscribing(false);
      setPhase(null);
    }
  }

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex flex-wrap items-center gap-2">
        <label className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold cursor-pointer transition-colors border focus-within:ring-2 focus-within:ring-primary/60 focus-within:outline-none ${file ? "bg-white/[0.06] border-white/[0.12] text-white/80" : "bg-white/[0.04] border-white/[0.08] text-white/50 hover:text-white/80 hover:bg-white/[0.07]"}`}>
          <Upload className="h-4 w-4 shrink-0" />
          <span className="truncate max-w-[180px]">{file ? file.name : "Upload Audio"}</span>
          <input
            ref={inputRef}
            type="file"
            accept="audio/*,video/mp4,video/webm"
            className="sr-only"
            aria-label={file ? `Replace audio file (currently ${file.name})` : "Upload audio file"}
            onChange={handleFileChange}
          />
        </label>

        {file && (
          <>
            <button
              type="button"
              onClick={clearFile}
              className="h-9 w-9 rounded-xl flex items-center justify-center text-white/30 hover:text-white/60 hover:bg-white/[0.05] transition-colors"
              aria-label="Remove file"
            >
              <X className="h-4 w-4" />
            </button>

            <Button
              type="button"
              onClick={handleTranscribe}
              disabled={transcribing}
              size="sm"
              className="h-9 gap-2 bg-primary/15 hover:bg-primary/25 text-primary border border-primary/25 rounded-xl font-bold text-sm px-4"
            >
              {transcribing ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> {phase === "uploading" ? "Uploading song..." : "Transcribing lyrics..."}</>
              ) : (
                <><Mic className="h-4 w-4" /> Transcribe Lyrics</>
              )}
            </Button>
            {transcribing && (
              <button
                type="button"
                onClick={cancelTranscribe}
                className="h-9 px-3 rounded-xl flex items-center gap-1.5 text-xs font-bold text-white/40 hover:text-white/70 hover:bg-white/[0.05] transition-colors"
              >
                <X className="h-3.5 w-3.5" /> Cancel
              </button>
            )}
          </>
        )}
      </div>

      {transcribing && (
        <p className="text-xs text-white/35">
          {phase === "uploading"
            ? "Sending your song — keep this tab open."
            : "Long songs can take a few minutes. You can cancel anytime."}
        </p>
      )}

      {file && (
        <p className="flex items-center gap-1.5 text-xs text-white/25">
          <FileAudio className="h-3 w-3 shrink-0" />
          {(file.size / 1024 / 1024).toFixed(1)} MB · MP3, WAV, M4A, or any audio format
        </p>
      )}

      {error && (
        <p className="text-sm text-red-400/80 flex items-start gap-2">
          <span className="shrink-0 mt-0.5">⚠</span>
          {error}
        </p>
      )}
    </div>
  );
}
