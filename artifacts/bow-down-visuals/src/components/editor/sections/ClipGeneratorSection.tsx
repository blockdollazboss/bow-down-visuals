import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Eye, EyeOff, CheckCircle2, Volume2, VolumeX, Video, ArrowUp, ArrowDown,
  Copy, Trash2, Link2, ShieldCheck, Film, Loader2, Sparkles, AlertCircle,
  GripVertical, ChevronsUp, ChevronsDown, Undo2, Plus, Scissors, Upload,
  ChevronDown, ChevronUp, Check, X, Clock, Zap,
} from "lucide-react";
import {
  DndContext, PointerSensor, useSensor, useSensors, closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, rectSortingStrategy, useSortable, arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { InlineRunwayGenerator } from "@/components/SceneStudio";
import { Collapsible, Field } from "@/components/editor/controls";
import { IconBtn } from "@/components/editor/sections/shared";
import type { SceneData } from "@/lib/scene-parser";
import { getPreviousClipUrl } from "@/lib/scene-chaining";
import type { ArtistVault } from "@/components/ArtistVaultSelector";
import { sceneHasClip, getClipEdit, type EditorSettings } from "@/lib/editor-settings";
import { computeSceneTimings, withSceneDurationSet, formatClock, type SceneTiming } from "@/lib/scene-timing";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";

const CONSISTENCY_MARKER = "[CHARACTER CONSISTENCY:";
const CLIP_BUCKET = "clips";

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

type SaveState = "idle" | "saving" | "saved" | "error";
type InsertMode = "end" | "before" | "after" | "playhead";
type UploadStatus = "idle" | "uploading" | "done" | "error";

const DEFAULT_NEGATIVE_PROMPT = "distorted face, deformed hands, extra fingers, extra limbs, blurry, low quality, watermark, text overlay, cartoon, anime, oversaturated, harsh shadows on face";

/* Quality defaults applied to every new scene for better AI output */
function makeBlankScene(sceneCount: number): SceneData {
  return {
    id: crypto.randomUUID(),
    sceneNumber: sceneCount + 1,
    timestamp: "",
    section: "New Clip",
    lyricLine: "",
    location: "",
    action: "",
    cameraMovement: "",
    lighting: "",
    mood: "",
    aiVideoPrompt: "New blank clip — edit prompt and generate",
    negativePrompt: DEFAULT_NEGATIVE_PROMPT,
    approved: false,
    demoClipUrl: null,
    thumbnailUrl: null,
    clipId: null,
    runwayJobId: null,
    provider: null,
    generationStatus: null,
    promptUsed: null,
    generatedAt: null,
  };
}

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
  saveState?: SaveState;
  playheadTimeSec?: number;
  totalDurationSec?: number;
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
  saveState = "idle",
  playheadTimeSec = 0,
  totalDurationSec,
}: ClipGeneratorSectionProps) {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* "Create All" runs scenes sequentially so each later scene can chain from
     the previous scene's freshly-generated last frame. `createAllQueue` holds
     the remaining scene ids to generate (queue[0] is the active one); an
     effect watches `scenes` for the active scene to finish (succeed or fail)
     and then advances to the next id. */
  const [createAllQueue, setCreateAllQueue] = useState<string[]>([]);
  const [createAllTotal, setCreateAllTotal] = useState(0);
  const [createAllTrigger, setCreateAllTrigger] = useState(0);
  const activeCreateAllId = createAllQueue[0] ?? null;
  const [enhancing, setEnhancing] = useState(false);
  const [enhanceProgress, setEnhanceProgress] = useState<{ done: number; total: number } | null>(null);
  const [enhancedIds, setEnhancedIds] = useState<Set<string>>(new Set());
  const [enhanceStatus, setEnhanceStatus] = useState<EnhanceStatus | null>(null);

  const [undoSnapshot, setUndoSnapshot] = useState<SceneData[] | null>(null);
  const [reorderStatus, setReorderStatus] = useState<"saved" | "failed" | null>(null);

  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [insertMode, setInsertMode] = useState<InsertMode>("end");
  const [showInsertMenu, setShowInsertMenu] = useState(false);
  const [showMoreClipControls, setShowMoreClipControls] = useState(false);

  const [uploadStatus, setUploadStatus] = useState<UploadStatus>("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [splitStatus, setSplitStatus] = useState<"idle" | "done" | "error">("idle");
  const [splitError, setSplitError] = useState<string | null>(null);

  const [timelineSaveMsg, setTimelineSaveMsg] = useState<string | null>(null);
  const [timelineSaveMsgType, setTimelineSaveMsgType] = useState<"saved" | "error">("saved");
  const mutatedRef = useRef(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  useEffect(() => {
    if (undoSnapshot === null) return;
    if (saveState === "saved") {
      setReorderStatus("saved");
      const t = setTimeout(() => setReorderStatus(null), 3000);
      return () => clearTimeout(t);
    }
    if (saveState === "error") setReorderStatus("failed");
    return;
  }, [saveState, undoSnapshot]);

  useEffect(() => {
    if (!mutatedRef.current) return;
    if (saveState === "saved") {
      setTimelineSaveMsg("Timeline saved");
      setTimelineSaveMsgType("saved");
      mutatedRef.current = false;
      const t = setTimeout(() => setTimelineSaveMsg(null), 4000);
      return () => clearTimeout(t);
    }
    if (saveState === "error") {
      setTimelineSaveMsg("Timeline save failed — check your connection");
      setTimelineSaveMsgType("error");
    }
    return;
  }, [saveState]);

  useEffect(() => {
    if (splitStatus === "done") {
      const t = setTimeout(() => setSplitStatus("idle"), 3000);
      return () => clearTimeout(t);
    }
    return;
  }, [splitStatus]);

  useEffect(() => {
    if (uploadStatus === "done") {
      const t = setTimeout(() => setUploadStatus("idle"), 3000);
      return () => clearTimeout(t);
    }
    return;
  }, [uploadStatus]);

  /* Advance the "Create All" queue once the active scene finishes (success
     or failure) so the next scene starts and can chain from a real clip. */
  useEffect(() => {
    if (createAllQueue.length === 0) return;
    const activeId = createAllQueue[0]!;
    const activeScene = scenes.find((s) => s.id === activeId);
    const isDone = !activeScene || sceneHasClip(activeScene) || activeScene.generationStatus === "failed";
    if (!isDone) return;
    const rest = createAllQueue.slice(1);
    setCreateAllQueue(rest);
    if (rest.length > 0) setCreateAllTrigger((n) => n + 1);
    else setCreateAllTotal(0);
  }, [scenes, createAllQueue]);

  function startCreateAll() {
    const ids = scenesWithoutClip.map((s) => s.id);
    if (ids.length === 0) return;
    setCreateAllQueue(ids);
    setCreateAllTotal(ids.length);
    setCreateAllTrigger((n) => n + 1);
  }

  useEffect(() => {
    if (showInsertMenu) {
      const close = () => setShowInsertMenu(false);
      document.addEventListener("click", close, { once: true });
      return () => document.removeEventListener("click", close);
    }
    return;
  }, [showInsertMenu]);

  function markMutated() {
    mutatedRef.current = true;
    setTimelineSaveMsg(null);
  }

  function reorder(newOrder: SceneData[]) {
    setUndoSnapshot([...scenes]);
    setScenes(newOrder);
  }

  function undoReorder() {
    if (!undoSnapshot) return;
    setScenes(undoSnapshot);
    setUndoSnapshot(null);
    setReorderStatus(null);
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = scenes.findIndex((s) => s.id === active.id);
    const newIdx = scenes.findIndex((s) => s.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    reorder(arrayMove(scenes, oldIdx, newIdx));
  }

  const addClipAt = useCallback((mode: InsertMode) => {
    const newScene = makeBlankScene(scenes.length);
    markMutated();
    if (mode === "end" || !selectedSceneId) {
      setScenes([...scenes, newScene]);
      setSelectedSceneId(newScene.id);
      return;
    }
    if (mode === "before") {
      const idx = scenes.findIndex((s) => s.id === selectedSceneId);
      const next = [...scenes];
      next.splice(idx < 0 ? scenes.length : idx, 0, newScene);
      setScenes(next);
      setSelectedSceneId(newScene.id);
      return;
    }
    if (mode === "after") {
      const idx = scenes.findIndex((s) => s.id === selectedSceneId);
      const next = [...scenes];
      next.splice(idx < 0 ? scenes.length : idx + 1, 0, newScene);
      setScenes(next);
      setSelectedSceneId(newScene.id);
      return;
    }
    if (mode === "playhead" && totalDurationSec && totalDurationSec > 0) {
      const sceneDuration = totalDurationSec / scenes.length;
      const activeIdx = Math.min(
        Math.floor(playheadTimeSec / sceneDuration),
        scenes.length - 1,
      );
      const next = [...scenes];
      next.splice(activeIdx + 1, 0, newScene);
      setScenes(next);
      setSelectedSceneId(newScene.id);
      return;
    }
    setScenes([...scenes, newScene]);
    setSelectedSceneId(newScene.id);
  }, [scenes, selectedSceneId, insertMode, playheadTimeSec, totalDurationSec, setScenes]);

  function splitAtPlayhead() {
    if (!totalDurationSec || totalDurationSec <= 0 || scenes.length === 0) {
      setSplitError("Cannot split — no audio duration available");
      setSplitStatus("error");
      return;
    }
    const sceneDuration = totalDurationSec / scenes.length;
    const activeIdx = Math.min(
      Math.floor(playheadTimeSec / sceneDuration),
      scenes.length - 1,
    );
    const scene = scenes[activeIdx];
    if (!scene) return;

    const sceneStart = activeIdx * sceneDuration;
    const splitWithin = Math.max(0.1, Math.min(playheadTimeSec - sceneStart, sceneDuration - 0.1));

    if (splitWithin <= 0 || splitWithin >= sceneDuration) {
      setSplitError("Playhead is at a scene boundary — move it into the scene first");
      setSplitStatus("error");
      return;
    }

    const currentEdit = getClipEdit(settings, scene.id);
    const secondId = `${scene.id}-split-${Date.now()}`;
    const secondScene: SceneData = { ...scene, id: secondId, approved: false };

    const trimEndFirst = currentEdit.trimEnd + (sceneDuration - splitWithin);
    const trimStartSecond = currentEdit.trimStart + splitWithin;

    const next = [...scenes];
    next.splice(activeIdx + 1, 0, secondScene);
    setScenes(next);

    const newClips = { ...settings.clips };
    newClips[scene.id] = { ...currentEdit, trimEnd: Number(trimEndFirst.toFixed(2)) };
    newClips[secondId] = { ...currentEdit, trimStart: Number(trimStartSecond.toFixed(2)), trimEnd: 0 };
    setSettings({ ...settings, clips: newClips });

    markMutated();
    setSplitStatus("done");
    setSplitError(null);
  }

  async function handleUploadClip(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (fileInputRef.current) fileInputRef.current.value = "";

    setUploadStatus("uploading");
    setUploadError(null);

    try {
      const sb = supabase;
      if (!sb) throw new Error("Storage client not initialised — check Supabase env vars");

      const ext = file.name.split(".").pop() ?? "mp4";
      const folder = user?.id ?? "anon";
      const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

      const { error: upErr } = await sb.storage
        .from(CLIP_BUCKET)
        .upload(path, file, { upsert: true });

      if (upErr) throw new Error(upErr.message);

      const { data } = sb.storage.from(CLIP_BUCKET).getPublicUrl(path);
      const url = data.publicUrl;

      const newScene: SceneData = {
        ...makeBlankScene(scenes.length),
        demoClipUrl: url,
        generationStatus: "completed",
        section: file.name.replace(/\.[^.]+$/, "").slice(0, 40),
      };

      const insertIdx = selectedSceneId
        ? scenes.findIndex((s) => s.id === selectedSceneId) + 1
        : scenes.length;
      const next = [...scenes];
      next.splice(insertIdx, 0, newScene);
      setScenes(next);
      setSelectedSceneId(newScene.id);
      markMutated();
      setUploadStatus("done");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setUploadError(msg);
      setUploadStatus("error");
    }
  }

  function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= scenes.length) return;
    const next = [...scenes];
    [next[index], next[target]] = [next[target]!, next[index]!];
    reorder(next);
  }

  function moveToStart(index: number) {
    if (index === 0) return;
    const next = [...scenes];
    const [item] = next.splice(index, 1);
    next.unshift(item!);
    reorder(next);
  }

  function moveToEnd(index: number) {
    if (index === scenes.length - 1) return;
    const next = [...scenes];
    const [item] = next.splice(index, 1);
    next.push(item!);
    reorder(next);
  }

  function duplicate(index: number) {
    const orig = scenes[index]!;
    const copy: SceneData = { ...orig, id: `${orig.id}-copy-${Date.now()}`, approved: false };
    const next = [...scenes];
    next.splice(index + 1, 0, copy);
    setScenes(next);
    markMutated();
  }

  function remove(id: string) {
    setScenes(scenes.filter((s) => s.id !== id));
    if (selectedSceneId === id) setSelectedSceneId(null);
    markMutated();
  }

  function patchClip(sceneId: string, patch: Partial<ReturnType<typeof getClipEdit>>) {
    const current = getClipEdit(settings, sceneId);
    setSettings({ ...settings, clips: { ...settings.clips, [sceneId]: { ...current, ...patch } } });
    markMutated();
  }

  function updateScene(id: string, patch: Partial<SceneData>) {
    setScenes(scenes.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    markMutated();
  }

  /* ── Precise scene timing: computed start/end for every scene (same math
   *  the master player + export use), and a duration setter that materializes
   *  current timings into explicit timestamps so nothing else shifts. ── */
  const sceneTimings = useMemo(
    () => computeSceneTimings(scenes, totalDurationSec ?? null),
    [scenes, totalDurationSec],
  );

  function setSceneDuration(sceneId: string, durSec: number) {
    if (!isFinite(durSec) || durSec <= 0) return;
    setScenes(withSceneDurationSet(scenes, totalDurationSec ?? null, sceneId, durSec));
    markMutated();
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

    const updatedScenes = scenes.map((s) => ({ ...s }));
    const newEnhancedIds = new Set(enhancedIds);
    let failed = 0;

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i]!;
      const cameraHint = ENHANCE_CAMERAS[i % ENHANCE_CAMERAS.length]!;
      try {
        const res = await fetch("/api/improve-prompt", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
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
      setEnhanceStatus({ type: "success", message: `All ${scenes.length} scene prompts enhanced with cinematic variety. No credits used.` });
    } else if (failed < scenes.length) {
      setEnhanceStatus({ type: "warning", message: `${scenes.length - failed} of ${scenes.length} prompts enhanced. ${failed} scene${failed !== 1 ? "s" : ""} failed — try again.` });
    } else {
      setEnhanceStatus({ type: "error", message: "Enhancement failed. Check your connection and try again." });
    }
  }

  const INSERT_MODE_LABELS: Record<InsertMode, string> = {
    end: "Add at end",
    before: "Insert before selected",
    after: "Insert after selected",
    playhead: "Insert at playhead",
  };

  const scenesWithoutClip = scenes.filter((s) => !sceneHasClip(s));
  const hasArtist = !!artistVault;

  const canSplit = totalDurationSec && totalDurationSec > 0 && scenes.length > 0;

  const activeSceneIdx = canSplit
    ? Math.min(Math.floor(playheadTimeSec / (totalDurationSec! / scenes.length)), scenes.length - 1)
    : -1;

  if (scenes.length === 0) {
    return (
      <div className="space-y-4">
        <div className="text-center py-8">
          <Film className="h-10 w-10 text-white/15 mx-auto mb-3" />
          <p className="text-sm font-bold text-white/40">No scenes loaded yet</p>
          <p className="text-[11px] text-white/45 mt-1">Rebuild scenes from your saved video plan above, or add a blank clip.</p>
          <button
            type="button"
            onClick={() => { markMutated(); setScenes([makeBlankScene(0)]); }}
            className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-primary/30 bg-primary/10 text-primary text-xs font-bold hover:bg-primary/20 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" /> Add First Clip
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">

      {/* ── Global save / undo status bar ── */}
      {(timelineSaveMsg || reorderStatus || undoSnapshot) && (
        <div className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border text-xs font-semibold ${
          timelineSaveMsgType === "error" || reorderStatus === "failed"
            ? "border-red-500/30 bg-red-500/[0.06] text-red-400"
            : timelineSaveMsg || reorderStatus === "saved"
            ? "border-green-500/30 bg-green-500/[0.06] text-green-400"
            : "border-white/[0.07] bg-white/[0.02] text-white/50"
        }`}>
          {timelineSaveMsg ? (
            <>
              {timelineSaveMsgType === "saved"
                ? <CheckCircle2 className="h-4 w-4 shrink-0" />
                : <AlertCircle className="h-4 w-4 shrink-0" />}
              {timelineSaveMsg}
            </>
          ) : reorderStatus === "saved" ? (
            <><CheckCircle2 className="h-4 w-4 shrink-0" /> Order saved</>
          ) : reorderStatus === "failed" ? (
            <><AlertCircle className="h-4 w-4 shrink-0" /> Order save failed — click Undo to restore</>
          ) : (
            <><span className="h-4 w-4 shrink-0 inline-flex items-center justify-center"><span className="h-1.5 w-1.5 rounded-full bg-white/40 animate-pulse" /></span> Saving…</>
          )}
          {undoSnapshot && (
            <button type="button" onClick={undoReorder}
              className="ml-auto flex items-center gap-1.5 px-3 py-1 rounded-lg border border-white/10 bg-white/[0.04] text-white/60 hover:text-white hover:border-white/20 transition-colors text-xs font-bold">
              <Undo2 className="h-3.5 w-3.5" /> Undo Reorder
            </button>
          )}
        </div>
      )}

      {/* ── Split status ── */}
      {splitStatus !== "idle" && (
        <div className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-xs font-semibold ${
          splitStatus === "done"
            ? "border-green-500/30 bg-green-500/[0.06] text-green-400"
            : "border-red-500/30 bg-red-500/[0.06] text-red-400"
        }`}>
          {splitStatus === "done"
            ? <><Check className="h-4 w-4 shrink-0" /> Clip split — two scenes created with trim points set</>
            : <><AlertCircle className="h-4 w-4 shrink-0" /> {splitError}</>}
        </div>
      )}

      {/* ── Upload status ── */}
      {uploadStatus !== "idle" && (
        <div className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-xs font-semibold ${
          uploadStatus === "done"
            ? "border-green-500/30 bg-green-500/[0.06] text-green-400"
            : uploadStatus === "error"
            ? "border-red-500/30 bg-red-500/[0.06] text-red-400"
            : "border-primary/25 bg-primary/[0.05] text-primary/80"
        }`}>
          {uploadStatus === "uploading" && <Loader2 className="h-4 w-4 shrink-0 animate-spin" />}
          {uploadStatus === "done" && <CheckCircle2 className="h-4 w-4 shrink-0" />}
          {uploadStatus === "error" && <AlertCircle className="h-4 w-4 shrink-0" />}
          {uploadStatus === "uploading" && "Uploading clip…"}
          {uploadStatus === "done" && "Clip uploaded and added to timeline"}
          {uploadStatus === "error" && (
            <span>
              Upload failed: {uploadError ?? "unknown error"}{" "}
              <span className="text-white/40 font-normal">— paste the URL into "Replace clip URL" instead</span>
            </span>
          )}
        </div>
      )}

      {/* ── Enhance Scene Prompts ── */}
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
              <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Enhancing {enhanceProgress ? `${enhanceProgress.done}/${enhanceProgress.total}` : "…"}</>
            ) : (
              <><Sparkles className="h-3.5 w-3.5" /> Enhance Scene Prompts</>
            )}
          </Button>
        </div>
        {enhancing && enhanceProgress && (
          <div className="h-1 w-full rounded-full bg-white/[0.07] overflow-hidden">
            <div className="h-full bg-primary/70 transition-all duration-300 rounded-full"
              style={{ width: `${(enhanceProgress.done / enhanceProgress.total) * 100}%` }} />
          </div>
        )}
        {enhanceStatus && (
          <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-semibold ${
            enhanceStatus.type === "success" ? "border-green-500/25 bg-green-500/[0.07] text-green-400"
              : enhanceStatus.type === "warning" ? "border-yellow-500/25 bg-yellow-500/[0.07] text-yellow-400"
              : "border-red-500/25 bg-red-500/[0.07] text-red-400"
          }`}>
            {enhanceStatus.type === "success" ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <AlertCircle className="h-3.5 w-3.5 shrink-0" />}
            {enhanceStatus.message}
          </div>
        )}
      </div>

      {/* ── Timeline editing toolbar ── */}
      <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-black text-white/40 uppercase tracking-widest">Timeline Controls</p>
          <button
            type="button"
            onClick={() => setShowMoreClipControls((v) => !v)}
            className="flex items-center gap-1 text-[10px] font-bold text-white/35 hover:text-white/60 transition-colors"
            data-testid="btn-more-clip-options"
          >
            {showMoreClipControls ? "Hide options" : "More options"}
            {showMoreClipControls ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
        </div>

        {/* Add Clip row */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Add Clip dropdown */}
          <div className="relative">
            <div className="flex items-stretch rounded-lg border border-white/15 overflow-hidden">
              <button
                type="button"
                onClick={() => addClipAt(insertMode)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white/[0.04] text-white/60 hover:text-white hover:bg-white/[0.08] transition-colors text-xs font-bold"
                title={INSERT_MODE_LABELS[insertMode]}
              >
                <Plus className="h-3.5 w-3.5" />
                Add Clip
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setShowInsertMenu((v) => !v); }}
                className="flex items-center px-2 border-l border-white/10 bg-white/[0.04] text-white/40 hover:text-white hover:bg-white/[0.08] transition-colors"
                title="Choose insert position"
              >
                <ChevronDown className="h-3 w-3" />
              </button>
            </div>
            {showInsertMenu && (
              <div
                onClick={(e) => e.stopPropagation()}
                className="absolute top-full mt-1 left-0 z-50 min-w-[200px] rounded-xl border border-white/10 bg-zinc-900 shadow-xl shadow-black/40 py-1 text-xs"
              >
                {(["end", "before", "after", "playhead"] as InsertMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => {
                      setInsertMode(mode);
                      setShowInsertMenu(false);
                      addClipAt(mode);
                    }}
                    className={`w-full flex items-center gap-2 px-3 py-2 hover:bg-white/[0.06] transition-colors text-left ${
                      insertMode === mode ? "text-primary" : "text-white/60"
                    }`}
                  >
                    {insertMode === mode && <Check className="h-3 w-3 shrink-0" />}
                    {insertMode !== mode && <span className="w-3" />}
                    {INSERT_MODE_LABELS[mode]}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Upload Clip — always visible (was buried under "More options") */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadStatus === "uploading"}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/15 bg-white/[0.04] text-white/60 hover:text-white hover:bg-white/[0.08] transition-colors text-xs font-bold disabled:opacity-50"
            title="Upload your own video file"
          >
            {uploadStatus === "uploading" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            Upload Video
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={handleUploadClip}
          />

          {/* Create All — runs sequentially so each scene can chain from the one before it */}
          {(scenesWithoutClip.length > 0 || createAllQueue.length > 0) && (
            <Button
              size="sm"
              onClick={startCreateAll}
              disabled={createAllQueue.length > 0}
              className="gap-2 bg-primary/15 border border-primary/40 text-primary hover:bg-primary/25 font-bold text-xs h-8 disabled:opacity-70"
              variant="outline"
              data-testid="btn-create-all-clips"
            >
              {createAllQueue.length > 0 ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span data-testid="text-create-all-progress">
                    Generating {createAllTotal - createAllQueue.length + 1} of {createAllTotal}…
                  </span>
                </>
              ) : (
                <>
                  <Video className="h-3.5 w-3.5" />
                  Create All ({scenesWithoutClip.length})
                </>
              )}
            </Button>
          )}
        </div>

        {showMoreClipControls && (
          <div className="space-y-3 pt-1 border-t border-white/[0.12]">
            <div className="flex items-center gap-2 flex-wrap">
              {/* Upload Clip */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadStatus === "uploading"}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/15 bg-white/[0.04] text-white/60 hover:text-white hover:bg-white/[0.08] transition-colors text-xs font-bold disabled:opacity-50"
                title="Upload a local video file"
              >
                {uploadStatus === "uploading" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                Upload Clip
              </button>

              {/* Split at playhead */}
              <button
                type="button"
                onClick={splitAtPlayhead}
                disabled={!canSplit}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/15 bg-white/[0.04] text-white/60 hover:text-white hover:bg-white/[0.08] transition-colors text-xs font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                title={canSplit ? `Split scene ${activeSceneIdx + 1} at playhead (${playheadTimeSec.toFixed(1)}s)` : "Load audio first to enable split"}
              >
                <Scissors className="h-3.5 w-3.5" />
                Split at ▶
              </button>
            </div>

            {/* Selected scene indicator */}
            {selectedSceneId && (() => {
              const selIdx = scenes.findIndex((s) => s.id === selectedSceneId);
              const selScene = scenes[selIdx];
              if (!selScene) return null;
              return (
                <div className="flex items-center gap-2 text-[10px] text-white/40">
                  <div className="h-1 w-1 rounded-full bg-primary/60" />
                  <span>
                    Selected: <span className="text-white/60 font-semibold">Scene {selIdx + 1} — {selScene.section || "New Clip"}</span>
                    {" "}— inserts will go <span className="text-primary/80 font-semibold">{INSERT_MODE_LABELS[insertMode]}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelectedSceneId(null)}
                    className="ml-auto text-white/50 hover:text-white/60 transition-colors"
                    title="Clear selection"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              );
            })()}

            {/* Playhead / split info */}
            {canSplit && (
              <div className="flex items-center gap-2 text-[10px] text-white/50">
                <Clock className="h-3 w-3 shrink-0" />
                <span>
                  Playhead: <span className="text-white/50">{playheadTimeSec.toFixed(2)}s</span>
                  {activeSceneIdx >= 0 && (
                    <> · Active scene: <span className="text-white/50">Scene {activeSceneIdx + 1}</span></>
                  )}
                </span>
              </div>
            )}

            {/* Debug status (collapsed) */}
            <details className="group">
              <summary className="text-[9px] font-bold text-white/20 uppercase tracking-widest cursor-pointer list-none hover:text-white/40 transition-colors">
                ▸ Debug
              </summary>
              <div className="pt-1.5 flex flex-wrap gap-x-4 gap-y-0.5">
                {([
                  ["grid cols",    "1 / 2 / 3"],
                  ["clip count",   String(scenes.length)],
                  ["no clip",      String(scenes.filter((s) => !sceneHasClip(s)).length)],
                  ["selected",     selectedSceneId ? `Scene ${scenes.findIndex((s) => s.id === selectedSceneId) + 1}` : "none"],
                  ["drag reorder", "yes ✓"],
                ] as [string, string][]).map(([k, v]) => (
                  <span key={k} className="flex items-center gap-1">
                    <span className="text-[8px] font-mono text-white/20">{k}</span>
                    <span className={`text-[8px] font-bold ${v.includes("✓") ? "text-green-400/50" : v === "none" ? "text-white/20" : "text-[#C9A84C]/50"}`}>{v}</span>
                  </span>
                ))}
              </div>
            </details>
          </div>
        )}
      </div>

      {/* ── Scene count ── */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-xs font-black text-white/60 uppercase tracking-widest">
          {scenes.length} Scene{scenes.length !== 1 ? "s" : ""}
          {scenesWithoutClip.length > 0 && (
            <span className="ml-1.5 text-white/50 font-normal normal-case tracking-normal">
              · {scenesWithoutClip.length} without a clip
            </span>
          )}
        </p>
        {selectedSceneId && (
          <p className="text-[10px] text-white/50">Click a card to change selection</p>
        )}
      </div>

      {/* ── Scene cards grid ── */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={scenes.map((s) => s.id)} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {scenes.map((scene, i) => (
              <SortableSceneCard key={scene.id} id={scene.id}>
                {(dragHandleProps, isDragging) => (
                  <SceneClipCard
                    scene={scene}
                    index={i}
                    totalScenes={scenes.length}
                    hasArtist={hasArtist}
                    artistVault={artistVault}
                    projectId={projectId}
                    settings={settings}
                    isSelected={selectedSceneId === scene.id}
                    onSelect={() => setSelectedSceneId((prev) => prev === scene.id ? null : scene.id)}
                    onUpdateScene={updateScene}
                    onPatchClip={patchClip}
                    timing={sceneTimings[i]}
                    onSetDuration={(d) => setSceneDuration(scene.id, d)}
                    onMove={move}
                    onMoveToStart={moveToStart}
                    onMoveToEnd={moveToEnd}
                    onDuplicate={duplicate}
                    onRemove={remove}
                    onPreview={onPreview}
                    previewSceneId={previewSceneId}
                    createAllTrigger={scene.id === activeCreateAllId ? createAllTrigger : 0}
                    isEnhanced={enhancedIds.has(scene.id)}
                    dragHandleProps={dragHandleProps}
                    isDragging={isDragging}
                    previousClipUrl={getPreviousClipUrl(scenes, i)}
                  />
                )}
              </SortableSceneCard>
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

/* ── Precise duration input — keyboard accessible, commits on blur/Enter.
 *  Local text state while editing so typing never fights reformatting. ── */
function DurationInput({
  index,
  seconds,
  onCommit,
}: {
  index: number;
  seconds: number;
  onCommit: (durSec: number) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? String(Math.round(seconds * 10) / 10);

  function commit() {
    if (text === null) return;
    const v = parseFloat(text);
    if (isFinite(v) && v > 0) onCommit(v);
    setText(null);
  }

  return (
    <Input
      id={`scene-duration-${index}`}
      data-testid={`input-duration-${index}`}
      type="number"
      min={0.1}
      step={0.1}
      value={shown}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setText(null);
      }}
      className="h-8 text-xs font-mono bg-white/[0.04] border-white/[0.1] text-white/80 focus:border-primary/50"
      aria-label={`Scene ${index + 1} duration in seconds`}
    />
  );
}

/* ── Sortable wrapper ────────────────────────────────────────── */function SortableSceneCard({
  id,
  children,
}: {
  id: string;
  children: (dragHandleProps: React.HTMLAttributes<HTMLElement>, isDragging: boolean) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 50 : undefined, opacity: isDragging ? 0.85 : 1 }}
    >
      {children({ ...attributes, ...listeners }, isDragging)}
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
  isSelected?: boolean;
  onSelect: () => void;
  onUpdateScene: (id: string, patch: Partial<SceneData>) => void;
  onPatchClip: (sceneId: string, patch: Partial<ReturnType<typeof getClipEdit>>) => void;
  /** Computed timeline placement (same math the master player + export use). */
  timing?: SceneTiming;
  /** Set this scene's duration in seconds (precise, 0.1s). Later scenes shift. */
  onSetDuration?: (durSec: number) => void;
  onMove: (index: number, dir: -1 | 1) => void;
  onMoveToStart: (index: number) => void;
  onMoveToEnd: (index: number) => void;
  onDuplicate: (index: number) => void;
  onRemove: (id: string) => void;
  onPreview?: (sceneId: string) => void;
  previewSceneId?: string | null;
  createAllTrigger: number;
  isEnhanced?: boolean;
  dragHandleProps?: React.HTMLAttributes<HTMLElement>;
  isDragging?: boolean;
  previousClipUrl?: string | null;
}

function SceneClipCard({
  scene,
  index,
  totalScenes,
  hasArtist,
  artistVault,
  projectId,
  settings,
  isSelected,
  onSelect,
  onUpdateScene,
  onPatchClip,
  onMove,
  onMoveToStart,
  onMoveToEnd,
  onDuplicate,
  onRemove,
  onPreview,
  previewSceneId,
  createAllTrigger,
  isEnhanced,
  dragHandleProps,
  isDragging,
  previousClipUrl,
  timing,
  onSetDuration,
}: SceneClipCardProps) {
  const [detailOpen, setDetailOpen] = useState(false);

  const hasClip        = sceneHasClip(scene);
  const edit           = getClipEdit(settings, scene.id);
  const isPreviewing   = previewSceneId === scene.id;
  const hasConsistency = (scene.aiVideoPrompt ?? "").startsWith(CONSISTENCY_MARKER);

  return (
    <div
      className={`rounded-xl border overflow-hidden flex flex-col transition-all ${
        isDragging
          ? "border-primary/60 bg-primary/[0.08] shadow-xl shadow-primary/20"
          : isSelected
          ? "border-primary/70 bg-primary/[0.06] shadow-[0_0_18px_rgba(234,179,8,0.1)] ring-1 ring-primary/30"
          : isPreviewing
          ? "border-primary/50 bg-primary/[0.04] shadow-[0_0_18px_rgba(234,179,8,0.07)]"
          : "border-white/[0.08] bg-white/[0.025]"
      }`}
      data-testid={`clip-gen-card-${index}`}
    >
      {/* ── Header — click to select ── */}
      <div
        className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.12] cursor-pointer hover:bg-white/[0.02] transition-colors"
        onClick={onSelect}
        title={isSelected ? "Click to deselect" : "Click to select for insert positioning"}
      >
        {dragHandleProps && (
          <div
            {...dragHandleProps}
            onClick={(e) => e.stopPropagation()}
            className="shrink-0 cursor-grab active:cursor-grabbing text-white/20 hover:text-white/50 transition-colors touch-none"
            title="Drag to reorder"
          >
            <GripVertical className="h-3.5 w-3.5" />
          </div>
        )}
        <div className="h-6 w-6 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
          <span className="text-[10px] font-black text-primary">{index + 1}</span>
        </div>

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
          {isSelected && (
            <span className="flex items-center gap-0.5 px-1 py-0.5 rounded-full bg-primary/20 border border-primary/40 text-[8px] font-black text-primary shrink-0">
              ✓ Selected
            </span>
          )}
        </div>

        {hasClip ? (
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full border border-green-500/30 bg-green-500/10 text-green-400 shrink-0">Ready</span>
        ) : (
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full border border-white/10 text-white/45 shrink-0">No clip</span>
        )}
      </div>

      {/* ── Thumbnail ── */}
      <div className="relative h-[110px] bg-black shrink-0">
        {hasClip ? (
          <video src={scene.demoClipUrl ?? undefined} muted preload="metadata" playsInline className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2">
            <Film className="h-8 w-8 text-white/10" />
          </div>
        )}
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
        {!hasClip && (
          <button type="button" onClick={() => setDetailOpen(true)} className="absolute inset-0 flex items-center justify-center">
            <span className="text-[10px] text-white/20 hover:text-primary font-bold transition-colors">+ Generate clip</span>
          </button>
        )}
      </div>

      {/* ── Quick action row ── */}
      <div className="px-2 py-1.5 flex items-center gap-1 flex-wrap">
        {timing && (
          <span
            className="flex items-center gap-1 text-[9px] font-mono text-white/35 shrink-0 mr-1"
            title="Where this scene sits on the song timeline (start → end)"
            data-testid={`timing-readout-${index}`}
          >
            <Clock className="h-3 w-3 text-white/25" />
            {formatClock(timing.startSec)}–{formatClock(timing.endSec)}
          </span>
        )}
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

        <div className="flex items-center gap-0.5 ml-auto">
          <IconBtn title="Move to start" disabled={index === 0} onClick={() => onMoveToStart(index)} testId={`btn-start-${index}`}>
            <ChevronsUp className="h-3 w-3" />
          </IconBtn>
          <IconBtn title="Move up" disabled={index === 0} onClick={() => onMove(index, -1)} testId={`btn-up-${index}`}>
            <ArrowUp className="h-3 w-3" />
          </IconBtn>
          <IconBtn title="Move down" disabled={index === totalScenes - 1} onClick={() => onMove(index, 1)} testId={`btn-down-${index}`}>
            <ArrowDown className="h-3 w-3" />
          </IconBtn>
          <IconBtn title="Move to end" disabled={index === totalScenes - 1} onClick={() => onMoveToEnd(index)} testId={`btn-end-${index}`}>
            <ChevronsDown className="h-3 w-3" />
          </IconBtn>
          <IconBtn title="Duplicate clip" onClick={() => onDuplicate(index)} testId={`btn-dup-${index}`}>
            <Copy className="h-3 w-3" />
          </IconBtn>
          <IconBtn title="Ripple delete (removes clip and closes gap)" danger onClick={() => onRemove(scene.id)} testId={`btn-rem-${index}`}>
            <Trash2 className="h-3 w-3" />
          </IconBtn>
          <button
            type="button"
            onClick={() => setDetailOpen((o) => !o)}
            className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold border transition-colors ${
              detailOpen
                ? "border-primary/30 bg-primary/10 text-primary"
                : "border-white/10 bg-white/[0.03] text-white/40 hover:text-white/70"
            }`}
          >
            {detailOpen ? "▲ Details" : "▼ Details"}
          </button>
        </div>
      </div>

      {/* ── Expandable detail / edit panel ── */}
      {detailOpen && (
        <div className="border-t border-white/[0.12] px-3 py-3 space-y-3">
          {/* Lyric / action line */}
          {(scene.lyricLine || scene.action) && (
            <p className="text-[10px] text-white/40 italic leading-snug">
              "{scene.lyricLine || scene.action}"
            </p>
          )}

          {/* ── Timing — precise scene placement on the song timeline ── */}
          {timing && onSetDuration && (
            <div className="rounded-xl border border-white/[0.12] bg-white/[0.015] px-3 py-2.5">
              <p className="text-[10px] font-bold text-white/50 mb-2 flex items-center gap-1.5">
                <Clock className="h-3 w-3" /> Timing
              </p>
              <div className="flex items-end gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-[9px] text-white/35 font-bold mb-1">Starts at</p>
                  <p className="text-xs font-mono text-white/70 h-8 flex items-center" data-testid={`timing-start-${index}`}>
                    {formatClock(timing.startSec)}
                  </p>
                </div>
                <div className="flex-1 min-w-0">
                  <label htmlFor={`scene-duration-${index}`} className="text-[9px] text-white/35 font-bold mb-1 block">
                    Duration (sec)
                  </label>
                  <DurationInput index={index} seconds={timing.durationSec} onCommit={onSetDuration} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[9px] text-white/35 font-bold mb-1">Ends at</p>
                  <p className="text-xs font-mono text-white/70 h-8 flex items-center" data-testid={`timing-end-${index}`}>
                    {formatClock(timing.endSec)}
                  </p>
                </div>
              </div>
              <p className="text-[9px] text-white/25 mt-2 leading-snug">
                Type an exact duration — later scenes shift automatically (back-to-back).
                Same timing the master player and export use.
              </p>
            </div>
          )}

          {/* AI Prompt */}
          {scene.aiVideoPrompt && (
            <details className="group">
              <summary className="text-[10px] text-white/35 hover:text-white/60 cursor-pointer font-bold list-none flex items-center gap-1.5">
                <Eye className="h-3 w-3" /> AI Video Prompt
              </summary>
              <pre className="mt-1.5 text-[10px] text-white/50 leading-relaxed whitespace-pre-wrap bg-white/[0.025] border border-white/[0.12] rounded-lg px-3 py-2 font-mono max-h-28 overflow-y-auto">
                {scene.aiVideoPrompt}
              </pre>
            </details>
          )}

          {hasArtist && !hasConsistency && (
            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-primary/[0.06] border border-primary/20">
              <ShieldCheck className="h-3 w-3 text-primary shrink-0" />
              <p className="text-[9px] text-primary/70 leading-snug">
                {artistVault!.artist_name} consistency auto-injected into Runway prompt.
              </p>
            </div>
          )}

          {/* Generate / Regenerate */}
          <div className="rounded-xl border border-white/[0.12] bg-white/[0.015] px-3 py-2.5">
            <InlineRunwayGenerator
              scene={scene}
              onUpdate={(patch) => onUpdateScene(scene.id, patch)}
              artistVault={artistVault}
              projectId={projectId}
              createAllTrigger={createAllTrigger}
              previousClipUrl={previousClipUrl}
            />
          </div>

          {/* Clip editing controls */}
          {hasClip && (
            <div className="space-y-2.5">
              {/* Quick toggles */}
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

              {/* Trim · Volume · Fade · Replace */}
              <Collapsible title="Trim · Volume · Fade · Replace URL">
                <div className="space-y-3">
                  <Field label="Trim start" hint={`${edit.trimStart.toFixed(1)}s`}>
                    <Slider value={[edit.trimStart]} min={0} max={15} step={0.5}
                      onValueChange={([v]) => onPatchClip(scene.id, { trimStart: v ?? 0 })} />
                  </Field>
                  <Field label="Trim end" hint={`${edit.trimEnd.toFixed(1)}s`}>
                    <Slider value={[edit.trimEnd]} min={0} max={15} step={0.5}
                      onValueChange={([v]) => onPatchClip(scene.id, { trimEnd: v ?? 0 })} />
                  </Field>
                  <Field label="Clip volume" hint={`${edit.volume}%`}>
                    <Slider value={[edit.volume]} min={0} max={100} step={5}
                      onValueChange={([v]) => onPatchClip(scene.id, { volume: v ?? 100 })} />
                  </Field>
                  <Field label="Fade in" hint={`${edit.fadeIn.toFixed(1)}s`}>
                    <Slider value={[edit.fadeIn]} min={0} max={5} step={0.1}
                      onValueChange={([v]) => onPatchClip(scene.id, { fadeIn: v ?? 0 })} />
                  </Field>
                  <Field label="Fade out" hint={`${edit.fadeOut.toFixed(1)}s`}>
                    <Slider value={[edit.fadeOut]} min={0} max={5} step={0.1}
                      onValueChange={([v]) => onPatchClip(scene.id, { fadeOut: v ?? 0 })} />
                  </Field>
                  <Field label="Replace clip URL">
                    <div className="flex items-center gap-2">
                      <Link2 className="h-4 w-4 text-white/50 shrink-0" />
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
