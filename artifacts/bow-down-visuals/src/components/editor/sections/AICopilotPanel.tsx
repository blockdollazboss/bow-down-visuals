import { useCallback, useMemo, useRef, useState } from "react";
import {
  Sparkles, Loader2, CheckCircle2, AlertTriangle, Lightbulb, Wrench,
  Undo2, ChevronRight, Zap, Brain, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { EditorCard } from "@/components/editor/controls";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useToast } from "@/hooks/use-toast";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import type { SceneData } from "@/lib/scene-parser";
import {
  getClipEdit, defaultClipEdit,
  type EditorSettings, type CaptionLine,
} from "@/lib/editor-settings";

/* ─── AI Copilot — the expert editor over your shoulder ───────────────────
   Watches the timeline and proactively suggests fixes: jarring cuts,
   dead spots, missing transitions, caption gaps, grade mismatches.
   Free client-side heuristics run instantly; the "Analyze with AI" button
   calls the LLM brain (50 VB) for taste-level calls.

   Every applied suggestion goes through the editor's wrapped setScenes /
   setSettings, so it is undoable via the standard undo button. */

type Severity = "fix" | "polish" | "idea";

type CopilotAction =
  | { kind: "set-transition"; sceneIndex: number; transition: string }
  | { kind: "set-grade"; grade: string }
  | { kind: "set-caption-style"; style: string }
  | { kind: "split-scene"; sceneIndex: number; atFraction: number }
  | { kind: "suggest-broll"; sceneIndex: number; prompt: string }
  | { kind: "note"; text: string };

interface Suggestion {
  id: string;
  title: string;
  reason: string;
  severity: Severity;
  action: CopilotAction;
  atSec?: number;
  source: "heuristic" | "ai";
  applied?: boolean;
}

interface Props {
  scenes: SceneData[];
  settings: EditorSettings;
  setSettings: React.Dispatch<React.SetStateAction<EditorSettings>>;
  setScenes: React.Dispatch<React.SetStateAction<SceneData[]>>;
  captions: CaptionLine[];
  totalDurationSec: number | null;
  songTitle: string;
  artistName: string;
  genre?: string;
  onJumpTo?: (sec: number) => void;
}

const COPILOT_COST = 50;
let suggestionCounter = 0;
const nextId = () => `csg-${Date.now()}-${suggestionCounter++}`;

/* ── Free client-side heuristics (instant, no credits) ─────────────────── */
function runHeuristics(
  scenes: SceneData[],
  settings: EditorSettings,
  captions: CaptionLine[],
): Suggestion[] {
  const out: Suggestion[] = [];
  const durations = scenes.map((s) => {
    // Prefer explicit duration; fall back to equal split of nothing → 0
    const d = (s as unknown as { durationSec?: number }).durationSec;
    return typeof d === "number" && d > 0 ? d : 0;
  });

  // 1. Jarring cuts: two sub-second scenes back to back
  for (let i = 1; i < scenes.length; i++) {
    if (durations[i] > 0 && durations[i - 1] > 0 && durations[i] < 1.2 && durations[i - 1] < 1.2) {
      const edit = getClipEdit(settings, scenes[i].id);
      if (!edit.transition || edit.transition === "Cut") {
        out.push({
          id: nextId(),
          title: `Jarring cut into scene ${scenes[i].sceneNumber}`,
          reason: `Two sub-second clips back-to-back with a hard cut feels glitchy. A 12-frame dissolve smooths it.`,
          severity: "fix",
          action: { kind: "set-transition", sceneIndex: i, transition: "Crossfade" },
          source: "heuristic",
        });
        break; // one is enough to surface the pattern
      }
    }
  }

  // 2. Dead spots: single scene holding > 18s with no internal variation
  for (let i = 0; i < scenes.length; i++) {
    if (durations[i] >= 18) {
      out.push({
        id: nextId(),
        title: `Scene ${scenes[i].sceneNumber} holds ${durations[i].toFixed(0)}s — dead spot risk`,
        reason: `Viewers drop off on long static holds. Split it mid-way and punch in.`,
        severity: "polish",
        action: { kind: "split-scene", sceneIndex: i, atFraction: 0.5 },
        source: "heuristic",
      });
      break;
    }
  }

  // 3. Missing transitions: scenes with no transition set at all
  const missingIdx = scenes.findIndex((s) => {
    const edit = getClipEdit(settings, s.id);
    return !edit.transition;
  });
  if (missingIdx > 0) {
    out.push({
      id: nextId(),
      title: `Scene ${scenes[missingIdx].sceneNumber} has no transition`,
      reason: `Unset transitions default to hard cuts. A crossfade keeps the flow.`,
      severity: "polish",
      action: { kind: "set-transition", sceneIndex: missingIdx, transition: "Crossfade" },
      source: "heuristic",
    });
  }

  // 4. No captions at all
  if (captions.length === 0 && scenes.length > 0) {
    out.push({
      id: nextId(),
      title: "No captions on this video",
      reason: "85% of social video is watched muted. Auto-captions with viral styling lift retention.",
      severity: "fix",
      action: { kind: "note", text: "Open the Captions tab → Auto-captions to generate them." },
      source: "heuristic",
    });
  }

  return out;
}

