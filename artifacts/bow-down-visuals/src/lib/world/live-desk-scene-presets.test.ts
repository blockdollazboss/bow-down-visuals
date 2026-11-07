/**
 * live-desk wave IV — #94: the Go Live scene presets in-World, via
 * the controller relay.
 *
 * Pins:
 * - the desk's preset menu IS the stream-kit registry (reference-
 *   identical to SCENE_PRESETS — the array ScenesPanel renders), all
 *   9 presets, and the panel remains a registry consumer;
 * - the relay carries a new command, scene.preset.apply { presetId },
 *   and nothing about what a preset MEANS travels the wire — only
 *   which one;
 * - end to end over a hand-shuttled relay: the in-world remote's pick
 *   reaches a ControllerStageClient whose executor is wired exactly
 *   like BroadcastStudio's (applyScenePreset on a REAL Stage), and
 *   the studio's published state confirms the desk — the scene the
 *   stage holds matches a direct panel apply of the same preset
 *   field-for-field (ids aside), framed in Preview, Program
 *   untouched, and the pending beat clears on that confirmation;
 * - the confirm predicate is the application's signature (a NEW
 *   scene named exactly the preset, in Preview, Program unchanged):
 *   unrelated fresh state does not confirm, and an unknown preset id
 *   can never confirm — the stage applies nothing for it either;
 * - the stage executor in BroadcastStudio runs the command through
 *   applyScenePreset (source pin — the panel's own path, not a
 *   reimplementation);
 * - the desk renders the picker from the seam under the #89 deck,
 *   gates it on the deck's own can-control + confirmed state, and
 *   sends through the seam's args builder;
 * - the board records the carry as #94 (pinned by containment so the
 *   wave-IV lanes' entries can join it), and nothing charges.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import {
  SCENE_PRESET_OPTIONS, SCENE_PRESET_APPLY_COMMAND, SCENE_PRESET_PICKER_NOTE,
  scenePresetApplyArgs, isScenePresetId, LIVE_WAVE4_PROMOTIONS,
} from "./live-desk";
import {
  SCENE_PRESETS, scenePresetById, buildSceneFromPreset, applyScenePreset,
} from "../stream-kit/scene-presets";
import { Stage } from "../stream-kit/stage";
import {
  CONTROLLER_COMMANDS, ControllerRemoteClient, ControllerStageClient, expectFor,
  type ControllerClientDeps, type ControllerSocketLike, type ControllerState,
} from "../stream-controller";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const deskSrc = read("../../components/world/native/LiveDesk.tsx");
const studioSrc = read("../../components/go-live/BroadcastStudio.tsx");
const panelSrc = read("../../components/go-live/studio/ScenesPanel.tsx");

/* ── a real Stage, on the kit suite's hand-stubbed document ──────── */

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

/* ── the relay, hand-shuttled the way the server shuttles it ─────── */

