import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Scissors, Loader2, Sparkles, CheckCircle2, AlertTriangle,
  Download, Plus, X, Clock3, Captions,
} from "lucide-react";
import type { SceneData } from "@/lib/scene-parser";
import { EditorCard, Chip } from "@/components/editor/controls";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useHubProject } from "@/lib/hub-project";
import { useToast } from "@/hooks/use-toast";
import { OutOfCredits } from "@/components/OutOfCredits";

/* ── AI Filler-Word Remover ───────────────────────────────────────────────
 * The Descript-killer for talking-head creators, docked in the Video
 * Editor's Pro Tools tab (no new sidebar item). Works on the active
 * scene's clip:
 *
 *   1. Pick which filler words to cut (+ custom words) and whether to
 *      cut dead-air pauses.
 *   2. "Find fillers" → server transcribes with Whisper (word-level
 *      timestamps) and returns a cut list — 200 Visual Bucs.
 *   3. Review the cut list — every cut is toggleable.
 *   4. "Render cleaned video" → server reassembles with ffmpeg.
 *   5. "Use in editor" swaps the scene clip; the cleaned video also
 *      lands in the hub project so it chains into captions → export →
 *      scheduler.
 *
 * Both phases are server-owned background jobs (safe to close the tab).
 */

const CREDIT_COST = 200;

interface FillerCut {
  id: string;
  start: number;
  end: number;
  kind: "filler" | "silence";
  label: string;
}

const FILLER_GROUPS: Array<{ id: string; words: string[]; defaultOn: boolean }> = [
  { id: "classic", words: ["um", "uh", "uhm", "uhh", "umm", "erm", "hmm"], defaultOn: true },
  { id: "hedges", words: ["you know", "i mean", "sort of", "kind of"], defaultOn: true },
  {
    id: "risky",
    words: ["like", "so", "well", "right", "okay", "yeah", "basically", "actually", "literally", "anyway"],
    defaultOn: false,
  },
];

const DEFAULT_ENABLED = new Set(
  FILLER_GROUPS.filter((g) => g.defaultOn).flatMap((g) => g.words),
);

