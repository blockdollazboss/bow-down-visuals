import { useEffect, useMemo, useRef, useState } from "react";
import {
  FileText, Loader2, Sparkles, CheckCircle2, AlertTriangle,
  Download, Scissors, Clock3, Check, X,
} from "lucide-react";
import type { SceneData } from "@/lib/scene-parser";
import { EditorCard } from "@/components/editor/controls";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useHubProject } from "@/lib/hub-project";
import { useToast } from "@/hooks/use-toast";
import { OutOfCredits } from "@/components/OutOfCredits";
import {
  acceptedSuggestionSets,
  buildCutSuggestions,
  buildTranscriptFlow,
  buildTranscriptRenderCuts,
  editedTimeSaved,
  rangeIndices,
  type CutSuggestion,
  type TranscriptCut,
  type TranscriptWord,
} from "@/lib/transcript-edit";

/* ── Transcript Word Editor (Wave 3 #17) ──────────────────────────────────
 * Descript-style word-level editing for the active scene's clip, docked
 * in the Pro Tools tab right under the Filler-Word Remover (whose one-tap
 * job stays the special case of this). Port of the proven podcast
 * transcript editor (Stack 6 #5) to video:
 *
 *   1. "Transcribe clip" → the shared analysis (Scribe word-level timings
 *      + ffmpeg silence detection) — 200 Visual Bucs, confirmed first.
 *   2. The transcript renders as clickable words with pause chips. Click
 *      a word to cut it, Shift-click to cut a range, click a pause chip
 *      to cut the pause. The AI pre-marks likely cuts — fillers, dead
 *      air, repeated takes — as SUGGESTIONS: they are outlined, never
 *      cut, until the creator accepts them (or ignores them).
 *   3. "Render cleaned video" → the shared render endpoint reassembles
 *      the video with exactly the marked spans removed (free — covered
 *      by the analysis charge), and the result can replace the scene
 *      clip, same as the Filler-Word Remover's output.
 *
 * If the analysis ever returns no word-level timings for a clip, the
 * pane says so and steps aside — no fake alignment, ever.
 */

const CREDIT_COST = 200;

/** Same default filler set as the podcast transcript editor / the
 *  Filler-Word Remover's default-on groups. */
const DEFAULT_FILLER_WORDS = [
  "um", "uh", "uhm", "uhh", "umm", "erm", "hmm",
  "you know", "i mean", "sort of", "kind of",
];

const ANALYZE_STAGE_LABELS: Record<string, string> = {
  queued: "Queued…",
  downloading: "Downloading the clip…",
  "extracting-audio": "Extracting the audio…",
  transcribing: "Transcribing word by word…",
  detecting: "Marking fillers and pauses…",
};

const RENDER_STAGE_LABELS: Record<string, string> = {
  queued: "Queued…",
  downloading: "Downloading the clip…",
  cutting: "Cutting the marked spans…",
  uploading: "Uploading the cleaned video…",
};

