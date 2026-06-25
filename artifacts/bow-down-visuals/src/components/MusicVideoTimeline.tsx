import { useState, useCallback, useEffect, useRef } from "react";
import {
  Film, ArrowUp, ArrowDown, Trash2, Plus, Pencil,
  CheckCircle2, Circle, Save, Loader2, Clock, X, Check,
  Music2, Clapperboard, Eye, AlertCircle, RefreshCw, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SceneData } from "@/lib/scene-parser";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { FinalVideoExport } from "@/components/FinalVideoExport";
import { ClipSequencePlayer } from "@/components/ClipSequencePlayer";
import { ReferenceAudioPlayer } from "@/components/ReferenceAudioPlayer";
import { OutOfCredits } from "@/components/OutOfCredits";

/* ─── Helpers ─── */

function parseDuration(ts: string | undefined | null): string {
  if (!ts) return "";
  const m = ts.match(/(\d+):(\d+)\s*[-–—]\s*(\d+):(\d+)/);
  if (!m) return "";
  const start = parseInt(m[1]!) * 60 + parseInt(m[2]!);
  const end   = parseInt(m[3]!) * 60 + parseInt(m[4]!);
  const diff  = end - start;
  return diff > 0 ? `${diff}s` : "";
}

const SECTION_COLORS: Record<string, string> = {
  intro:  "bg-purple-500/20 text-purple-300 border-purple-500/30",
  verse:  "bg-blue-500/20  text-blue-300  border-blue-500/30",
  hook:   "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  chorus: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  bridge: "bg-cyan-500/20  text-cyan-300  border-cyan-500/30",
  outro:  "bg-rose-500/20  text-rose-300  border-rose-500/30",
  pre:    "bg-orange-500/20 text-orange-300 border-orange-500/30",
  break:  "bg-green-500/20 text-green-300 border-green-500/30",
};
function sectionColor(s: string): string {
  const l = s.toLowerCase();
  for (const key of Object.keys(SECTION_COLORS)) {
    if (l.includes(key)) return SECTION_COLORS[key]!;
  }
  return "bg-white/10 text-white/50 border-white/20";
}

function statusBadge(scene: SceneData, isPolling: boolean) {
  if (isPolling)                                            return { label: "Generating",    cls: "text-yellow-300 bg-yellow-500/10 border-yellow-500/25" };
  if (scene.approved && scene.generationStatus === "completed") return { label: "Approved",   cls: "text-primary bg-primary/15 border-primary/30" };
  if (scene.generationStatus === "completed")               return { label: "Completed",    cls: "text-green-300 bg-green-500/10 border-green-500/25" };
  if (scene.generationStatus === "failed")                  return { label: "Failed",       cls: "text-red-300 bg-red-500/10 border-red-500/25" };
  return                                                           { label: "Not Generated", cls: "text-white/35 bg-white/5 border-white/10" };
}

/* ─── Runway Clip Generator ─── */

const IS_DEV = import.meta.env.DEV;

interface RunwayClipProps {
  scene: SceneData;
  onUpdate: (patch: Partial<SceneData>) => void;
  isLocked: boolean;
  onGeneratingStart: () => void;
  onGeneratingEnd: () => void;
  projectId?: string | null;
}

