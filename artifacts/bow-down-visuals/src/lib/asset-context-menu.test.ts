import { describe, it, expect, vi } from "vitest";
import { buildAssetContextItems, type AssetMenuActions } from "./asset-context-menu";
import type { HubAsset } from "./hub-project";
import type { ContextMenuItem } from "../components/editor/ClipContextMenu";

const song: HubAsset = { id: "a1", kind: "song", url: "https://cdn.example/song.mp3", label: "My Song", createdAt: 1 };

function actions(): Required<AssetMenuActions> & { [K in keyof AssetMenuActions]: ReturnType<typeof vi.fn> } {
  return {
    onUse: vi.fn(),
    onNavigate: vi.fn(),
    onSendIntent: vi.fn(),
    onDownload: vi.fn(),
    onRename: vi.fn(),
    onRemove: vi.fn(),
  } as never;
}

function item(items: ContextMenuItem[], key: string): ContextMenuItem {
  const found = items.find((i) => i.key === key);
  if (!found) throw new Error(`missing item ${key}`);
  return found;
}

describe("hub asset context menu", () => {
  it("use / download / rename / remove call the surface's real handlers", () => {
    const a = actions();
    const items = buildAssetContextItems(song, a);
    item(items, "use").onClick?.();
    expect(a.onUse).toHaveBeenCalledWith(song);
    item(items, "download").onClick?.();
    expect(a.onDownload).toHaveBeenCalledWith(song);
    item(items, "rename").onClick?.();
    expect(a.onRename).toHaveBeenCalledWith(song);
    item(items, "remove").onClick?.();
    expect(a.onRemove).toHaveBeenCalledWith(song);
    expect(item(items, "remove").danger).toBe(true);
  });

  it("next-step submenu carries the real NEXT_STEPS routes + the asset's id (0142)", () => {
    const a = actions();
    const items = buildAssetContextItems(song, a);
    const next = item(items, "next");
    expect(next.children?.map((c) => c.label)).toContain("Make the video");
    next.children?.find((c) => c.label === "Make the video")?.onClick?.();
    expect(a.onNavigate).toHaveBeenCalledWith("/create?panel=video&assetId=a1");
  });

  it("send-to-desk submenu carries the real handoff intents for the kind", () => {
    const a = actions();
    const items = buildAssetContextItems(song, a);
    const send = item(items, "send");
    const ids = send.children?.map((c) => c.key) ?? [];
    expect(ids).toContain("send-song-to-video");
    expect(ids).toContain("send-song-to-audio");
    expect(ids).toContain("send-song-to-lyric-video");
    send.children?.find((c) => c.key === "send-song-to-video")?.onClick?.();
    expect(a.onSendIntent).toHaveBeenCalledWith(song, "song-to-video");
  });

  it("includes only the actions a surface actually supplies", () => {
    expect(buildAssetContextItems(song, {})).toEqual([]);
    const other: HubAsset = { ...song, kind: "other" };
    const items = buildAssetContextItems(other, actions());
    // "other" has no NEXT_STEPS and no handoff intents — no dead submenus.
    expect(items.find((i) => i.key === "next")).toBeUndefined();
    expect(items.find((i) => i.key === "send")).toBeUndefined();
    expect(items.find((i) => i.key === "use")).toBeTruthy();
  });
});
