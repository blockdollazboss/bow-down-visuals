import { useState } from "react";
import {
  Sparkles, Loader2, CheckCircle2, RotateCcw, Undo2, ChevronDown, ChevronUp,
  Film, Wand2, ArrowLeftRight, Type, Music2, AlignLeft, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import type { SceneData } from "@/lib/scene-parser";
import {
  AI_EDIT_STYLE_DEFS,
  type EditorSettings,
  type AiEditStylePreset,
  type AiEditPlan,
} from "@/lib/editor-settings";

interface Props {
  scenes: SceneData[];
  settings: EditorSettings;
  setSettings: (s: EditorSettings) => void;
  audioUrl?: string | null;
}

/* ── Status / debug row ─────────────────────────────── */
function DebugRow({ label, ok, value }: { label: string; ok?: boolean | null; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-1.5">
      <span className="text-[10px] text-white/40">{label}</span>
      <span className={`text-[10px] font-mono font-bold ${
        ok === true ? "text-green-400" : ok === false ? "text-red-400" : "text-white/50"
      }`}>{value}</span>
    </div>
  );
}

/* ── Plan section card ──────────────────────────────── */
function PlanCard({
  icon, title, children,
}: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-white/[0.03] transition-colors"
      >
        <span className="text-primary/70">{icon}</span>
        <span className="text-[11px] font-black text-white/60 uppercase tracking-wider flex-1">{title}</span>
        {open ? <ChevronUp className="h-3 w-3 text-white/30" /> : <ChevronDown className="h-3 w-3 text-white/30" />}
      </button>
      {open && <div className="px-3 pb-3 space-y-1 border-t border-white/[0.05]">{children}</div>}
    </div>
  );
}

