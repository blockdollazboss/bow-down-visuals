/**
 * ScenesPanel — the scene list for the parity studio: create, rename
 * (inline), duplicate, delete; each scene previews on click and can be
 * Taken straight to Program. The Program scene carries a LIVE badge,
 * the framed one a PVW badge (OBS studio-mode language).
 */
import { useState } from "react";
import { Copy, MonitorPlay, Plus, Trash2 } from "lucide-react";
import type { Stage } from "@/lib/stream-kit/stage";
import { ClipContextMenu } from "@/components/editor/ClipContextMenu";
import { buildSceneContextItems } from "@/lib/studio-context-menu";

export default function ScenesPanel({
  stage,
  isLight,
  onTake,
}: {
  stage: Stage;
  isLight: boolean;
  onTake: (sceneId: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number; sceneId: string } | null>(null);
  const label = isLight ? "text-[#6B5B36]" : "text-zinc-400";

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className={`text-[11px] font-semibold uppercase tracking-wide ${label}`}>Scenes</p>
        <button
          type="button"
          onClick={() => stage.addScene()}
          className="inline-flex items-center gap-1 rounded-md border border-[#C9A84C]/50 px-2 py-1 text-[11px] font-semibold text-[#8a6d1f] transition hover:bg-[#C9A84C]/10 dark:text-[#e8cf8a]"
        >
          <Plus className="h-3 w-3" /> Scene
        </button>
      </div>
      <div className="space-y-1.5">
        {stage.scenes.map((scene, i) => {
          const isProgram = scene.id === stage.programId;
          const isPreview = scene.id === stage.previewId;
          return (
            <div
              key={scene.id}
              onContextMenu={(e) => {
                if (editingId === scene.id) return; // the rename field keeps its own menu
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY, sceneId: scene.id });
              }}
              className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-sm ${
                isPreview
                  ? "border-[#C9A84C]/70 bg-[#C9A84C]/10"
                  : isLight
                    ? "border-[#C9A84C]/25 bg-white/40"
                    : "border-white/10 bg-white/[0.03]"
              }`}
            >
              <span className={`w-4 text-center text-[11px] font-bold ${label}`}>{i + 1}</span>
              {editingId === scene.id ? (
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => {
                    if (draft.trim()) stage.renameScene(scene.id, draft.trim());
                    setEditingId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  className={`min-w-0 flex-1 rounded border border-[#C9A84C]/50 bg-transparent px-1.5 py-0.5 text-sm outline-none ${isLight ? "text-[#2A1E07]" : "text-zinc-100"}`}
                />
              ) : (
                <button
                  type="button"
                  className={`min-w-0 flex-1 truncate text-left font-medium ${isLight ? "text-[#2A1E07]" : "text-zinc-100"}`}
                  onClick={() => stage.setPreview(scene.id)}
                  onDoubleClick={() => {
                    setDraft(scene.name);
                    setEditingId(scene.id);
                  }}
                  title="Preview this scene — double-click to rename"
                >
                  {scene.name}
                </button>
              )}
              {isProgram ? (
                <span className="rounded bg-red-600 px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">Live</span>
              ) : isPreview ? (
                <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">Pvw</span>
              ) : null}
              <button
                type="button"
                title="Take to Program (cut)"
                onClick={() => onTake(scene.id)}
                className="rounded p-1 text-zinc-400 transition hover:text-[#C9A84C]"
              >
                <MonitorPlay className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                title="Duplicate scene"
                onClick={() => stage.duplicateSceneById(scene.id)}
                className="rounded p-1 text-zinc-400 transition hover:text-[#C9A84C]"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                title={stage.scenes.length <= 1 ? "You need at least one scene" : "Delete scene"}
                disabled={stage.scenes.length <= 1}
                onClick={() => stage.deleteScene(scene.id)}
                className="rounded p-1 text-zinc-400 transition hover:text-red-400 disabled:opacity-30"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
      <p className={`mt-2 text-[11px] leading-snug ${label}`}>
        Click a scene to frame it in Preview. Number keys 1–9 take a scene straight to Program.
      </p>
      {menu && (() => {
        const scene = stage.scenes.find((s) => s.id === menu.sceneId);
        if (!scene) return null;
        return (
          <ClipContextMenu
            x={menu.x}
            y={menu.y}
            onClose={() => setMenu(null)}
            testId="scene-context-menu"
            items={buildSceneContextItems(stage, scene, {
              onTake,
              onRename: (s) => {
                setDraft(s.name);
                setEditingId(s.id);
              },
            })}
          />
        );
      })()}
    </div>
  );
}