function RunwayClipGenerator({ scene, onUpdate, isLocked, onGeneratingStart, onGeneratingEnd, projectId }: RunwayClipProps) {
  const { getAccessToken, refreshProfile } = useAuth();
  const { toast } = useToast();

  const [isPolling, setIsPolling]               = useState(false);
  const [taskId, setTaskId]                     = useState<string | null>(null);
  const [progress, setProgress]                 = useState<number | null>(null);
  const [error, setError]                       = useState<string | null>(null);
  const [showRegenConfirm, setShowRegenConfirm] = useState(false);
  const [urlError, setUrlError]                 = useState(false);
  const [outOfCredits, setOutOfCredits]         = useState(false);

  const onUpdateRef        = useRef(onUpdate);
  const promptUsedRef      = useRef<string>("");
  const onGeneratingEndRef = useRef(onGeneratingEnd);
  useEffect(() => { onUpdateRef.current = onUpdate; onGeneratingEndRef.current = onGeneratingEnd; });

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  function stopPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }
  useEffect(() => () => stopPolling(), []);

  async function autoSaveClip(clipUrl: string, jobId: string) {
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/generated-clips", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({
          projectId:   projectId ?? null,
          sceneId:     scene.id ?? null,
          title:       scene.section || scene.timestamp || "Scene Clip",
          prompt:      scene.aiVideoPrompt || null,
          finalPrompt: promptUsedRef.current || null,
          runwayJobId: jobId,
          videoUrl:    clipUrl,
          status:      "completed",
        }),
      });
      if (res.ok) {
        refreshProfile(); /* refresh credits so dashboard shows the deduction */
      } else {
        const body = await res.json().catch(() => ({})) as { creditMessage?: string };
        const creditMsg = body.creditMessage ?? "Clip generated but saving failed.";
        toast({ title: "Save failed", description: creditMsg, variant: "destructive" });
        refreshProfile();
      }
    } catch {
      /* best-effort */
    }
  }

  function startPolling(id: string) {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch(`/api/generate-runway-clip/${id}`, {
          headers: { Authorization: `Bearer ${token ?? ""}` },
        });
        const data = await res.json() as { status: string; url?: string; progress?: number; error?: string };
        if (IS_DEV) console.log("[Runway] poll:", data.status, data.progress ?? "");
        if (data.status === "succeeded" && data.url) {
          stopPolling();
          setIsPolling(false);
          onGeneratingEndRef.current();
          void autoSaveClip(data.url, id); /* save clip + refresh credits */
          onUpdateRef.current({
            demoClipUrl: data.url,
            provider: "Runway",
            generationStatus: "completed",
            promptUsed: promptUsedRef.current,
            generatedAt: new Date().toISOString(),
          });
          if (IS_DEV) console.log("[Runway] done:", data.url);
        } else if (data.status === "failed" || data.status === "cancelled") {
          stopPolling();
          setIsPolling(false);
          setError(data.error ?? "Runway returned a failure with no message");
          onUpdateRef.current({ generationStatus: "failed" });
          onGeneratingEndRef.current();
          if (IS_DEV) console.log("[Runway] failed:", data.error);
        } else {
          setProgress(typeof data.progress === "number" ? data.progress : null);
        }
      } catch (e) {
        stopPolling();
        setIsPolling(false);
        setError(e instanceof Error ? e.message : "Network error while polling Runway");
        onUpdateRef.current({ generationStatus: "failed" });
        onGeneratingEndRef.current();
      }
    }, 5000);
  }

  function buildPrompt(): string {
    if (scene.aiVideoPrompt.trim()) return scene.aiVideoPrompt.trim();
    const fallback = [scene.action, scene.location, scene.cameraMovement, scene.lighting, scene.mood]
      .filter(Boolean).join(", ");
    return fallback || "cinematic music video scene, dramatic lighting, luxury aesthetic";
  }

  async function doGenerate() {
    const promptText = buildPrompt();
    promptUsedRef.current = promptText;
    if (IS_DEV) console.log("[Runway] starting:", promptText.slice(0, 80));
    setIsPolling(true);
    setError(null);
    setProgress(null);
    setShowRegenConfirm(false);
    setUrlError(false);
    onGeneratingStart();
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/generate-runway-clip", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({ promptText, negativePrompt: scene.negativePrompt ?? "", ratio: "720:1280" }),
      });
      const data = await res.json() as { taskId?: string; error?: string };
      if (!res.ok || !data.taskId) throw new Error(data.error ?? `Runway API error (HTTP ${res.status})`);
      if (IS_DEV) console.log("[Runway] task:", data.taskId);
      setTaskId(data.taskId);
      startPolling(data.taskId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to start Runway generation";
      setIsPolling(false);
      if (msg === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        onGeneratingEndRef.current();
        return;
      }
      setError(msg);
      onUpdateRef.current({ generationStatus: "failed" });
      onGeneratingEndRef.current();
      if (IS_DEV) console.log("[Runway] error:", msg);
    }
  }

  function handleRemoveClip() {
    stopPolling();
    if (isPolling) onGeneratingEndRef.current();
    setIsPolling(false);
    setTaskId(null);
    setError(null);
    setProgress(null);
    setShowRegenConfirm(false);
    setUrlError(false);
    onUpdateRef.current({
      demoClipUrl: null,
      generationStatus: null,
      provider: null,
      promptUsed: null,
      generatedAt: null,
      approved: false,
    });
  }

  const hasClip   = !!scene.demoClipUrl && scene.demoClipUrl.startsWith("http");
  const hasPrompt = !!scene.aiVideoPrompt.trim();

  /* ─── Render ─── */
  return (
    <div className="mt-4 space-y-3 border-t border-white/[0.04] pt-4">

      {/* Status row */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[9px] font-black text-white/20 uppercase tracking-widest">Runway</span>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border flex items-center gap-1 ${
          isPolling                                                     ? "text-yellow-300 bg-yellow-500/10 border-yellow-500/25" :
          scene.approved && scene.generationStatus === "completed"     ? "text-primary bg-primary/15 border-primary/30" :
          scene.generationStatus === "completed"                        ? "text-green-300 bg-green-500/10 border-green-500/25" :
          scene.generationStatus === "failed"                           ? "text-red-300 bg-red-500/10 border-red-500/25" :
                                                                          "text-white/30 bg-white/5 border-white/10"
        }`}>
          {isPolling                                                     && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
          {scene.approved && scene.generationStatus === "completed"     && <CheckCircle2 className="h-2.5 w-2.5" />}
          {scene.generationStatus === "completed" && !scene.approved    && <Zap className="h-2.5 w-2.5" />}
          {isPolling ? "Generating" :
           scene.approved && scene.generationStatus === "completed" ? "Approved" :
           scene.generationStatus === "completed" ? "Completed" :
           scene.generationStatus === "failed" ? "Failed" :
           "Not Generated"}
        </span>
        {scene.generatedAt && !isPolling && (
          <span className="text-[9px] text-white/20">
            {new Date(scene.generatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
      </div>

      {/* Generating: spinner + progress */}
      {isPolling && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-primary/20 bg-primary/5">
          <Loader2 className="h-4 w-4 text-primary animate-spin shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-primary/80">Generating Runway clip…</p>
            <p className="text-[11px] text-white/30 mt-0.5">This takes 30–90 seconds</p>
            {progress !== null && (
              <div className="mt-2 w-full h-1 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full bg-primary rounded-full transition-all duration-1000" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
            )}
            {IS_DEV && taskId && (
              <p className="text-[9px] font-mono text-white/20 mt-1">DEV · taskId: {taskId}</p>
            )}
          </div>
        </div>
      )}

      {/* Error message */}
      {!isPolling && error && (
        <div className="flex gap-2 px-4 py-3 rounded-xl border border-red-500/30 bg-red-500/5">
          <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
          <p className="text-[11px] text-red-300/70 leading-relaxed break-words flex-1">{error}</p>
        </div>
      )}

      {/* Clip video player */}
      {hasClip && !isPolling && (
        <div className="space-y-1.5">
          {urlError ? (
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-yellow-500/25 bg-yellow-500/5">
              <AlertCircle className="h-4 w-4 text-yellow-400 shrink-0" />
              <div className="min-w-0">
                <p className="text-xs font-bold text-yellow-300">Clip link expired</p>
                <p className="text-[11px] text-yellow-300/60 mt-0.5">Click "Regenerate" below to create a new clip — it will be saved permanently.</p>
              </div>
            </div>
          ) : (
            <video
              key={scene.demoClipUrl!}
              src={scene.demoClipUrl!}
              controls
              autoPlay
              muted
              loop
              playsInline
              className="w-full rounded-xl border border-green-500/20"
              style={{ background: "#000" }}
              onError={() => setUrlError(true)}
            />
          )}
          {IS_DEV && (
            <p className="text-[9px] font-mono text-white/15 break-all px-0.5">
              DEV · {scene.demoClipUrl!.slice(0, 72)}…
            </p>
          )}
        </div>
      )}

      {/* Regenerate confirm inline */}
      {showRegenConfirm && !isPolling && (
        <div className="flex items-center gap-2 flex-wrap px-3 py-2.5 rounded-xl border border-yellow-500/25 bg-yellow-500/5">
          <span className="text-[11px] text-yellow-300/80 font-medium flex-1">
            This will use Runway API credits. Continue?
          </span>
          <button
            onClick={doGenerate}
            className="px-3 py-1 rounded-lg bg-primary/20 border border-primary/30 text-primary text-xs font-bold hover:bg-primary/30 transition-colors"
          >
            Yes, Regenerate
          </button>
          <button
            onClick={() => setShowRegenConfirm(false)}
            className="px-3 py-1 rounded-lg bg-white/5 border border-white/10 text-white/40 text-xs font-bold hover:bg-white/10 transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Action buttons */}
      {!isPolling && !showRegenConfirm && (
        <div className="flex flex-wrap gap-2">

          {/* Generate (no clip) */}
          {!hasClip && (
            <button
              onClick={doGenerate}
              disabled={isLocked}
              title={isLocked ? "Another clip is generating. Please wait." : undefined}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-primary/30 bg-primary/10 text-primary text-xs font-bold hover:border-primary/50 hover:bg-primary/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              data-testid="btn-generate-runway-clip"
            >
              <Zap className="h-3.5 w-3.5" />
              Generate Runway Clip
              {!hasPrompt && <span className="text-primary/50 font-normal">(using scene info)</span>}
            </button>
          )}

          {/* Regenerate (has clip) */}
          {hasClip && (
            <button
              onClick={() => setShowRegenConfirm(true)}
              disabled={isLocked}
              title={isLocked ? "Another clip is generating. Please wait." : undefined}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/10 bg-white/[0.03] text-white/50 text-xs font-bold hover:border-primary/30 hover:text-primary hover:bg-primary/10 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              data-testid="btn-regenerate-runway-clip"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Regenerate
            </button>
          )}

          {/* Approve / Unapprove */}
          {hasClip && (
            <button
              onClick={() => onUpdate({ approved: !scene.approved })}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-bold transition-all ${
                scene.approved
                  ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/5 hover:border-primary/20"
                  : "border-white/10 bg-white/[0.03] text-white/50 hover:border-primary/30 hover:text-primary hover:bg-primary/10"
              }`}
              data-testid="btn-approve-clip"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              {scene.approved ? "Approved ✓" : "Approve Clip"}
            </button>
          )}

          {/* Remove clip */}
          {hasClip && (
            <button
              onClick={handleRemoveClip}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/10 bg-white/[0.03] text-white/35 text-xs font-bold hover:border-red-500/30 hover:text-red-400 hover:bg-red-500/5 transition-all"
              data-testid="btn-remove-clip"
            >
              <X className="h-3.5 w-3.5" /> Remove Clip
            </button>
          )}
        </div>
      )}

      {/* Out of credits */}
      {outOfCredits && (
        <div className="mt-2">
          <OutOfCredits />
        </div>
      )}

      {/* Locked notice (shown under generate button) */}
      {isLocked && !isPolling && !hasClip && (
        <p className="text-[11px] text-white/25 flex items-center gap-1.5 pl-0.5">
          <Loader2 className="h-3 w-3 animate-spin" />
          Another clip is generating. Please wait.
        </p>
      )}

      {IS_DEV && !isPolling && (
        <p className="text-[9px] font-mono text-white/15 leading-relaxed">
          DEV · {hasPrompt ? `prompt: "${scene.aiVideoPrompt.slice(0, 50)}…"` : `fallback: "${buildPrompt().slice(0, 50)}…"`}
        </p>
      )}
    </div>
  );
}

