import { useState } from "react";
import { Layers, Loader2, Scissors, Type, User, AlertTriangle, CheckCircle2, RotateCcw } from "lucide-react";
import type { SceneData } from "@/lib/scene-parser";
import type { EditorSettings, VideoFormat } from "@/lib/editor-settings";
import { defaultClipEdit } from "@/lib/editor-settings";
import { EditorCard } from "@/components/editor/controls";
import { PlanNote } from "@/components/editor/sections/shared";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useToast } from "@/hooks/use-toast";
import { OutOfCredits } from "@/components/OutOfCredits";

/* ── Timeline Edit Recipes ───────────────────────────────────────────────
 * One-tap edit recipes that return a PREVIEWABLE list of edit operations —
 * never applied blindly. Distinct from the project-level TemplatePicker
 * ("what are you making?" → tab order + caption presets) in
 * lib/video-templates.ts: these recipes DO things to the timeline model.
 *
 *   Jump-Cut Vlog  — cut dead-air pauses (real ffmpeg silencedetect on the
 *                     project audio), hard cuts everywhere, minimal captions.
 *   Lyric Video     — caption-forward layout (karaoke word-by-word, centered).
 *   Talking Head    — 9:16 vertical, centered framing via per-clip Pro Tools
 *                     crop, lower-third overlay, clean captions.
 *
 * DOCK: video-editor.tsx — "timeline" tab area, below BeatSyncSection.
 * BEAT HANDOFF: pass beatGrid (kept markers from BeatSyncSection) and the
 *   jump-cut recipe snaps cut boundaries to the nearest beat.
 *
 * Op execution maps to EditorSettings: clips[].transition, captions,
 * effects[], overlays[], export.format, clips[].proTools.crop. "cut" ops
 * and "setAudio" ops are stored in the localStorage cut plan (same key as
 * BeatSyncSection) — export wiring pending, never faked into the render.
 */

const CREDIT_COST = 100;
const BEATCUT_PLAN_KEY = (projectKey: string) => `wave9b-beatcuts-${projectKey}`;

type RecipeId = "jumpcut-vlog" | "lyric-video" | "talking-head";

interface EditOp {
  op: string;
  target?: string;
  params: Record<string, unknown>;
  label: string;
  reversible: boolean;
}

const RECIPES: Array<{
  id: RecipeId;
  name: string;
  description: string;
  icon: React.ReactNode;
  needsAudio: boolean;
}> = [
  {
    id: "jumpcut-vlog",
    name: "Jump-Cut Vlog",
    description: "Finds dead-air pauses in your audio and cuts them, hard cuts everywhere, captions tucked to the bottom.",
    icon: <Scissors className="h-4 w-4" />,
    needsAudio: true,
  },
  {
    id: "lyric-video",
    name: "Lyric Video",
    description: "Caption-forward layout: karaoke word-by-word centered, vignette + glow, smooth crossfades between clips.",
    icon: <Type className="h-4 w-4" />,
    needsAudio: false,
  },
  {
    id: "talking-head",
    name: "Talking Head",
    description: "Vertical 9:16 with every clip centered on the speaker, lower-third name banner, clean captions.",
    icon: <User className="h-4 w-4" />,
    needsAudio: false,
  },
];

function strParam(params: Record<string, unknown>, key: string): string | undefined {
  const v = params[key];
  return typeof v === "string" ? v : undefined;
}
function numParam(params: Record<string, unknown>, key: string): number | undefined {
  const v = params[key];
  return typeof v === "number" && isFinite(v) ? v : undefined;
}

interface TimelineTemplatesSectionProps {
  scenes: SceneData[];
  settings: EditorSettings;
  setSettings: (s: EditorSettings) => void;
  audioUrl?: string | null;
  durationSec?: number | null;
  /** Kept beat-marker times from BeatSyncSection — jump-cuts snap to these. */
  beatGrid?: number[];
  projectKey?: string;
}

