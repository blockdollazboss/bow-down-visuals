import { useState } from "react";
import {
  Eye, EyeOff, CheckCircle2, Volume2, VolumeX, Video, ArrowUp, ArrowDown,
  Copy, Trash2, Link2, ShieldCheck, Film, Loader2, Sparkles, AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { InlineRunwayGenerator } from "@/components/SceneStudio";
import { Collapsible, Field } from "@/components/editor/controls";
import { IconBtn } from "@/components/editor/sections/shared";
import type { SceneData } from "@/lib/scene-parser";
import type { ArtistVault } from "@/components/ArtistVaultSelector";
import { sceneHasClip, getClipEdit, type EditorSettings } from "@/lib/editor-settings";

const CONSISTENCY_MARKER = "[CHARACTER CONSISTENCY:";

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

/* Cameras cycled to ensure every scene gets a distinct shot type */
const ENHANCE_CAMERAS = [
  "tracking shot — camera follows artist from behind",
  "low angle close-up — camera looks up at artist",
  "wide establishing shot — camera shows full location",
  "handheld street shot — shaky kinetic energy",
  "slow push-in — camera drifts toward artist's face",
  "rooftop drone-style angle — sweeping overhead view",
  "side profile walking shot — artist moves through frame",
  "overhead top-down shot — camera looks straight down",
  "slow motion close-up — extreme detail, time slowed",
  "dutch angle — tilted frame, dramatic tension",
];

interface EnhanceStatus { type: "success" | "error" | "warning"; message: string }

interface ClipGeneratorSectionProps {
  scenes: SceneData[];
  setScenes: (s: SceneData[]) => void;
  settings: EditorSettings;
  setSettings: (s: EditorSettings) => void;
  artistVault?: ArtistVault | null;
  projectId?: string | null;
  onPreview?: (sceneId: string) => void;
  previewSceneId?: string | null;
  getAccessToken?: () => Promise<string | null>;
}

export function ClipGeneratorSection({
  scenes,
  setScenes,
  settings,
  setSettings,
  artistVault,
  projectId,
  onPreview,
  previewSceneId,
  getAccessToken,
}: ClipGeneratorSectionProps) {
  const [createAllTrigger, setCreateAllTrigger] = useState(0);
  const [enhancing, setEnhancing] = useState(false);
  const [enhanceProgress, setEnhanceProgress] = useState<{ done: number; total: number } | null>(null);
  const [enhancedIds, setEnhancedIds] = useState<Set<string>>(new Set());
  const [enhanceStatus, setEnhanceStatus] = useState<EnhanceStatus | null>(null);

  const scenesWithoutClip = scenes.filter((s) => !sceneHasClip(s));
  const hasArtist = !!artistVault;

  function updateScene(id: string, patch: Partial<SceneData>) {
    setScenes(scenes.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  async function handleEnhanceAll() {
    if (!getAccessToken || scenes.length === 0 || enhancing) return;
    setEnhancing(true);
    setEnhanceStatus(null);
    setEnhanceProgress({ done: 0, total: scenes.length });

    let token: string | null;
    try {
      token = await getAccessToken();
    } catch {
      setEnhanceStatus({ type: "error", message: "Could not authenticate. Please refresh and try again." });
      setEnhancing(false);
      return;
    }
    if (!token) {
      setEnhanceStatus({ type: "error", message: "Not signed in. Please sign in and try again." });
      setEnhancing(false);
      return;
    }

    /* Keep a mutable local copy so sequential updates don't clobber each other */
    const updatedScenes = scenes.map((s) => ({ ...s }));
    const newEnhancedIds = new Set(enhancedIds);
    let failed = 0;

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i]!;
      const cameraHint = ENHANCE_CAMERAS[i % ENHANCE_CAMERAS.length]!;
      try {
        const res = await fetch("/api/improve-prompt", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            prompt: scene.aiVideoPrompt || `${scene.action} at ${scene.location}`,
            sceneContext: {
              section: scene.section,
              lyricLine: scene.lyricLine,
              action: scene.action,
              location: scene.location,
              cameraMovement: cameraHint,
              lighting: scene.lighting,
              mood: scene.mood,
            },
            artistVault,
          }),
        });
        if (res.ok) {
          const data = (await res.json()) as { improvedPrompt: string };
          updatedScenes[i] = { ...updatedScenes[i]!, aiVideoPrompt: data.improvedPrompt };
          newEnhancedIds.add(scene.id);
          /* Push accumulated updates after each scene so the UI feels live */
          setScenes([...updatedScenes]);
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
      setEnhanceProgress({ done: i + 1, total: scenes.length });
    }

    setEnhancedIds(new Set(newEnhancedIds));
    setEnhancing(false);
    setEnhanceProgress(null);

    if (failed === 0) {
      setEnhanceStatus({
        type: "success",
        message: `All ${scenes.length} scene prompts enhanced with cinematic variety. No credits used.`,
      });
    } else if (failed < scenes.length) {
      setEnhanceStatus({
        type: "warning",
        message: `${scenes.length - failed} of ${scenes.length} prompts enhanced. ${failed} scene${failed !== 1 ? "s" : ""} failed — try again.`,
      });
    } else {
      setEnhanceStatus({
        type: "error",
        message: "Enhancement failed. Check your connection and try again.",
      });
    }
  }

  function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= scenes.length) return;
    const next = [...scenes];
    [next[index], next[target]] = [next[target]!, next[index]!];
    setScenes(next);
  }

  function duplicate(index: number) {
    const orig = scenes[index]!;
    const copy: SceneData = { ...orig, id: `${orig.id}-copy-${Date.now()}`, approved: false };
    const next = [...scenes];
    next.splice(index + 1, 0, copy);
    setScenes(next);
  }

  function remove(id: string) {
    setScenes(scenes.filter((s) => s.id !== id));
  }

  function patchClip(sceneId: string, patch: Partial<ReturnType<typeof getClipEdit>>) {
    const current = getClipEdit(settings, sceneId);
    setSettings({ ...settings, clips: { ...settings.clips, [sceneId]: { ...current, ...patch } } });
  }

  if (scenes.length === 0) {
    return (
      <div className="text-center py-12">
        <Film className="h-10 w-10 text-white/15 mx-auto mb-3" />
        <p className="text-sm font-bold text-white/40">No scenes loaded yet</p>
        <p className="text-[11px] text-white/25 mt-1">Rebuild scenes from your saved video plan above.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">

      {/* ── Enhance Scene Prompts banner ── */}
      <div className="rounded-xl border border-primary/20 bg-primary/[0.04] p-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-0.5">
            <p className="text-sm font-black text-white/80 flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-primary" />
              Enhance Scene Prompts
            </p>
            <p className="text-[11px] text-white/40 leading-relaxed">
              Rewrites every AI video prompt to be more cinematic — each scene gets a unique camera angle, location, and action.
              <span className="ml-1 text-green-400 font-semibold">Free — no credits used.</span>
            </p>
          </div>
          <Button
            size="sm"
            onClick={handleEnhanceAll}
            disabled={enhancing || !getAccessToken || scenes.length === 0}
            className="gap-1.5 bg-primary/15 border border-primary/40 text-primary hover:bg-primary/25 font-bold shrink-0 h-8"
            variant="outline"
            data-testid="btn-enhance-all-prompts"
          >
            {enhancing ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Enhancing {enhanceProgress ? `${enhanceProgress.done}/${enhanceProgress.total}` : "…"}
              </>
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5" />
                Enhance Scene Prompts
              </>
            )}
          </Button>
        </div>

        {/* Progress bar */}
        {enhancing && enhanceProgress && (
          <div className="h-1 w-full rounded-full bg-white/[0.07] overflow-hidden">
            <div
              className="h-full bg-primary/70 transition-all duration-300 rounded-full"
              style={{ width: `${(enhanceProgress.done / enhanceProgress.total) * 100}%` }}
            />
          </div>
        )}

        {/* Status */}
        {enhanceStatus && (
          <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-semibold ${
            enhanceStatus.type === "success"
              ? "border-green-500/25 bg-green-500/[0.07] text-green-400"
              : enhanceStatus.type === "warning"
              ? "border-yellow-500/25 bg-yellow-500/[0.07] text-yellow-400"
              : "border-red-500/25 bg-red-500/[0.07] text-red-400"
          }`}>
            {enhanceStatus.type === "success"
              ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              : <AlertCircle className="h-3.5 w-3.5 shrink-0" />}
            {enhanceStatus.message}
          </div>
        )}
      </div>

      {/* Create All button */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-xs font-black text-white/60 uppercase tracking-widest">
            {scenes.length} Scene{scenes.length !== 1 ? "s" : ""}
            {scenesWithoutClip.length > 0 && (
              <span className="ml-1.5 text-white/30 font-normal normal-case tracking-normal">
                · {scenesWithoutClip.length} without a clip
              </span>
            )}
          </p>
        </div>
        {scenesWithoutClip.length > 0 && (
          <Button
            size="sm"
            onClick={() => setCreateAllTrigger((n) => n + 1)}
            className="gap-2 bg-primary/15 border border-primary/40 text-primary hover:bg-primary/25 font-bold text-xs h-8"
            variant="outline"
            data-testid="btn-create-all-clips"
          >
            <Video className="h-3.5 w-3.5" />
            Create All Video Clips ({scenesWithoutClip.length})
          </Button>
        )}
      </div>

      {/* Scene cards */}
      <div className="space-y-4">
        {scenes.map((scene, i) => (
          <SceneClipCard
            key={scene.id}
            scene={scene}
            index={i}
            totalScenes={scenes.length}
            hasArtist={hasArtist}
            artistVault={artistVault}
            projectId={projectId}
            settings={settings}
            onUpdateScene={updateScene}
            onPatchClip={patchClip}
            onMove={move}
            onDuplicate={duplicate}
            onRemove={remove}
            onPreview={onPreview}
            previewSceneId={previewSceneId}
            createAllTrigger={createAllTrigger}
            isEnhanced={enhancedIds.has(scene.id)}
          />
        ))}
      </div>
    </div>
  );
}

/* ── Individual scene clip card ─────────────────────────────── */
interface SceneClipCardProps {
  scene: SceneData;
  index: number;
  totalScenes: number;
  hasArtist: boolean;
  artistVault?: ArtistVault | null;
  projectId?: string | null;
  settings: EditorSettings;
  onUpdateScene: (id: string, patch: Partial<SceneData>) => void;
  onPatchClip: (sceneId: string, patch: Partial<ReturnType<typeof getClipEdit>>) => void;
  onMove: (index: number, dir: -1 | 1) => void;
  onDuplicate: (index: number) => void;
  onRemove: (id: string) => void;
  onPreview?: (sceneId: string) => void;
  previewSceneId?: string | null;
  createAllTrigger: number;
  isEnhanced?: boolean;
}

function SceneClipCard({
  scene,
  index,
  totalScenes,
  hasArtist,
  artistVault,
  projectId,
  settings,
  onUpdateScene,
  onPatchClip,
  onMove,
  onDuplicate,
  onRemove,
  onPreview,
  previewSceneId,
  createAllTrigger,
  isEnhanced,
}: SceneClipCardProps) {
  const [showPrompt, setShowPrompt] = useState(false);

  const hasClip = sceneHasClip(scene);
  const edit = getClipEdit(settings, scene.id);
  const isPreviewing = previewSceneId === scene.id;
  const hasConsistency = scene.aiVideoPrompt.startsWith(CONSISTENCY_MARKER);

  return (
    <div
      className={`rounded-2xl border overflow-hidden transition-colors ${
        isPreviewing
          ? "border-primary/50 bg-primary/[0.04]"
          : "border-white/[0.08] bg-white/[0.025]"
      }`}
      data-testid={`clip-gen-card-${index}`}
    >
      {/* ── Header ── */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06] bg-white/[0.02]">
        {/* Scene number */}
        <div className="h-7 w-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
          <span className="text-[11px] font-black text-primary">{index + 1}</span>
        </div>

        {/* Section + consistency + enhanced badges */}
        <div className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap">
          {scene.section && (
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${sectionColor(scene.section)}`}>
              {scene.section}
            </span>
          )}
          {hasConsistency && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-green-500/[0.12] border border-green-500/25 text-[9px] font-bold text-green-400 shrink-0">
              <ShieldCheck className="h-2.5 w-2.5" /> Consistency Applied
            </span>
          )}
          {isEnhanced && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-primary/[0.15] border border-primary/30 text-[9px] font-bold text-primary shrink-0">
              <Sparkles className="h-2.5 w-2.5" /> Prompt Enhanced
            </span>
          )}
        </div>

        {/* Clip status badge */}
        {hasClip ? (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-green-500/30 bg-green-500/10 text-green-400 shrink-0">
            Clip Ready
          </span>
        ) : (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-white/10 bg-white/[0.03] text-white/30 shrink-0">
            No clip yet
          </span>
        )}

        {/* Preview clip button (when clip exists) */}
        {hasClip && onPreview && (
          <button
            type="button"
            onClick={() => onPreview(scene.id)}
            title="Preview in Live Preview"
            data-testid={`btn-preview-clip-${index}`}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors shrink-0 ${
              isPreviewing
                ? "border-primary/50 bg-primary/15 text-primary"
                : "border-white/10 bg-white/[0.03] text-white/45 hover:text-primary hover:border-primary/30"
            }`}
          >
            <Eye className="h-3 w-3" /> Preview
          </button>
        )}

        {/* Move / duplicate / remove */}
        <div className="flex items-center gap-1 shrink-0">
          <IconBtn title="Move up" disabled={index === 0} onClick={() => onMove(index, -1)} testId={`btn-up-${index}`}>
            <ArrowUp className="h-3.5 w-3.5" />
          </IconBtn>
          <IconBtn title="Move down" disabled={index === totalScenes - 1} onClick={() => onMove(index, 1)} testId={`btn-down-${index}`}>
            <ArrowDown className="h-3.5 w-3.5" />
          </IconBtn>
          <IconBtn title="Duplicate" onClick={() => onDuplicate(index)} testId={`btn-dup-${index}`}>
            <Copy className="h-3.5 w-3.5" />
          </IconBtn>
          <IconBtn title="Remove" danger onClick={() => onRemove(scene.id)} testId={`btn-rem-${index}`}>
            <Trash2 className="h-3.5 w-3.5" />
          </IconBtn>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="px-4 py-4 space-y-4">

        {/* Lyric line */}
        {(scene.lyricLine || scene.action) && (
          <p className="text-sm text-white/55 leading-relaxed border-l-2 border-primary/20 pl-3 italic">
            "{scene.lyricLine || scene.action}"
          </p>
        )}

        {/* AI Prompt preview toggle */}
        {scene.aiVideoPrompt && (
          <div>
            <button
              type="button"
              onClick={() => setShowPrompt((s) => !s)}
              className="flex items-center gap-1.5 text-[10px] font-bold text-white/35 hover:text-white/60 transition-colors mb-1.5"
              data-testid={`btn-prompt-toggle-${index}`}
            >
              {showPrompt ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              {showPrompt ? "Hide" : "Preview"} AI Video Prompt
            </button>
            {showPrompt && (
              <pre className="text-[10px] text-white/50 leading-relaxed whitespace-pre-wrap bg-white/[0.025] border border-white/[0.06] rounded-lg px-3 py-2.5 font-mono max-h-40 overflow-y-auto">
                {scene.aiVideoPrompt}
              </pre>
            )}
          </div>
        )}

        {/* Artist consistency note (when artist loaded, no consistency applied yet) */}
        {hasArtist && !hasConsistency && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/[0.06] border border-primary/20">
            <ShieldCheck className="h-3.5 w-3.5 text-primary shrink-0" />
            <p className="text-[10px] text-primary/70">
              {artistVault!.artist_name} artist consistency will be injected into the Runway prompt automatically.
            </p>
          </div>
        )}

        {/* ── Create Video Clip (InlineRunwayGenerator) ── */}
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] px-4 py-3">
          <InlineRunwayGenerator
            scene={scene}
            onUpdate={(patch) => onUpdateScene(scene.id, patch)}
            artistVault={artistVault}
            projectId={projectId}
            createAllTrigger={createAllTrigger}
          />
        </div>

        {/* ── Edit Clip (approve / mute / trim / replace) — shown after clip exists ── */}
        {hasClip && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onUpdateScene(scene.id, { approved: !scene.approved })}
                data-testid={`btn-approve-${index}`}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                  scene.approved
                    ? "border-primary/50 bg-primary/15 text-primary"
                    : "border-white/10 bg-white/[0.03] text-white/45 hover:text-primary hover:border-primary/30"
                }`}
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                {scene.approved ? "Approved ✓" : "Approve Clip"}
              </button>
              <button
                type="button"
                onClick={() => onPatchClip(scene.id, { muted: !edit.muted })}
                data-testid={`btn-mute-${index}`}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                  edit.muted
                    ? "border-red-500/40 bg-red-500/10 text-red-300"
                    : "border-white/10 bg-white/[0.03] text-white/45 hover:text-white/70"
                }`}
              >
                {edit.muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                {edit.muted ? "Muted" : "Mute"}
              </button>
            </div>

            <Collapsible title="Trim · Volume · Replace URL">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Trim start" hint={`${edit.trimStart.toFixed(1)}s`}>
                  <Slider value={[edit.trimStart]} min={0} max={10} step={0.5} onValueChange={([v]) => onPatchClip(scene.id, { trimStart: v ?? 0 })} />
                </Field>
                <Field label="Trim end" hint={`${edit.trimEnd.toFixed(1)}s`}>
                  <Slider value={[edit.trimEnd]} min={0} max={10} step={0.5} onValueChange={([v]) => onPatchClip(scene.id, { trimEnd: v ?? 0 })} />
                </Field>
                <Field label="Clip volume" hint={`${edit.volume}%`}>
                  <Slider value={[edit.volume]} min={0} max={100} step={5} onValueChange={([v]) => onPatchClip(scene.id, { volume: v ?? 100 })} />
                </Field>
                <Field label="Replace clip URL">
                  <div className="flex items-center gap-2">
                    <Link2 className="h-4 w-4 text-white/30 shrink-0" />
                    <Input
                      value={edit.replaceUrl ?? ""}
                      onChange={(e) => onPatchClip(scene.id, { replaceUrl: e.target.value || null })}
                      placeholder="https://…"
                      className="h-9 text-xs bg-white/[0.04] border-white/[0.1] text-white/80"
                      data-testid={`input-replace-${index}`}
                    />
                  </div>
                </Field>
              </div>
            </Collapsible>
          </div>
        )}
      </div>
    </div>
  );
}
