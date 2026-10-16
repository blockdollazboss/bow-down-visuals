/* ── Podcast transcript editor (Stack 6 #5) ──────────────────────────────
 * Edit a recorded or imported episode by editing its words. The episode
 * is transcribed once with word-level timings (the same analysis the
 * Filler-Word Remover runs — 200 Visual Bucs, confirmed before it
 * charges; silence spans come from the same detection). Clicking a word
 * marks it for deletion; silence chips toggle the pauses. Rendering
 * reassembles the audio with exactly those cuts — no extra charge, and
 * the cuts you see are the cuts that render (same padding/merge rules on
 * both sides, see lib/podcast-edit.ts). */

import { useEffect, useRef, useState } from "react";
import { Download, Loader2, Scissors, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { uploadStemFile } from "@/lib/audio-stems";
import {
  buildTranscriptFlow,
  buildTranscriptRenderCuts,
  editedTimeSaved,
  fillerWordIndices,
  type TranscriptCut,
  type TranscriptWord,
} from "@/lib/podcast-edit";

/** Same default filler set as the video editor's Filler-Word Remover. */
const DEFAULT_FILLER_WORDS = [
  "um", "uh", "uhm", "uhh", "umm", "erm", "hmm",
  "you know", "i mean", "sort of", "kind of",
];

interface AnalyzeResult {
  cuts: TranscriptCut[];
  words: TranscriptWord[];
  durationSec: number | null;
}

type Phase = "idle" | "analyzing" | "review" | "rendering" | "done";

export function PodcastTranscriptEditor() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const [mediaUrl, setMediaUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [stage, setStage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [analyzeJobId, setAnalyzeJobId] = useState<string | null>(null);
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [deleted, setDeleted] = useState<ReadonlySet<number>>(new Set());
  const [silencesOn, setSilencesOn] = useState<ReadonlySet<string>>(new Set());
  const [renderJobId, setRenderJobId] = useState<string | null>(null);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const silenceCuts = (result?.cuts ?? []).filter((c) => c.kind === "silence");
  const fillerIdx = result ? fillerWordIndices(result.words, result.cuts) : new Set<number>();
  const renderCuts = result
    ? buildTranscriptRenderCuts(result.words, deleted, silenceCuts, silencesOn)
    : [];
  const timeSaved = result?.durationSec ? editedTimeSaved(renderCuts, result.durationSec) : 0;
  const flow = result ? buildTranscriptFlow(result.words, silenceCuts) : [];

  async function handleUpload(file: File) {
    if (!user) {
      toast({ title: "Sign in required", description: "Sign in to import an episode.", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const up = await uploadStemFile(user.id, file);
      setMediaUrl(up.url);
      toast({ title: "Episode imported", description: "Ready to transcribe." });
    } catch (err) {
      toast({ title: "Upload failed", description: err instanceof Error ? err.message : "Could not upload.", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  async function startAnalyze() {
    if (!mediaUrl.trim() || phase === "analyzing") return;
    setError(null);
    setResult(null);
    setOutputUrl(null);
    setDeleted(new Set());
    setSilencesOn(new Set());
    lastAnalyzeJobId.current = null;
    try {
      const res = await confirmedFetch("/api/remove-fillers/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mediaUrl: mediaUrl.trim(),
          fillerWords: DEFAULT_FILLER_WORDS,
          removeSilences: true,
        }),
      });
      if (!res) return; /* credit confirmation cancelled */
      const data = (await res.json().catch(() => null)) as { jobId?: string; error?: string } | null;
      if (!res.ok || !data?.jobId) throw new Error(data?.error ?? "Could not start the transcription.");
      setAnalyzeJobId(data.jobId);
      setPhase("analyzing");
      setStage("queued");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transcription failed to start.");
    }
  }

  /* Poll the analyze job. */
  useEffect(() => {
    if (!analyzeJobId || phase !== "analyzing") return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/remove-fillers/analyze/${analyzeJobId}`);
        if (!res.ok) return;
        const data = (await res.json()) as {
          status: string; stage?: string; error?: string | null;
          cuts?: TranscriptCut[]; words?: TranscriptWord[]; durationSec?: number | null;
        };
        if (cancelled) return;
        setStage(data.status);
        if (data.status === "done") {
          const words = data.words ?? [];
          const cuts = data.cuts ?? [];
          lastAnalyzeJobId.current = analyzeJobId;
          setResult({ cuts, words, durationSec: data.durationSec ?? null });
          /* Start from the detector's own suggestions — the user edits from there. */
          setDeleted(fillerWordIndices(words, cuts));
          setSilencesOn(new Set(cuts.filter((c) => c.kind === "silence").map((c) => c.id)));
          setPhase("review");
          setAnalyzeJobId(null);
        } else if (data.status === "failed") {
          setError(data.error ?? "Transcription failed — the charge was refunded.");
          setPhase("idle");
          setAnalyzeJobId(null);
        }
      } catch {
        /* transient — keep polling */
      }
    };
    void tick();
    pollRef.current = setInterval(() => void tick(), 2500);
    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [analyzeJobId, phase]);

  async function startRender() {
    if (phase !== "review" && phase !== "done") return;
    if (renderCuts.length === 0) {
      setError("Nothing is marked for deletion yet — click words or enable silences first.");
      return;
    }
    setError(null);
    try {
      /* The render endpoint keys off the completed analyze job. */
      const jobId = lastAnalyzeJobId.current;
      if (!jobId) {
        setError("The transcription session expired — run the transcription again.");
        return;
      }
      const res = await confirmedFetch("/api/remove-fillers/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analyzeJobId: jobId, cuts: renderCuts }),
      });
      if (!res) return;
      const data = (await res.json().catch(() => null)) as { jobId?: string; error?: string } | null;
      if (!res.ok || !data?.jobId) throw new Error(data?.error ?? "Could not start the render.");
      setRenderJobId(data.jobId);
      setPhase("rendering");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Render failed to start.");
    }
  }

  const lastAnalyzeJobId = useRef<string | null>(null);

  /* Poll the render job. */
  useEffect(() => {
    if (!renderJobId || phase !== "rendering") return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/remove-fillers/render/${renderJobId}`);
        if (!res.ok) return;
        const data = (await res.json()) as { status: string; outputUrl?: string | null; error?: string | null };
        if (cancelled) return;
        if (data.status === "done") {
          setOutputUrl(data.outputUrl ?? null);
          setPhase("done");
          setRenderJobId(null);
        } else if (data.status === "failed") {
          setError(data.error ?? "Render failed.");
          setPhase("review");
          setRenderJobId(null);
        }
      } catch {
        /* transient */
      }
    };
    void tick();
    const iv = setInterval(() => void tick(), 2500);
    return () => { cancelled = true; clearInterval(iv); };
  }, [renderJobId, phase]);

  function toggleWord(index: number) {
    setDeleted((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }
  function toggleSilence(id: string) {
    setSilencesOn((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-4" data-testid="podcast-transcript-editor">
      <div>
        <h3 className="text-base font-black text-white">Transcript Editor</h3>
        <p className="text-xs text-white/45 leading-relaxed mt-1">
          For recorded or imported episodes: transcribe once (200 Visual Bucs — the same charge as the Filler-Word Remover),
          then delete words and pauses by editing the text. Rendering the cleaned episode is free.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          value={mediaUrl}
          onChange={(e) => setMediaUrl(e.target.value)}
          placeholder="Episode audio URL (MP3, WAV, M4A…)"
          className="h-10 flex-1 min-w-[220px] rounded-lg bg-white/[0.03] border border-white/10 px-3 text-sm text-white/85"
          data-testid="podcast-media-url"
        />
        <Button type="button" variant="outline" disabled={uploading} onClick={() => fileRef.current?.click()} className="h-10 text-sm font-bold border-white/12 bg-white/[0.03] text-white/80" data-testid="btn-podcast-upload">
          {uploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />} Import file
        </Button>
        <input ref={fileRef} type="file" accept=".wav,.mp3,.m4a,.flac,audio/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleUpload(f); e.target.value = ""; }} />
        <Button type="button" onClick={() => void startAnalyze()} disabled={!mediaUrl.trim() || phase === "analyzing"} className="h-10 text-sm font-black bg-primary text-black hover:bg-primary/90" data-testid="btn-podcast-analyze">
          {phase === "analyzing" ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Transcribing… ({stage})</> : <><Scissors className="h-4 w-4 mr-2" /> Transcribe episode</>}
        </Button>
      </div>

      {error && <p className="text-[11px] text-red-300/90 leading-relaxed" data-testid="podcast-error">{error}</p>}

      {phase !== "idle" && result && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-bold text-white/55">
              {deleted.size} word{deleted.size === 1 ? "" : "s"} marked · {silencesOn.size} pause{silencesOn.size === 1 ? "" : "s"} cut · saves ~{timeSaved.toFixed(1)}s
            </span>
            <div className="ml-auto flex gap-2">
              <button type="button" onClick={() => setDeleted(new Set(fillerIdx))} className="text-[11px] font-bold text-amber-300/90 hover:text-amber-200">Cut all fillers</button>
              <button type="button" onClick={() => setSilencesOn(new Set(silenceCuts.map((c) => c.id)))} className="text-[11px] font-bold text-amber-300/90 hover:text-amber-200">Cut all pauses</button>
              <button type="button" onClick={() => { setDeleted(new Set()); setSilencesOn(new Set()); }} className="text-[11px] font-bold text-white/45 hover:text-white/75">Reset</button>
            </div>
          </div>
          <div className="rounded-xl border border-white/[0.08] bg-black/25 p-4 leading-[2.1] text-[15px]" data-testid="transcript-flow">
            {flow.map((item, i) => {
              if (item.type === "silence") {
                const on = silencesOn.has(item.cut.id);
                return (
                  <button
                    key={`s-${item.cut.id}-${i}`}
                    type="button"
                    onClick={() => toggleSilence(item.cut.id)}
                    className={`mx-1 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold align-middle transition-colors ${on ? "bg-red-500/25 text-red-200 line-through" : "bg-white/[0.06] text-white/45 hover:text-white/75"}`}
                    title={on ? "This pause will be cut — click to keep it" : "Pause — click to cut it"}
                    data-testid={`silence-chip-${item.cut.id}`}
                  >
                    ⏸ {Math.max(0.1, item.cut.end - item.cut.start).toFixed(1)}s
                  </button>
                );
              }
              const isDel = deleted.has(item.index);
              const isFiller = fillerIdx.has(item.index);
              return (
                <button
                  key={`w-${item.index}`}
                  type="button"
                  onClick={() => toggleWord(item.index)}
                  className={`rounded px-0.5 transition-colors ${isDel ? "text-red-300 line-through decoration-red-400/70" : isFiller ? "text-amber-200/90 hover:bg-white/[0.06]" : "text-white/85 hover:bg-white/[0.06]"}`}
                  title={isDel ? "Will be cut — click to keep" : "Click to cut this word"}
                  data-testid={`word-${item.index}`}
                >
                  {item.word.word}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={() => void startRender()} disabled={phase === "rendering" || renderCuts.length === 0} className="h-10 text-sm font-black bg-primary text-black hover:bg-primary/90" data-testid="btn-podcast-render">
              {phase === "rendering" ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Cutting…</> : <><Scissors className="h-4 w-4 mr-2" /> Render cleaned episode (free)</>}
            </Button>
            {phase === "done" && outputUrl && (
              <div className="flex-1 min-w-[240px] space-y-2" data-testid="podcast-render-done">
                <audio controls src={outputUrl} className="w-full" />
                <a href={outputUrl} download target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[11px] font-bold text-amber-300 hover:text-amber-200">
                  <Download className="h-3.5 w-3.5" /> Download cleaned episode
                </a>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