function fmtTime(sec: number): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest < 10 ? "0" : ""}${rest.toFixed(1)}`;
}

type Phase = "idle" | "analyzing" | "review" | "noWords" | "rendering" | "done";

export function TranscriptCutCard({
  scene,
  onReplaceClipVideo,
}: {
  scene: SceneData | null;
  onReplaceClipVideo?: (sceneId: string, url: string) => void;
}) {
  const { toast } = useToast();
  const { confirmedFetch } = useConfirmedApi();
  const { addAsset } = useHubProject();

  const [phase, setPhase] = useState<Phase>("idle");
  const [analyzeJobId, setAnalyzeJobId] = useState<string | null>(null);
  const [analyzeStage, setAnalyzeStage] = useState<string>("queued");
  const [words, setWords] = useState<TranscriptWord[]>([]);
  const [detCuts, setDetCuts] = useState<TranscriptCut[]>([]);
  const [durationSec, setDurationSec] = useState<number | null>(null);
  const [deleted, setDeleted] = useState<ReadonlySet<number>>(new Set());
  const [silencesOn, setSilencesOn] = useState<ReadonlySet<string>>(new Set());
  const [accepted, setAccepted] = useState<ReadonlySet<string>>(new Set());
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [renderJobId, setRenderJobId] = useState<string | null>(null);
  const [renderStage, setRenderStage] = useState<string>("queued");
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [renderedSaved, setRenderedSaved] = useState(0);
  const [renderedCuts, setRenderedCuts] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  const pollRef = useRef<number | null>(null);
  const anchorRef = useRef<number | null>(null);
  const activeSceneId = scene?.id ?? null;
  const mediaUrl = scene?.demoClipUrl ?? null;

  /* A different scene was picked mid-flow — reset to a clean slate. */
  useEffect(() => {
    setPhase("idle");
    setAnalyzeJobId(null);
    setRenderJobId(null);
    setWords([]);
    setDetCuts([]);
    setDeleted(new Set());
    setSilencesOn(new Set());
    setAccepted(new Set());
    setDismissed(new Set());
    setOutputUrl(null);
    setError(null);
    setOutOfCredits(false);
    anchorRef.current = null;
  }, [activeSceneId]);

  const silenceCuts = useMemo(() => detCuts.filter((c) => c.kind === "silence"), [detCuts]);
  const suggestions = useMemo(
    () => (words.length > 0 ? buildCutSuggestions(words, detCuts) : []),
    [words, detCuts],
  );
  const pendingSuggestions = useMemo(
    () => suggestions.filter((s) => !accepted.has(s.id) && !dismissed.has(s.id)),
    [suggestions, accepted, dismissed],
  );
  const suggestedWordIdx = useMemo(() => {
    const out = new Set<number>();
    for (const s of pendingSuggestions) for (const ix of s.wordIndices) out.add(ix);
    return out;
  }, [pendingSuggestions]);
  const suggestedSilenceIds = useMemo(() => {
    const out = new Set<string>();
    for (const s of pendingSuggestions) if (s.silenceId) out.add(s.silenceId);
    return out;
  }, [pendingSuggestions]);

  /* Suggestions contribute only once accepted — the render list is built
   * from (manual marks ∪ accepted suggestions), nothing else. */
  const acceptedSets = useMemo(
    () => acceptedSuggestionSets(suggestions, accepted),
    [suggestions, accepted],
  );
  const effectiveDeleted = useMemo(() => {
    const out = new Set(deleted);
    for (const ix of acceptedSets.wordIndices) out.add(ix);
    return out;
  }, [deleted, acceptedSets]);
  const effectiveSilences = useMemo(() => {
    const out = new Set(silencesOn);
    for (const id of acceptedSets.silenceIds) out.add(id);
    return out;
  }, [silencesOn, acceptedSets]);
  const renderCuts = useMemo(
    () =>
      words.length > 0
        ? buildTranscriptRenderCuts(words, effectiveDeleted, silenceCuts, effectiveSilences)
        : [],
    [words, effectiveDeleted, silenceCuts, effectiveSilences],
  );
  const timeSaved = durationSec ? editedTimeSaved(renderCuts, durationSec) : 0;
  const flow = useMemo(() => buildTranscriptFlow(words, silenceCuts), [words, silenceCuts]);

  async function startAnalyze() {
    if (!mediaUrl || phase === "analyzing") return;
    setError(null);
    setOutOfCredits(false);
    try {
      const res = await confirmedFetch("/api/remove-fillers/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mediaUrl,
          fillerWords: DEFAULT_FILLER_WORDS,
          removeSilences: true,
        }),
      });
      if (!res) return; /* credit confirmation cancelled */
      const data = await res.json().catch(() => ({}));
      if (res.status === 402) {
        setOutOfCredits(true);
        return;
      }
      if (!res.ok || !data.jobId) {
        throw new Error(typeof data.error === "string" ? data.error : "Could not start the transcription.");
      }
      setAnalyzeJobId(data.jobId as string);
      setAnalyzeStage("queued");
      setPhase("analyzing");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the transcription.");
    }
  }

  /* Poll the analyze job. */
  useEffect(() => {
    if (!analyzeJobId || phase !== "analyzing") return;
    pollRef.current = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/remove-fillers/analyze/${analyzeJobId}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setPhase("idle");
          setError(typeof data.error === "string" ? data.error : "Transcription failed — the charge was refunded.");
          return;
        }
        setAnalyzeStage(typeof data.status === "string" ? data.status : "processing");
        if (data.status === "done") {
          const list: TranscriptWord[] = Array.isArray(data.words) ? data.words : [];
          setDetCuts(Array.isArray(data.cuts) ? data.cuts : []);
          setDurationSec(typeof data.durationSec === "number" ? data.durationSec : null);
          setDeleted(new Set());
          setSilencesOn(new Set());
          setAccepted(new Set());
          setDismissed(new Set());
          anchorRef.current = null;
          if (list.length === 0) {
            /* Honest dead end: without word timings there is nothing to
             * align text edits to — never invent an alignment. */
            setWords([]);
            setPhase("noWords");
          } else {
            setWords(list);
            setPhase("review");
          }
        } else if (data.status === "failed") {
          setPhase("idle");
          setError(typeof data.error === "string" ? data.error : "Transcription failed — the charge was refunded.");
        }
      } catch {
        /* keep polling on transient network errors */
      }
    }, 3000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [analyzeJobId, phase]);

  async function startRender() {
    if (!analyzeJobId || renderCuts.length === 0 || phase === "rendering") return;
    setError(null);
    try {
      /* Render is covered by the analysis charge — no second confirmation. */
      const res = await confirmedFetch("/api/remove-fillers/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analyzeJobId, cuts: renderCuts }),
        skipConfirm: true,
      });
      if (!res) return;
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.jobId) {
        throw new Error(typeof data.error === "string" ? data.error : "Could not start the render.");
      }
      setRenderJobId(data.jobId as string);
      setRenderStage("queued");
      setPhase("rendering");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the render.");
    }
  }

  /* Poll the render job. */
  useEffect(() => {
    if (!renderJobId || phase !== "rendering") return;
    pollRef.current = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/remove-fillers/render/${renderJobId}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setPhase("review");
          setError(typeof data.error === "string" ? data.error : "Render failed.");
          return;
        }
        setRenderStage(typeof data.status === "string" ? data.status : "processing");
        if (data.status === "done" && data.outputUrl) {
          const url = data.outputUrl as string;
          setOutputUrl(url);
          setRenderedSaved(typeof data.timeSavedSec === "number" ? data.timeSavedSec : 0);
          setRenderedCuts(typeof data.cutsApplied === "number" ? data.cutsApplied : 0);
          setPhase("done");
          addAsset({
            kind: "video",
            url,
            label: "Transcript-edited video",
            detail: `${typeof data.cutsApplied === "number" ? data.cutsApplied : 0} cuts · saved ${fmtTime(typeof data.timeSavedSec === "number" ? data.timeSavedSec : 0)}`,
          });
          toast({
            title: "Cleaned video rendered",
            description: "Your word cuts are in — use it in the editor or download it.",
          });
        } else if (data.status === "failed") {
          setPhase("review");
          setError(typeof data.error === "string" ? data.error : "Render failed.");
        }
      } catch {
        /* keep polling on transient network errors */
      }
    }, 3000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [renderJobId, phase, addAsset, toast]);

  function onWordClick(index: number, shiftKey: boolean) {
    if (shiftKey && anchorRef.current !== null) {
      setDeleted((prev) => {
        const next = new Set(prev);
        for (const ix of rangeIndices(anchorRef.current!, index)) next.add(ix);
        return next;
      });
      return;
    }
    anchorRef.current = index;
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

  function acceptSuggestion(s: CutSuggestion) {
    setAccepted((prev) => new Set(prev).add(s.id));
  }
  function dismissSuggestion(s: CutSuggestion) {
    setDismissed((prev) => new Set(prev).add(s.id));
  }
  function acceptAllSuggestions() {
    setAccepted((prev) => {
      const next = new Set(prev);
      for (const s of pendingSuggestions) next.add(s.id);
      return next;
    });
  }

  function resetAll() {
    setPhase("idle");
    setAnalyzeJobId(null);
    setRenderJobId(null);
    setWords([]);
    setDetCuts([]);
    setDeleted(new Set());
    setSilencesOn(new Set());
    setAccepted(new Set());
    setDismissed(new Set());
    setOutputUrl(null);
    setError(null);
    setOutOfCredits(false);
    anchorRef.current = null;
  }

  if (!scene || !mediaUrl) {
    return (
      <EditorCard
        title="Transcript Word Editor"
        subtitle={`Cut the clip by deleting words — ${CREDIT_COST} Visual Bucs to transcribe`}
        icon={<FileText className="h-4 w-4" />}
        data-testid="pro-card-transcript"
      >
        <p className="text-white/40 text-sm">Select a clip with video to edit it by its words.</p>
      </EditorCard>
    );
  }

  return (
    <EditorCard
      title="Transcript Word Editor"
      subtitle={`Cut the clip by deleting words — ${CREDIT_COST} Visual Bucs to transcribe, rendering is free`}
      icon={<FileText className="h-4 w-4" />}
      data-testid="pro-card-transcript"
    >
      <div className="space-y-4">
        {outOfCredits && <OutOfCredits />}

        {error && (
          <div className="flex items-start gap-2.5 rounded-xl border border-red-500/25 bg-red-500/5 px-4 py-3">
            <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
            <p className="text-sm text-red-200/80">{error}</p>
          </div>
        )}

        {phase === "idle" && (
          <div className="space-y-3">
            <p className="text-sm text-white/55 leading-relaxed">
              Read the clip as text and cut it like text: click any word to cut it,
              Shift-click to cut a whole run, and toggle the pause chips to drop dead air.
              The AI also pre-marks likely cuts — fillers, pauses, repeated takes — as
              suggestions you accept or ignore. Nothing is ever cut that you didn't mark or accept.
            </p>
            <button
              type="button"
              onClick={startAnalyze}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-black text-sm
                bg-gradient-to-r from-[#C9A84C] to-[#8a6f2e] text-black
                hover:from-[#e0bc58] hover:to-[#a5853a] transition-all shadow-lg shadow-[#C9A84C]/20"
              data-testid="transcript-analyze"
            >
              <Sparkles className="h-4 w-4" />
              Transcribe clip ({CREDIT_COST} Visual Bucs)
            </button>
          </div>
        )}

        {phase === "analyzing" && (
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] px-6 py-10 text-center">
            <Loader2 className="h-8 w-8 text-primary animate-spin mx-auto mb-4" />
            <p className="font-bold text-white">{ANALYZE_STAGE_LABELS[analyzeStage] ?? "Working…"}</p>
            <p className="text-sm text-white/40 mt-1">This runs on the server — safe to switch tabs while it works.</p>
          </div>
        )}

        {phase === "noWords" && (
          <div className="space-y-3">
            <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-3">
              <AlertTriangle className="h-4 w-4 text-amber-300 shrink-0 mt-0.5" />
              <p className="text-sm text-amber-100/80 leading-relaxed">
                This clip's transcription came back without word-level timings, so there's
                nothing honest to align the words to — word editing is off for this clip.
                The Filler-Word Remover above still cuts its fillers and pauses, and the
                Timeline tab still trims and reorders segments.
              </p>
            </div>
            <button
              type="button"
              onClick={resetAll}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border border-white/10 bg-white/[0.03] text-white/60 hover:text-white hover:border-white/25 transition-colors"
              data-testid="transcript-nowords-reset"
            >
              Start over
            </button>
          </div>
        )}

        {(phase === "review" || phase === "done") && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-bold text-white/55">
                {effectiveDeleted.size} word{effectiveDeleted.size === 1 ? "" : "s"} + {effectiveSilences.size} pause{effectiveSilences.size === 1 ? "" : "s"} marked · saves ~{fmtTime(timeSaved)}
              </span>
              <div className="ml-auto flex gap-2">
                <button
                  type="button"
                  onClick={() => { setDeleted(new Set()); setSilencesOn(new Set()); setAccepted(new Set()); }}
                  className="text-[11px] font-bold text-white/45 hover:text-white/75"
                  data-testid="transcript-clear-marks"
                >
                  Clear marks
                </button>
                <button
                  type="button"
                  onClick={resetAll}
                  className="text-[11px] font-bold text-white/45 hover:text-white/75"
                  data-testid="transcript-start-over"
                >
                  Start over
                </button>
              </div>
            </div>

            {pendingSuggestions.length > 0 && (
              <div className="rounded-xl border border-[#C9A84C]/25 bg-[#C9A84C]/[0.04] px-3.5 py-3 space-y-2" data-testid="transcript-suggestions">
                <div className="flex items-center gap-2">
                  <p className="flex items-center gap-1.5 text-[11px] font-black text-[#e8c96a] uppercase tracking-wider">
                    <Sparkles className="h-3.5 w-3.5" /> AI suggestions — never cut until you accept
                  </p>
                  <button
                    type="button"
                    onClick={acceptAllSuggestions}
                    className="ml-auto text-[11px] font-bold text-[#e8c96a] hover:text-white transition-colors"
                    data-testid="sug-accept-all"
                  >
                    Accept all
                  </button>
                </div>
                <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
                  {pendingSuggestions.map((s) => (
                    <div key={s.id} className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-black/20 px-2.5 py-1.5" data-testid={`suggestion-${s.id}`}>
                      <span
                        className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0 ${
                          s.kind === "filler"
                            ? "bg-[#C9A84C]/15 text-[#e8c96a] border border-[#C9A84C]/30"
                            : s.kind === "silence"
                              ? "bg-sky-500/10 text-sky-300 border border-sky-500/25"
                              : "bg-violet-500/10 text-violet-300 border border-violet-500/25"
                        }`}
                      >
                        {s.kind === "filler" ? "Filler" : s.kind === "silence" ? "Pause" : "Retake"}
                      </span>
                      <span className="flex-1 min-w-0 truncate text-xs font-semibold text-white/80" title={s.label}>
                        “{s.label}”
                      </span>
                      <span className="hidden md:inline text-[10px] text-white/35 shrink-0">{s.reason}</span>
                      <button
                        type="button"
                        onClick={() => acceptSuggestion(s)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-black bg-[#C9A84C]/20 text-[#e8c96a] hover:bg-[#C9A84C]/35 transition-colors shrink-0"
                        data-testid={`sug-accept-${s.id}`}
                      >
                        <Check className="h-3 w-3" /> Cut it
                      </button>
                      <button
                        type="button"
                        onClick={() => dismissSuggestion(s)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold border border-white/10 text-white/50 hover:text-white/80 transition-colors shrink-0"
                        data-testid={`sug-dismiss-${s.id}`}
                      >
                        <X className="h-3 w-3" /> Keep
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-xl border border-white/[0.08] bg-black/25 p-4 leading-[2.1] text-[15px] max-h-80 overflow-y-auto" data-testid="transcript-flow">
              {flow.map((item, i) => {
                if (item.type === "silence") {
                  const on = effectiveSilences.has(item.cut.id);
                  const suggested = suggestedSilenceIds.has(item.cut.id);
                  return (
                    <button
                      key={`s-${item.cut.id}-${i}`}
                      type="button"
                      onClick={() => toggleSilence(item.cut.id)}
                      className={`mx-1 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold align-middle transition-colors ${
                        on
                          ? "bg-red-500/25 text-red-200 line-through"
                          : suggested
                            ? "bg-sky-500/10 text-sky-200 border border-dashed border-sky-400/50 hover:text-white"
                            : "bg-white/[0.06] text-white/45 hover:text-white/75"
                      }`}
                      title={on ? "This pause will be cut — click to keep it" : suggested ? "Suggested pause cut — click to cut it, or accept the suggestion above" : "Pause — click to cut it"}
                      data-testid={`tsilence-${item.cut.id}`}
                    >
                      ⏸ {Math.max(0.1, item.cut.end - item.cut.start).toFixed(1)}s
                    </button>
                  );
                }
                const isCut = effectiveDeleted.has(item.index);
                const isSuggested = suggestedWordIdx.has(item.index);
                return (
                  <button
                    key={`w-${item.index}`}
                    type="button"
                    onClick={(e) => onWordClick(item.index, e.shiftKey)}
                    className={`rounded px-0.5 transition-colors ${
                      isCut
                        ? "text-red-300 line-through decoration-red-400/70"
                        : isSuggested
                          ? "text-amber-200/90 bg-[#C9A84C]/[0.07] underline decoration-dashed decoration-[#C9A84C]/60 underline-offset-4 hover:bg-white/[0.06]"
                          : "text-white/85 hover:bg-white/[0.06]"
                    }`}
                    title={isCut ? "Will be cut — click to keep" : isSuggested ? "Suggested cut — click to cut it, or accept the suggestion above" : "Click to cut · Shift-click cuts a range"}
                    data-testid={`tword-${item.index}`}
                  >
                    {item.word.word}
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-white/30">
              Click a word to cut it · Shift-click cuts from the last clicked word to here · struck-through text is removed by the render, exactly as marked.
            </p>

            {phase === "review" && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={startRender}
                  disabled={renderCuts.length === 0}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-black text-sm
                    bg-gradient-to-r from-[#C9A84C] to-[#8a6f2e] text-black
                    hover:from-[#e0bc58] hover:to-[#a5853a] transition-all shadow-lg shadow-[#C9A84C]/20
                    disabled:opacity-40 disabled:cursor-not-allowed"
                  data-testid="transcript-render"
                >
                  <Scissors className="h-4 w-4" />
                  Render cleaned video ({renderCuts.length} cut{renderCuts.length === 1 ? "" : "s"}, free)
                </button>
                <span className="inline-flex items-center gap-1.5 text-xs text-white/45">
                  <Clock3 className="h-3.5 w-3.5 text-[#C9A84C]" /> saves ~{fmtTime(timeSaved)}
                </span>
              </div>
            )}
          </div>
        )}

        {phase === "rendering" && (
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] px-6 py-10 text-center">
            <Loader2 className="h-8 w-8 text-primary animate-spin mx-auto mb-4" />
            <p className="font-bold text-white">{RENDER_STAGE_LABELS[renderStage] ?? "Working…"}</p>
            <p className="text-sm text-white/40 mt-1">This runs on the server — safe to switch tabs while it works.</p>
          </div>
        )}

        {phase === "done" && outputUrl && (
          <div className="space-y-4">
            <div className="flex items-center gap-2.5 rounded-xl border border-green-500/25 bg-green-500/5 px-4 py-3">
              <CheckCircle2 className="h-5 w-5 text-green-400 shrink-0" />
              <p className="text-sm font-semibold text-white/80">
                Cleaned video rendered — {renderedCuts} cut{renderedCuts === 1 ? "" : "s"}, {fmtTime(renderedSaved)} removed.
              </p>
            </div>
            <video
              src={outputUrl}
              controls
              playsInline
              className="w-full max-h-64 object-contain rounded-xl bg-black border border-white/[0.08]"
              data-testid="transcript-result-video"
            />
            <div className="flex flex-wrap gap-2">
              {onReplaceClipVideo && scene && (
                <button
                  type="button"
                  onClick={() => {
                    onReplaceClipVideo(scene.id, outputUrl);
                    toast({
                      title: "Clip replaced",
                      description: "The scene now uses the transcript-cleaned video.",
                    });
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl font-black text-sm
                    bg-gradient-to-r from-[#C9A84C] to-[#8a6f2e] text-black
                    hover:from-[#e0bc58] hover:to-[#a5853a] transition-all"
                  data-testid="transcript-use-in-editor"
                >
                  <Sparkles className="h-4 w-4" /> Use in editor
                </button>
              )}
              <a
                href={outputUrl}
                download="cleaned-by-transcript.mp4"
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold
                  border border-white/15 text-white/70 hover:text-white hover:border-white/30 transition-colors"
                data-testid="transcript-download"
              >
                <Download className="h-4 w-4" /> Download
              </a>
              <button
                type="button"
                onClick={resetAll}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold
                  border border-white/10 text-white/50 hover:text-white/80 transition-colors"
                data-testid="transcript-new"
              >
                New run
              </button>
            </div>
          </div>
        )}
      </div>
    </EditorCard>
  );
}
