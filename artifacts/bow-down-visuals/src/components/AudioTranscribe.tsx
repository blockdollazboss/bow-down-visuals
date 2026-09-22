import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Mic, Upload, X, FileAudio } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

interface Props {
  onTranscript: (text: string) => void;
  onFileUrl?: (url: string | null) => void;
  /** Exposes the raw uploaded File (e.g. so a parent can read its duration or re-upload it). */
  onFile?: (file: File | null) => void;
  className?: string;
}

export function AudioTranscribe({ onTranscript, onFileUrl, onFile, className = "" }: Props) {
  const { getAccessToken } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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

  async function handleTranscribe() {
    if (!file) return;
    setTranscribing(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const fd = new FormData();
      fd.append("audio", file);
      const res = await fetch("/api/transcribe", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      if (!res.ok) throw new Error("Transcription failed");
      const data = (await res.json()) as { transcript: string };
      onTranscript(data.transcript);
    } catch {
      setError("We could not transcribe this audio. Please paste your lyrics manually.");
    } finally {
      setTranscribing(false);
    }
  }

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex flex-wrap items-center gap-2">
        <label className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold cursor-pointer transition-colors border ${file ? "bg-white/[0.06] border-white/[0.12] text-white/80" : "bg-white/[0.04] border-white/[0.08] text-white/50 hover:text-white/80 hover:bg-white/[0.07]"}`}>
          <Upload className="h-4 w-4 shrink-0" />
          <span className="truncate max-w-[180px]">{file ? file.name : "Upload Audio"}</span>
          <input
            ref={inputRef}
            type="file"
            accept="audio/*,video/mp4,video/webm"
            className="hidden"
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
                <><Loader2 className="h-4 w-4 animate-spin" /> Transcribing lyrics...</>
              ) : (
                <><Mic className="h-4 w-4" /> Transcribe Lyrics</>
              )}
            </Button>
          </>
        )}
      </div>

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
