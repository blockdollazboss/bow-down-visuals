import { describe, it, expect, vi, beforeAll } from "vitest";
import { buildSceneContextItems, buildSourceContextItems } from "./studio-context-menu";
import { Stage } from "./stream-kit/stage";
import type { ContextMenuItem } from "../components/editor/ClipContextMenu";

class FakeCtx {
  fillStyle: unknown = "";
  strokeStyle: unknown = "";
  globalAlpha = 1;
  font = "";
  textAlign = "";
  textBaseline = "";
  lineWidth = 1;
  lineJoin = "";
  save(): void {}
  restore(): void {}
  clearRect(): void {}
  fillRect(): void {}
  strokeRect(): void {}
  drawImage(): void {}
  fillText(): void {}
  strokeText(): void {}
  createLinearGradient(): { addColorStop: () => void } {
    return { addColorStop: () => undefined };
  }
  getImageData(_x: number, _y: number, w: number, h: number): { data: Uint8ClampedArray; width: number; height: number } {
    return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
  }
  putImageData(): void {}
}

class FakeCanvas {
  width = 1280;
  height = 720;
  ctx = new FakeCtx();
  getContext(): FakeCtx {
    return this.ctx;
  }
  captureStream(): object {
    return { fake: "stream" };
  }
}

beforeAll(() => {
  (globalThis as { document?: unknown }).document = {
    createElement: (tag: string) => {
      if (tag === "canvas") return new FakeCanvas();
      throw new Error(`unexpected element ${tag}`);
    },
  };
});

function item(items: ContextMenuItem[], key: string): ContextMenuItem {
  const found = items.find((i) => i.key === key);
  if (!found) throw new Error(`missing item ${key}`);
  return found;
}

function newStage(): Stage {
  return new Stage(new FakeCanvas() as never);
}

describe("scene context menu", () => {
  it("preview / take / rename / duplicate / add / delete drive the real Stage", () => {
    const stage = newStage();
    const second = stage.addScene("Two");
    const first = stage.scenes[0]!;
    const onTake = vi.fn();
    const onRename = vi.fn();
    const items = buildSceneContextItems(stage, first, { onTake, onRename });

    item(items, "preview").onClick?.();
    expect(stage.previewId).toBe(first.id);
    item(items, "take").onClick?.();
    expect(onTake).toHaveBeenCalledWith(first.id);
    item(items, "rename").onClick?.();
    expect(onRename).toHaveBeenCalledWith(first);
    item(items, "duplicate").onClick?.();
    expect(stage.scenes).toHaveLength(3);
    item(items, "add").onClick?.();
    expect(stage.scenes).toHaveLength(4);
    const items2 = buildSceneContextItems(stage, second, { onTake, onRename });
    item(items2, "delete").onClick?.();
    expect(stage.sceneById(second.id)).toBeNull();
  });

  it("delete is disabled when only one scene remains", () => {
    const stage = newStage();
    const items = buildSceneContextItems(stage, stage.scenes[0]!, { onTake: vi.fn(), onRename: vi.fn() });
    expect(item(items, "delete").disabled).toBe(true);
    expect(item(items, "delete").disabledTitle).toMatch(/at least one scene/);
  });
});

describe("source context menu", () => {
  function stageWithStack() {
    const stage = newStage();
    const sceneId = stage.scenes[0]!.id;
    const text = stage.addSource(sceneId, "text")!;
    const color = stage.addSource(sceneId, "color")!;
    return { stage, sceneId, text, color };
  }

  it("duplicate creates a selected deep copy directly in front of the original", () => {
    const { stage, sceneId, text } = stageWithStack();
    const scene = stage.sceneById(sceneId)!;
    const onSelect = vi.fn();
    const items = buildSourceContextItems(stage, scene, text, {
      onSelect, onRename: vi.fn(), onRemove: vi.fn(),
    });
    item(items, "duplicate").onClick?.();
    const after = stage.sceneById(sceneId)!;
    const idx = after.sources.findIndex((s) => s.id === text.id);
    const copy = after.sources[idx + 1]!;
    expect(copy.name).toBe(`${text.name} copy`);
    expect(copy.id).not.toBe(text.id);
    expect(onSelect).toHaveBeenCalledWith(copy.id);
    // nested settings are copied, not shared
    copy.text!.content = "COPY ONLY";
    expect(after.sources[idx]!.text!.content).not.toBe("COPY ONLY");
  });

  it("move / visibility / lock / rename / remove call the real operations", () => {
    const { stage, sceneId, text } = stageWithStack();
    const onRename = vi.fn();
    const onRemove = vi.fn();
    const scene = stage.sceneById(sceneId)!;
    const items = buildSourceContextItems(stage, scene, text, {
      onSelect: vi.fn(), onRename, onRemove,
    });
    item(items, "front").onClick?.();
    expect(stage.sceneById(sceneId)!.sources.at(-1)!.id).toBe(text.id);
    item(items, "visible").onClick?.();
    expect(stage.sceneById(sceneId)!.sources.find((s) => s.id === text.id)!.visible).toBe(false);
    item(items, "lock").onClick?.();
    expect(stage.sceneById(sceneId)!.sources.find((s) => s.id === text.id)!.locked).toBe(true);
    item(items, "rename").onClick?.();
    expect(onRename).toHaveBeenCalledWith(expect.objectContaining({ id: text.id }));
    item(items, "remove").onClick?.();
    expect(onRemove).toHaveBeenCalledWith(expect.objectContaining({ id: text.id }));
    expect(item(items, "remove").danger).toBe(true);
  });

  it("moves disable at the ends of the stack", () => {
    const { stage, sceneId, color } = stageWithStack();
    const scene = stage.sceneById(sceneId)!;
    const frontItems = buildSourceContextItems(stage, scene, color, {
      onSelect: vi.fn(), onRename: vi.fn(), onRemove: vi.fn(),
    });
    expect(item(frontItems, "front").disabled).toBe(true); // color was added last = front
    expect(item(frontItems, "back").disabled).toBeFalsy();
    const back = scene.sources[0]!;
    const backItems = buildSourceContextItems(stage, scene, back, {
      onSelect: vi.fn(), onRename: vi.fn(), onRemove: vi.fn(),
    });
    expect(item(backItems, "back").disabled).toBe(true);
  });
});
