import { useState, useRef, useCallback, useEffect } from "react";
import {
  Camera, Clock, MapPin, Zap, Film, Loader2,
  Sparkles, Video, CheckCircle2, AlertCircle, X,
  ChevronDown, ChevronUp, RotateCcw,
  ArrowUp, ArrowDown, Trash2, Plus, Save, Eye,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import type { SceneData } from "@/lib/scene-parser";
import type { ArtistVault } from "@/components/ArtistVaultSelector";
import { OutOfCredits } from "@/components/OutOfCredits";

/* ─── Section color badges ──────────────────────────────────── */
const SECTION_COLORS: Record<string, string> = {
  intro:  "bg-white/[0.12] text-zinc-200 border-white/20",
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

/* ─── Build artist consistency prefix for Runway prompt ────── */
function buildConsistencyPrefix(vault: ArtistVault): string {
  const parts: string[] = [
    `CHARACTER CONSISTENCY — ACTIVE ARTIST: ${vault.artist_name}`,
    `Use ${vault.artist_name} as the main character. Do NOT create a random new person.`,
    `Keep the exact same face, skin tone, hairstyle, body type, tattoos, jewelry, clothing style, and overall identity throughout.`,
  ];
  if (vault.personality)         parts.push(`Description: ${vault.personality}`);
  if (vault.visual_style)        parts.push(`Visual Style: ${vault.visual_style}`);
  if (vault.hair)                parts.push(`Hair: ${vault.hair}`);
  if (vault.tattoos)             parts.push(`Tattoos: ${vault.tattoos}`);
  if (vault.jewelry)             parts.push(`Jewelry: ${vault.jewelry}`);
  if (vault.clothing_style)      parts.push(`Clothing: ${vault.clothing_style}`);
  if (vault.brand_colors)        parts.push(`Brand Colors: ${vault.brand_colors}`);
  if (vault.consistency_prompt)  parts.push(`Consistency Guide: ${vault.consistency_prompt}`);
  if (vault.do_not_change_rules) parts.push(`⛔ Do Not Change: ${vault.do_not_change_rules}`);
  if (vault.reference_image_url) {
    parts.push(`Reference Image: ${vault.reference_image_url} — use this as the visual identity anchor.`);
  }
  parts.push("---");
  return parts.join("\n");
}

/* ─── Inline Runway clip generator ─────────────────────────── */
export interface RunwayGeneratorProps {
  scene: SceneData;
  onUpdate: (patch: Partial<SceneData>) => void;
  artistVault?: ArtistVault | null;
  projectId?: string | null;
  /** Increment to auto-trigger generation (skips confirm) for "Create All" */
  createAllTrigger?: number;
}

export function InlineRunwayGenerator({ scene, onUpdate, artistVault, projectId, createAllTrigger }: RunwayGeneratorProps) {
  const { getAccessToken, refreshProfile } = useAuth();
  const { toast } = useToast();

  const [isGenerating, setIsGenerating] = useState(false);
  const [taskId, setTaskId]             = useState<string | null>(null);
  const [progress, setProgress]         = useState<number | null>(null);
  const [error, setError]               = useState<string | null>(null);
  const [showConfirm, setShowConfirm]   = useState(false);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [showFinalPrompt, setShowFinalPrompt] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const onUpdateRef = useRef(onUpdate);
  useEffect(() => { onUpdateRef.current = onUpdate; });

  function stopPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }
  useEffect(() => () => stopPolling(), []);

  /* Auto-trigger from "Create All Video Clips" — skip confirm step */
  const hasClipForTrigger = !!scene.demoClipUrl && scene.demoClipUrl.startsWith("http");
  useEffect(() => {
    if (!createAllTrigger) return;
    if (hasClipForTrigger || isGenerating || outOfCredits) return;
    void startGeneration();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createAllTrigger]);

  /* Build the final prompt that will actually be sent to Runway */
  function buildFinalPrompt(): string {
    const basePrompt = scene.aiVideoPrompt.trim() ||
      [scene.action, scene.location, scene.cameraMovement, scene.lighting, scene.mood]
        .filter(Boolean).join(", ") ||
      "cinematic music video scene, dramatic lighting, luxury aesthetic";

    if (artistVault) {
      const prefix = buildConsistencyPrefix(artistVault);
      return `${prefix}\n${basePrompt}`;
    }
    return basePrompt;
  }

  async function autoSaveClip(clipUrl: string, jobId: string, finalPrompt: string) {
    try {
      const token = await getAccessToken();
      await fetch("/api/generated-clips", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({
          projectId: projectId ?? null,
          sceneId: scene.id ?? null,
          title: scene.section || scene.timestamp || "Scene Clip",
          prompt: scene.aiVideoPrompt || null,
          finalPrompt,
          runwayJobId: jobId,
          videoUrl: clipUrl,
          status: "completed",
        }),
      });
    } catch {
      /* best-effort — clip is already in the UI */
    }
  }

  function startPolling(id: string, finalPrompt: string) {
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
          /* Auto-save clip to DB immediately — before any UI update */
          void autoSaveClip(data.url, id, finalPrompt);
          onUpdateRef.current({
            demoClipUrl: data.url,
            provider: "Runway",
            generationStatus: "completed",
            promptUsed: finalPrompt,
            generatedAt: new Date().toISOString(),
          });
          toast({ title: "Runway clip ready!", description: "Your clip has been generated and saved." });
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
    const finalPrompt = buildFinalPrompt();

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
          promptText: finalPrompt,
          negativePrompt: scene.negativePrompt ?? "",
          ratio: "720:1280",
        }),
      });
      const data = await res.json() as { taskId?: string; error?: string };
      if (!res.ok || !data.taskId) throw new Error(data.error ?? `Runway API error (HTTP ${res.status})`);
      setTaskId(data.taskId);
      startPolling(data.taskId, finalPrompt);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to start Runway generation";
      setIsGenerating(false);
      if (msg === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      setError(msg);
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
  const finalPromptPreview = buildFinalPrompt();
  const hasArtist = !!artistVault;

  /* Generating state */
  if (isGenerating) {
    return (
      <div className="flex items-start gap-3 px-4 py-3 rounded-xl border border-primary/25 bg-primary/5">
        <Loader2 className="h-4 w-4 text-primary animate-spin shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold text-primary/90">Generating Runway clip…</p>
          {hasArtist && (
            <p className="text-[10px] text-primary/60 mt-0.5 flex items-center gap-1">
              <ShieldCheck className="h-3 w-3" /> Artist consistency applied to prompt
            </p>
          )}
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

  /* Out of credits */
  if (outOfCredits) {
    return <OutOfCredits />;
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

  /* Idle — show generate button + final prompt preview */
  return (
    <div className="space-y-3">
      {/* Artist consistency badge */}
      {hasArtist && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/8 border border-primary/20">
          <ShieldCheck className="h-3.5 w-3.5 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold text-primary uppercase tracking-wider">
              Artist Consistency Applied
            </p>
            <p className="text-[10px] text-white/40 leading-snug">
              {artistVault!.artist_name} will be used as the main character.
              {artistVault!.reference_image_url
                ? " Reference image included in prompt."
                : " Text-only character consistency applied. Image reference video support coming soon."}
            </p>
          </div>
        </div>
      )}

      {/* Final Prompt preview */}
      <div>
        <button
          onClick={() => setShowFinalPrompt((s) => !s)}
          className="flex items-center gap-1.5 text-[10px] font-bold text-white/30 hover:text-white/60 transition-colors mb-1.5"
        >
          <Eye className="h-3 w-3" />
          {showFinalPrompt ? "Hide" : "Preview"} Final Prompt Sent To Runway
          {showFinalPrompt ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
        {showFinalPrompt && (
          <pre className="text-[10px] text-white/50 leading-relaxed whitespace-pre-wrap bg-white/[0.025] border border-white/[0.06] rounded-lg px-3 py-2.5 font-mono max-h-48 overflow-y-auto">
            {finalPromptPreview}
          </pre>
        )}
      </div>

      {/* Generate controls */}
      {showConfirm ? (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-white/50">Generate costs 5 credits.</span>
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
      )}
    </div>
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
  projectId?: string | null;
}

function SceneCard({ scene, index, onUpdate, artistVault, videoStyle, platform, projectId }: SceneCardProps) {
  const { getAccessToken } = useAuth();
  const { toast } = useToast();

  const [collapsed, setCollapsed]         = useState(false);
  const [showPrompt, setShowPrompt]       = useState(false);
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
    setShowPrompt(true);
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
                artistType:        artistVault.artist_type,
                artistDescription: artistVault.personality,
                visualStyle:       artistVault.visual_style,
                hair:              artistVault.hair,
                tattoos:           artistVault.tattoos,
                jewelry:           artistVault.jewelry,
                clothingStyle:     artistVault.clothing_style,
                brandColors:       artistVault.brand_colors,
                doNotChangeRules:  artistVault.do_not_change_rules,
                consistencyPrompt: artistVault.consistency_prompt,
                referenceImageUrl: artistVault.reference_image_url,
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

  const hasClip = !!scene.demoClipUrl && scene.demoClipUrl.startsWith("http");
  const summary =
    scene.lyricLine || scene.action || scene.location || `Scene ${index + 1}`;

  return (
    <div
      className={`rounded-2xl border bg-white/[0.025] overflow-hidden transition-colors ${
        scene.approved ? "border-primary/40" : "border-white/10 hover:border-white/20"
      }`}
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

        {/* Status indicator */}
        <span className="ml-auto flex items-center gap-2 shrink-0">
          {scene.approved && (
            <span className="flex items-center gap-1 text-[10px] font-bold text-primary">
              <CheckCircle2 className="h-3 w-3" /> Approved
            </span>
          )}
          {!scene.approved && hasClip && (
            <span className="flex items-center gap-1 text-[10px] font-bold text-green-400">
              <CheckCircle2 className="h-3 w-3" /> Clip Ready
            </span>
          )}
          {/* Collapse toggle */}
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="text-white/30 hover:text-white/60 transition-colors"
            aria-label={collapsed ? "Expand" : "Collapse"}
          >
            {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </button>
        </span>
      </div>

      {/* ── Card body ── */}
      {!collapsed && (
        <div className="px-5 py-4 space-y-4">

          {/* Scene summary (always visible) */}
          <p className="text-sm text-white/55 leading-relaxed border-l-2 border-primary/20 pl-3">
            {scene.lyricLine ? <span className="italic">"{summary}"</span> : summary}
          </p>

          {/* Action buttons (always visible) */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleImprovePrompt}
              disabled={improving}
              className="h-8 text-xs gap-1.5 border-primary/20 bg-primary/5 text-primary/80 hover:bg-primary/15 hover:text-primary font-bold"
              data-testid={`btn-improve-prompt-${index}`}
            >
              {improving
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Improving…</>
                : <><Sparkles className="h-3.5 w-3.5" /> Improve Prompt for Artist</>}
            </Button>

            <button
              onClick={() => setShowPrompt((s) => !s)}
              className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-white/10 bg-white/[0.03] text-white/50 text-xs font-bold hover:text-white/80 hover:border-white/20 transition-colors"
              data-testid={`btn-toggle-prompt-${index}`}
            >
              <Zap className="h-3.5 w-3.5" />
              {showPrompt ? "Hide AI Prompt" : "AI Prompt & Details"}
              {showPrompt ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>

            {hasClip && (
              <Button
                size="sm"
                onClick={() => handleUpdate({ approved: !scene.approved })}
                variant="outline"
                className={`h-8 text-xs gap-1.5 font-bold ${
                  scene.approved
                    ? "border-primary/40 bg-primary/15 text-primary hover:bg-primary/10"
                    : "border-white/10 bg-white/[0.03] text-white/50 hover:text-primary hover:border-primary/30 hover:bg-primary/10"
                }`}
                data-testid={`btn-approve-clip-${index}`}
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                {scene.approved ? "Approved ✓" : "Approve Clip"}
              </Button>
            )}
          </div>

          {/* AI Video Prompt & scene details (collapsed by default) */}
          {showPrompt && (
            <div className="space-y-4 pt-1">
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
                <label className="text-[10px] font-black text-primary/70 uppercase tracking-widest flex items-center gap-1.5">
                  <Zap className="h-2.5 w-2.5" /> AI Video Prompt
                </label>
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
            </div>
          )}

          {/* Generate Runway Clip + preview */}
          <div className="pt-1 border-t border-white/[0.04]">
            <InlineRunwayGenerator
              scene={{ ...scene, aiVideoPrompt: aiPrompt, negativePrompt: negPrompt }}
              onUpdate={(patch) => handleUpdate(patch)}
              artistVault={artistVault}
              projectId={projectId}
            />
          </div>

          {/* Silent preview note */}
          <p className="text-[11px] text-white/30 flex items-start gap-1.5">
            <Film className="h-3 w-3 text-primary/40 shrink-0 mt-0.5" />
            Runway clips are silent previews. Your uploaded song will be added during final export.
          </p>

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
  /** When true, expose scene-management controls (reorder, add, remove). */
  manageable?: boolean;
  /** Explicit save action (e.g. persist timeline to project). Renders a Save button when provided. */
  onSave?: () => void;
  /** Saving spinner state for the Save button. */
  saving?: boolean;
  /** Project ID for auto-saving generated clips. */
  projectId?: string | null;
}

export function SceneStudio({
  scenes, onScenesChange, artistVault, videoStyle, platform,
  manageable = false, onSave, saving = false, projectId,
}: SceneStudioProps) {
  const handleUpdate = useCallback(
    (id: string, patch: Partial<SceneData>) => {
      onScenesChange(scenes.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    },
    [scenes, onScenesChange],
  );

  const moveScene = useCallback(
    (index: number, dir: -1 | 1) => {
      const target = index + dir;
      if (target < 0 || target >= scenes.length) return;
      const next = [...scenes];
      [next[index], next[target]] = [next[target], next[index]];
      onScenesChange(next);
    },
    [scenes, onScenesChange],
  );

  const removeScene = useCallback(
    (id: string) => onScenesChange(scenes.filter((s) => s.id !== id)),
    [scenes, onScenesChange],
  );

  const addScene = useCallback(() => {
    const newScene: SceneData = {
      id: `scene-${Date.now()}`,
      sceneNumber: scenes.length + 1,
      timestamp: "", section: "", lyricLine: "", location: "",
      action: "", cameraMovement: "", lighting: "", mood: "",
      aiVideoPrompt: "", negativePrompt: "", approved: false, demoClipUrl: null,
      provider: null, generationStatus: null, promptUsed: null, generatedAt: null,
    };
    onScenesChange([...scenes, newScene]);
  }, [scenes, onScenesChange]);

  if (scenes.length === 0 && !manageable) return null;

  const clipsReady = scenes.filter((s) => s.generationStatus === "completed").length;

  return (
    <div className="space-y-4" data-testid="scene-studio">
      {/* Section heading */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
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
        {manageable && (
          <div className="flex items-center gap-2">
            <Button
              size="sm" variant="outline" onClick={addScene}
              className="border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white gap-1.5 h-9"
              data-testid="btn-add-scene"
            >
              <Plus className="h-4 w-4" /> Add Scene
            </Button>
            {onSave && (
              <Button
                size="sm" onClick={onSave} disabled={saving}
                className="gold-glow font-bold gap-1.5 h-9"
                data-testid="btn-save-scenes"
              >
                {saving
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving...</>
                  : <><Save className="h-4 w-4" /> Save</>}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Cards */}
      <div className="space-y-4">
        {scenes.map((scene, i) => (
          <div key={scene.id} className="space-y-1.5">
            {manageable && (
              <div className="flex items-center justify-end gap-1">
                <button
                  type="button" onClick={() => moveScene(i, -1)} disabled={i === 0}
                  className="h-7 w-7 rounded-lg border border-white/10 bg-white/5 flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
                  title="Move up" data-testid={`btn-scene-up-${i}`}
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button" onClick={() => moveScene(i, 1)} disabled={i === scenes.length - 1}
                  className="h-7 w-7 rounded-lg border border-white/10 bg-white/5 flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
                  title="Move down" data-testid={`btn-scene-down-${i}`}
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button" onClick={() => removeScene(scene.id)}
                  className="h-7 w-7 rounded-lg border border-red-500/20 bg-red-500/5 flex items-center justify-center text-red-400/70 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  title="Remove scene" data-testid={`btn-scene-remove-${i}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            <SceneCard
              scene={scene}
              index={i}
              onUpdate={handleUpdate}
              artistVault={artistVault}
              videoStyle={videoStyle}
              platform={platform}
              projectId={projectId}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
