import { useState, useCallback } from "react";
import {
  CheckCircle2, Circle, Copy, Check, Pencil, Play,
  Clock, MapPin, Camera, Zap, Film, X, ChevronDown, ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SceneData } from "@/lib/scene-parser";

const SECTION_COLORS: Record<string, string> = {
  intro:    "bg-purple-500/20 text-purple-300 border-purple-500/30",
  verse:    "bg-blue-500/20 text-blue-300 border-blue-500/30",
  hook:     "bg-primary/20 text-primary border-primary/30",
  chorus:   "bg-primary/20 text-primary border-primary/30",
  bridge:   "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
  outro:    "bg-rose-500/20 text-rose-300 border-rose-500/30",
  pre:      "bg-orange-500/20 text-orange-300 border-orange-500/30",
  break:    "bg-green-500/20 text-green-300 border-green-500/30",
};

function sectionColor(section: string): string {
  const lower = section.toLowerCase();
  for (const key of Object.keys(SECTION_COLORS)) {
    if (lower.includes(key)) return SECTION_COLORS[key]!;
  }
  return "bg-white/10 text-white/60 border-white/20";
}

function DemoClipPlaceholder({ onClose }: { onClose: () => void }) {
  return (
    <div className="mt-3 rounded-xl overflow-hidden border border-primary/20 bg-black relative">
      <div className="flex items-center justify-between px-3 py-2 bg-primary/10 border-b border-primary/20">
        <span className="text-xs font-bold text-primary uppercase tracking-wider flex items-center gap-1.5">
          <Film className="h-3.5 w-3.5" /> Demo Clip Preview
        </span>
        <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="relative bg-gradient-to-br from-[#1a1209] via-[#0d0d0d] to-[#120a00] aspect-video flex flex-col items-center justify-center gap-3">
        <div className="absolute inset-0 overflow-hidden">
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              className="absolute rounded-full bg-primary/5 animate-pulse"
              style={{
                width: `${80 + i * 40}px`,
                height: `${80 + i * 40}px`,
                top: `${20 + i * 8}%`,
                left: `${15 + i * 12}%`,
                animationDelay: `${i * 0.4}s`,
                animationDuration: `${2 + i * 0.5}s`,
              }}
            />
          ))}
        </div>
        <div className="relative z-10 flex flex-col items-center gap-2">
          <div className="h-14 w-14 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center animate-pulse">
            <Play className="h-6 w-6 text-primary ml-1" />
          </div>
          <p className="text-white/50 text-xs text-center max-w-[200px] leading-relaxed">
            AI video generation coming soon.<br />Your prompt is ready to paste into Runway, Sora, or Kling.
          </p>
        </div>
      </div>
    </div>
  );
}

interface SceneCardProps {
  scene: SceneData;
  index: number;
  onUpdate: (id: string, patch: Partial<SceneData>) => void;
}