class FakeSocket implements ControllerSocketLike {
  readyState = 1;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code?: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
    this.onclose?.({});
  }
  emit(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
  lastFrame(): any {
    return JSON.parse(this.sent.at(-1)!);
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function deps(sockets: Record<string, FakeSocket>): ControllerClientDeps {
  return {
    getAccessToken: async () => "tok",
    socketUrl: (role) => `ws://test/${role}`,
    openSocket: (url) => sockets[url.endsWith("/stage") ? "stage" : "remote"]!,
    setTimeoutFn: () => 0,
    clearTimeoutFn: () => undefined,
    now: () => 1_000_000,
  };
}

/** BroadcastStudio's confirmed-state snapshot, mirrored field for
 *  field over a real Stage (its scenes / program / preview reads). */
function studioState(stage: Stage): ControllerState {
  return {
    stageId: "stage-1",
    label: "Your studio",
    live: false,
    title: "Show",
    scenes: stage.scenes.map((s) => ({ id: s.id, name: s.name })),
    activeSceneId: stage.programId,
    previewSceneId: stage.previewId,
    micMuted: false,
    micPresent: false,
    cameraOn: false,
    recording: false,
    liveSince: null,
  };
}

/** BroadcastStudio's executor wiring for the new command, verbatim
 *  in miniature: applyScenePreset on the studio's own stage. */
function studioExecutor(stage: Stage) {
  return async (command: string, args: Record<string, unknown>): Promise<void> => {
    if (command !== "scene.preset.apply") return;
    const presetId = typeof args.presetId === "string" ? args.presetId : null;
    if (presetId) applyScenePreset(stage, presetId);
  };
}

async function relayHarness() {
  const stage = new Stage(new FakeCanvas() as never);
  const sockets = { remote: new FakeSocket(), stage: new FakeSocket() };
  const remote = new ControllerRemoteClient(deps(sockets), () => undefined);
  const stageClient = new ControllerStageClient(
    deps(sockets),
    studioExecutor(stage),
    () => studioState(stage),
    () => undefined,
  );
  await remote.start();
  await stageClient.start();
  sockets.remote.onopen?.();
  sockets.stage.onopen?.();
  /* presence + the stage's on-open publish, relayed as state.sync */
  sockets.remote.emit({ type: "presence", stageConnected: true, stageCount: 1 });
  sockets.remote.emit({ type: "state.sync", state: sockets.stage.lastFrame().state });
  const relayCommand = () => {
    sockets.stage.emit(sockets.remote.lastFrame());
  };
  const relayState = () => {
    sockets.remote.emit({ type: "state.sync", state: sockets.stage.lastFrame().state });
  };
  return { stage, sockets, remote, relayCommand, relayState };
}

describe("#94 the desk's menu is the preset registry itself", () => {
  it("is SCENE_PRESETS by reference — all 9, in the registry's order", () => {
    expect(SCENE_PRESET_OPTIONS).toBe(SCENE_PRESETS);
    expect(SCENE_PRESET_OPTIONS).toHaveLength(9);
    expect(SCENE_PRESET_OPTIONS.map((p) => p.id)).toEqual([
      "just-you", "camera-live-overlay", "screen-and-you", "screen-only",
      "starting-soon", "be-right-back", "avatar-stage", "guest-interview", "end-screen",
    ]);
    expect(SCENE_PRESET_OPTIONS.map((p) => p.name)).toEqual([
      "Just You", "Camera + Live Overlay", "Screen + You in the Corner",
      "Screen Only", "Starting Soon", "Be Right Back", "Live as Your Avatar",
      "Guest Interview", "End Screen",
    ]);
  });

  it("the 2D panel renders the same registry — one list, two faces", () => {
    expect(panelSrc).toContain("SCENE_PRESETS.map(");
    expect(panelSrc).toContain("applyScenePreset(stage, preset.id)");
  });

  it("the seam's id gate reads the registry, and the args carry only the id", () => {
    for (const p of SCENE_PRESETS) expect(isScenePresetId(p.id)).toBe(true);
    expect(isScenePresetId("no-such-preset")).toBe(false);
    expect(scenePresetApplyArgs("starting-soon")).toEqual({ presetId: "starting-soon" });
    expect(SCENE_PRESET_APPLY_COMMAND).toBe("scene.preset.apply");
  });

  it("the picker's note is the panel's own account of what a preset does", () => {
    expect(SCENE_PRESET_PICKER_NOTE).toContain("frames it in Preview");
    expect(SCENE_PRESET_PICKER_NOTE).toContain("take it to Program");
  });
});

describe("#94 the relay protocol", () => {
  it("carries scene.preset.apply as a first-class command", () => {
    expect(CONTROLLER_COMMANDS).toContain("scene.preset.apply");
  });

  it("the confirm predicate is the application's signature, nothing looser", () => {
    const before: ControllerState = {
      stageId: "stage-1", label: "Your studio", live: false, title: "Show",
      scenes: [{ id: "s1", name: "Main" }],
      activeSceneId: "s1", previewSceneId: "s1",
      micMuted: false, cameraOn: true, recording: false, liveSince: null,
    };
    const expect_ = expectFor("scene.preset.apply", { presetId: "starting-soon" }, before);
    /* The same state again is not an apply. */
    expect(expect_(before)).toBe(false);
    /* A new scene NOT in Preview is not the apply. */
    expect(expect_({
      ...before,
      scenes: [...before.scenes, { id: "s2", name: "Starting Soon" }],
    })).toBe(false);
    /* A new scene in Preview with the WRONG name is not this preset. */
    expect(expect_({
      ...before,
      scenes: [...before.scenes, { id: "s2", name: "Be Right Back" }],
      previewSceneId: "s2",
    })).toBe(false);
    /* Program moved — a preset apply never touches Program. */
    expect(expect_({
      ...before,
      scenes: [...before.scenes, { id: "s2", name: "Starting Soon" }],
      previewSceneId: "s2", activeSceneId: "s2",
    })).toBe(false);
    /* The real signature confirms. */
    expect(expect_({
      ...before,
      scenes: [...before.scenes, { id: "s2", name: "Starting Soon" }],
      previewSceneId: "s2",
    })).toBe(true);
  });

  it("an unknown preset id can never confirm", () => {
    const expect_ = expectFor("scene.preset.apply", { presetId: "no-such-preset" }, null);
    expect(expect_({
      stageId: "stage-1", label: "Your studio", live: false, title: "Show",
      scenes: [{ id: "s2", name: "Starting Soon" }],
      activeSceneId: null, previewSceneId: "s2",
      micMuted: false, cameraOn: true, recording: false, liveSince: null,
    })).toBe(false);
  });
});

describe("#94 end to end over the relay — parity with the panel's apply", () => {
  it("a desk pick builds the identical scene in the studio's Preview, Program untouched", async () => {
    const h = await relayHarness();
    const programBefore = h.stage.programId;
    expect(h.remote.state?.scenes).toHaveLength(1);

    const id = h.remote.send(SCENE_PRESET_APPLY_COMMAND, scenePresetApplyArgs("starting-soon"));
    expect(id).toBeTruthy();
    expect(h.sockets.remote.lastFrame()).toMatchObject({
      type: "command", command: "scene.preset.apply",
      args: { presetId: "starting-soon" }, targetStageId: "stage-1",
    });
    expect(h.remote.isPending("scene.preset.apply", "starting-soon")).toBe(true);
    expect(h.remote.isPending("scene.preset.apply", "just-you")).toBe(false);

    h.relayCommand();
    await flush();
    h.relayState();

    /* The stage's own truth: a new scene, in Preview, Program same. */
    expect(h.stage.scenes).toHaveLength(2);
    expect(h.stage.programId).toBe(programBefore);
    expect(h.stage.previewScene().name).toBe("Starting Soon");

    /* Field-for-field the scene a direct panel apply builds
       (fresh ids aside) — same code path, same registry. */
    const held = h.stage.previewScene();
    const direct = buildSceneFromPreset(scenePresetById("starting-soon")!);
    expect(held.sources.map((s) => ({ ...s, id: "" }))).toEqual(
      direct.sources.map((s) => ({ ...s, id: "" })),
    );

    /* The desk confirms from the studio's state and the beat clears. */
    expect(h.remote.state?.scenes).toHaveLength(2);
    expect(h.remote.state?.previewSceneId).toBe(h.stage.previewId);
    expect(h.remote.state?.activeSceneId).toBe(programBefore);
    expect(h.remote.isPending("scene.preset.apply", "starting-soon")).toBe(false);
    expect(h.remote.notice).toBeNull();
  });

  it("every one of the 9 presets applies through the relay by its registry name", async () => {
    const h = await relayHarness();
    for (const preset of SCENE_PRESETS) {
      const before = h.stage.scenes.length;
      h.remote.send(SCENE_PRESET_APPLY_COMMAND, scenePresetApplyArgs(preset.id));
      h.relayCommand();
      await flush();
      h.relayState();
      expect(h.stage.scenes.length, preset.id).toBe(before + 1);
      expect(h.stage.previewScene().name, preset.id).toBe(preset.name);
      expect(h.remote.isPending("scene.preset.apply", preset.id), preset.id).toBe(false);
    }
    expect(h.stage.scenes).toHaveLength(1 + SCENE_PRESETS.length);
  });

  it("an unknown preset id applies nothing and its beat honestly expires unconfirmed", async () => {
    const h = await relayHarness();
    h.remote.send(SCENE_PRESET_APPLY_COMMAND, scenePresetApplyArgs("no-such-preset"));
    h.relayCommand();
    await flush();
    const scenesBefore = h.stage.scenes.length;
    h.relayState();
    expect(h.stage.scenes).toHaveLength(scenesBefore);
    /* Never confirmed — it stays pending until the ack window sweeps
       it (the harness clock is fixed, so it is still pending here;
       stream-controller.test.ts pins the expiry beat itself). */
    expect(h.remote.isPending("scene.preset.apply", "no-such-preset")).toBe(true);
  });
});

describe("#94 the stage executor and the desk (source pins)", () => {
  it("BroadcastStudio executes the command through applyScenePreset on its own stage", () => {
    expect(studioSrc).toContain("applyScenePreset");
    expect(studioSrc).toContain('case "scene.preset.apply"');
    expect(studioSrc).toContain("applyScenePreset(st, presetId)");
  });

  it("the desk renders the picker from the seam, under the controller deck", () => {
    expect(deskSrc).toContain('data-testid="world-live-scene-presets"');
    expect(deskSrc).toContain("SCENE_PRESET_OPTIONS.map(");
    expect(deskSrc).toContain("worldDeskRemainder.liveScenePickerNote");
    expect(deskSrc).toContain("world-live-preset-${preset.id}");
  });

  it("a pick sends the relay command with the seam's args, gated like the deck", () => {
    expect(deskSrc).toContain("client?.send(SCENE_PRESET_APPLY_COMMAND, scenePresetApplyArgs(preset.id))");
    expect(deskSrc).toContain("client?.isPending(SCENE_PRESET_APPLY_COMMAND, preset.id)");
  });

  it("the desk holds no preset list of its own (no second registry to drift)", () => {
    expect(deskSrc).not.toContain("Starting Soon");
    expect(deskSrc).not.toContain("Be Right Back");
    expect(deskSrc).not.toContain("SCENE_PRESETS");
  });
});

describe("#94 the board", () => {
  it("records the carry as #94 on the wave-IV board, by containment", () => {
    const mine = LIVE_WAVE4_PROMOTIONS.filter((entry) => entry.includes("#94"));
    expect(mine).toHaveLength(1);
    expect(mine[0]).toContain("Scene presets");
    expect(mine[0]).toContain("scene.preset.apply");
    expect(mine[0]).toContain("applyScenePreset");
    expect(mine[0]).toContain("Free");
  });
});
