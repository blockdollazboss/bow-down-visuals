import { useState, useRef, useCallback, useEffect } from "react";
import {
  Camera, Clock, MapPin, Zap, Film, Loader2,
  Sparkles, Video, CheckCircle2, AlertCircle, X,
  ChevronDown, ChevronUp, RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import type { SceneData } from "@/lib/scene-parser";
import type { ArtistVault } from "@/components/ArtistVaultSelector";

/* ─── Section color badges ──────────────────────────────────── */
const SECTION_COLORS: Record<string, string> = {
  intro:  "bg-purple-500/20 text-purple-300 border-purple-500/30",
  verse:  "bg-blue-500/20 text-blue-300 border-blue-500/30",
  hook:   "bg-primary/20 text-primary border-primary/30",
  chorus: "bg-primary/20 text-primary border-primary/30",
  bridge: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
  outro:  "bg-rose-500/20 text-rose-300 border-rose-500/30",
  pre:    "bg-orange-500/20 text-orange-300 border-orange-500/30",
  break:  "bg-green-500/20 text-green-300 border-green-500/30",
};

function sectionColor(section: string): string {
  const lower = section.toLowerCase();
  for (const key of Object.keys(SECTION_COLORS)) {
    if (lower.includes(key)) return SECTION_COLORS[key]!;
  }
  return "bg-white/10 text-white/60 border-white/20";
}

/* ─── Inline Runway clip generator ─────────────────────────── */
interface RunwayGeneratorProps {
  scene: SceneData;
  onUpdate: (patch: Partial<SceneData>) => void;
}

function InlineRunwayGenerator({ scene, onUpdate }: RunwayGeneratorProps) {
  const { getAccessToken } = useAuth();
  const { toast } = useToast();

  const [isGenerating, setIsGenerating] = useState(false);
  const [taskId, setTaskId]             = useState<string | null>(null);
  const [progress, setProgress]         = useState<number | null>(null);
  const [error, setError]               = useState<string | null>(null);
  const [showConfirm, setShowConfirm]   = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const onUpdateRef = useRef(onUpdate);
  useEffect(() => { onUpdateRef.current = onUpdate; });

  function stopPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }
  useEffect(() => () => stopPolling(), []);

  function startPolling(id: string) {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch(`/api/generate-runway-clip/${id}`, {
          headers: { Authorization: `Bearer ${token ?? ""}` },
        });
        const data = await res.json() as { status: string; url?: string; progress?: number; error?: string };
        if (data.status === "succeeded" && data.url) {
          stopPolling();
          setIsGenerating(false);
          setTaskId(null);
          onUpdateRef.current({
            demoClipUrl: data.url,
            provider: "Runway",
            generationStatus: "completed",
            promptUsed: scene.aiVideoPrompt,
            generatedAt: new Date().toISOString(),
          });
          toast({ title: "Runway clip ready!", description: "Your clip has been generated." });
        } else if (data.status === "failed" || data.status === "cancelled") {
          stopPolling();
          setIsGenerating(false);
          setError(data.error ?? "Runway generation failed");
          onUpdateRef.current({ generationStatus: "failed" });
        } else {
          setProgress(typeof data.progress === "number" ? data.progress : null);
        }
      } catch {
        stopPolling();
        setIsGenerating(false);
        setError("Network error while polling Runway");
        onUpdateRef.current({ generationStatus: "failed" });
      }
    }, 5000);
  }

  async function startGeneration() {
    const promptText = scene.aiVideoPrompt.trim() ||
      [scene.action, scene.location, scene.cameraMovement, scene.lighting, scene.mood]
        .filter(Boolean).join(", ") ||
      "cinematic music video scene, dramatic lighting, luxury aesthetic";

    setIsGenerating(true);
    setError(null);
    setProgress(null);
    setShowConfirm(false);

    try {
      const token = await getAccessToken();
      const res = await fetch("/api/generate-runway-clip", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({
          promptText,
          negativePrompt: scene.negativePrompt ?? "",
          ratio: "720:1280",
        }),
      });
      const data = await res.json() as { taskId?: string; error?: string };
      if (!res.ok || !data.taskId) throw new Error(data.error ?? `Runway API error (HTTP ${res.status})`);
      setTaskId(data.taskId);
      startPolling(data.taskId);
    } catch (e) {
      setIsGenerating(false);
      setError(e instanceof Error ? e.message : "Failed to start Runway generation");
      onUpdateRef.current({ generationStatus: "failed" });
    }
  }

  function handleRemoveClip() {
    stopPolling();
    setIsGenerating(false);
    setTaskId(null);
    setError(null);
    setProgress(null);
    setShowConfirm(false);
    onUpdateRef.current({
      demoClipUrl: null,
      generationStatus: null,
      provider: null,
      promptUsed: null,
      generatedAt: null,
    });
  }

  const hasClip = !!scene.demoClipUrl && scene.demoClipUrl.startsWith("http");

  /* Generating state */
  if (isGenerating) {
    return (
      <div className="flex items-start gap-3 px-4 py-3 rounded-xl border border-primary/25 bg-primary/5">
        <Loader2 className="h-4 w-4 text-primary animate-spin shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold text-primary/90">Generating Runway clip…</p>
          <p className="text-[11px] text-white/30 mt-0.5">Usually takes 30–90 seconds</p>
          {progress !== null && (
            <div className="mt-2 h-1 w-full rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-1000"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
          )}
          {taskId && (
            <p className="text-[9px] text-white/20 font-mono mt-1">Task: {taskId.slice(0, 16)}…</p>
          )}
        </div>
      </div>
    );
  }

  /* Error state */
  if (error) {
    return (
      <div className="flex items-start gap-3 px-4 py-3 rounded-xl border border-red-500/30 bg-red-500/5">
        <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold text-red-300">Generation failed</p>
          <p className="text-[11px] text-red-400/70 mt-0.5 break-words">{error}</p>
        </div>
        <button
          onClick={() => { setError(null); setShowConfirm(false); }}
          className="text-white/30 hover:text-white/60 transition-colors shrink-0"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  /* Has clip */
  if (hasClip) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[10px] font-bold text-green-400 uppercase tracking-widest">
            <CheckCircle2 className="h-3 w-3" /> Clip Ready — {scene.provider ?? "Runway"}
          </span>
          {showConfirm ? (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-white/40">Remove clip?</span>
              <button
                onClick={handleRemoveClip}
                className="text-[10px] font-bold text-red-400 hover:text-red-300 transition-colors"
              >Yes</button>
              <button
                onClick={() => setShowConfirm(false)}
                className="text-[10px] text-white/30 hover:text-white/60 transition-colors"
              >No</button>
            </div>
          ) : (
            <button
              onClick={() => setShowConfirm(true)}
              className="text-[10px] text-white/25 hover:text-white/50 transition-colors flex items-center gap-1"
            >
              <RotateCcw className="h-2.5 w-2.5" /> Re-generate
            </button>
          )}
        </div>
        <video
          src={scene.demoClipUrl!}
          controls
          playsInline
          className="w-full rounded-xl bg-black border border-white/10 max-h-64"
        />
      </div>
    );
  }

  /* Idle — show generate button */
  return showConfirm ? (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-white/50">Generate costs 1 credit.</span>
      <Button size="sm" onClick={startGeneration} className="gold-glow h-7 text-xs gap-1.5">
        <Video className="h-3.5 w-3.5" /> Yes, Generate
      </Button>
      <Button
        size="sm" variant="outline"
        onClick={() => setShowConfirm(false)}
        className="h-7 text-xs border-white/10 bg-white/5 text-white/50"
      >
        Cancel
      </Button>
    </div>
  ) : (
    <Button
      size="sm"
      onClick={() => setShowConfirm(true)}
      className="gap-2 border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 font-bold text-xs h-8"
      variant="outline"
      data-testid={`btn-generate-runway`}
    >
      <Video className="h-3.5 w-3.5" />
      Generate Runway Clip
    </Button>
  );
}

