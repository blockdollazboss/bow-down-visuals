import { useState } from "react";
import { Check, X, Clapperboard, Clock, MapPin, Video, Lightbulb, Sparkles } from "lucide-react";
import type { SceneData } from "@/lib/scene-parser";

interface StoryboardReviewProps {
  scenes: SceneData[];
  onApprove: (approvedScenes: SceneData[]) => void;
  creditsPerSecond?: number;
}

/**
 * Visual storyboard review — the mandatory pre-production gate.
 * Shows every scene as a film storyboard card with timing, shot details,
 * and the AI prompt. Nothing generates until the user approves each scene.
 */
export function StoryboardReview({ scenes, onApprove, creditsPerSecond = 2 }: StoryboardReviewProps) {
  const [approvedIds, setApprovedIds] = useState<Set<string>>(
    new Set(scenes.filter((s) => s.approved).map((s) => s.id))
  );

  function toggleApprove(id: string) {
    setApprovedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function approveAll() {
    setApprovedIds(new Set(scenes.map((s) => s.id)));
  }

  function handleConfirm() {
    const updated = scenes.map((s) => ({ ...s, approved: approvedIds.has(s.id) }));
    onApprove(updated);
  }

  const allApproved = scenes.length > 0 && approvedIds.size === scenes.length;
  const estimatedCredits = scenes.length * 10 * creditsPerSecond; // assume 10s per scene

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-2xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6">
        <div className="flex items-center gap-3 mb-2">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Clapperboard className="h-5 w-5" />
          </span>
          <div>
            <h3 className="text-lg font-bold text-white">Director's Storyboard</h3>
            <p className="text-sm text-white/45">
              Review every shot before we roll cameras. Nothing generates until you approve.
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
          <span className="rounded-full bg-white/[0.06] px-3 py-1.5 text-white/70">
            {scenes.length} scene{scenes.length === 1 ? "" : "s"}
          </span>
          <span className="rounded-full bg-white/[0.06] px-3 py-1.5 text-white/70">
            ~{estimatedCredits} credits estimated
          </span>
          <span className={`rounded-full px-3 py-1.5 font-semibold ${
            allApproved ? "bg-green-500/15 text-green-400" : "bg-amber-500/15 text-amber-400"
          }`}>
            {approvedIds.size}/{scenes.length} approved
          </span>
          <button
            onClick={approveAll}
            className="ml-auto text-sm font-semibold text-primary hover:underline"
          >
            Approve all
          </button>
        </div>
      </div>

      {/* Storyboard cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {scenes.map((scene, i) => {
          const isApproved = approvedIds.has(scene.id);
          return (
            <div
              key={scene.id}
              className={`rounded-2xl border overflow-hidden transition ${
                isApproved
                  ? "border-green-500/30 bg-green-500/[0.03]"
                  : "border-white/[0.08] bg-white/[0.02]"
              }`}
            >
              {/* Card header */}
              <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06]">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary text-sm font-black">
                  {scene.sceneNumber || i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-white truncate">{scene.section || "Scene"}</p>
                  <p className="text-xs text-white/40 flex items-center gap-1">
                    <Clock className="h-3 w-3" /> {scene.timestamp || "—"}
                  </p>
                </div>
                <button
                  onClick={() => toggleApprove(scene.id)}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition ${
                    isApproved
                      ? "bg-green-500/20 text-green-400 hover:bg-green-500/30"
                      : "bg-white/[0.06] text-white/50 hover:bg-white/[0.1] hover:text-white"
                  }`}
                >
                  {isApproved ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                  {isApproved ? "Approved" : "Approve"}
                </button>
              </div>

              {/* Shot details */}
              <div className="px-4 py-3 space-y-2 text-sm">
                {scene.location && (
                  <p className="flex items-start gap-2 text-white/70">
                    <MapPin className="h-4 w-4 text-primary/60 shrink-0 mt-0.5" />
                    <span>{scene.location}</span>
                  </p>
                )}
                {scene.action && (
                  <p className="text-white/70 leading-relaxed">{scene.action}</p>
                )}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {scene.cameraMovement && (
                    <span className="rounded-full bg-white/[0.05] px-2.5 py-1 text-xs text-white/50 flex items-center gap-1">
                      <Video className="h-3 w-3" /> {scene.cameraMovement}
                    </span>
                  )}
                  {scene.lighting && (
                    <span className="rounded-full bg-white/[0.05] px-2.5 py-1 text-xs text-white/50 flex items-center gap-1">
                      <Lightbulb className="h-3 w-3" /> {scene.lighting}
                    </span>
                  )}
                  {scene.mood && (
                    <span className="rounded-full bg-white/[0.05] px-2.5 py-1 text-xs text-white/50">
                      {scene.mood}
                    </span>
                  )}
                </div>
                {scene.lyricLine && (
                  <p className="text-xs italic text-white/40 border-l-2 border-primary/30 pl-2.5 pt-1">
                    "{scene.lyricLine}"
                  </p>
                )}
              </div>

              {/* AI Prompt (collapsible) */}
              {scene.aiVideoPrompt && (
                <details className="border-t border-white/[0.06] px-4 py-3">
                  <summary className="cursor-pointer text-xs font-semibold text-primary/70 hover:text-primary flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5" /> AI Generation Prompt
                  </summary>
                  <p className="mt-2 text-xs text-white/50 leading-relaxed whitespace-pre-wrap">
                    {scene.aiVideoPrompt}
                  </p>
                </details>
              )}
            </div>
          );
        })}
      </div>

      {/* Confirm button */}
      <div className="sticky bottom-4">
        <button
          onClick={handleConfirm}
          disabled={!allApproved}
          className="w-full rounded-2xl bg-primary px-6 py-4 font-bold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:brightness-100 shadow-[0_0_30px_rgba(201,168,76,0.3)]"
        >
          {allApproved
            ? `🎬 Roll Cameras — Generate ${scenes.length} Scene${scenes.length === 1 ? "" : "s"}`
            : `Approve all ${scenes.length} scenes to continue (${approvedIds.size}/${scenes.length})`}
        </button>
        {!allApproved && (
          <p className="mt-2 text-center text-xs text-white/35">
            Review each shot above — tap Approve on every scene you're happy with.
          </p>
        )}
      </div>
    </div>
  );
}