export function AutoAiEditSection({ scenes, settings, setSettings, audioUrl }: Props) {
  const aiEdit = settings.aiEdit;
  const { getAccessToken } = useAuth();
  const { toast } = useToast();
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clipCount = scenes.filter((s) => !!s.demoClipUrl?.startsWith("http")).length;
  const captionsFound = settings.captions.lines.length > 0;
  const plan = aiEdit.plan as AiEditPlan | null;

  function patch(p: Partial<typeof aiEdit>) {
    setSettings({ ...settings, aiEdit: { ...aiEdit, ...p } });
  }

  async function generatePlan() {
    setGenerating(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const sceneDescriptions = scenes.map((s, i) =>
        [s.section, s.lyricLine, s.action, s.mood].filter(Boolean).join(" · ") || `Scene ${i + 1}`,
      );
      const body = {
        style: aiEdit.style,
        styleName: AI_EDIT_STYLE_DEFS.find((d) => d.id === aiEdit.style)?.name ?? aiEdit.style,
        sceneCount: scenes.length,
        sceneDescriptions,
        audioFound: !!audioUrl,
        captionsFound,
        captionCount: settings.captions.lines.length,
        captionStyle: settings.captions.stylePreset,
        currentEffects: settings.effects,
        artistName: settings.branding.titleOverlay?.artistNameText ?? "",
        songTitle: settings.branding.titleOverlay?.songTitleText ?? "",
        lyricsText: settings.captions.lyricsText ?? "",
      };
      const res = await fetch("/api/generate/ai-edit-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) {
        const j = (await res.json()) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { plan: AiEditPlan; source: string };
      patch({ plan: data.plan, applied: false });
      toast({
        title: "AI Edit Plan ready ✓",
        description: `Generated with ${data.source === "ai" ? "GPT-4o-mini AI" : "smart defaults"}. Review the plan then click Apply.`,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast({ title: "AI Edit failed", description: msg, variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  }

  function applyPlan() {
    if (!plan) return;
    const newEffects = [...new Set(
      [...plan.effectsPlan, plan.colorGrade].filter((x) => x && x !== "None"),
    )];
    setSettings({
      ...settings,
      effects: newEffects,
      captions: { ...settings.captions, stylePreset: plan.captionStylePreset },
      aiEdit: {
        ...aiEdit,
        applied: true,
        enabled: true,
        preApplyEffects: [...settings.effects],
        preApplyCaptionStylePreset: settings.captions.stylePreset,
      },
    });
    toast({ title: "AI Edit Applied ✓", description: "Effects, color grade, and caption style updated in your project." });
  }

  function undoPlan() {
    setSettings({
      ...settings,
      effects: aiEdit.preApplyEffects ?? [],
      captions: {
        ...settings.captions,
        stylePreset: aiEdit.preApplyCaptionStylePreset ?? "clean-white",
      },
      aiEdit: { ...aiEdit, applied: false },
    });
    toast({ title: "AI Edit Undone", description: "Restored settings to pre-edit state." });
  }

  function resetEdit() {
    setSettings({
      ...settings,
      effects: [],
      captions: { ...settings.captions, stylePreset: "clean-white" },
      aiEdit: {
        enabled: false,
        style: aiEdit.style,
        plan: null,
        applied: false,
        preApplyEffects: null,
        preApplyCaptionStylePreset: null,
      },
    });
    toast({ title: "Reset to Clean Edit", description: "All AI edits cleared." });
  }

  /* ── Status / debug computed values ── */
  const exportReady = aiEdit.applied && !!plan;
  const statusRows: [string, boolean | null, string][] = [
    ["Clips found",           clipCount > 0,      clipCount > 0 ? `yes (${clipCount})` : "no"],
    ["Audio found",           !!audioUrl,         audioUrl ? "yes" : "no"],
    ["Captions found",        captionsFound,      captionsFound ? `yes (${settings.captions.lines.length} lines)` : "no"],
    ["Transitions selected",  !!(plan?.transitionPlan?.length), plan?.transitionPlan?.length ? "yes" : "no"],
    ["Effects selected",      !!(plan?.effectsPlan?.length),    plan?.effectsPlan?.join(", ") || "no"],
    ["Color grade selected",  !!(plan?.colorGrade && plan.colorGrade !== "None"), plan?.colorGrade || "no"],
    ["Caption style selected", !!(plan?.captionStylePreset),    plan?.captionStylePreset || "no"],
    ["Saved to project",      aiEdit.applied,     aiEdit.applied ? "yes" : "no"],
    ["Export ready",          exportReady,        exportReady ? "yes" : "no"],
  ];
  const debugRows: [string, string][] = [
    ["Scenes edited",           String(plan?.sceneEditNotes?.length ?? 0)],
    ["Transitions applied",     String(plan?.transitionPlan?.length ?? 0)],
    ["Effects applied",         plan?.effectsPlan?.join(", ") || "none"],
    ["Color grade",             plan?.colorGrade || "none"],
    ["Caption preset",          plan?.captionStylePreset || "none"],
    ["Export settings connected", aiEdit.applied ? "yes" : "no"],
    ["Last error",              error ?? "none"],
  ];

  return (
    <div className="space-y-4">
      {/* ── Header card ── */}
      <div className="rounded-2xl border border-primary/20 bg-black/40 overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-primary/10">
          <div className="h-8 w-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-black text-white uppercase tracking-wider">Auto AI Edit Whole Video</h3>
            <p className="text-xs text-white/40 mt-0.5">
              AI analyzes your clips, audio, captions &amp; style — then creates a complete edit plan
            </p>
          </div>
          {aiEdit.applied && (
            <span className="flex items-center gap-1 text-[10px] font-black text-green-400 border border-green-500/30 bg-green-500/10 px-2 py-1 rounded-full uppercase tracking-wider">
              <CheckCircle2 className="h-3 w-3" /> Applied
            </span>
          )}
        </div>

        <div className="p-5 space-y-4">
          {/* ── Style preset grid ── */}
          <div>
            <p className="text-[10px] font-black text-white/30 uppercase tracking-widest mb-2">AI Edit Style</p>
            <div className="grid grid-cols-2 gap-2">
              {AI_EDIT_STYLE_DEFS.map((def) => (
                <button
                  key={def.id}
                  onClick={() => patch({ style: def.id as AiEditStylePreset })}
                  className={`relative text-left rounded-xl border p-3 transition-all ${
                    aiEdit.style === def.id
                      ? `bg-gradient-to-br ${def.accent} border-opacity-60`
                      : "border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.04]"
                  }`}
                >
                  {aiEdit.style === def.id && (
                    <CheckCircle2 className="absolute top-2.5 right-2.5 h-3 w-3 text-primary" />
                  )}
                  <p className="text-[11px] font-black text-white pr-5 leading-tight">{def.name}</p>
                  <p className="text-[10px] text-white/40 mt-0.5 leading-tight">{def.description}</p>
                </button>
              ))}
            </div>
          </div>

          {/* ── Generate button ── */}
          <Button
            onClick={generatePlan}
            disabled={generating}
            className="w-full gold-glow gap-2"
          >
            {generating
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Generating AI Edit Plan…</>
              : <><Sparkles className="h-4 w-4" /> {plan ? "Regenerate AI Edit Plan" : "Generate AI Edit Plan"}</>
            }
          </Button>

          {/* ── Credits note ── */}
          <p className="text-[10px] text-white/25 text-center">
            AI Edit is free during development. Credits may apply in production.
          </p>
        </div>
      </div>

      {/* ── Edit Plan display ── */}
      {plan && (
        <div className="space-y-3">
          <p className="text-[10px] font-black text-white/30 uppercase tracking-widest px-1">AI Edit Plan</p>

          <PlanCard icon={<ArrowLeftRight className="h-3.5 w-3.5" />} title="Transition Plan">
            {plan.transitionPlan?.length > 0 ? (
              <div className="space-y-1 pt-2">
                {plan.transitionPlan.slice(0, 12).map((t) => (
                  <div key={t.sceneIndex} className="flex items-start gap-2">
                    <span className="shrink-0 text-[9px] font-black text-white/30 w-12">Scene {t.sceneIndex + 1}</span>
                    <span className="text-[10px] font-bold text-primary/80">{t.transition}</span>
                    <span className="text-[10px] text-white/35 flex-1">{t.note}</span>
                  </div>
                ))}
              </div>
            ) : <p className="text-[10px] text-white/30 pt-2">No transition plan generated.</p>}
          </PlanCard>

          <PlanCard icon={<Wand2 className="h-3.5 w-3.5" />} title="Effects &amp; Color Grade">
            <div className="pt-2 space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {plan.effectsPlan?.map((fx) => (
                  <span key={fx} className="text-[10px] font-bold bg-primary/10 border border-primary/20 text-primary/80 px-2 py-0.5 rounded-full">{fx}</span>
                ))}
              </div>
              {plan.colorGrade && plan.colorGrade !== "None" && (
                <p className="text-[10px] text-white/50">Color grade: <span className="text-amber-400 font-bold">{plan.colorGrade}</span></p>
              )}
            </div>
          </PlanCard>

          <PlanCard icon={<Type className="h-3.5 w-3.5" />} title="Caption Style">
            <div className="pt-2">
              <span className="text-[11px] font-bold text-primary/80">{plan.captionStylePreset}</span>
              <p className="text-[10px] text-white/35 mt-1">Applied to all caption lines in the final export</p>
            </div>
          </PlanCard>

          <PlanCard icon={<Music2 className="h-3.5 w-3.5" />} title="Beat Cut &amp; Pacing">
            <p className="text-[10px] text-white/50 pt-2 leading-relaxed">{plan.beatCutNotes}</p>
          </PlanCard>

          <PlanCard icon={<Film className="h-3.5 w-3.5" />} title="Intro / Outro Polish">
            <div className="pt-2 space-y-1">
              <p className="text-[10px] text-white/50 leading-relaxed"><span className="font-bold text-white/60">Intro:</span> {plan.introPlan}</p>
              <p className="text-[10px] text-white/50 leading-relaxed"><span className="font-bold text-white/60">Outro:</span> {plan.outroPlan}</p>
            </div>
          </PlanCard>

          {plan.sceneEditNotes?.length > 0 && (
            <PlanCard icon={<AlignLeft className="h-3.5 w-3.5" />} title={`Scene-by-Scene Notes (${plan.sceneEditNotes.length})`}>
              <div className="pt-2 space-y-1.5 max-h-48 overflow-y-auto">
                {plan.sceneEditNotes.map((n) => (
                  <div key={n.sceneIndex} className="flex items-start gap-2">
                    <span className="shrink-0 text-[9px] font-black text-white/30 w-12">Scene {n.sceneIndex + 1}</span>
                    <span className="text-[10px] text-white/45 flex-1 leading-relaxed">{n.note}</span>
                  </div>
                ))}
              </div>
            </PlanCard>
          )}

          {/* ── Export note ── */}
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2.5">
            <p className="text-[10px] text-amber-200/70 leading-relaxed">
              <span className="font-bold text-amber-300">Export note:</span> Effects and color grade are preview-only CSS overlays in the master player. When you export, effects and caption style are burned in via the FFmpeg pipeline. Transitions and beat-cut pacing are reference notes for the render — clip re-cutting is not connected to export yet.
            </p>
          </div>

          {/* ── Apply / Undo / Reset controls ── */}
          <div className="flex gap-2">
            {!aiEdit.applied ? (
              <Button onClick={applyPlan} className="gold-glow flex-1 gap-2">
                <Zap className="h-4 w-4" /> Apply AI Edit
              </Button>
            ) : (
              <Button onClick={undoPlan} variant="outline" className="flex-1 gap-2 border-white/20 bg-white/5 text-white hover:bg-white/10">
                <Undo2 className="h-4 w-4" /> Undo AI Edit
              </Button>
            )}
            <Button onClick={resetEdit} variant="outline" className="gap-2 border-white/20 bg-white/5 text-white/60 hover:bg-white/10 hover:text-white">
              <RotateCcw className="h-3.5 w-3.5" /> Reset
            </Button>
          </div>
        </div>
      )}

      {/* ── AI Edit Status ── */}
      <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] overflow-hidden">
        <div className="px-3 py-2 border-b border-white/[0.06] bg-white/[0.03]">
          <p className="text-[10px] font-black text-white/30 uppercase tracking-widest">AI Edit Status</p>
        </div>
        <div className="divide-y divide-white/[0.04]">
          {statusRows.map(([label, ok, val]) => (
            <DebugRow key={label} label={label} ok={ok} value={val} />
          ))}
        </div>
      </div>

      {/* ── AI Edit Debug ── */}
      <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] overflow-hidden">
        <div className="px-3 py-2 border-b border-white/[0.06] bg-white/[0.03]">
          <p className="text-[10px] font-black text-white/30 uppercase tracking-widest">AI Edit Debug</p>
        </div>
        <div className="divide-y divide-white/[0.04]">
          {debugRows.map(([label, val]) => (
            <DebugRow key={label} label={label} value={val} />
          ))}
        </div>
      </div>
    </div>
  );
}
