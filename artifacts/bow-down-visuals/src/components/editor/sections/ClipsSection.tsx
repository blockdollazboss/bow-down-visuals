import { useState, useEffect } from "react";
import {
  ArrowUp, ArrowDown, Copy, Trash2, Volume2, VolumeX, Check, Link2, Eye, ShieldCheck,
  ChevronsUp, ChevronsDown, Undo2, CheckCircle2, AlertCircle,
  GripVertical,
} from "lucide-react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  closestCenter,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import type { SceneData } from "@/lib/scene-parser";
import {
  getClipEdit, sceneHasClip,
  type EditorSettings, type ClipEdit,
} from "@/lib/editor-settings";
import { Field, Collapsible } from "@/components/editor/controls";
import { PlanNote, EmptyScenes, IconBtn } from "@/components/editor/sections/shared";

const CONSISTENCY_MARKER = "[CHARACTER CONSISTENCY:";

type SaveState = "idle" | "saving" | "saved" | "error";

interface ClipsSectionProps {
  scenes: SceneData[];
  setScenes: (s: SceneData[]) => void;
  settings: EditorSettings;
  setSettings: (s: EditorSettings) => void;
  onPreview?: (sceneId: string) => void;
  previewSceneId?: string | null;
  saveState?: SaveState;
}

/* ── Sortable clip row wrapper ─────────────────────────────────── */
function SortableClipRow({
  scene,
  index,
  total,
  isActive,
  isDragDisabled,
  children,
}: {
  scene: SceneData;
  index: number;
  total: number;
  isActive: boolean;
  isDragDisabled?: boolean;
  children: (dragHandleProps: React.HTMLAttributes<HTMLElement>) => React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: scene.id, disabled: isDragDisabled });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.85 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`rounded-xl border overflow-hidden transition-colors ${
        isDragging
          ? "border-primary/60 bg-primary/[0.08] shadow-xl shadow-primary/20"
          : isActive
          ? "border-primary/40 bg-primary/[0.04]"
          : "border-white/[0.07] bg-white/[0.02]"
      }`}
      data-testid={`clip-row-${index}`}
    >
      {children({ ...attributes, ...listeners })}
    </div>
  );
}

