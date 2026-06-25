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

      {/* Scene cards — 1 col mobile / 2 col tablet / 3 col desktop */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
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
  const [detailOpen, setDetailOpen] = useState(false);

  const hasClip        = sceneHasClip(scene);
  const edit           = getClipEdit(settings, scene.id);
  const isPreviewing   = previewSceneId === scene.id;
  const hasConsistency = scene.aiVideoPrompt.startsWith(CONSISTENCY_MARKER);

  return (
    <div
      className={`rounded-xl border overflow-hidden flex flex-col transition-colors ${
        isPreviewing
          ? "border-primary/50 bg-primary/[0.04] shadow-[0_0_18px_rgba(234,179,8,0.07)]"
          : "border-white/[0.08] bg-white/[0.025]"
      }`}
      data-testid={`clip-gen-card-${index}`}
    >
      {/* ── Compact header ── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06]">
        {/* Scene number badge */}
        <div className="h-6 w-6 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
          <span className="text-[10px] font-black text-primary">{index + 1}</span>
        </div>

        {/* Section + flag badges */}
        <div className="flex-1 min-w-0 flex items-center gap-1 flex-wrap">
          {scene.section && (
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border truncate max-w-[90px] ${sectionColor(scene.section)}`}>
              {scene.section}
            </span>
          )}
          {isEnhanced && (
            <span className="flex items-center gap-0.5 px-1 py-0.5 rounded-full bg-primary/[0.15] border border-primary/30 text-[8px] font-bold text-primary shrink-0">
              <Sparkles className="h-2 w-2" /> Enhanced
            </span>
          )}
          {hasConsistency && (
            <span className="flex items-center gap-0.5 px-1 py-0.5 rounded-full bg-green-500/[0.12] border border-green-500/25 text-[8px] font-bold text-green-400 shrink-0">
              <ShieldCheck className="h-2 w-2" /> Consistent
            </span>
          )}
        </div>

        {/* Status badge */}
        {hasClip ? (
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full border border-green-500/30 bg-green-500/10 text-green-400 shrink-0">
            Ready
          </span>
        ) : (
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full border border-white/10 text-white/25 shrink-0">
            No clip
          </span>
        )}
      </div>

      {/* ── Video thumbnail area — fixed heights so cards stay compact ── */}
      <div className="relative h-[200px] sm:h-[220px] xl:h-[190px] bg-black shrink-0">
        {hasClip ? (
          <video
            src={scene.demoClipUrl ?? undefined}
            muted
            preload="metadata"
            playsInline
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2">
            <Film className="h-8 w-8 text-white/10" />
          </div>
        )}

        {/* Preview overlay — click to load into master player */}
        {hasClip && onPreview && (
          <button
            type="button"
            onClick={() => onPreview(scene.id)}
            data-testid={`btn-preview-clip-${index}`}
            className="absolute inset-0 flex items-center justify-center bg-transparent hover:bg-black/40 transition-colors group"
            aria-label="Preview in master player"
          >
            {isPreviewing ? (
              <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary text-black text-[9px] font-black shadow-lg">
                <Eye className="h-2.5 w-2.5" /> In Master Player
              </div>
            ) : (
              <div className="h-10 w-10 rounded-full bg-black/60 border border-white/20 flex items-center justify-center backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity">
                <Eye className="h-4 w-4 text-white" />
              </div>
            )}
          </button>
        )}

        {/* No-clip generate hint */}
        {!hasClip && (
          <button
            type="button"
            onClick={() => setDetailOpen(true)}
            className="absolute inset-0 flex items-center justify-center"
          >
            <span className="text-[10px] text-white/20 hover:text-primary font-bold transition-colors">
              + Generate clip
            </span>
          </button>
        )}
      </div>

      {/* ── Lyric line ── */}
      {(scene.lyricLine || scene.action) && (
        <p className="px-3 py-1.5 text-[10px] text-white/40 italic truncate border-b border-white/[0.04]">
          "{scene.lyricLine || scene.action}"
        </p>
      )}

      {/* ── Quick action row ── */}
      <div className="px-3 py-2 flex items-center gap-1.5 flex-wrap">
        {/* Approve */}
        {hasClip && (
          <button
            type="button"
            onClick={() => onUpdateScene(scene.id, { approved: !scene.approved })}
            data-testid={`btn-approve-${index}`}
            className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold border transition-colors shrink-0 ${
              scene.approved
                ? "border-primary/50 bg-primary/15 text-primary"
                : "border-white/10 bg-white/[0.03] text-white/40 hover:text-primary hover:border-primary/30"
            }`}
          >
            <CheckCircle2 className="h-3 w-3" />
            {scene.approved ? "Approved" : "Approve"}
          </button>
        )}

        {/* Spacer + icon buttons on the right */}
        <div className="flex items-center gap-1 ml-auto">
          <IconBtn title="Move up" disabled={index === 0} onClick={() => onMove(index, -1)} testId={`btn-up-${index}`}>
            <ArrowUp className="h-3 w-3" />
          </IconBtn>
          <IconBtn title="Move down" disabled={index === totalScenes - 1} onClick={() => onMove(index, 1)} testId={`btn-down-${index}`}>
            <ArrowDown className="h-3 w-3" />
          </IconBtn>
          <IconBtn title="Duplicate" onClick={() => onDuplicate(index)} testId={`btn-dup-${index}`}>
            <Copy className="h-3 w-3" />
          </IconBtn>
          <IconBtn title="Remove" danger onClick={() => onRemove(scene.id)} testId={`btn-rem-${index}`}>
            <Trash2 className="h-3 w-3" />
          </IconBtn>
          {/* Toggle detail/generate panel */}
          <button
            type="button"
            onClick={() => setDetailOpen((o) => !o)}
            className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold border transition-colors ${
              detailOpen
                ? "border-primary/30 bg-primary/10 text-primary"
                : "border-white/10 bg-white/[0.03] text-white/40 hover:text-white/70"
            }`}
          >
            {hasClip ? (detailOpen ? "▲ Edit" : "▼ Edit") : (detailOpen ? "▲ Gen" : "▼ Gen")}
          </button>
        </div>
      </div>

      {/* ── Expandable detail panel ── */}
      {detailOpen && (
        <div className="border-t border-white/[0.06] px-3 py-3 space-y-3">
          {/* AI Prompt */}
          {scene.aiVideoPrompt && (
            <details className="group">
              <summary className="text-[10px] text-white/35 hover:text-white/60 cursor-pointer font-bold list-none flex items-center gap-1.5">
                <Eye className="h-3 w-3" /> AI Video Prompt
              </summary>
              <pre className="mt-1.5 text-[10px] text-white/50 leading-relaxed whitespace-pre-wrap bg-white/[0.025] border border-white/[0.06] rounded-lg px-3 py-2 font-mono max-h-28 overflow-y-auto">
                {scene.aiVideoPrompt}
              </pre>
            </details>
          )}

          {/* Artist consistency note */}
          {hasArtist && !hasConsistency && (
            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-primary/[0.06] border border-primary/20">
              <ShieldCheck className="h-3 w-3 text-primary shrink-0" />
              <p className="text-[9px] text-primary/70 leading-snug">
                {artistVault!.artist_name} consistency auto-injected into Runway prompt.
              </p>
            </div>
          )}

          {/* InlineRunwayGenerator — create / regenerate clip */}
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] px-3 py-2.5">
            <InlineRunwayGenerator
              scene={scene}
              onUpdate={(patch) => onUpdateScene(scene.id, patch)}
              artistVault={artistVault}
              projectId={projectId}
              createAllTrigger={createAllTrigger}
            />
          </div>

          {/* Clip editing — approve / mute / trim / replace */}
          {hasClip && (
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onPatchClip(scene.id, { muted: !edit.muted })}
                  data-testid={`btn-mute-${index}`}
                  className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold border transition-colors ${
                    edit.muted
                      ? "border-red-500/40 bg-red-500/10 text-red-300"
                      : "border-white/10 bg-white/[0.03] text-white/40 hover:text-white/70"
                  }`}
                >
                  {edit.muted ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
                  {edit.muted ? "Muted" : "Mute clip"}
                </button>
              </div>

              <Collapsible title="Trim · Volume · Replace URL">
                <div className="space-y-3">
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
                        className="h-8 text-xs bg-white/[0.04] border-white/[0.1] text-white/80"
                        data-testid={`input-replace-${index}`}
                      />
                    </div>
                  </Field>
                </div>
              </Collapsible>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