/* ─── Timeline Scene Row ─── */
interface TimelineRowProps {
  scene: SceneData;
  index: number;
  isFirst: boolean;
  isLast: boolean;
  onUpdate: (patch: Partial<SceneData>) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  isLocked: boolean;
  isThisGenerating: boolean;
  onGeneratingStart: () => void;
  onGeneratingEnd: () => void;
  projectId?: string | null;
}

function TimelineRow({ scene, index, isFirst, isLast, onUpdate, onMoveUp, onMoveDown, onRemove, isLocked, isThisGenerating, onGeneratingStart, onGeneratingEnd, projectId }: TimelineRowProps) {
  const [editing, setEditing]           = useState(false);
  const [editedPrompt, setEditedPrompt] = useState(scene.aiVideoPrompt);
  const [copied, setCopied]             = useState(false);
  const duration = parseDuration(scene.timestamp);
  const status   = statusBadge(scene, isThisGenerating);

  function handleSaveEdit() {
    onUpdate({ aiVideoPrompt: editedPrompt });
    setEditing(false);
  }

  function handleCopyPrompt() {
    navigator.clipboard.writeText(scene.aiVideoPrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div
      className={`rounded-xl border overflow-hidden transition-all duration-200 ${
        scene.approved ? "border-primary/40 shadow-[0_0_20px_rgba(234,179,8,0.04)]" : "border-white/[0.07]"
      } bg-[#0a0a0a]`}
      data-testid={`timeline-scene-${index}`}
    >
      {/* ── Header ── */}
      <div className={`flex items-center gap-2 px-4 py-3 border-b border-white/[0.05] ${scene.approved ? "bg-primary/[0.03]" : "bg-white/[0.01]"}`}>
        <button
          onClick={() => onUpdate({ approved: !scene.approved })}
          className="shrink-0 transition-transform hover:scale-110"
          title={scene.approved ? "Remove approval" : "Approve scene"}
          data-testid={`timeline-approve-toggle-${index}`}
        >
          {scene.approved
            ? <CheckCircle2 className="h-5 w-5 text-primary" />
            : <Circle className="h-5 w-5 text-white/15 hover:text-white/40 transition-colors" />}
        </button>

        <span className="text-xs font-black text-white/25 tabular-nums w-5 shrink-0">
          {String(index + 1).padStart(2, "0")}
        </span>

        {scene.section && (
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${sectionColor(scene.section)}`}>
            {scene.section}
          </span>
        )}

        {scene.timestamp && (
          <span className="flex items-center gap-1 text-xs text-white/30 shrink-0">
            <Clock className="h-3 w-3" /> {scene.timestamp}
            {duration && <span className="text-white/20">· {duration}</span>}
          </span>
        )}

        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border hidden sm:inline-flex ${status.cls}`}>
          {status.label}
        </span>

        {scene.provider && scene.generationStatus === "completed" && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-green-500/30 bg-green-500/10 text-green-400 hidden sm:inline-flex items-center gap-1">
            <Zap className="h-2.5 w-2.5" /> {scene.provider}
          </span>
        )}

        <div className="ml-auto flex items-center gap-1">
          <button onClick={onMoveUp} disabled={isFirst}
            className="h-7 w-7 rounded-lg flex items-center justify-center text-white/20 hover:text-white/60 hover:bg-white/5 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
            title="Move Up" data-testid={`timeline-move-up-${index}`}>
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
          <button onClick={onMoveDown} disabled={isLast}
            className="h-7 w-7 rounded-lg flex items-center justify-center text-white/20 hover:text-white/60 hover:bg-white/5 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
            title="Move Down" data-testid={`timeline-move-down-${index}`}>
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
          <button onClick={onRemove}
            className="h-7 w-7 rounded-lg flex items-center justify-center text-white/20 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            title="Remove Scene" data-testid={`timeline-remove-${index}`}>
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* ── Lyric line ── */}
      {scene.lyricLine && (
        <div className="px-4 py-2 border-b border-white/[0.04]">
          <p className="text-xs italic text-white/30">"{scene.lyricLine}"</p>
        </div>
      )}

      {/* ── Main body ── */}
      <div className="p-4 space-y-4">

        {/* ── Scene metadata: Visual Description + Camera Direction ── */}
        {(scene.action || scene.location || scene.cameraMovement || scene.lighting) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pb-3 border-b border-white/[0.04]">
            {(scene.action || scene.location) && (
              <div className="space-y-1">
                <span className="text-[10px] font-black text-white/25 uppercase tracking-widest flex items-center gap-1.5">
                  <Eye className="h-3 w-3" /> Visual Description
                </span>
                <p className="text-xs text-white/50 leading-relaxed">
                  {[scene.action, scene.location].filter(Boolean).join(" · ")}
                </p>
              </div>
            )}
            {scene.cameraMovement && (
              <div className="space-y-1">
                <span className="text-[10px] font-black text-white/25 uppercase tracking-widest flex items-center gap-1.5">
                  <Film className="h-3 w-3" /> Camera Direction
                </span>
                <p className="text-xs text-white/50 leading-relaxed">{scene.cameraMovement}</p>
              </div>
            )}
            {scene.lighting && (
              <div className="space-y-1">
                <span className="text-[10px] font-black text-white/25 uppercase tracking-widest flex items-center gap-1.5">
                  <Music2 className="h-3 w-3" /> Lighting
                </span>
                <p className="text-xs text-white/50 leading-relaxed">{scene.lighting}</p>
              </div>
            )}
          </div>
        )}

        {/* ── AI Video Prompt ── */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black text-primary/50 uppercase tracking-widest">AI Video Prompt</span>
            <div className="flex items-center gap-1">
              <button
                onClick={handleCopyPrompt}
                className="flex items-center gap-1 text-[11px] text-white/25 hover:text-primary transition-colors px-1.5 py-0.5 rounded hover:bg-primary/10"
              >
                {copied ? <Check className="h-3 w-3 text-green-400" /> : <span>Copy</span>}
              </button>
              {!editing && (
                <button
                  onClick={() => { setEditedPrompt(scene.aiVideoPrompt); setEditing(true); }}
                  className="flex items-center gap-1 text-[11px] text-white/25 hover:text-primary transition-colors px-1.5 py-0.5 rounded hover:bg-primary/10"
                  data-testid={`timeline-edit-prompt-${index}`}
                >
                  <Pencil className="h-3 w-3" /> Edit
                </button>
              )}
            </div>
          </div>

          {editing ? (
            <div className="space-y-2">
              <textarea
                value={editedPrompt}
                onChange={(e) => setEditedPrompt(e.target.value)}
                rows={4}
                className="w-full bg-white/[0.04] border border-primary/30 rounded-lg px-3 py-2 text-sm text-white/80 leading-relaxed resize-none focus:outline-none focus:border-primary/60 transition-colors"
                placeholder="Describe the AI video prompt for this scene..."
                data-testid={`timeline-prompt-textarea-${index}`}
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={handleSaveEdit} className="gold-glow h-7 text-xs" data-testid={`timeline-save-prompt-${index}`}>
                  Save
                </Button>
                <Button size="sm" variant="outline" onClick={() => setEditing(false)}
                  className="border-white/10 bg-white/5 text-white/50 h-7 text-xs">
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-white/55 leading-relaxed bg-white/[0.02] rounded-lg px-3 py-2.5 border border-white/[0.05] min-h-[60px]">
              {scene.aiVideoPrompt || <span className="italic text-white/20">No prompt yet — click Edit to add one</span>}
            </p>
          )}
        </div>

        {/* ── Negative Prompt ── */}
        {scene.negativePrompt && (
          <p className="text-[11px] text-white/25 leading-relaxed bg-white/[0.02] rounded-lg px-3 py-2 border border-white/[0.04]">
            <span className="font-black text-white/20 uppercase tracking-wider text-[9px]">Negative: </span>
            {scene.negativePrompt}
          </p>
        )}

        {/* ── Runway Clip Generator (Generate / Regenerate / Approve / Remove) ── */}
        <RunwayClipGenerator
          scene={scene}
          onUpdate={onUpdate}
          isLocked={isLocked}
          onGeneratingStart={onGeneratingStart}
          onGeneratingEnd={onGeneratingEnd}
          projectId={projectId}
        />
      </div>
    </div>
  );
}

