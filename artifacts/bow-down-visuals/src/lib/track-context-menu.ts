/**
 * track-context-menu.ts — the right-click menu items for an audio track
 * header (a stem row in the editor's music studio). Pure builder: it
 * only describes items whose onClick calls the row's REAL handlers —
 * the same patch/delete/replace functions the visible buttons use.
 * Lock semantics mirror the row itself: mute/solo/lock stay toggleable
 * while locked; rename, replace and delete are disabled while locked.
 */
import type { ContextMenuItem } from "../components/editor/ClipContextMenu";
import type { AudioStem } from "./editor-settings";

export interface StemMenuActions {
  patchStem: (id: string, patch: Partial<AudioStem>) => void;
  deleteStem: (stem: AudioStem) => void;
  startReplace: (id: string) => void;
  /** Bring the row's inline name field into focus for renaming. */
  focusRename: (id: string) => void;
  /** Opens the add-track (upload) picker. Only where that picker exists. */
  addTrack?: () => void;
  uploading?: boolean;
}

export function buildStemContextItems(stem: AudioStem, actions: StemMenuActions): ContextMenuItem[] {
  const lockedTitle = "Unlock the track first";
  const items: ContextMenuItem[] = [
    {
      key: "mute",
      label: stem.muted ? "Unmute track" : "Mute track",
      checked: stem.muted,
      onClick: () => actions.patchStem(stem.id, { muted: !stem.muted }),
    },
    {
      key: "solo",
      label: stem.solo ? "Unsolo track" : "Solo track",
      checked: stem.solo,
      onClick: () => actions.patchStem(stem.id, { solo: !stem.solo }),
    },
    {
      key: "lock",
      label: stem.locked ? "Unlock track" : "Lock track",
      checked: stem.locked,
      onClick: () => actions.patchStem(stem.id, { locked: !stem.locked }),
    },
    { key: "div-1", divider: true, label: "" },
    {
      key: "rename",
      label: "Rename track",
      disabled: stem.locked,
      disabledTitle: lockedTitle,
      onClick: () => actions.focusRename(stem.id),
    },
    {
      key: "replace",
      label: "Replace file…",
      disabled: stem.locked || !!actions.uploading,
      disabledTitle: stem.locked ? lockedTitle : "Wait for the current upload to finish",
      onClick: () => actions.startReplace(stem.id),
    },
  ];
  if (actions.addTrack) {
    items.push({
      key: "add-track",
      label: "Add track…",
      disabled: !!actions.uploading,
      disabledTitle: "Wait for the current upload to finish",
      onClick: () => actions.addTrack?.(),
    });
  }
  items.push(
    { key: "div-2", divider: true, label: "" },
    {
      key: "delete",
      label: "Delete track",
      danger: true,
      disabled: stem.locked,
      disabledTitle: lockedTitle,
      onClick: () => actions.deleteStem(stem),
    },
  );
  return items;
}
