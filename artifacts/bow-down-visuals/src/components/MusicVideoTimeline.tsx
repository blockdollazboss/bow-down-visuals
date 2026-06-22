import { useState, useCallback, useEffect, useRef } from "react";
import {
  Film, ArrowUp, ArrowDown, Trash2, Plus, Pencil, Play,
  CheckCircle2, Circle, Save, Loader2, Clock, X, Check,
  Music2, Clapperboard, Eye, AlertCircle, RefreshCw, Zap,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SceneData } from "@/lib/scene-parser";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

/* ─── Helpers ─── */

function parseDuration(ts: string): string {
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

function statusBadge(scene: SceneData) {
  if (scene.approved)        return { label: "Approved",   cls: "text-primary bg-primary/15 border-primary/30" };
  if (scene.demoClipUrl)     return { label: "Clip Ready", cls: "text-green-300 bg-green-500/10 border-green-500/25" };
  if (scene.aiVideoPrompt)   return { label: "Ready",      cls: "text-green-300 bg-green-500/10 border-green-500/25" };
  return                            { label: "Pending",    cls: "text-white/35 bg-white/5 border-white/10" };
}

/* ─── Old Demo Clip Placeholder (fallback) ─── */

function DemoClipInline({ onClose }: { onClose: () => void }) {
  return (
    <div className="mt-3 rounded-xl overflow-hidden border border-primary/20 bg-black">
      <div className="flex items-center justify-between px-3 py-2 bg-primary/10 border-b border-primary/15">
        <span className="text-[10px] font-black text-primary uppercase tracking-widest flex items-center gap-1.5">
          <Film className="h-3 w-3" /> Demo Clip Preview
        </span>
        <button onClick={onClose} className="text-white/30 hover:text-white transition-colors">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="relative aspect-video bg-gradient-to-br from-[#1a1209] via-[#0d0d0d] to-[#120a00] flex flex-col items-center justify-center gap-3 overflow-hidden">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="absolute rounded-full bg-primary/5 animate-pulse"
            style={{ width: `${90 + i * 45}px`, height: `${90 + i * 45}px`, top: `${15 + i * 9}%`, left: `${10 + i * 13}%`, animationDelay: `${i * 0.4}s`, animationDuration: `${2 + i * 0.5}s` }} />
        ))}
        <div className="relative z-10 flex flex-col items-center gap-2">
          <div className="h-14 w-14 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center animate-pulse">
            <Play className="h-6 w-6 text-primary ml-1" />
          </div>
          <p className="text-white/40 text-xs text-center max-w-[200px] leading-relaxed">
            AI video generation coming soon.<br />Paste your prompt into Runway, Sora, or Kling.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ─── Runway Clip Generator ─── */

type RunwayState = "idle" | "confirm" | "starting" | "polling" | "done" | "error";

interface RunwayClipProps {
  scene: SceneData;
  onUpdate: (patch: Partial<SceneData>) => void;
}