/* ── Main component ─────────────────────────────────────────────── */
export function ClipsSection({
  scenes,
  setScenes,
  settings,
  setSettings,
  onPreview,
  previewSceneId,
  saveState = "idle",
}: ClipsSectionProps) {
  const [undoSnapshot, setUndoSnapshot] = useState<SceneData[] | null>(null);
  const [reorderStatus, setReorderStatus] = useState<"saved" | "failed" | null>(null);
  const prevSaveState = useState<SaveState>("idle");

  /* Show transient save feedback after a reorder triggers a save */
  useEffect(() => {
    if (undoSnapshot === null) return; // no reorder pending
    if (saveState === "saved") {
      setReorderStatus("saved");
      const t = setTimeout(() => setReorderStatus(null), 3000);
      return () => clearTimeout(t);
    }
    if (saveState === "error") {
      setReorderStatus("failed");
    }
    return;
  }, [saveState, undoSnapshot]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  /* ── Reorder helpers ── */
  function reorder(newOrder: SceneData[]) {
    setUndoSnapshot([...scenes]);
    setScenes(newOrder);
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

  /* ── Clip helpers ── */
  function remove(id: string) {
    setScenes(scenes.filter((s) => s.id !== id));
  }

  function duplicate(index: number) {
    const orig = scenes[index]!;
    const copy: SceneData = { ...orig, id: `${orig.id}-copy-${Date.now()}`, approved: false };
    const next = [...scenes];
    next.splice(index + 1, 0, copy);
    setScenes(next);
  }

  function toggleApprove(id: string) {
    setScenes(scenes.map((s) => (s.id === id ? { ...s, approved: !s.approved } : s)));
  }

  function patchClip(sceneId: string, patch: Partial<ClipEdit>) {
    const current = getClipEdit(settings, sceneId);
    setSettings({ ...settings, clips: { ...settings.clips, [sceneId]: { ...current, ...patch } } });
  }

  /* ── Render ── */
  return (
    <div className="space-y-5">
      <PlanNote />

      {/* Save / undo status bar */}
      {(reorderStatus || undoSnapshot) && (
        <div
          className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border text-xs font-semibold ${
            reorderStatus === "failed"
              ? "border-red-500/30 bg-red-500/[0.06] text-red-400"
              : reorderStatus === "saved"
              ? "border-green-500/30 bg-green-500/[0.06] text-green-400"
              : "border-white/[0.07] bg-white/[0.02] text-white/50"
          }`}
        >
          {reorderStatus === "saved" ? (
            <><CheckCircle2 className="h-4 w-4 shrink-0" /> Order saved</>
          ) : reorderStatus === "failed" ? (
            <><AlertCircle className="h-4 w-4 shrink-0" /> Order save failed — click Undo to restore</>
          ) : (
            <><span className="h-4 w-4 shrink-0 inline-flex items-center justify-center"><span className="h-1.5 w-1.5 rounded-full bg-white/40 animate-pulse" /></span> Saving order…</>
          )}
          {undoSnapshot && (
            <button
              type="button"
              onClick={undoReorder}
              className="ml-auto flex items-center gap-1.5 px-3 py-1 rounded-lg border border-white/10 bg-white/[0.04] text-white/60 hover:text-white hover:border-white/20 transition-colors text-xs font-bold"
            >
              <Undo2 className="h-3.5 w-3.5" /> Undo Reorder
            </button>
          )}
        </div>
      )}

      {scenes.length === 0 ? (
        <EmptyScenes />
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={scenes.map((s) => s.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-3">
              {scenes.map((scene, i) => {
                const edit = getClipEdit(settings, scene.id);
                const hasClip = sceneHasClip(scene);
                const isPreviewing = previewSceneId === scene.id;
                const hasConsistency = (scene.aiVideoPrompt ?? "").startsWith(CONSISTENCY_MARKER);

                return (
                  <SortableClipRow
                    key={scene.id}
                    scene={scene}
                    index={i}
                    total={scenes.length}
                    isActive={isPreviewing}
                  >
                    {(dragHandleProps) => (
                      <>
                        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.05]">
                          {/* Drag handle */}
                          <div
                            {...dragHandleProps}
                            className="shrink-0 cursor-grab active:cursor-grabbing text-white/20 hover:text-white/50 transition-colors touch-none"
                            title="Drag to reorder"
                          >
                            <GripVertical className="h-4 w-4" />
                          </div>

                          <span className="h-7 w-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 text-[11px] font-black text-primary">
                            {i + 1}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="text-sm font-semibold text-white/80 truncate">
                                {scene.section || `Scene ${i + 1}`}
                              </p>
                              {hasConsistency && (
                                <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-green-500/[0.12] border border-green-500/25 text-[9px] font-bold text-green-400 shrink-0">
                                  <ShieldCheck className="h-2.5 w-2.5" /> Consistency Applied
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-white/35 truncate">
                              {scene.lyricLine || scene.action || scene.location || "—"}
                            </p>
                          </div>

                          {hasClip ? (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-green-500/30 bg-green-500/10 text-green-400 shrink-0">Clip</span>
                          ) : (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-white/10 bg-white/[0.03] text-white/30 shrink-0">No clip</span>
                          )}

                          {hasClip && onPreview && (
                            <button
                              type="button"
                              onClick={() => onPreview(scene.id)}
                              title="Preview Clip"
                              data-testid={`btn-preview-${i}`}
                              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors shrink-0 ${
                                isPreviewing
                                  ? "border-primary/50 bg-primary/15 text-primary"
                                  : "border-white/10 bg-white/[0.03] text-white/45 hover:text-primary hover:border-primary/30"
                              }`}
                            >
                              <Eye className="h-3 w-3" /> Preview
                            </button>
                          )}

                          {/* Reorder controls */}
                          <div className="flex items-center gap-1 shrink-0">
                            <IconBtn title="Move to start" disabled={i === 0} onClick={() => moveToStart(i)}>
                              <ChevronsUp className="h-3.5 w-3.5" />
                            </IconBtn>
                            <IconBtn title="Move up" disabled={i === 0} onClick={() => move(i, -1)} testId={`btn-up-${i}`}>
                              <ArrowUp className="h-3.5 w-3.5" />
                            </IconBtn>
                            <IconBtn title="Move down" disabled={i === scenes.length - 1} onClick={() => move(i, 1)} testId={`btn-down-${i}`}>
                              <ArrowDown className="h-3.5 w-3.5" />
                            </IconBtn>
                            <IconBtn title="Move to end" disabled={i === scenes.length - 1} onClick={() => moveToEnd(i)}>
                              <ChevronsDown className="h-3.5 w-3.5" />
                            </IconBtn>
                            <IconBtn title="Duplicate" onClick={() => duplicate(i)} testId={`btn-duplicate-${i}`}>
                              <Copy className="h-3.5 w-3.5" />
                            </IconBtn>
                            <IconBtn title="Remove" danger onClick={() => remove(scene.id)} testId={`btn-remove-${i}`}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </IconBtn>
                          </div>
                        </div>

                        <div className="p-4 space-y-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => toggleApprove(scene.id)}
                              data-testid={`btn-approve-${i}`}
                              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                                scene.approved
                                  ? "border-primary/50 bg-primary/15 text-primary"
                                  : "border-white/10 bg-white/[0.03] text-white/45 hover:text-white/70"
                              }`}
                            >
                              <Check className="h-3.5 w-3.5" /> {scene.approved ? "Approved" : "Approve"}
                            </button>
                            <button
                              type="button"
                              onClick={() => patchClip(scene.id, { muted: !edit.muted })}
                              data-testid={`btn-mute-${i}`}
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

                          <Collapsible title="Trim · Volume · Replace">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              <Field label="Trim start" hint={`${edit.trimStart.toFixed(1)}s`}>
                                <Slider value={[edit.trimStart]} min={0} max={10} step={0.5} onValueChange={([v]) => patchClip(scene.id, { trimStart: v ?? 0 })} />
                              </Field>
                              <Field label="Trim end" hint={`${edit.trimEnd.toFixed(1)}s`}>
                                <Slider value={[edit.trimEnd]} min={0} max={10} step={0.5} onValueChange={([v]) => patchClip(scene.id, { trimEnd: v ?? 0 })} />
                              </Field>
                              <Field label="Clip volume" hint={`${edit.volume}%`}>
                                <Slider value={[edit.volume]} min={0} max={100} step={5} onValueChange={([v]) => patchClip(scene.id, { volume: v ?? 100 })} />
                              </Field>
                              <Field label="Replace clip URL" hint="edit-plan only">
                                <div className="flex items-center gap-2">
                                  <Link2 className="h-4 w-4 text-white/30 shrink-0" />
                                  <Input
                                    value={edit.replaceUrl ?? ""}
                                    onChange={(e) => patchClip(scene.id, { replaceUrl: e.target.value || null })}
                                    placeholder="https://…"
                                    className="h-9 text-xs bg-white/[0.04] border-white/[0.1] text-white/80"
                                    data-testid={`input-replace-${i}`}
                                  />
                                </div>
                              </Field>
                            </div>
                          </Collapsible>
                        </div>
                      </>
                    )}
                  </SortableClipRow>
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}
