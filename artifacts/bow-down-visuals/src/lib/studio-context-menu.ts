/**
 * studio-context-menu.ts — right-click menu items for the Go Live
 * studio's scenes and sources. Pure builders over the real Stage:
 * every item calls the same Stage operation the panel buttons call
 * (preview / cut / rename / duplicate / delete for scenes; rename /
 * duplicate / reorder / visibility / lock / remove for sources).
 * "Move toward front" is +1 in the source stack (the list renders
 * front-first); both moves disable at the ends of the stack.
 */
import type { ContextMenuItem } from "../components/editor/ClipContextMenu";
import type { Stage } from "./stream-kit/stage";
import type { Scene, SceneSource } from "./stream-kit/scenes";

export interface SceneMenuActions {
  /** Take the scene straight to Program (the studio's cut handler). */
  onTake: (sceneId: string) => void;
  /** Start the panel's inline rename for this scene. */
  onRename: (scene: Scene) => void;
}

export function buildSceneContextItems(
  stage: Stage,
  scene: Scene,
  actions: SceneMenuActions,
): ContextMenuItem[] {
  const only = stage.scenes.length <= 1;
  return [
    {
      key: "preview",
      label: "Preview scene",
      checked: stage.previewId === scene.id,
      onClick: () => stage.setPreview(scene.id),
    },
    {
      key: "take",
      label: "Take to Program",
      checked: stage.programId === scene.id,
      onClick: () => actions.onTake(scene.id),
    },
    { key: "div-1", divider: true, label: "" },
    {
      key: "rename",
      label: "Rename scene",
      onClick: () => actions.onRename(scene),
    },
    {
      key: "duplicate",
      label: "Duplicate scene",
      onClick: () => stage.duplicateSceneById(scene.id),
    },
    {
      key: "add",
      label: "Add scene",
      onClick: () => stage.addScene(),
    },
    { key: "div-2", divider: true, label: "" },
    {
      key: "delete",
      label: "Delete scene",
      danger: true,
      disabled: only,
      disabledTitle: "You need at least one scene",
      onClick: () => stage.deleteScene(scene.id),
    },
  ];
}

export interface SourceMenuActions {
  onSelect: (id: string | null) => void;
  /** Rename through the surface's own editor (panel field / prompt). */
  onRename: (source: SceneSource) => void;
  /** Remove through the surface so its selection state stays honest. */
  onRemove: (source: SceneSource) => void;
}

export function buildSourceContextItems(
  stage: Stage,
  scene: Scene,
  source: SceneSource,
  actions: SourceMenuActions,
): ContextMenuItem[] {
  const idx = scene.sources.findIndex((s) => s.id === source.id);
  const atFront = idx >= 0 && idx === scene.sources.length - 1;
  const atBack = idx <= 0;
  return [
    {
      key: "rename",
      label: "Rename source",
      onClick: () => actions.onRename(source),
    },
    {
      key: "duplicate",
      label: "Duplicate source",
      onClick: () => {
        const copy = stage.duplicateSourceById(scene.id, source.id);
        if (copy) actions.onSelect(copy.id);
      },
    },
    { key: "div-1", divider: true, label: "" },
    {
      key: "front",
      label: "Move toward front",
      disabled: atFront,
      disabledTitle: "Already at the front",
      onClick: () => stage.moveSourceById(scene.id, source.id, 1),
    },
    {
      key: "back",
      label: "Move toward back",
      disabled: atBack,
      disabledTitle: "Already at the back",
      onClick: () => stage.moveSourceById(scene.id, source.id, -1),
    },
    { key: "div-2", divider: true, label: "" },
    {
      key: "visible",
      label: source.visible ? "Hide source" : "Show source",
      checked: source.visible,
      onClick: () => stage.updateSource(scene.id, source.id, { visible: !source.visible }),
    },
    {
      key: "lock",
      label: source.locked ? "Unlock source" : "Lock source",
      checked: source.locked,
      onClick: () => stage.updateSource(scene.id, source.id, { locked: !source.locked }),
    },
    { key: "div-3", divider: true, label: "" },
    {
      key: "remove",
      label: "Remove source",
      danger: true,
      onClick: () => actions.onRemove(source),
    },
  ];
}