/* ─── Main Export ─── */

interface ExportRecord {
  final_video_url: string;
  export_status: string;
  export_created_at: string;
  clips_used: number;
  audio_used: boolean;
  timeline_order?: string[];
}

interface MusicVideoTimelineProps {
  scenes: SceneData[];
  onScenesChange: (scenes: SceneData[]) => void;
  audioUrl?: string | null;
  projectId?: string | null;
  onSaveSuccess?: () => void;
  existingExport?: ExportRecord | null;
  onExportComplete?: (record: ExportRecord) => void;
}

export function MusicVideoTimeline({
  scenes,
  onScenesChange,
  audioUrl,
  projectId,
  onSaveSuccess,
  existingExport,
  onExportComplete,
}: MusicVideoTimelineProps) {
  const { getAccessToken } = useAuth();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [activeGeneratingId, setActiveGeneratingId] = useState<string | null>(null);

  const approvedCount = scenes.filter((s) => s.approved).length;
  const clippedCount  = scenes.filter((s) => s.demoClipUrl).length;

  const handleUpdate = useCallback(
    async (id: string, patch: Partial<SceneData>) => {
      const updatedScenes = scenes.map((s) => (s.id === id ? { ...s, ...patch } : s));
      onScenesChange(updatedScenes);

      const shouldAutoSave =
        projectId &&
        (("demoClipUrl" in patch && patch.demoClipUrl) ||
         ("approved" in patch) ||
         ("generationStatus" in patch && patch.generationStatus === "completed"));

      if (shouldAutoSave) {
        try {
          const token = await getAccessToken();
          await fetch(`/api/projects/${projectId}`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token ?? ""}`,
            },
            body: JSON.stringify({ scenes: updatedScenes }),
          });
          if ("demoClipUrl" in patch && patch.demoClipUrl) {
            toast({ title: "Clip saved!", description: "Your Runway clip has been saved to this project." });
          }
        } catch {
          toast({ title: "Changes not saved", description: "Click Save Timeline to persist.", variant: "destructive" });
        }
      }
    },
    [scenes, onScenesChange, projectId, getAccessToken, toast]
  );

  function handleMoveUp(index: number) {
    if (index === 0) return;
    const next = [...scenes];
    [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
    onScenesChange(next);
  }

  function handleMoveDown(index: number) {
    if (index === scenes.length - 1) return;
    const next = [...scenes];
    [next[index + 1], next[index]] = [next[index]!, next[index + 1]!];
    onScenesChange(next);
  }

  function handleRemove(id: string) {
    onScenesChange(scenes.filter((s) => s.id !== id));
  }

  function handleAddScene() {
    const newScene: SceneData = {
      id: `scene-${Date.now()}`,
      sceneNumber: scenes.length + 1,
      timestamp: "", section: "", lyricLine: "", location: "",
      action: "", cameraMovement: "", lighting: "", mood: "",
      aiVideoPrompt: "", negativePrompt: "", approved: false, demoClipUrl: null,
      provider: null, generationStatus: null, promptUsed: null, generatedAt: null,
    };
    onScenesChange([...scenes, newScene]);
  }

  async function handleSaveTimeline() {
    setSaving(true);
    try {
      if (projectId) {
        const token = await getAccessToken();
        const res = await fetch(`/api/projects/${projectId}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token ?? ""}`,
          },
          body: JSON.stringify({ scenes }),
        });
        if (!res.ok) throw new Error("Save failed");
        toast({ title: "Timeline saved!", description: "Scenes, prompts, clips, and approvals updated." });
        onSaveSuccess?.();
      } else {
        toast({
          title: "Timeline updated",
          description: "Changes will be included when you save your project above.",
        });
      }
    } catch {
      toast({ title: "Save failed", description: "Could not save timeline.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  if (scenes.length === 0) return null;

  return (
    <div className="mt-12 space-y-6" data-testid="music-video-timeline">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-primary/20">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
            <Clapperboard className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-black text-white uppercase tracking-wider">Music Video Timeline</h2>
            <p className="text-xs text-white/30 mt-0.5">
              {scenes.length} scene{scenes.length !== 1 ? "s" : ""}
              {approvedCount > 0 && <> · <span className="text-primary">{approvedCount} approved</span></>}
              {clippedCount  > 0 && <> · <span className="text-green-400">{clippedCount} clip{clippedCount !== 1 ? "s" : ""} ready</span></>}
            </p>
          </div>
        </div>
        <Button
          onClick={handleSaveTimeline}
          disabled={saving}
          className="gold-glow shrink-0"
          size="sm"
          data-testid="btn-save-timeline"
        >
          {saving
            ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Saving...</>
            : <><Save className="h-4 w-4 mr-1.5" /> Save Timeline</>}
        </Button>
      </div>

      {/* ── Audio Player ── */}
      {audioUrl && <ReferenceAudioPlayer url={audioUrl} />}

      {/* ── Timeline Rows ── */}
      <div className="space-y-4">
        {scenes.map((scene, i) => (
          <TimelineRow
            key={scene.id}
            scene={scene}
            index={i}
            isFirst={i === 0}
            isLast={i === scenes.length - 1}
            onUpdate={(patch) => handleUpdate(scene.id, patch)}
            onMoveUp={() => handleMoveUp(i)}
            onMoveDown={() => handleMoveDown(i)}
            onRemove={() => handleRemove(scene.id)}
            isLocked={activeGeneratingId !== null && activeGeneratingId !== scene.id}
            isThisGenerating={activeGeneratingId === scene.id}
            onGeneratingStart={() => setActiveGeneratingId(scene.id)}
            onGeneratingEnd={() => setActiveGeneratingId(null)}
            projectId={projectId}
          />
        ))}
      </div>

      {/* ── Add New Scene ── */}
      <button
        onClick={handleAddScene}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-white/[0.1] text-white/30 hover:border-primary/30 hover:text-primary/60 hover:bg-primary/5 transition-all text-sm font-semibold"
        data-testid="btn-add-scene"
      >
        <Plus className="h-4 w-4" /> Add New Scene
      </button>

      {/* ── Final Video Preview ── */}
      <ClipSequencePlayer scenes={scenes} />

      {/* ── Final Video Export ── */}
      <FinalVideoExport
        scenes={scenes}
        projectId={projectId}
        audioUrl={audioUrl}
        existingExport={existingExport}
        onExportComplete={onExportComplete}
      />

      {/* ── Bottom Save ── */}
      <div className="flex justify-end pt-2">
        <Button
          onClick={handleSaveTimeline}
          disabled={saving}
          className="gold-glow"
          size="sm"
        >
          {saving
            ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Saving...</>
            : <><Save className="h-4 w-4 mr-1.5" /> Save Timeline</>}
        </Button>
      </div>
    </div>
  );
}