const SEVERITY_META: Record<Severity, { icon: React.ReactNode; chip: string; label: string }> = {
  fix: {
    icon: <Wrench className="h-3.5 w-3.5" />,
    chip: "border-red-400/40 bg-red-400/10 text-red-300",
    label: "Fix",
  },
  polish: {
    icon: <Sparkles className="h-3.5 w-3.5" />,
    chip: "border-[#C9A84C]/40 bg-[#C9A84C]/10 text-[#E8C96A]",
    label: "Polish",
  },
  idea: {
    icon: <Lightbulb className="h-3.5 w-3.5" />,
    chip: "border-sky-400/40 bg-sky-400/10 text-sky-300",
    label: "Idea",
  },
};

export function AICopilotPanel(props: Props) {
  const { scenes, settings, setSettings, setScenes, captions } = props;
  const isLight = useIsLightTheme();
  const { confirmedFetch } = useConfirmedApi();
  const { toast } = useToast();
  const [aiSuggestions, setAiSuggestions] = useState<Suggestion[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const appliedRef = useRef<Set<string>>(new Set());

  const heuristicSuggestions = useMemo(
    () => runHeuristics(scenes, settings, captions),
    [scenes, settings, captions],
  );

  const allSuggestions = useMemo(() => {
    const merged = [...heuristicSuggestions, ...aiSuggestions];
    const order: Record<Severity, number> = { fix: 0, polish: 1, idea: 2 };
    return merged
      .filter((s) => !dismissed.has(s.id))
      .sort((a, b) => order[a.severity] - order[b.severity]);
  }, [heuristicSuggestions, aiSuggestions, dismissed]);

  /* ── Apply a suggestion (undoable via editor history) ────────────────── */
  const applySuggestion = useCallback(async (s: Suggestion) => {
    if (appliedRef.current.has(s.id)) return;
    setApplyingId(s.id);
    try {
      const a = s.action;
      if (a.kind === "set-transition") {
        const scene = scenes[a.sceneIndex];
        if (!scene) throw new Error("Scene not found.");
        setSettings((prev) => {
          const current = getClipEdit(prev, scene.id);
          return {
            ...prev,
            clips: {
              ...prev.clips,
              [scene.id]: { ...defaultClipEdit(), ...current, transition: a.transition, transitionDuration: 0.4 },
            },
          };
        });
        toast({ title: "Applied", description: `${a.transition} added to scene ${scene.sceneNumber}. Undo anytime.` });
      } else if (a.kind === "set-grade") {
        // Grades burn in per-scene via /api/color-grade — Copilot surfaces the
        // recommendation; the user applies it in the Color section (one tap there).
        toast({
          title: `Suggested grade: ${a.grade}`,
          description: "Open the Color section to apply it to any scene with one tap. Undo anytime.",
        });
      } else if (a.kind === "set-caption-style") {
        setSettings((prev) => ({
          ...prev,
          captions: { ...prev.captions, stylePreset: a.style as typeof prev.captions.stylePreset },
        }));
        toast({ title: "Applied", description: `Caption style set. Undo anytime.` });
      } else if (a.kind === "split-scene") {
        const scene = scenes[a.sceneIndex];
        if (!scene) throw new Error("Scene not found.");
        // Split = duplicate scene with adjusted section label; timing engine re-flows.
        const copy: SceneData = {
          ...scene,
          id: `${scene.id}-copilot-split-${Date.now()}`,
          sceneNumber: scene.sceneNumber + 1,
          section: `${scene.section} (2/2)`.trim(),
        };
        const orig = { ...scene, section: `${scene.section} (1/2)`.trim() };
        setScenes((prev) => {
          const idx = prev.findIndex((x) => x.id === scene.id);
          if (idx < 0) return prev;
          const next = [...prev];
          next.splice(idx, 1, orig, copy);
          return next.map((x, i) => ({ ...x, sceneNumber: i + 1 }));
        });
        toast({ title: "Applied", description: `Scene ${scene.sceneNumber} split in two. Undo anytime.` });
      } else if (a.kind === "suggest-broll") {
        toast({
          title: "B-roll idea",
          description: a.prompt.slice(0, 120),
        });
      } else {
        toast({ title: "Note", description: a.text });
      }
      appliedRef.current.add(s.id);
      setAiSuggestions((prev) => prev.map((x) => (x.id === s.id ? { ...x, applied: true } : x)));
    } catch (e) {
      toast({
        title: "Couldn't apply",
        description: e instanceof Error ? e.message : "Unknown error.",
        variant: "destructive",
      });
    } finally {
      setApplyingId(null);
    }
  }, [scenes, setScenes, setSettings, toast]);

  /* ── AI analysis (LLM brain, 50 VB) ───────────────────────────────────── */
  const analyzeWithAI = useCallback(async () => {
    if (scenes.length === 0) {
      toast({ title: "Nothing to analyze", description: "Add scenes to the timeline first." });
      return;
    }
    setAnalyzing(true);
    try {
      const compactScenes = scenes.map((s, i) => {
        const d = (s as unknown as { durationSec?: number }).durationSec ?? 0;
        const edit = getClipEdit(settings, s.id);
        return {
          id: s.id,
          sceneNumber: s.sceneNumber,
          section: s.section,
          lyricLine: (s.lyricLine || "").slice(0, 80),
          mood: s.mood,
          action: (s.action || "").slice(0, 80),
          cameraMovement: s.cameraMovement,
          durationSec: Math.round(d * 10) / 10,
          hasClip: !!s.demoClipUrl,
          transition: edit.transition || "",
        };
      });
      const totalDurationSec = compactScenes.reduce((a, s) => a + s.durationSec, 0);

      const res = await confirmedFetch("/api/ai-copilot/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenes: compactScenes,
          totalDurationSec,
          songTitle: props.songTitle,
          artistName: props.artistName,
          genre: props.genre ?? "",
          hasCaptions: captions.length > 0,
          captionStyle: settings.captions?.stylePreset ?? "",
          currentGrade: "",
          flags: {
            jarringCuts: heuristicSuggestions.filter((h) => h.title.startsWith("Jarring")).map((_, i) => i),
            deadSpots: [],
            missingTransitions: [],
          },
        }),
        overrideCost: COPILOT_COST,
        overrideFeature: "AI Copilot analysis",
      });
      if (!res) return; // user cancelled the credit confirm
      const data = await res.json() as {
        suggestions?: Array<{
          title: string; reason: string; severity: Severity;
          action: CopilotAction; atSec?: number;
        }>;
        error?: string; message?: string;
      };
      if (!res.ok) throw new Error(data.message || data.error || "Analysis failed.");
      const incoming: Suggestion[] = (data.suggestions ?? []).map((s) => ({
        ...s, id: nextId(), source: "ai" as const,
      }));
      setAiSuggestions(incoming);
      toast({
        title: "Copilot analysis complete",
        description: `${incoming.length} suggestion${incoming.length === 1 ? "" : "s"} from the AI.`,
      });
    } catch (e) {
      toast({
        title: "Analysis failed",
        description: e instanceof Error ? e.message : "Unknown error.",
        variant: "destructive",
      });
    } finally {
      setAnalyzing(false);
    }
  }, [scenes, settings, captions, props.songTitle, props.artistName, props.genre, confirmedFetch, toast, heuristicSuggestions]);

  const dismiss = (id: string) => setDismissed((prev) => new Set(prev).add(id));

  if (scenes.length === 0) {
    return (
      <EditorCard
        icon={<Brain className="h-4 w-4" />}
        title="AI Copilot"
        subtitle="Your expert editor, watching the timeline"
      >
        <p className={`text-xs ${isLight ? "text-[#4A3B22]/70" : "text-white/50"}`}>
          Add scenes to the timeline and Copilot will start watching — flagging jarring cuts,
          dead spots, and missed opportunities.
        </p>
      </EditorCard>
    );
  }

  return (
    <EditorCard
      icon={<Brain className="h-4 w-4" />}
      title="AI Copilot"
      subtitle={`${allSuggestions.length} suggestion${allSuggestions.length === 1 ? "" : "s"} · everything is undoable`}
      right={
        <Button
          size="sm"
          onClick={analyzeWithAI}
          disabled={analyzing}
          className="gap-1.5 bg-[#C9A84C]/15 border border-[#C9A84C]/40 text-[#E8C96A] hover:bg-[#C9A84C]/25 text-[11px] h-7"
        >
          {analyzing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
          {analyzing ? "Analyzing…" : `Analyze · ${COPILOT_COST} VB`}
        </Button>
      }
    >
      <div className="space-y-2">
        {allSuggestions.length === 0 && (
          <div className={`flex items-center gap-2 rounded-xl border border-[#C9A84C]/25 bg-[#C9A84C]/5 px-3 py-2.5`}>
            <CheckCircle2 className="h-4 w-4 text-[#C9A84C] shrink-0" />
            <p className={`text-xs ${isLight ? "text-[#4A3B22]" : "text-white/70"}`}>
              Timeline looks clean. Hit <span className="font-bold">Analyze</span> for AI taste-level notes.
            </p>
          </div>
        )}
        {allSuggestions.map((s) => {
          const meta = SEVERITY_META[s.severity];
          const applied = appliedRef.current.has(s.id) || s.applied;
          return (
            <div
              key={s.id}
              className={`rounded-xl border p-3 transition-colors ${
                isLight
                  ? "border-[#C9A84C]/25 bg-[#FDFBF5]"
                  : "border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.04]"
              }`}
            >
              <div className="flex items-start gap-2">
                <span className={`mt-0.5 shrink-0 ${s.severity === "fix" ? "text-red-400" : s.severity === "polish" ? "text-[#C9A84C]" : "text-sky-400"}`}>
                  {meta.icon}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className={`text-[13px] font-bold ${isLight ? "text-[#2A2118]" : "text-white/90"}`}>{s.title}</p>
                    <span className={`text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${meta.chip}`}>
                      {meta.label}
                    </span>
                    {s.source === "ai" && (
                      <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-violet-400/40 bg-violet-400/10 text-violet-300">
                        AI
                      </span>
                    )}
                  </div>
                  <p className={`text-xs mt-1 ${isLight ? "text-[#4A3B22]/75" : "text-white/55"}`}>{s.reason}</p>
                  <div className="flex items-center gap-1.5 mt-2">
                    {s.action.kind !== "note" && (
                      <Button
                        size="sm"
                        onClick={() => applySuggestion(s)}
                        disabled={applied || applyingId === s.id}
                        className={`h-7 text-[11px] gap-1 ${
                          applied
                            ? "bg-green-500/15 border border-green-500/40 text-green-300"
                            : "bg-[#C9A84C] text-black hover:bg-[#E8C96A] font-bold"
                        }`}
                      >
                        {applyingId === s.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : applied ? (
                          <CheckCircle2 className="h-3 w-3" />
                        ) : (
                          <Zap className="h-3 w-3" />
                        )}
                        {applied ? "Applied" : applyingId === s.id ? "Applying…" : "Apply"}
                      </Button>
                    )}
                    {s.action.kind === "note" && (
                      <span className={`text-[11px] italic ${isLight ? "text-[#4A3B22]/60" : "text-white/40"}`}>
                        <AlertTriangle className="h-3 w-3 inline mr-1" />
                        Manual step — see reason above
                      </span>
                    )}
                    {s.atSec != null && props.onJumpTo && (
                      <button
                        onClick={() => props.onJumpTo!(s.atSec!)}
                        className={`text-[11px] underline underline-offset-2 ${isLight ? "text-[#8a6d2f]" : "text-[#C9A84C]/80"} hover:opacity-80`}
                      >
                        Jump to {s.atSec.toFixed(1)}s
                      </button>
                    )}
                    {!applied && (
                      <button
                        onClick={() => dismiss(s.id)}
                        className={`ml-auto p-1 rounded ${isLight ? "text-[#4A3B22]/40 hover:text-[#4A3B22]" : "text-white/30 hover:text-white/60"}`}
                        aria-label="Dismiss suggestion"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {applied && (
                      <span className={`ml-auto flex items-center gap-1 text-[11px] ${isLight ? "text-[#4A3B22]/50" : "text-white/40"}`}>
                        <Undo2 className="h-3 w-3" /> Undo in toolbar
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        <button
          onClick={() => { setAiSuggestions([]); setDismissed(new Set()); appliedRef.current.clear(); }}
          className={`w-full flex items-center justify-center gap-1.5 py-1.5 text-[11px] ${isLight ? "text-[#4A3B22]/50 hover:text-[#4A3B22]" : "text-white/35 hover:text-white/60"}`}
        >
          <ChevronRight className="h-3 w-3 rotate-90" /> Re-scan timeline
        </button>
      </div>
    </EditorCard>
  );
}