function RunwayClipGenerator({ scene, onUpdate }: RunwayClipProps) {
  const { getAccessToken } = useAuth();

  const [state, setState]       = useState<RunwayState>(() => scene.demoClipUrl ? "done" : "idle");
  const [taskId, setTaskId]     = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError]       = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(scene.demoClipUrl);

  const onUpdateRef = useRef(onUpdate);
  useEffect(() => { onUpdateRef.current = onUpdate; });

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
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
        const data = await res.json() as {
          status: string; url?: string; progress?: number; error?: string;
        };
        if (data.status === "succeeded" && data.url) {
          stopPolling();
          setVideoUrl(data.url);
          onUpdateRef.current({ demoClipUrl: data.url });
          setState("done");
        } else if (data.status === "failed" || data.status === "cancelled") {
          stopPolling();
          setError(data.error ?? "Runway returned a failure with no message");
          setState("error");
        } else {
          setProgress(typeof data.progress === "number" ? data.progress : null);
        }
      } catch (e) {
        stopPolling();
        setError(e instanceof Error ? e.message : "Network error while polling Runway");
        setState("error");
      }
    }, 5000);
  }

  async function handleGenerate() {
    if (!scene.aiVideoPrompt) return;
    setState("starting");
    setError(null);
    setProgress(null);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/generate-runway-clip", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token ?? ""}`,
        },
        body: JSON.stringify({
          promptText: scene.aiVideoPrompt,
          negativePrompt: scene.negativePrompt ?? "",
        }),
      });
      const data = await res.json() as { taskId?: string; error?: string };
      if (!res.ok || !data.taskId) {
        throw new Error(data.error ?? `Runway API error (HTTP ${res.status})`);
      }
      setTaskId(data.taskId);
      setState("polling");
      startPolling(data.taskId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start Runway generation");
      setState("error");
    }
  }

  /* ── Video ready ── */
  if (state === "done" && videoUrl) {
    return (
      <div className="mt-4 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-black text-green-400/70 uppercase tracking-widest flex items-center gap-1.5">
            <Zap className="h-3 w-3" /> Runway Clip Ready
          </span>
          <button
            onClick={() => { setVideoUrl(null); setTaskId(null); setProgress(null); setError(null); setState("idle"); }}
            className="text-[10px] text-white/20 hover:text-white/50 flex items-center gap-1 transition-colors"
          >
            <RefreshCw className="h-2.5 w-2.5" /> Regenerate
          </button>
        </div>
        <video
          key={videoUrl}
          src={videoUrl}
          controls
          autoPlay
          loop
          className="w-full rounded-xl border border-green-500/20"
          style={{ background: "#000" }}
        />
      </div>
    );
  }

  /* ── Generating ── */
  if (state === "starting" || state === "polling") {
    return (
      <div className="mt-4 flex items-center gap-3 px-4 py-3 rounded-xl border border-primary/20 bg-primary/5">
        <Loader2 className="h-4 w-4 text-primary animate-spin shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-primary/80">Generating Runway clip...</p>
          <p className="text-[11px] text-white/30 mt-0.5">
            {state === "starting" ? "Starting task…" : "Processing (30–90 seconds)…"}
          </p>
          {progress !== null && (
            <div className="mt-2 w-full h-1 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-1000"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ── Error (show exact Runway error) ── */
  if (state === "error") {
    return (
      <div className="mt-4 space-y-2">
        <div className="flex gap-2 px-4 py-3 rounded-xl border border-red-500/30 bg-red-500/5">
          <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-red-400">Runway Error</p>
            <p className="text-[11px] text-red-300/70 mt-1 leading-relaxed break-words">{error}</p>
          </div>
        </div>
        <button
          onClick={() => { setError(null); setState("idle"); }}
          className="flex items-center gap-1 text-[11px] text-white/30 hover:text-white/60 transition-colors"
        >
          <RefreshCw className="h-2.5 w-2.5" /> Try again
        </button>
      </div>
    );
  }

  /* ── Confirm warning ── */
  if (state === "confirm") {
    return (
      <div className="mt-4 rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-3 space-y-3">
        <div className="flex gap-2">
          <TriangleAlert className="h-4 w-4 text-yellow-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-bold text-yellow-300">Runway video generation may use paid API credits.</p>
            <p className="text-[11px] text-white/40 mt-1">Generate one test clip first to verify your settings.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={handleGenerate} className="gold-glow h-7 text-xs">
            <Zap className="h-3 w-3 mr-1" /> Yes, Generate
          </Button>
          <Button size="sm" variant="outline" onClick={() => setState("idle")}
            className="border-white/10 bg-white/5 text-white/50 h-7 text-xs">
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  /* ── Idle: Generate Runway Clip button ── */
  return (
    <div className="mt-4">
      <button
        onClick={() => setState("confirm")}
        disabled={!scene.aiVideoPrompt}
        className="flex items-center gap-2 px-3 py-2 rounded-lg border border-primary/20 bg-primary/5 text-primary/70 text-xs font-bold hover:border-primary/40 hover:bg-primary/10 hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors group w-full justify-center"
        title={scene.aiVideoPrompt ? "Generate a real Runway video clip" : "Add a prompt above first"}
      >
        <Zap className="h-3.5 w-3.5 group-hover:text-primary transition-colors" />
        Generate Runway Clip
      </button>
    </div>
  );
}

/* ─── Audio Player ─── */
function AudioPlayer({ url }: { url: string }) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
      <div className="flex items-center gap-2 mb-3">
        <Music2 className="h-4 w-4 text-primary/60" />
        <span className="text-xs font-black text-white/50 uppercase tracking-widest">Reference Audio</span>
      </div>
      <audio controls src={url} className="w-full h-10" style={{ colorScheme: "dark" }} />
    </div>
  );
}

/* ─── Final Video Preview ─── */
function FinalVideoPreview() {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-[#080808] overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-white/[0.05] bg-white/[0.02]">
        <Eye className="h-4 w-4 text-primary/60" />
        <span className="text-xs font-black text-white/70 uppercase tracking-widest">Final Video Preview</span>
      </div>
      <div className="relative aspect-video flex flex-col items-center justify-center gap-4 bg-gradient-to-br from-[#0f0a00] via-[#080808] to-[#000]">
        <div className="absolute inset-0 opacity-[0.03]"
          style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)", backgroundSize: "40px 40px" }} />
        <div className="relative z-10 flex flex-col items-center gap-4">
          <div className="h-20 w-20 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Clapperboard className="h-8 w-8 text-primary/40" />
          </div>
          <div className="text-center space-y-1">
            <p className="text-white/60 font-semibold text-sm">This is a demo timeline preview.</p>
            <p className="text-white/25 text-xs">Real video rendering coming soon.</p>
          </div>
          <div className="flex items-center gap-2 px-4 py-2 rounded-full border border-primary/20 bg-primary/5">
            <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
            <span className="text-xs font-bold text-primary/60 uppercase tracking-wider">Timeline Preview Mode</span>
          </div>
        </div>
      </div>
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
}

function TimelineRow({ scene, index, isFirst, isLast, onUpdate, onMoveUp, onMoveDown, onRemove }: TimelineRowProps) {
  const [editing, setEditing]         = useState(false);
  const [editedPrompt, setEditedPrompt] = useState(scene.aiVideoPrompt);
  const [showDemo, setShowDemo]       = useState(false);
  const [copied, setCopied]           = useState(false);
  const duration = parseDuration(scene.timestamp);
  const status   = statusBadge(scene);

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

      {/* ── Main body: demo clip (placeholder) + prompt ── */}
      <div className="flex flex-col sm:flex-row gap-0 sm:gap-0">
        {/* Demo clip column — old placeholder fallback */}
        <div className="sm:w-44 shrink-0 p-3 sm:border-r border-white/[0.05]">
          <button
            onClick={() => setShowDemo((v) => !v)}
            className="w-full aspect-video bg-gradient-to-br from-[#180f00] to-[#0a0900] rounded-lg border border-primary/10 flex flex-col items-center justify-center gap-1.5 hover:border-primary/25 transition-colors group cursor-pointer"
            data-testid={`timeline-demo-btn-${index}`}
          >
            <div className="h-8 w-8 rounded-full bg-primary/10 border border-primary/15 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
              <Play className="h-3.5 w-3.5 text-primary/40 ml-0.5" />
            </div>
            <span className="text-[9px] text-white/20 group-hover:text-white/35 transition-colors">Demo Clip</span>
          </button>
          {showDemo && <DemoClipInline onClose={() => setShowDemo(false)} />}
        </div>

        {/* Prompt column */}
        <div className="flex-1 p-4 space-y-3">
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
            <p className="text-sm text-white/50 leading-relaxed bg-white/[0.02] rounded-lg px-3 py-2 border border-white/[0.04] min-h-[60px]">
              {scene.aiVideoPrompt || <span className="italic text-white/20">No prompt yet — click Edit to add one</span>}
            </p>
          )}

          {/* Negative prompt */}
          {scene.negativePrompt && (
            <p className="text-[11px] text-white/20 leading-relaxed">
              <span className="font-bold text-white/15">Negative: </span>{scene.negativePrompt}
            </p>
          )}

          {/* Actions row */}
          <div className="flex items-center gap-2 flex-wrap pt-1">
            <button
              onClick={() => onUpdate({ approved: !scene.approved })}
              className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg border transition-colors ${
                scene.approved
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-white/10 bg-white/5 text-white/35 hover:border-primary/30 hover:text-primary/60"
              }`}
              data-testid={`timeline-approve-btn-${index}`}
            >
              {scene.approved
                ? <><CheckCircle2 className="h-3.5 w-3.5" /> Approved</>
                : <><Circle className="h-3.5 w-3.5" /> Approve Scene</>}
            </button>
          </div>

          {/* ── Generate Runway Clip (new real generation) ── */}
          <RunwayClipGenerator scene={scene} onUpdate={onUpdate} />
        </div>
      </div>
    </div>
  );
}

/* ─── Main Export ─── */

interface MusicVideoTimelineProps {
  scenes: SceneData[];
  onScenesChange: (scenes: SceneData[]) => void;
  audioUrl?: string | null;
  projectId?: string | null;
  onSaveSuccess?: () => void;
}

export function MusicVideoTimeline({
  scenes,
  onScenesChange,
  audioUrl,
  projectId,
  onSaveSuccess,
}: MusicVideoTimelineProps) {
  const { getAccessToken } = useAuth();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  const approvedCount = scenes.filter((s) => s.approved).length;
  const clippedCount  = scenes.filter((s) => s.demoClipUrl).length;

  const handleUpdate = useCallback(
    (id: string, patch: Partial<SceneData>) => {
      onScenesChange(scenes.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    },
    [scenes, onScenesChange]
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
      timestamp: "", section: "", lyricLine: "", location: "",
      action: "", cameraMovement: "", lighting: "", mood: "",
      aiVideoPrompt: "", negativePrompt: "", approved: false, demoClipUrl: null,
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
      {audioUrl && <AudioPlayer url={audioUrl} />}

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
      <FinalVideoPreview />

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