/* ─── Scene card ────────────────────────────────────────────── */
interface SceneCardProps {
  scene: SceneData;
  index: number;
  onUpdate: (id: string, patch: Partial<SceneData>) => void;
  artistVault?: ArtistVault | null;
  videoStyle?: string;
  platform?: string;
}

function SceneCard({ scene, index, onUpdate, artistVault, videoStyle, platform }: SceneCardProps) {
  const { getAccessToken } = useAuth();
  const { toast } = useToast();

  const [collapsed, setCollapsed]         = useState(false);
  const [aiPrompt, setAiPrompt]           = useState(scene.aiVideoPrompt);
  const [negPrompt, setNegPrompt]         = useState(scene.negativePrompt);
  const [improving, setImproving]         = useState(false);

  /* Keep local textarea state in sync if parent updates the scene */
  useEffect(() => { setAiPrompt(scene.aiVideoPrompt); }, [scene.aiVideoPrompt]);
  useEffect(() => { setNegPrompt(scene.negativePrompt); }, [scene.negativePrompt]);

  function handleUpdate(patch: Partial<SceneData>) {
    onUpdate(scene.id, patch);
  }

  function saveAiPrompt() {
    if (aiPrompt !== scene.aiVideoPrompt) handleUpdate({ aiVideoPrompt: aiPrompt });
  }

  function saveNegPrompt() {
    if (negPrompt !== scene.negativePrompt) handleUpdate({ negativePrompt: negPrompt });
  }

  async function handleImprovePrompt() {
    if (!aiPrompt.trim()) {
      toast({ title: "Enter a prompt first", description: "Type an AI Video Prompt before improving it.", variant: "destructive" });
      return;
    }
    setImproving(true);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/improve-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({
          prompt: aiPrompt,
          sceneContext: {
            section: scene.section,
            lyricLine: scene.lyricLine,
            action: scene.action,
            location: scene.location,
            cameraMovement: scene.cameraMovement,
            lighting: scene.lighting,
            mood: scene.mood,
          },
          videoStyle,
          platform,
          artistVault: artistVault
            ? {
                artistType: artistVault.artist_type,
                artistDescription: artistVault.artist_description,
                visualStyle: artistVault.visual_style,
                hair: artistVault.hair,
                tattoos: artistVault.tattoos,
                jewelry: artistVault.jewelry,
                clothingStyle: artistVault.clothing_style,
                brandColors: artistVault.brand_colors,
                doNotChangeRules: artistVault.do_not_change_rules,
                specialStyleRules: artistVault.special_style_rules,
              }
            : null,
        }),
      });
      if (!res.ok) throw new Error("Improve prompt API error");
      const { improvedPrompt } = await res.json() as { improvedPrompt: string };
      setAiPrompt(improvedPrompt);
      handleUpdate({ aiVideoPrompt: improvedPrompt });
      toast({ title: "Prompt improved!", description: "Your AI Video Prompt has been enhanced for Runway." });
    } catch {
      toast({ title: "Could not improve prompt", variant: "destructive" });
    } finally {
      setImproving(false);
    }
  }

  return (
    <div
      className="rounded-2xl border border-white/10 bg-white/[0.025] overflow-hidden transition-colors hover:border-white/20"
      data-testid={`scene-card-${index}`}
    >
      {/* ── Card header ── */}
      <div className="flex items-center gap-3 px-5 py-3.5 border-b border-white/[0.06] bg-white/[0.02]">
        {/* Scene number */}
        <div className="h-7 w-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
          <span className="text-[11px] font-black text-primary">{index + 1}</span>
        </div>

        {/* Timestamp */}
        {scene.timestamp && (
          <span className="flex items-center gap-1 text-xs text-white/40 shrink-0">
            <Clock className="h-3 w-3" />
            {scene.timestamp}
          </span>
        )}

        {/* Section badge */}
        {scene.section && (
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${sectionColor(scene.section)}`}>
            {scene.section}
          </span>
        )}

        {/* Clip status indicator */}
        {scene.generationStatus === "completed" && (
          <span className="ml-auto flex items-center gap-1 text-[10px] font-bold text-green-400">
            <CheckCircle2 className="h-3 w-3" /> Clip Ready
          </span>
        )}

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="ml-auto text-white/30 hover:text-white/60 transition-colors shrink-0"
          aria-label={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
        </button>
      </div>

      {/* ── Card body ── */}
      {!collapsed && (
        <div className="px-5 py-4 space-y-4">

          {/* Lyric line */}
          {scene.lyricLine && (
            <p className="text-sm text-white/40 italic leading-relaxed border-l-2 border-primary/20 pl-3">
              "{scene.lyricLine}"
            </p>
          )}

          {/* Visual description + Camera direction */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {(scene.location || scene.action) && (
              <div className="rounded-xl bg-white/[0.03] border border-white/[0.05] px-3.5 py-3 space-y-1.5">
                <p className="text-[9px] font-black text-white/25 uppercase tracking-widest flex items-center gap-1.5">
                  <MapPin className="h-2.5 w-2.5" /> Visual Description
                </p>
                {scene.location && (
                  <p className="text-xs text-white/60 leading-relaxed">
                    <span className="text-white/30">Location: </span>{scene.location}
                  </p>
                )}
                {scene.action && (
                  <p className="text-xs text-white/60 leading-relaxed flex items-start gap-1.5">
                    <Zap className="h-3 w-3 text-primary/40 shrink-0 mt-0.5" />
                    {scene.action}
                  </p>
                )}
              </div>
            )}

            {(scene.cameraMovement || scene.lighting || scene.mood) && (
              <div className="rounded-xl bg-white/[0.03] border border-white/[0.05] px-3.5 py-3 space-y-1.5">
                <p className="text-[9px] font-black text-white/25 uppercase tracking-widest flex items-center gap-1.5">
                  <Camera className="h-2.5 w-2.5" /> Camera Direction
                </p>
                {scene.cameraMovement && (
                  <p className="text-xs text-white/60 leading-relaxed">
                    <span className="text-white/30">Camera: </span>{scene.cameraMovement}
                  </p>
                )}
                {scene.lighting && (
                  <p className="text-xs text-white/60 leading-relaxed">
                    <span className="text-white/30">Lighting: </span>{scene.lighting}
                  </p>
                )}
                {scene.mood && (
                  <p className="text-xs text-white/60 leading-relaxed">
                    <span className="text-white/30">Mood: </span>{scene.mood}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* AI Video Prompt */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label className="text-[10px] font-black text-primary/70 uppercase tracking-widest flex items-center gap-1.5">
                <Zap className="h-2.5 w-2.5" /> AI Video Prompt
              </label>
              <Button
                size="sm"
                variant="outline"
                onClick={handleImprovePrompt}
                disabled={improving}
                className="h-6 text-[10px] px-2.5 gap-1 border-primary/20 bg-primary/5 text-primary/70 hover:bg-primary/15 hover:text-primary font-bold uppercase tracking-wide"
                data-testid={`btn-improve-prompt-${index}`}
              >
                {improving
                  ? <><Loader2 className="h-2.5 w-2.5 animate-spin" /> Improving…</>
                  : <><Sparkles className="h-2.5 w-2.5" /> Improve Prompt for Artist</>}
              </Button>
            </div>
            <textarea
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              onBlur={saveAiPrompt}
              rows={4}
              placeholder="Describe the visual for this scene…"
              className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl px-3.5 py-3 text-sm text-white/80 leading-relaxed resize-none focus:outline-none focus:border-primary/40 transition-colors placeholder:text-white/20"
              data-testid={`textarea-ai-prompt-${index}`}
            />
          </div>

          {/* Negative Prompt */}
          <div className="space-y-2">
            <label className="text-[10px] font-black text-white/30 uppercase tracking-widest block">
              Negative Prompt
            </label>
            <textarea
              value={negPrompt}
              onChange={(e) => setNegPrompt(e.target.value)}
              onBlur={saveNegPrompt}
              rows={2}
              placeholder="Things to avoid in the video (e.g. blurry, text, watermark)…"
              className="w-full bg-white/[0.02] border border-white/[0.06] rounded-xl px-3.5 py-2.5 text-xs text-white/50 leading-relaxed resize-none focus:outline-none focus:border-white/20 transition-colors placeholder:text-white/15"
              data-testid={`textarea-neg-prompt-${index}`}
            />
          </div>

          {/* Generate Runway Clip */}
          <div className="pt-1 border-t border-white/[0.04]">
            <InlineRunwayGenerator
              scene={{ ...scene, aiVideoPrompt: aiPrompt, negativePrompt: negPrompt }}
              onUpdate={(patch) => handleUpdate(patch)}
            />
          </div>

        </div>
      )}
    </div>
  );
}

/* ─── SceneStudio ───────────────────────────────────────────── */
interface SceneStudioProps {
  scenes: SceneData[];
  onScenesChange: (scenes: SceneData[]) => void;
  artistVault?: ArtistVault | null;
  videoStyle?: string;
  platform?: string;
}

export function SceneStudio({ scenes, onScenesChange, artistVault, videoStyle, platform }: SceneStudioProps) {
  const handleUpdate = useCallback(
    (id: string, patch: Partial<SceneData>) => {
      onScenesChange(scenes.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    },
    [scenes, onScenesChange],
  );

  if (scenes.length === 0) return null;

  const clipsReady = scenes.filter((s) => s.generationStatus === "completed").length;

  return (
    <div className="space-y-4" data-testid="scene-studio">
      {/* Section heading */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Film className="h-4.5 w-4.5 text-primary" style={{ width: "1.125rem", height: "1.125rem" }} />
          </div>
          <div>
            <h2 className="text-lg font-black text-white uppercase tracking-wider">
              Scene Cards For Video Generation
            </h2>
            <p className="text-xs text-white/30 mt-0.5">
              {scenes.length} scene{scenes.length !== 1 ? "s" : ""}
              {clipsReady > 0 ? ` · ${clipsReady} clip${clipsReady !== 1 ? "s" : ""} ready` : ""}
            </p>
          </div>
        </div>
      </div>

      {/* Cards */}
      <div className="space-y-4">
        {scenes.map((scene, i) => (
          <SceneCard
            key={scene.id}
            scene={scene}
            index={i}
            onUpdate={handleUpdate}
            artistVault={artistVault}
            videoStyle={videoStyle}
            platform={platform}
          />
        ))}
      </div>
    </div>
  );
}