export function TimelineTemplatesSection({
  scenes,
  settings,
  setSettings,
  audioUrl = null,
  durationSec = null,
  beatGrid = [],
  projectKey = "default",
}: TimelineTemplatesSectionProps) {
  const { confirmedFetch } = useConfirmedApi();
  const { toast } = useToast();

  const [recipeId, setRecipeId] = useState<RecipeId | null>(null);
  const [ops, setOps] = useState<EditOp[]>([]);
  const [phase, setPhase] = useState<"idle" | "compiling" | "preview" | "applied">("idle");
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [appliedCount, setAppliedCount] = useState(0);

  async function compileRecipe(id: RecipeId) {
    if (phase === "compiling") return;
    setError(null);
    setOutOfCredits(false);
    const needsAudio = RECIPES.find((r) => r.id === id)?.needsAudio;
    if (needsAudio && !audioUrl) {
      setError("Jump-Cut Vlog needs the project audio URL to find pauses.");
      return;
    }
    setPhase("compiling");
    try {
      const res = await confirmedFetch("/api/wave9b/templates/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipeId: id,
          mediaUrl: audioUrl ?? undefined,
          durationSec: durationSec ?? 0,
          beatGrid: id === "jumpcut-vlog" ? beatGrid.slice(0, 600) : [],
        }),
      });
      if (!res) {
        setPhase("idle"); // user cancelled the credit confirmation
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (res.status === 402) {
        setOutOfCredits(true);
        setPhase("idle");
        return;
      }
      if (!res.ok || !Array.isArray(data.ops)) {
        throw new Error(typeof data.error === "string" ? data.error : "The recipe failed to compile.");
      }
      setRecipeId(id);
      setOps(data.ops as EditOp[]);
      setPhase("preview");
    } catch (err) {
      setPhase("idle");
      setError(err instanceof Error ? err.message : "The recipe failed to compile.");
    }
  }

  /** Execute the previewed ops against the timeline model. Returns how many
   *  ops were actually applied (cut/audio ops go to the localStorage cut plan). */
  function executeOps(opsToRun: EditOp[]): { applied: number; cutTimes: number[] } {
    let next = { ...settings };
    let clips = { ...next.clips };
    let applied = 0;
    const cutTimes: number[] = [];

    for (const op of opsToRun) {
      switch (op.op) {
        case "setTransition": {
          const transition = strParam(op.params, "transition");
          if (!transition) break;
          for (const scene of scenes) {
            const existing = clips[scene.id] ?? defaultClipEdit();
            clips[scene.id] = { ...existing, transition };
          }
          applied++;
          break;
        }
        case "setCaptions": {
          const preset = strParam(op.params, "preset");
          const position = strParam(op.params, "position");
          next = {
            ...next,
            captions: {
              ...next.captions,
              ...(preset ? { stylePreset: preset as typeof next.captions.stylePreset, enabled: true } : {}),
              ...(position ? { position } : {}),
            },
          };
          applied++;
          break;
        }
        case "addEffect": {
          const effect = strParam(op.params, "effect");
          if (effect && !next.effects.includes(effect)) next = { ...next, effects: [...next.effects, effect] };
          applied++;
          break;
        }
        case "addOverlay": {
          const overlay = strParam(op.params, "overlay");
          if (overlay && !next.overlays.includes(overlay)) next = { ...next, overlays: [...next.overlays, overlay] };
          applied++;
          break;
        }
        case "setFormat": {
          const format = strParam(op.params, "format");
          if (format && ["9:16", "16:9", "1:1", "4:5"].includes(format)) {
            next = { ...next, export: { ...next.export, format: format as VideoFormat } };
          }
          applied++;
          break;
        }
        case "setFraming": {
          // Centered framing: enable per-clip Pro Tools crop. For a 9:16
          // target on 16:9 source this crops the horizontal center band.
          const value = strParam(op.params, "value");
          const format = next.export?.format ?? "9:16";
          if (value === "center") {
            const aspect = format;
            for (const scene of scenes) {
              const existing = clips[scene.id] ?? defaultClipEdit();
              clips[scene.id] = {
                ...existing,
                proTools: {
                  ...existing.proTools,
                  crop: {
                    enabled: true,
                    aspect,
                    x: 0,
                    y: 0,
                    w: 1,
                    h: 1,
                  },
                },
              };
            }
          }
          applied++;
          break;
        }
        case "cut": {
          // Cut ops need the export pipeline's split-point support — store
          // them in the cut plan, don't fake them into settings.
          const start = numParam(op.params, "start");
          const end = numParam(op.params, "end");
          if (start != null && end != null && end > start) cutTimes.push(start, end);
          applied++;
          break;
        }
        case "setAudio":
        case "note":
          // Acknowledged but intentionally not applied: no audio-ducking
          // setting exists in the timeline model yet ("setAudio"), and
          // "note" ops are informational.
          break;
        default:
          break;
      }
    }

    next = { ...next, clips };
    setSettings(next);

    if (cutTimes.length > 0) {
      try {
        const key = BEATCUT_PLAN_KEY(projectKey);
        const existing = JSON.parse(localStorage.getItem(key) ?? "{}") as { cuts?: number[] };
        const merged = [...(existing.cuts ?? []), ...cutTimes].sort((a, b) => a - b);
        localStorage.setItem(key, JSON.stringify({ ...existing, cuts: merged, recipe: recipeId }));
      } catch {
        /* storage unavailable — settings changes still applied */
      }
    }
    return { applied, cutTimes };
  }

  function applyRecipe() {
    const { applied, cutTimes } = executeOps(ops);
    setAppliedCount(applied);
    setPhase("applied");
    toast({
      title: "Recipe applied",
      description: `${applied} of ${ops.length} edits applied${
        cutTimes.length > 0
          ? ` — ${cutTimes.length / 2} cut ranges saved to the cut plan (sliced on export when split support ships).`
          : "."
      }`,
    });
  }

  const recipeName = RECIPES.find((r) => r.id === recipeId)?.name ?? "";

  return (
    <EditorCard
      title="Timeline Edit Recipes"
      subtitle={`One-tap edit plans — preview first, nothing applies blindly · ${CREDIT_COST} Visual Bucs each`}
      icon={<Layers className="h-4 w-4" />}
      data-testid="wave9b-templates"
    >
      <div className="space-y-4">
        {outOfCredits && <OutOfCredits />}

        {error && (
          <div className="flex items-start gap-2.5 rounded-xl border border-red-500/25 bg-red-500/5 px-4 py-3">
            <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
            <p className="text-sm text-red-200/80">{error}</p>
          </div>
        )}

        {/* ── Recipe cards ── */}
        <div className="grid gap-2.5 sm:grid-cols-3">
          {RECIPES.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => compileRecipe(r.id)}
              disabled={phase === "compiling" || (r.needsAudio && !audioUrl)}
              title={r.needsAudio && !audioUrl ? "Needs project audio first" : r.description}
              className="text-left rounded-xl border border-white/[0.08] bg-white/[0.02] hover:border-[#C9A84C]/40 hover:bg-[#C9A84C]/[0.04] transition-all px-4 py-3.5 disabled:opacity-40 disabled:cursor-not-allowed group"
              data-testid={`wave9b-recipe-${r.id}`}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[#C9A84C] group-hover:text-[#e8c96a] transition-colors">{r.icon}</span>
                <span className="text-sm font-black text-white">{r.name}</span>
              </div>
              <p className="text-[11px] text-white/40 leading-relaxed">{r.description}</p>
              {r.id === "jumpcut-vlog" && beatGrid.length > 0 && (
                <p className="text-[10px] text-[#e8c96a]/70 mt-1.5 font-bold">
                  Will snap cuts to your {beatGrid.length} beat markers
                </p>
              )}
            </button>
          ))}
        </div>

        {phase === "compiling" && (
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] px-6 py-8 text-center">
            <Loader2 className="h-7 w-7 text-primary animate-spin mx-auto mb-3" />
            <p className="font-bold text-white">Compiling the edit plan…</p>
          </div>
        )}

        {/* ── Preview (never apply blindly) ── */}
        {phase === "preview" && (
          <div className="space-y-3">
            <p className="text-sm font-bold text-white/80">
              {recipeName} will make {ops.length} change{ops.length === 1 ? "" : "s"}:
            </p>
            <div className="max-h-64 overflow-y-auto rounded-xl border border-white/[0.08] divide-y divide-white/[0.05]">
              {ops.map((op, i) => (
                <div key={i} className="flex items-start gap-3 px-3.5 py-2.5">
                  <span className="text-[10px] font-mono text-[#C9A84C]/70 w-6 shrink-0 pt-0.5">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white/80">{op.label}</p>
                    <p className="text-[10px] font-mono text-white/25 mt-0.5">
                      {op.op}
                      {op.target && op.target !== "timeline" ? ` · ${op.target}` : ""}
                    </p>
                  </div>
                  {op.reversible && (
                    <span className="text-[10px] font-bold text-white/30 uppercase tracking-wider shrink-0 pt-1">
                      Undoable
                    </span>
                  )}
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={applyRecipe}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-black text-sm
                  bg-gradient-to-r from-[#C9A84C] to-[#8a6f2e] text-black
                  hover:from-[#e0bc58] hover:to-[#a5853a] transition-all shadow-lg shadow-[#C9A84C]/20"
                data-testid="wave9b-recipe-apply"
              >
                <CheckCircle2 className="h-4 w-4" />
                Apply {ops.length} changes
              </button>
              <button
                type="button"
                onClick={() => { setPhase("idle"); setOps([]); setRecipeId(null); }}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold
                  border border-white/10 text-white/50 hover:text-white/80 transition-colors"
                data-testid="wave9b-recipe-cancel"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {phase === "applied" && (
          <div className="space-y-3">
            <div className="flex items-start gap-2.5 rounded-xl border border-green-500/25 bg-green-500/5 px-4 py-3">
              <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0 mt-0.5" />
              <p className="text-sm text-green-200/80">
                {recipeName}: {appliedCount} of {ops.length} edits applied to your timeline.
              </p>
            </div>
            <button
              type="button"
              onClick={() => { setPhase("idle"); setOps([]); setRecipeId(null); }}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border border-white/10 bg-white/[0.03] text-white/60 hover:text-white hover:border-white/25 transition-colors"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Run another recipe
            </button>
          </div>
        )}

        <PlanNote text="Recipes change your edit plan — captions, effects, overlays, transitions and framing are saved with the project and applied at final render. Cut ranges wait in the cut plan until split-point export ships." />
      </div>
    </EditorCard>
  );
}