function SceneCard({ scene, index, onUpdate }: SceneCardProps) {
  const [editing, setEditing] = useState(false);
  const [editedPrompt, setEditedPrompt] = useState(scene.aiVideoPrompt);
  const [copied, setCopied] = useState(false);
  const [showClip, setShowClip] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  function handleApprove() {
    onUpdate(scene.id, { approved: !scene.approved });
  }

  function handleSaveEdit() {
    onUpdate(scene.id, { aiVideoPrompt: editedPrompt });
    setEditing(false);
  }

  function handleCancelEdit() {
    setEditedPrompt(scene.aiVideoPrompt);
    setEditing(false);
  }

  function handleCopyPrompt() {
    navigator.clipboard.writeText(scene.aiVideoPrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleGenerateDemo() {
    setShowClip(true);
  }

  return (
    <div
      className={`rounded-xl border transition-all duration-200 overflow-hidden ${
        scene.approved
          ? "border-primary/40 bg-primary/[0.04]"
          : "border-white/[0.08] bg-white/[0.02]"
      }`}
      data-testid={`scene-card-${index}`}
    >
      {/* Card Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06]">
        <button
          onClick={handleApprove}
          className="shrink-0 transition-transform hover:scale-110"
          data-testid={`btn-approve-scene-${index}`}
          title={scene.approved ? "Remove approval" : "Approve this scene"}
        >
          {scene.approved ? (
            <CheckCircle2 className="h-5 w-5 text-primary" />
          ) : (
            <Circle className="h-5 w-5 text-white/20 hover:text-white/50" />
          )}
        </button>

        <span className="text-xs font-black text-white/30 tabular-nums">
          {String(index + 1).padStart(2, "0")}
        </span>

        {scene.timestamp && (
          <span className="flex items-center gap-1 text-xs text-white/40">
            <Clock className="h-3 w-3" /> {scene.timestamp}
          </span>
        )}

        {scene.section && (
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${sectionColor(scene.section)}`}>
            {scene.section}
          </span>
        )}

        {scene.approved && (
          <span className="ml-auto text-[10px] font-bold text-primary uppercase tracking-wider">
            ✓ Approved
          </span>
        )}

        <button
          onClick={() => setCollapsed((c) => !c)}
          className="ml-auto text-white/30 hover:text-white/60 transition-colors"
          data-testid={`btn-collapse-scene-${index}`}
        >
          {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
        </button>
      </div>

      {!collapsed && (
        <div className="px-4 py-4 space-y-3">
          {/* Scene metadata grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            {scene.lyricLine && (
              <div className="col-span-full bg-white/[0.03] rounded-lg px-3 py-2 italic text-white/50 border border-white/[0.05]">
                "{scene.lyricLine}"
              </div>
            )}
            {scene.location && (
              <div className="flex items-start gap-2 text-white/50">
                <MapPin className="h-3.5 w-3.5 text-primary/50 shrink-0 mt-0.5" />
                <span><span className="text-white/30 mr-1">Location:</span>{scene.location}</span>
              </div>
            )}
            {scene.action && (
              <div className="flex items-start gap-2 text-white/50">
                <Zap className="h-3.5 w-3.5 text-primary/50 shrink-0 mt-0.5" />
                <span><span className="text-white/30 mr-1">Action:</span>{scene.action}</span>
              </div>
            )}
            {scene.cameraMovement && (
              <div className="flex items-start gap-2 text-white/50">
                <Camera className="h-3.5 w-3.5 text-primary/50 shrink-0 mt-0.5" />
                <span><span className="text-white/30 mr-1">Camera:</span>{scene.cameraMovement}</span>
              </div>
            )}
            {scene.lighting && (
              <div className="flex items-start gap-2 text-white/50">
                <span className="text-primary/50 text-[11px] font-bold shrink-0">LT</span>
                <span><span className="text-white/30 mr-1">Lighting:</span>{scene.lighting}</span>
              </div>
            )}
            {scene.mood && (
              <div className="flex items-start gap-2 text-white/50">
                <span className="text-primary/50 text-[11px] font-bold shrink-0">MD</span>
                <span><span className="text-white/30 mr-1">Mood:</span>{scene.mood}</span>
              </div>
            )}
          </div>

          {/* AI Video Prompt */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-primary/70 uppercase tracking-widest">
                AI Video Prompt
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleCopyPrompt}
                  className="flex items-center gap-1 text-xs text-white/30 hover:text-primary transition-colors px-2 py-1 rounded hover:bg-primary/10"
                  data-testid={`btn-copy-prompt-${index}`}
                >
                  {copied ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}
                  {copied ? "Copied!" : "Copy"}
                </button>
                {!editing && (
                  <button
                    onClick={() => setEditing(true)}
                    className="flex items-center gap-1 text-xs text-white/30 hover:text-primary transition-colors px-2 py-1 rounded hover:bg-primary/10"
                    data-testid={`btn-edit-prompt-${index}`}
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
                  data-testid={`textarea-edit-prompt-${index}`}
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={handleSaveEdit}
                    className="gold-glow text-xs h-7"
                    data-testid={`btn-save-prompt-${index}`}
                  >
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleCancelEdit}
                    className="border-white/10 bg-white/5 text-white/50 text-xs h-7"
                    data-testid={`btn-cancel-edit-${index}`}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-white/60 leading-relaxed bg-white/[0.03] rounded-lg px-3 py-2 border border-white/[0.05]">
                {scene.aiVideoPrompt || <span className="italic text-white/20">No prompt generated</span>}
              </p>
            )}
          </div>

          {/* Negative Prompt (collapsed by default via small display) */}
          {scene.negativePrompt && (
            <p className="text-[11px] text-white/25 leading-relaxed">
              <span className="text-white/20 font-bold">Negative: </span>
              {scene.negativePrompt}
            </p>
          )}

          {/* Demo Clip */}
          {showClip && (
            <DemoClipPlaceholder onClose={() => setShowClip(false)} />
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1 flex-wrap">
            <button
              onClick={handleGenerateDemo}
              className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
              data-testid={`btn-demo-clip-${index}`}
            >
              <Play className="h-3.5 w-3.5" /> Generate Demo Clip
            </button>
            <button
              onClick={handleApprove}
              className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg border transition-colors ${
                scene.approved
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-white/10 bg-white/5 text-white/40 hover:border-primary/30 hover:text-primary/70"
              }`}
              data-testid={`btn-approve-action-${index}`}
            >
              {scene.approved ? (
                <><CheckCircle2 className="h-3.5 w-3.5" /> Approved</>
              ) : (
                <><Circle className="h-3.5 w-3.5" /> Approve Scene</>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface SceneStudioProps {
  scenes: SceneData[];
  onScenesChange: (scenes: SceneData[]) => void;
}

export function SceneStudio({ scenes, onScenesChange }: SceneStudioProps) {
  const approvedCount = scenes.filter((s) => s.approved).length;

  const handleUpdate = useCallback(
    (id: string, patch: Partial<SceneData>) => {
      onScenesChange(
        scenes.map((s) => (s.id === id ? { ...s, ...patch } : s))
      );
    },
    [scenes, onScenesChange]
  );

  if (scenes.length === 0) return null;

  return (
    <div className="space-y-3" data-testid="scene-studio">
      {/* Studio Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Film className="h-4 w-4 text-primary" />
          <span className="text-sm font-black text-white uppercase tracking-wider">
            Scene Studio
          </span>
          <span className="text-xs text-white/30">{scenes.length} scenes</span>
        </div>
        {approvedCount > 0 && (
          <span className="text-xs font-bold text-primary bg-primary/10 border border-primary/25 px-2.5 py-1 rounded-full">
            {approvedCount} / {scenes.length} approved
          </span>
        )}
      </div>

      {/* Scene Cards */}
      <div className="space-y-3">
        {scenes.map((scene, i) => (
          <SceneCard key={scene.id} scene={scene} index={i} onUpdate={handleUpdate} />
        ))}
      </div>
    </div>
  );
}
