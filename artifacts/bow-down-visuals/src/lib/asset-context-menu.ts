/**
 * asset-context-menu.ts — right-click menu items for a hub project
 * asset (hub tray cards + ProjectFlowBar chips). Pure builder: each
 * item is included ONLY when the surface supplies the real handler
 * for it, and the submenus are built from the real routing tables —
 * NEXT_STEPS (hub-workflows) for "next step" links and HANDOFF_INTENTS
 * (asset-handoff) for "send to desk", which the surface executes
 * through sendAssetToDesk so ownership validation still applies.
 */
import type { ContextMenuItem } from "../components/editor/ClipContextMenu";
import type { HubAsset } from "./hub-project";
import { nextStepsFor } from "./hub-workflows";
import { intentsForKind } from "./asset-handoff";

export interface AssetMenuActions {
  /** Use the asset in the surface's own tool (ProjectFlowBar's onPick). */
  onUse?: (asset: HubAsset) => void;
  /** Navigate to one of the asset's NEXT_STEPS hrefs. */
  onNavigate?: (href: string) => void;
  /** Execute a handoff intent (sendAssetToDesk + navigate). */
  onSendIntent?: (asset: HubAsset, intentId: string) => void;
  /** Download the asset from its own URL. */
  onDownload?: (asset: HubAsset) => void;
  /** Start the surface's inline rename for this asset. */
  onRename?: (asset: HubAsset) => void;
  /** Remove the asset from the project (hub removeAsset). */
  onRemove?: (asset: HubAsset) => void;
}

export function buildAssetContextItems(asset: HubAsset, actions: AssetMenuActions): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];
  if (actions.onUse) {
    items.push({
      key: "use",
      label: "Use in this tool",
      onClick: () => actions.onUse?.(asset),
    });
  }
  const next = nextStepsFor(asset);
  if (actions.onNavigate && next.length > 0) {
    items.push({
      key: "next",
      label: "Next step",
      children: next.map((n) => ({
        key: `next-${n.href}`,
        label: n.label,
        onClick: () => actions.onNavigate?.(n.href),
      })),
    });
  }
  const intents = intentsForKind(asset.kind);
  if (actions.onSendIntent && intents.length > 0) {
    items.push({
      key: "send",
      label: "Send to desk",
      children: intents.map((i) => ({
        key: `send-${i.id}`,
        label: i.label,
        onClick: () => actions.onSendIntent?.(asset, i.id),
      })),
    });
  }
  if (items.length > 0 && (actions.onDownload || actions.onRename || actions.onRemove)) {
    items.push({ key: "div-1", divider: true, label: "" });
  }
  if (actions.onDownload && asset.url) {
    items.push({
      key: "download",
      label: "Download",
      onClick: () => actions.onDownload?.(asset),
    });
  }
  if (actions.onRename) {
    items.push({
      key: "rename",
      label: "Rename asset",
      onClick: () => actions.onRename?.(asset),
    });
  }
  if (actions.onRemove) {
    items.push({
      key: "remove",
      label: "Remove from project",
      danger: true,
      onClick: () => actions.onRemove?.(asset),
    });
  }
  return items;
}

/** The download every asset surface shares: a real anchor to the
    asset's own URL (same target as the hub card's Download link). */
export function downloadAsset(asset: HubAsset): void {
  const a = document.createElement("a");
  a.href = asset.url;
  a.download = asset.label || "asset";
  a.target = "_blank";
  a.rel = "noreferrer";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
