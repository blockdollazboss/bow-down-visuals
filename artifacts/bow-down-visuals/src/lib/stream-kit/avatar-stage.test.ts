/**
 * Avatar × stage/scenes integration: an avatar source is a
 * first-class scene citizen — factory defaults, settings that
 * survive scene duplication, and stage rendering that composites
 * the director's canvas when one exists and shows the honest
 * placeholder note when it doesn't. The pool's director is replaced
 * with a recording stub (the pool's own wiring is what is under
 * test, not the director — that has its own suite).
 */
import { describe, it, expect } from "vitest";
import { SourcePool, drawScene } from "./stage";
import { createScene, createSource, duplicateScene } from "./scenes";

class FakeCtx {
  calls: string[] = [];
  fillStyle: unknown = "";
  strokeStyle: unknown = "";
  globalAlpha = 1;
  font = "";
  textAlign = "";
  textBaseline = "";
  lineWidth = 1;
  save(): void {}
  restore(): void {}
  clearRect(): void { this.calls.push("clearRect"); }
  fillRect(): void { this.calls.push("fillRect"); }
  strokeRect(): void { this.calls.push("strokeRect"); }
  drawImage(): void { this.calls.push("drawImage"); }
  fillText(): void { this.calls.push("fillText"); }
  createLinearGradient(): { addColorStop: () => void } { return { addColorStop: () => undefined }; }
}

class FakeCanvas {
  width = 720;
  height = 720;
  ctx = new FakeCtx();
  getContext(): FakeCtx {
    return this.ctx;
  }
}

interface DirectorStub {
  canvas: FakeCanvas | null;
  forgotten: string[];
  canvasForCalls: number;
}

function poolWithDirector(stub: DirectorStub): SourcePool {
  const pool = new SourcePool();
  const fake = {
    canvasFor: () => {
      stub.canvasForCalls++;
      return stub.canvas as never;
    },
    noteFor: () => "Add your picture in the source settings",
    statusFor: () => ({ requested: "face", mode: "idle", fellBack: false, reason: null, engine: "off" }),
    forget: (id: string) => {
      stub.forgotten.push(id);
    },
  };
  (pool as unknown as { avatarDirector: unknown }).avatarDirector = fake;
  return pool;
}

describe("avatar scenes", () => {
  it("createSource('avatar') carries the house defaults", () => {
    const s = createSource("avatar");
    expect(s.type).toBe("avatar");
    expect(s.name).toBe("Avatar");
    expect(s.avatar).toEqual({ character: "shark", drive: "face", sensitivity: 1 });
    expect(s.fit).toBe("contain");
    expect({ x: s.x, y: s.y, w: s.w, h: s.h }).toEqual({ x: 0.3, y: 0.08, w: 0.4, h: 0.84 });
  });

  it("duplicateScene deep-copies avatar settings", () => {
    const scene = createScene("Main", [createSource("avatar")]);
    scene.sources[0]!.avatar = { character: "mask", drive: "voice", sensitivity: 1.3, imageUrl: "https://x/y.png" };
    const copy = duplicateScene(scene);
    expect(copy.sources[0]!.avatar).toEqual({ character: "mask", drive: "voice", sensitivity: 1.3, imageUrl: "https://x/y.png" });
    copy.sources[0]!.avatar!.character = "mic";
    expect(scene.sources[0]!.avatar!.character).toBe("mask");
    expect(copy.sources[0]!.id).not.toBe(scene.sources[0]!.id);
  });
});

describe("avatar on stage", () => {
  it("composites the director's canvas like any other source", () => {
    const stub: DirectorStub = { canvas: new FakeCanvas(), forgotten: [], canvasForCalls: 0 };
    const pool = poolWithDirector(stub);
    const scene = createScene("S", [createSource("avatar")]);
    const ctx = new FakeCtx();
    drawScene(ctx as never, scene, pool, 1280, 720);
    expect(stub.canvasForCalls).toBe(1);
    expect(ctx.calls).toContain("drawImage");
  });

  it("no canvas yet → the placeholder carries the director's note", () => {
    const stub: DirectorStub = { canvas: null, forgotten: [], canvasForCalls: 0 };
    const pool = poolWithDirector(stub);
    const scene = createScene("S", [createSource("avatar")]);
    const ctx = new FakeCtx();
    drawScene(ctx as never, scene, pool, 1280, 720);
    expect(ctx.calls).not.toContain("drawImage");
    expect(ctx.calls).toContain("fillText");
    expect(pool.avatarNoteFor(scene.sources[0]!)).toContain("Add your picture");
  });

  it("pool.forget releases the avatar through the director", () => {
    const stub: DirectorStub = { canvas: null, forgotten: [], canvasForCalls: 0 };
    const pool = poolWithDirector(stub);
    pool.forget("src-123");
    expect(stub.forgotten).toEqual(["src-123"]);
  });
});