function fmtTime(sec: number): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest < 10 ? "0" : ""}${rest.toFixed(1)}`;
}

type Phase = "idle" | "analyzing" | "review" | "rendering" | "done";

export function FillerRemoverCard({
  scene,
  onReplaceClipVideo,
}: {
  scene: SceneData | null;
  onReplaceClipVideo?: (sceneId: string, url: string) => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { confirmedFetch } = useConfirmedApi();
  const { addAsset } = useHubProject();

  const [enabled, setEnabled] = useState<string[]>(() => [...DEFAULT_ENABLED]);
  const [customWords, setCustomWords] = useState<string[]>([]);
  const [customInput, setCustomInput] = useState("");
  const [removeSilences, setRemoveSilences] = useState(true);
  const [minSilence, setMinSilence] = useState(0.8);

  const [phase, setPhase] = useState<Phase>("idle");
  const [analyzeJobId, setAnalyzeJobId] = useState<string | null>(null);
  const [analyzeStage, setAnalyzeStage] = useState<string>("queued");
  const [cuts, setCuts] = useState<FillerCut[]>([]);
  const [cutOn, setCutOn] = useState<Record<string, boolean>>({});
  const [durationSec, setDurationSec] = useState<number | null>(null);
  const [timeSavedSec, setTimeSavedSec] = useState(0);
  const [renderJobId, setRenderJobId] = useState<string | null>(null);
  const [renderStage, setRenderStage] = useState<string>("queued");
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [renderedSaved, setRenderedSaved] = useState(0);
  const [renderedCuts, setRenderedCuts] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [creditsRemaining, setCreditsRemaining] = useState<number | null>(null);

  const pollRef = useRef<number | null>(null);
  const activeSceneId = scene?.id ?? null;
  const mediaUrl = scene?.demoClipUrl ?? null;

  /* A different scene was picked mid-flow — reset to a clean slate. */
  useEffect(() => {
    setPhase("idle");
    setAnalyzeJobId(null);
    setRenderJobId(null);
    setCuts([]);
    setCutOn({});
    setOutputUrl(null);
    setError(null);
    setOutOfCredits(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSceneId]);

  /* Poll the analyze job. */
  useEffect(() => {
    if (!analyzeJobId || phase !== "analyzing") return;
    pollRef.current = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/remove-fillers/analyze/${analyzeJobId}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setPhase("idle");
          setError(typeof data.error === "string" ? data.error : t("fillerRemover.errorAnalyze"));
          return;
        }
        setAnalyzeStage(typeof data.status === "string" ? data.status : "processing");
        if (data.status === "done") {
          const list: FillerCut[] = Array.isArray(data.cuts) ? data.cuts : [];
          setCuts(list);
          const on: Record<string, boolean> = {};
          for (const c of list) on[c.id] = true;
          setCutOn(on);
          setDurationSec(typeof data.durationSec === "number" ? data.durationSec : null);
          setTimeSavedSec(typeof data.timeSavedSec === "number" ? data.timeSavedSec : 0);
          setPhase("review");
        } else if (data.status === "failed") {
          setPhase("idle");
          setError(typeof data.error === "string" ? data.error : t("fillerRemover.errorAnalyze"));
        }
      } catch {
        /* keep polling on transient network errors */
      }
    }, 3000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [analyzeJobId, phase, t]);

  /* Poll the render job. */
  useEffect(() => {
    if (!renderJobId || phase !== "rendering") return;
    pollRef.current = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/remove-fillers/render/${renderJobId}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setPhase("review");
          setError(typeof data.error === "string" ? data.error : t("fillerRemover.errorRender"));
          return;
        }
        setRenderStage(typeof data.status === "string" ? data.status : "processing");
        if (data.status === "done" && data.outputUrl) {
          const url = data.outputUrl as string;
          setOutputUrl(url);
          setRenderedSaved(typeof data.timeSavedSec === "number" ? data.timeSavedSec : 0);
          setRenderedCuts(typeof data.cutsApplied === "number" ? data.cutsApplied : 0);
          setPhase("done");
          /* The cleaned video flows into the hub project for the next
             step — captions → multi-ratio export → scheduler. */
          addAsset({
            kind: "video",
            url,
            label: t("fillerRemover.hubAssetLabel"),
            detail: t("fillerRemover.hubAssetDetail", {
              n: typeof data.cutsApplied === "number" ? data.cutsApplied : 0,
              saved: fmtTime(typeof data.timeSavedSec === "number" ? data.timeSavedSec : 0),
            }),
          });
          toast({
            title: t("fillerRemover.renderCompleteTitle"),
            description: t("fillerRemover.renderCompleteDesc"),
          });
        } else if (data.status === "failed") {
          setPhase("review");
          setError(typeof data.error === "string" ? data.error : t("fillerRemover.errorRender"));
        }
      } catch {
        /* keep polling on transient network errors */
      }
    }, 3000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [renderJobId, phase, t, addAsset, toast]);

  function toggleWord(word: string) {
    setEnabled((prev) => (prev.includes(word) ? prev.filter((w) => w !== word) : [...prev, word]));
  }

  function addCustomWord() {
    const w = customInput.trim().toLowerCase();
    if (!w) return;
    if (customWords.includes(w) || enabled.includes(w)) {
      setCustomInput("");
      return;
    }
    setCustomWords((prev) => [...prev, w]);
    setEnabled((prev) => [...prev, w]);
    setCustomInput("");
  }

  function removeCustomWord(word: string) {
    setCustomWords((prev) => prev.filter((w) => w !== word));
    setEnabled((prev) => prev.filter((w) => w !== word));
  }

  async function startAnalyze() {
    if (!mediaUrl || phase === "analyzing") return;
    setError(null);
    setOutOfCredits(false);
    const fillerWords = [...enabled, ...customWords.filter((w) => !enabled.includes(w))];
    try {
      const res = await confirmedFetch("/api/remove-fillers/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mediaUrl,
          fillerWords,
          removeSilences,
          minSilenceDuration: minSilence,
        }),
      });
      if (!res) return; // user cancelled the credit confirmation
      const data = await res.json().catch(() => ({}));
      if (res.status === 402) {
        setOutOfCredits(true);
        return;
      }
      if (!res.ok || !data.jobId) {
        throw new Error(typeof data.error === "string" ? data.error : t("fillerRemover.errorAnalyze"));
      }
      setAnalyzeJobId(data.jobId as string);
      setAnalyzeStage("queued");
      setPhase("analyzing");
      if (typeof data.creditsRemaining === "number") setCreditsRemaining(data.creditsRemaining);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("fillerRemover.errorAnalyze"));
    }
  }

  const enabledCuts = cuts.filter((c) => cutOn[c.id] !== false);
  const enabledSaved = enabledCuts.reduce((s, c) => s + (c.end - c.start), 0);

  async function startRender() {
    if (!analyzeJobId || enabledCuts.length === 0 || phase === "rendering") return;
    setError(null);
    try {
      // Render is covered by the analysis charge — no second confirmation.
      const res = await confirmedFetch("/api/remove-fillers/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analyzeJobId, cuts: enabledCuts }),
        skipConfirm: true,
      });
      if (!res) return;
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.jobId) {
        throw new Error(typeof data.error === "string" ? data.error : t("fillerRemover.errorRender"));
      }
      setRenderJobId(data.jobId as string);
      setRenderStage("queued");
      setPhase("rendering");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("fillerRemover.errorRender"));
    }
  }

  function toggleCut(id: string) {
    setCutOn((prev) => ({ ...prev, [id]: prev[id] === false }));
  }

  function setAllCuts(on: boolean) {
    const next: Record<string, boolean> = {};
    for (const c of cuts) next[c.id] = on;
    setCutOn(next);
  }

  function resetAll() {
    setPhase("idle");
    setAnalyzeJobId(null);
    setRenderJobId(null);
    setCuts([]);
    setCutOn({});
    setOutputUrl(null);
    setError(null);
    setOutOfCredits(false);
  }

  if (!scene || !mediaUrl) {
    return (
      <EditorCard
        title={t("fillerRemover.title")}
        subtitle={t("fillerRemover.subtitle", { cost: CREDIT_COST })}
        icon={<Scissors className="h-4 w-4" />}
        data-testid="pro-card-filler"
      >
        <p className="text-white/40 text-sm">{t("fillerRemover.noClip")}</p>
      </EditorCard>
    );
  }

  return (
    <EditorCard
      title={t("fillerRemover.title")}
      subtitle={t("fillerRemover.subtitle", { cost: CREDIT_COST })}
      icon={<Scissors className="h-4 w-4" />}
      data-testid="pro-card-filler"
    >
      <div className="space-y-4">
        {outOfCredits && <OutOfCredits />}

        {error && (
          <div className="flex items-start gap-2.5 rounded-xl border border-red-500/25 bg-red-500/5 px-4 py-3">
            <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
            <p className="text-sm text-red-200/80">{error}</p>
          </div>
        )}

        {/* ── Step 1: what to cut ── */}
        {(phase === "idle") && (
          <div className="space-y-4">
            {FILLER_GROUPS.map((group) => (
              <div key={group.id}>
                <p className="text-[11px] font-black text-white/40 uppercase tracking-widest mb-1.5">
                  {t(`fillerRemover.group${group.id[0].toUpperCase()}${group.id.slice(1)}`)}
                  {group.id === "risky" && (
                    <span className="normal-case font-normal text-white/30"> · {t("fillerRemover.riskyHint")}</span>
                  )}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {group.words.map((w) => (
                    <Chip
                      key={w}
                      active={enabled.includes(w)}
                      onClick={() => toggleWord(w)}
                      data-testid={`filler-word-${w.replace(/\s+/g, "-")}`}
                    >
                      {w}
                    </Chip>
                  ))}
                </div>
              </div>
            ))}

            {/* Custom words */}
            <div>
              <p className="text-[11px] font-black text-white/40 uppercase tracking-widest mb-1.5">
                {t("fillerRemover.customWordsLabel")}
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={customInput}
                  onChange={(e) => setCustomInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addCustomWord();
                    }
                  }}
                  placeholder={t("fillerRemover.customWordsPlaceholder")}
                  className="flex-1 px-3 py-2 rounded-xl bg-white/[0.03] border border-white/10 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-[#C9A84C]/50"
                  data-testid="filler-custom-input"
                />
                <button
                  type="button"
                  onClick={addCustomWord}
                  className="inline-flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-black border border-white/10 bg-white/[0.03] text-white/60 hover:text-white hover:border-white/25 transition-colors"
                  data-testid="filler-custom-add"
                >
                  <Plus className="h-3.5 w-3.5" /> {t("fillerRemover.add")}
                </button>
              </div>
              {customWords.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {customWords.map((w) => (
                    <button
                      key={w}
                      type="button"
                      onClick={() => removeCustomWord(w)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold border border-[#C9A84C]/40 bg-[#C9A84C]/10 text-[#e8c96a] hover:border-[#C9A84C]/70 transition-colors"
                      data-testid={`filler-custom-${w.replace(/\s+/g, "-")}`}
                      title={t("fillerRemover.removeWord")}
                    >
                      {w} <X className="h-3 w-3" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Dead-air pauses */}
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={removeSilences}
                  onChange={(e) => setRemoveSilences(e.target.checked)}
                  className="h-4 w-4"
                  style={{ accentColor: "#C9A84C" }}
                  data-testid="filler-silence-toggle"
                />
                <span className="text-sm font-bold text-white/80">{t("fillerRemover.silenceLabel")}</span>
              </label>
              {removeSilences && (
                <div className="flex items-center gap-2 mt-2.5">
                  <span className="text-[11px] font-semibold text-white/60 w-28 shrink-0">
                    {t("fillerRemover.minPauseLabel")}
                  </span>
                  <input
                    type="range"
                    min={0.3}
                    max={3}
                    step={0.1}
                    value={minSilence}
                    onChange={(e) => setMinSilence(Number(e.target.value))}
                    className="flex-1 h-1 cursor-pointer"
                    style={{ accentColor: "#C9A84C" }}
                    data-testid="filler-silence-duration"
                  />
                  <span className="text-[10px] font-mono text-white/40 w-12 text-right">
                    {minSilence.toFixed(1)}s
                  </span>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={startAnalyze}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-black text-sm
                bg-gradient-to-r from-[#C9A84C] to-[#8a6f2e] text-black
                hover:from-[#e0bc58] hover:to-[#a5853a] transition-all shadow-lg shadow-[#C9A84C]/20"
              data-testid="filler-analyze"
            >
              <Sparkles className="h-4 w-4" />
              {t("fillerRemover.analyzeButton", { cost: CREDIT_COST })}
            </button>
            {creditsRemaining != null && (
              <p className="text-[11px] text-white/35">{t("fillerRemover.creditsRemaining", { n: creditsRemaining })}</p>
            )}
          </div>
        )}

        {/* ── Analyzing progress (real stages from the server job) ── */}
        {phase === "analyzing" && (
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] px-6 py-10 text-center">
            <Loader2 className="h-8 w-8 text-primary animate-spin mx-auto mb-4" />
            <p className="font-bold text-white">{t(`fillerRemover.stage${analyzeStage}`)}</p>
            <p className="text-sm text-white/40 mt-1">{t("fillerRemover.progressNote")}</p>
          </div>
        )}

        {/* ── Step 2: review the cut list ── */}
        {phase === "review" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-white/80">
                {t("fillerRemover.cutsFound", { n: cuts.length })}
                {durationSec != null && (
                  <span className="text-white/40 font-normal"> · {t("fillerRemover.ofDuration", { d: fmtTime(durationSec) })}</span>
                )}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setAllCuts(true)}
                  className="text-[11px] font-bold text-white/40 hover:text-white/70 transition-colors"
                  data-testid="filler-select-all"
                >
                  {t("fillerRemover.selectAll")}
                </button>
                <button
                  type="button"
                  onClick={() => setAllCuts(false)}
                  className="text-[11px] font-bold text-white/40 hover:text-white/70 transition-colors"
                  data-testid="filler-select-none"
                >
                  {t("fillerRemover.selectNone")}
                </button>
              </div>
            </div>

            {cuts.length === 0 ? (
              <div className="rounded-xl border border-green-500/25 bg-green-500/5 px-4 py-5 text-center">
                <CheckCircle2 className="h-6 w-6 text-green-400 mx-auto mb-2" />
                <p className="text-sm font-bold text-white/80">{t("fillerRemover.noCutsTitle")}</p>
                <p className="text-xs text-white/40 mt-1">{t("fillerRemover.noCutsDesc")}</p>
              </div>
            ) : (
              <div className="max-h-64 overflow-y-auto rounded-xl border border-white/[0.08] divide-y divide-white/[0.05]">
                {cuts.map((c) => {
                  const on = cutOn[c.id] !== false;
                  return (
                    <label
                      key={c.id}
                      className={`flex items-center gap-3 px-3.5 py-2 cursor-pointer transition-colors ${
                        on ? "hover:bg-white/[0.03]" : "opacity-40"
                      }`}
                      data-testid={`filler-cut-${c.id}`}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggleCut(c.id)}
                        className="h-4 w-4 shrink-0"
                        style={{ accentColor: "#C9A84C" }}
                      />
                      <span className="text-[11px] font-mono text-white/45 w-24 shrink-0">
                        {fmtTime(c.start)}–{fmtTime(c.end)}
                      </span>
                      <span className="flex-1 min-w-0 truncate text-sm font-semibold text-white/80">
                        “{c.label}”
                      </span>
                      <span
                        className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0 ${
                          c.kind === "filler"
                            ? "bg-[#C9A84C]/15 text-[#e8c96a] border border-[#C9A84C]/30"
                            : "bg-sky-500/10 text-sky-300 border border-sky-500/25"
                        }`}
                      >
                        {c.kind === "filler" ? t("fillerRemover.kindFiller") : t("fillerRemover.kindSilence")}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}

            <div className="flex items-center gap-2 text-sm">
              <Clock3 className="h-4 w-4 text-[#C9A84C]" />
              <p className="text-white/70">
                <span className="font-black text-white">{fmtTime(enabledSaved)}</span>{" "}
                {t("fillerRemover.timeSaved", { n: enabledCuts.length })}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={startRender}
                disabled={enabledCuts.length === 0}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-black text-sm
                  bg-gradient-to-r from-[#C9A84C] to-[#8a6f2e] text-black
                  hover:from-[#e0bc58] hover:to-[#a5853a] transition-all shadow-lg shadow-[#C9A84C]/20
                  disabled:opacity-40 disabled:cursor-not-allowed"
                data-testid="filler-render"
              >
                <Scissors className="h-4 w-4" />
                {t("fillerRemover.renderButton", { n: enabledCuts.length })}
              </button>
              <button
                type="button"
                onClick={resetAll}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border border-white/10 bg-white/[0.03] text-white/60 hover:text-white hover:border-white/25 transition-colors"
                data-testid="filler-start-over"
              >
                {t("fillerRemover.startOver")}
              </button>
            </div>
          </div>
        )}

        {/* ── Rendering progress ── */}
        {phase === "rendering" && (
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] px-6 py-10 text-center">
            <Loader2 className="h-8 w-8 text-primary animate-spin mx-auto mb-4" />
            <p className="font-bold text-white">{t(`fillerRemover.renderStage${renderStage}`)}</p>
            <p className="text-sm text-white/40 mt-1">{t("fillerRemover.progressNote")}</p>
          </div>
        )}

        {/* ── Done ── */}
        {phase === "done" && outputUrl && (
          <div className="space-y-4">
            <div className="flex items-center gap-2.5 rounded-xl border border-green-500/25 bg-green-500/5 px-4 py-3">
              <CheckCircle2 className="h-5 w-5 text-green-400 shrink-0" />
              <p className="text-sm font-semibold text-white/80">
                {t("fillerRemover.doneTitle", { n: renderedCuts, saved: fmtTime(renderedSaved) })}
              </p>
            </div>

            <video
              src={outputUrl}
              controls
              playsInline
              className="w-full max-h-64 object-contain rounded-xl bg-black border border-white/[0.08]"
              data-testid="filler-result-video"
            />

            <div className="flex flex-wrap gap-2">
              {onReplaceClipVideo && scene && (
                <button
                  type="button"
                  onClick={() => {
                    onReplaceClipVideo(scene.id, outputUrl);
                    toast({
                      title: t("fillerRemover.usedInEditorTitle"),
                      description: t("fillerRemover.usedInEditorDesc"),
                    });
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl font-black text-sm
                    bg-gradient-to-r from-[#C9A84C] to-[#8a6f2e] text-black
                    hover:from-[#e0bc58] hover:to-[#a5853a] transition-all"
                  data-testid="filler-use-in-editor"
                >
                  <Sparkles className="h-4 w-4" /> {t("fillerRemover.useInEditor")}
                </button>
              )}
              <a
                href={outputUrl}
                download="cleaned-no-fillers.mp4"
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold
                  border border-white/15 text-white/70 hover:text-white hover:border-white/30 transition-colors"
                data-testid="filler-download"
              >
                <Download className="h-4 w-4" /> {t("fillerRemover.download")}
              </a>
              <button
                type="button"
                onClick={resetAll}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold
                  border border-white/10 text-white/50 hover:text-white/80 transition-colors"
                data-testid="filler-new"
              >
                {t("fillerRemover.newRun")}
              </button>
            </div>

            {/* Chain: captions → export → scheduler */}
            <div className="rounded-xl border border-[#C9A84C]/25 bg-[#C9A84C]/[0.04] px-4 py-3">
              <p className="flex items-center gap-1.5 text-xs font-black text-[#e8c96a] uppercase tracking-wider mb-1">
                <Captions className="h-3.5 w-3.5" /> {t("fillerRemover.nextTitle")}
              </p>
              <p className="text-xs text-white/55 leading-relaxed">{t("fillerRemover.nextDesc")}</p>
            </div>
          </div>
        )}
      </div>
    </EditorCard>
  );
}
