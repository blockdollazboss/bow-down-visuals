import { useState } from "react";
import { ListVideo, Sparkles, Copy, Check, Plus, Trash2, Loader2, AlertCircle } from "lucide-react";
import { EditorCard } from "@/components/editor/controls";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import type { VideoChapter } from "@/lib/editor-settings";

const AUTO_CHAPTERS_COST = 150;

interface AutoChaptersCardProps {
  chapters: VideoChapter[];
  onChaptersChange: (chapters: VideoChapter[]) => void;
  /** Resolved project audio URL — used for the transcribe-first flow. */
  audioUrl: string | null;
  /** Existing project transcript, prefilled into the paste box. */
  transcriptText: string | null;
  /** Total video duration in seconds (needed for untimed transcripts). */
  durationSec: number | null;
}

function formatChapterTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(r).padStart(2, "0")}`;
}

/** Accept "M:SS", "H:MM:SS" or plain seconds; null when unparseable. */
function parseChapterTime(v: string): number | null {
  const s = v.trim();
  if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  const parts = s.split(":").map((p) => p.trim());
  if (parts.length < 2 || parts.length > 3) return null;
  if (!parts.every((p) => /^\d+(\.\d+)?$/.test(p))) return null;
  const nums = parts.map(Number);
  if (parts.length === 2) return nums[0]! * 60 + nums[1]!;
  return nums[0]! * 3600 + nums[1]! * 60 + nums[2]!;
}

type GenStatus = { type: "success" | "error" | "info"; message: string } | null;

export function AutoChaptersCard({
  chapters,
  onChaptersChange,
  audioUrl,
  transcriptText,
  durationSec,
}: AutoChaptersCardProps) {
  const { confirmedFetch } = useConfirmedApi();
  const [mode, setMode] = useState<"audio" | "transcript">(audioUrl ? "audio" : "transcript");
  const [transcript, setTranscript] = useState(transcriptText ?? "");
  const [maxChapters, setMaxChapters] = useState(10);
  const [generating, setGenerating] = useState(false);
  const [status, setStatus] = useState<GenStatus>(null);
  const [copied, setCopied] = useState(false);

  function sortChapters(list: VideoChapter[]): VideoChapter[] {
    return [...list].sort((a, b) => a.startSec - b.startSec);
  }

  async function runGenerate() {
    setStatus(null);
    if (mode === "audio") {
      if (!audioUrl) {
        setStatus({ type: "error", message: "No project audio found — paste a transcript instead." });
        return;
      }
    } else if (transcript.trim().length < 20) {
      setStatus({ type: "error", message: "Paste at least a few sentences of transcript first." });
      return;
    } else if (!durationSec || durationSec <= 0) {
      const hasTimestamps = /^\s*\[?\d{1,2}:\d{2}/m.test(transcript);
      if (!hasTimestamps) {
        setStatus({ type: "error", message: "Video duration isn't known yet — paste a transcript with [M:SS] timestamps or use the audio flow." });
        return;
      }
    }

    setGenerating(true);
    try {
      const body: Record<string, unknown> = { maxChapters };
      if (mode === "audio") {
        body.audioUrl = audioUrl;
      } else {
        body.transcript = transcript.trim();
        if (durationSec && durationSec > 0) body.totalDurationSec = Math.round(durationSec);
      }

      const res = await confirmedFetch("/api/auto-chapters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res) return; // user cancelled the credit confirmation
      if (!res.ok) {
        const err = (await res.json().catch(() => ({ error: "Chapter generation failed" }))) as {
          error?: string;
          message?: string;
        };
        throw new Error(err.message ?? err.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { chapters?: VideoChapter[] };
      const next = sortChapters(data.chapters ?? []);
      if (next.length === 0) throw new Error("No chapters were generated — try a longer transcript.");
      onChaptersChange(next);
      setStatus({ type: "success", message: `${next.length} chapters generated — review, edit, then copy for YouTube.` });
    } catch (err) {
      setStatus({ type: "error", message: err instanceof Error ? err.message : "Chapter generation failed." });
    } finally {
      setGenerating(false);
    }
  }

  function updateChapter(i: number, patch: Partial<VideoChapter>) {
    const next = chapters.map((c, idx) => (idx === i ? { ...c, ...patch } : c));
    onChaptersChange(sortChapters(next));
  }

  function deleteChapter(i: number) {
    onChaptersChange(chapters.filter((_, idx) => idx !== i));
  }

  function addChapter() {
    const last = chapters[chapters.length - 1];
    const startSec = last ? last.endSec : 0;
    onChaptersChange(sortChapters([...chapters, { title: "New chapter", startSec, endSec: startSec + 60 }]));
  }

  async function copyForYouTube() {
    const text = chapters
      .map((c) => `${formatChapterTime(c.startSec)} ${c.title}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setStatus({ type: "error", message: "Clipboard blocked — select the list and copy manually." });
    }
  }

  return (
    <EditorCard
      title="Auto Chapters"
      subtitle={`AI detects topic shifts in your transcript and drops timestamped chapter markers. ${AUTO_CHAPTERS_COST} Visual Bucs per run.`}
      icon={<ListVideo className="h-4 w-4" />}
    >
      <div className="space-y-4">
        {/* Source toggle */}
        <div className="flex gap-2">
          {(["audio", "transcript"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`flex-1 rounded-lg border px-3 py-2 text-[11px] font-bold transition-colors ${
                mode === m
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "border-white/10 bg-black/40 text-white/50 hover:text-white"
              }`}
            >
              {m === "audio" ? "From project audio" : "Paste transcript"}
            </button>
          ))}
        </div>

        {mode === "transcript" && (
          <textarea
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            rows={5}
            placeholder="Paste your transcript here. Add [M:SS] timestamps per line for exact chapter times, or leave plain text and we'll scale from the video duration."
            className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-[12px] text-white placeholder:text-white/25 focus:outline-none focus:border-primary/50 resize-y"
          />
        )}
        {mode === "audio" && (
          <p className="text-[11px] text-white/40 leading-relaxed">
            {audioUrl
              ? "Uses your project's audio — transcribed with timestamps first, then the AI finds topic shifts."
              : "No project audio found. Switch to “Paste transcript” instead."}
          </p>
        )}

        <div className="flex items-center gap-3">
          <label className="text-[11px] font-bold text-white/50 uppercase tracking-wider">
            Max chapters
          </label>
          <input
            type="number"
            min={2}
            max={20}
            value={maxChapters}
            onChange={(e) => setMaxChapters(Math.min(20, Math.max(2, Number(e.target.value) || 2)))}
            className="w-16 rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[12px] text-white focus:outline-none focus:border-primary/50"
          />
          <button
            type="button"
            onClick={runGenerate}
            disabled={generating}
            className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-[12px] font-black text-black uppercase tracking-wider hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {generating ? "Detecting topics…" : `Auto-generate · ${AUTO_CHAPTERS_COST} Bucs`}
          </button>
        </div>

        {status && (
          <div
            className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-[11px] leading-relaxed ${
              status.type === "error"
                ? "border-red-500/30 bg-red-500/[0.06] text-red-300"
                : status.type === "success"
                  ? "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-300"
                  : "border-white/10 bg-white/[0.03] text-white/60"
            }`}
          >
            {status.type === "error" && <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />}
            {status.type === "success" && <Check className="h-3.5 w-3.5 mt-0.5 shrink-0" />}
            <span>{status.message}</span>
          </div>
        )}

        {/* Chapter list: edit → apply */}
        {chapters.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-black text-white/50 uppercase tracking-widest">
                Chapters ({chapters.length})
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={addChapter}
                  className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-[10px] font-bold text-white/60 hover:text-white hover:border-white/25 transition-colors"
                >
                  <Plus className="h-3 w-3" /> Add
                </button>
                <button
                  type="button"
                  onClick={copyForYouTube}
                  className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/[0.08] px-2 py-1 text-[10px] font-bold text-primary hover:bg-primary/[0.15] transition-colors"
                >
                  {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  {copied ? "Copied!" : "Copy for YouTube"}
                </button>
              </div>
            </div>

            <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
              {chapters.map((c, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg border border-white/[0.07] bg-black/30 px-2 py-1.5">
                  <input
                    value={formatChapterTime(c.startSec)}
                    onChange={(e) => {
                      const v = parseChapterTime(e.target.value);
                      if (v !== null && v >= 0) {
                        const next = [...chapters];
                        next[i] = { ...c, startSec: Math.round(v * 10) / 10 };
                        if (i > 0 && next[i - 1]) next[i - 1] = { ...next[i - 1]!, endSec: next[i]!.startSec };
                        onChaptersChange(sortChapters(next));
                      }
                    }}
                    className="w-16 shrink-0 rounded-md border border-white/10 bg-black/50 px-1.5 py-1 text-[11px] font-mono text-primary focus:outline-none focus:border-primary/50"
                    title="Chapter start time (M:SS)"
                  />
                  <input
                    value={c.title}
                    onChange={(e) => updateChapter(i, { title: e.target.value })}
                    maxLength={80}
                    className="flex-1 min-w-0 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-[12px] text-white hover:border-white/10 focus:outline-none focus:border-primary/50"
                    title="Chapter title"
                  />
                  <button
                    type="button"
                    onClick={() => deleteChapter(i)}
                    className="shrink-0 rounded-md p-1 text-white/30 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    title="Delete chapter"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-white/30 leading-relaxed">
              Chapters save with your project. Copy for YouTube pastes timestamped chapters straight into your video description.
            </p>
          </div>
        )}
      </div>
    </EditorCard>
  );
}
