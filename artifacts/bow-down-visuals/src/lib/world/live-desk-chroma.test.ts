/**
 * live-desk wave IV — #95: per-source chroma key in-World, via the
 * controller relay.
 *
 * Pins:
 * - the desk's tables ARE the 2D panel's (SourcesPanel's mode pills,
 *   slider caps and explainer; scenes.ts's creation defaults) — the
 *   seam re-declares nothing the kit doesn't already own;
 * - the relay carries a new command, scene.chroma.update { sceneId,
 *   sourceId, cameraMode, chroma? } — parameters only — and the
 *   api-server's relay allowlist carries it too (the server drops
 *   commands it doesn't know; the two lists are mirrors);
 * - parseChromaUpdate is the ONE validator both sides read: panel
 *   caps (similarity ≤ 0.9, smoothness ≤ 0.6), #rrggbb colors, the
 *   kit flip takes no settings; anything else is no update at all;
 * - end to end over a hand-shuttled relay: the in-world remote's
 *   change reaches a ControllerStageClient whose executor is wired
 *   exactly like BroadcastStudio's (parseChromaUpdate +
 *   Stage.updateSource on a REAL Stage) and the applied state is
 *   field-for-field a direct SourcesPanel apply — flip, retune,
 *   flip back (stored settings persist, the panel's semantics);
 * - the confirm predicate is the exact signature (named scene +
 *   source, exact mode, exact key settings in the studio's
 *   published cameraSources): partial matches, older state without
 *   cameraSources, invalid params and non-camera targets never
 *   confirm and apply nothing;
 * - the desk renders per-source controls from the seam under the
 *   #89 deck and holds no keyer of its own;
 * - the board records the carry as #95 (pinned by containment so
 *   the wave-IV lanes' entries can join it) and the follow-on list
 *   no longer names the chroma key. Nothing charges.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import {
  SOURCE_CHROMA_UPDATE_COMMAND, CAMERA_MODE_OPTIONS, CHROMA_SLIDERS, CHROMA_DEFAULTS,
  SOURCE_CHROMA_NOTE, chromaSettingsFor, chromaWithSlider, chromaUpdateArgs, isChromaUpdateReady,
  LIVE_WAVE4_PROMOTIONS, LIVE_NATIVE_FOLLOW_ONS,
} from "./live-desk";
import { createSource } from "../stream-kit/scenes";
import { Stage } from "../stream-kit/stage";
import {
  CONTROLLER_COMMANDS, ControllerRemoteClient, ControllerStageClient, expectFor, parseChromaUpdate,
  type ControllerClientDeps, type ControllerSocketLike, type ControllerState,
} from "../stream-controller";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const deskSrc = read("../../components/world/native/LiveDesk.tsx");
const studioSrc = read("../../components/go-live/BroadcastStudio.tsx");
const panelSrc = read("../../components/go-live/studio/SourcesPanel.tsx");
const relaySrc = read("../../../../api-server/src/lib/control-relay.ts");

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
 *  field over a real Stage — including the cameraSources publish. */
function studioState(stage: Stage): ControllerState {
  const previewScene = stage.previewScene() ?? null;
  return {
    stageId: "stage-1",
    label: "Your studio",
    live: false,
    title: "Show",
    scenes: stage.scenes.map((s) => ({ id: s.id, name: s.name })),
    activeSceneId: stage.programId,
    previewSceneId: stage.previewId,
    cameraSources: (previewScene?.sources ?? [])
      .filter((s) => s.type === "camera")
      .map((s) => ({
        sceneId: previewScene!.id,
        sourceId: s.id,
        name: s.name,
        cameraMode: s.cameraMode ?? ("kit" as const),
        chroma: s.chroma ? { ...s.chroma } : null,
      })),
    micMuted: false,
    micPresent: false,
    cameraOn: false,
    recording: false,
    liveSince: null,
  };
}

/** BroadcastStudio's executor wiring for the new command, verbatim
 *  in miniature: the one validator, a camera-source check, and
 *  Stage.updateSource — SourcesPanel's own write. */
function studioExecutor(stage: Stage) {
  return async (command: string, args: Record<string, unknown>): Promise<void> => {
    if (command !== "scene.chroma.update") return;
    const update = parseChromaUpdate(args);
    if (!update) return;
    const scene = stage.sceneById(update.sceneId);
    const source = scene?.sources.find((s) => s.id === update.sourceId);
    if (scene && source && source.type === "camera") {
      if (update.cameraMode === "kit") {
        stage.updateSource(scene.id, source.id, { cameraMode: "kit" });
      } else {
        stage.updateSource(scene.id, source.id, { cameraMode: "chroma", chroma: update.chroma! });
      }
    }
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
  const scene = stage.previewScene();
  const camera = scene.sources.find((s) => s.type === "camera")!;
  return { stage, sockets, remote, relayCommand, relayState, scene, camera };
}

const SETTINGS = { color: "#123abc", similarity: 0.5, smoothness: 0.2 };

describe("#95 the desk's tables are the panel's and the kit's own", () => {
  it("mode pills mirror SourcesPanel's, in the panel's order", () => {
    expect(CAMERA_MODE_OPTIONS).toEqual([
      { mode: "kit", label: "Studio backdrop" },
      { mode: "chroma", label: "Green screen" },
    ]);
    expect(panelSrc).toContain('["kit", "Studio backdrop"]');
    expect(panelSrc).toContain('["chroma", "Green screen"]');
    expect(SOURCE_CHROMA_UPDATE_COMMAND).toBe("scene.chroma.update");
  });

  it("defaults are the kit's creation defaults (createSource, deep-equal)", () => {
    expect(createSource("camera").chroma).toEqual(CHROMA_DEFAULTS);
    expect(CHROMA_DEFAULTS).toEqual({ color: "#00FF00", similarity: 0.32, smoothness: 0.12 });
  });

  it("sliders carry the panel's labels and caps", () => {
    expect(CHROMA_SLIDERS).toEqual([
      { key: "similarity", label: "Similarity", max: 90 },
      { key: "smoothness", label: "Smoothness", max: 60 },
    ]);
    expect(panelSrc).toContain("max={90}");
    expect(panelSrc).toContain("max={60}");
  });

  it("the closing note is SourcesPanel's explainer, verbatim", () => {
    /* The panel wraps the sentence across JSX source lines; the
       rendered words are the note exactly (whitespace-normalized
       on both sides — the words and punctuation are the pin). */
    expect(panelSrc.replace(/\s+/g, " ")).toContain(SOURCE_CHROMA_NOTE);
  });

  it("settings reads: stored settings win, null falls back to the defaults", () => {
    expect(chromaSettingsFor({ chroma: SETTINGS })).toEqual(SETTINGS);
    expect(chromaSettingsFor({ chroma: null })).toEqual(CHROMA_DEFAULTS);
  });

  it("a slider write moves only its own setting", () => {
    expect(chromaWithSlider(SETTINGS, "similarity", 0.7)).toEqual({ ...SETTINGS, similarity: 0.7 });
    expect(chromaWithSlider(SETTINGS, "smoothness", 0.05)).toEqual({ ...SETTINGS, smoothness: 0.05 });
  });
});

describe("#95 the args builder and the one validator", () => {
  it("the kit flip carries parameters only — no settings on the wire", () => {
    const args = chromaUpdateArgs({ sceneId: "s1", sourceId: "c1", cameraMode: "kit", chroma: SETTINGS });
    expect(args).toEqual({ sceneId: "s1", sourceId: "c1", cameraMode: "kit" });
    expect("chroma" in args).toBe(false);
  });

  it("keying carries a copy of the settings", () => {
    const args = chromaUpdateArgs({ sceneId: "s1", sourceId: "c1", cameraMode: "chroma", chroma: SETTINGS });
    expect(args).toEqual({ sceneId: "s1", sourceId: "c1", cameraMode: "chroma", chroma: SETTINGS });
    expect(args.chroma).not.toBe(SETTINGS);
  });

  it("the readiness gate is the validator's own read", () => {
    expect(isChromaUpdateReady({ sceneId: "s1", sourceId: "c1", cameraMode: "chroma", chroma: SETTINGS })).toBe(true);
    expect(isChromaUpdateReady({ sceneId: "s1", sourceId: "c1", cameraMode: "kit", chroma: null })).toBe(true);
    expect(isChromaUpdateReady({ sceneId: "s1", sourceId: "c1", cameraMode: "chroma", chroma: { ...SETTINGS, similarity: 0.95 } })).toBe(false);
    expect(isChromaUpdateReady({ sceneId: "s1", sourceId: "c1", cameraMode: "chroma", chroma: { ...SETTINGS, color: "green" } })).toBe(false);
    expect(isChromaUpdateReady({ sceneId: "", sourceId: "c1", cameraMode: "kit", chroma: null })).toBe(false);
  });

  it("parseChromaUpdate accepts the panel's full range, boundaries included", () => {
    expect(parseChromaUpdate({ sceneId: "s1", sourceId: "c1", cameraMode: "chroma", chroma: { color: "#00FF00", similarity: 0.9, smoothness: 0.6 } }))
      .toEqual({ sceneId: "s1", sourceId: "c1", cameraMode: "chroma", chroma: { color: "#00FF00", similarity: 0.9, smoothness: 0.6 } });
    expect(parseChromaUpdate({ sceneId: "s1", sourceId: "c1", cameraMode: "chroma", chroma: { color: "#000000", similarity: 0, smoothness: 0 } }))
      .toEqual({ sceneId: "s1", sourceId: "c1", cameraMode: "chroma", chroma: { color: "#000000", similarity: 0, smoothness: 0 } });
  });

  it("the kit flip ignores any settings riding along (normalized to null)", () => {
    expect(parseChromaUpdate({ sceneId: "s1", sourceId: "c1", cameraMode: "kit", chroma: { color: "junk" } }))
      .toEqual({ sceneId: "s1", sourceId: "c1", cameraMode: "kit", chroma: null });
  });

  it("rejects everything the panel cannot produce", () => {
    const chroma = (patch: Record<string, unknown>) => ({ sceneId: "s1", sourceId: "c1", cameraMode: "chroma", chroma: { ...SETTINGS, ...patch } });
    expect(parseChromaUpdate(chroma({ color: "#0F0" }))).toBeNull();
    expect(parseChromaUpdate(chroma({ color: "00FF00" }))).toBeNull();
    expect(parseChromaUpdate(chroma({ color: "#GGGGGG" }))).toBeNull();
    expect(parseChromaUpdate(chroma({ similarity: 0.91 }))).toBeNull();
    expect(parseChromaUpdate(chroma({ similarity: -0.1 }))).toBeNull();
    expect(parseChromaUpdate(chroma({ similarity: Number.NaN }))).toBeNull();
    expect(parseChromaUpdate(chroma({ similarity: "0.5" }))).toBeNull();
    expect(parseChromaUpdate(chroma({ smoothness: 0.61 }))).toBeNull();
    expect(parseChromaUpdate({ sceneId: "s1", sourceId: "c1", cameraMode: "chroma" })).toBeNull();
    expect(parseChromaUpdate({ sceneId: "s1", sourceId: "c1", cameraMode: "matte", chroma: SETTINGS })).toBeNull();
    expect(parseChromaUpdate({ sourceId: "c1", cameraMode: "kit" })).toBeNull();
    expect(parseChromaUpdate({ sceneId: "s1", cameraMode: "kit" })).toBeNull();
    expect(parseChromaUpdate({})).toBeNull();
  });
});

describe("#95 the relay protocol", () => {
  it("carries scene.chroma.update on BOTH allowlist mirrors", () => {
    expect(CONTROLLER_COMMANDS).toContain("scene.chroma.update");
    /* The api-server relay drops any command its own list doesn't
       carry — without the mirror the frame never reaches a stage. */
    expect(relaySrc).toContain('"scene.chroma.update"');
  });

  it("the confirm predicate is the exact signature, nothing looser", () => {
    const base: ControllerState = {
      stageId: "stage-1", label: "Your studio", live: false, title: "Show",
      scenes: [{ id: "s1", name: "Main" }], activeSceneId: "s1", previewSceneId: "s1",
      cameraSources: [{ sceneId: "s1", sourceId: "c1", name: "Camera", cameraMode: "kit", chroma: { ...CHROMA_DEFAULTS } }],
      micMuted: false, cameraOn: true, recording: false, liveSince: null,
    };
    const expect_ = expectFor("scene.chroma.update",
      { sceneId: "s1", sourceId: "c1", cameraMode: "chroma", chroma: SETTINGS }, base);
    /* The same state again is not the update. */
    expect(expect_(base)).toBe(false);
    /* Mode flipped but settings still the defaults — a retune is
       part of the signature. */
    expect(expect_({
      ...base,
      cameraSources: [{ sceneId: "s1", sourceId: "c1", name: "Camera", cameraMode: "chroma", chroma: { ...CHROMA_DEFAULTS } }],
    })).toBe(false);
    /* The right settings on a DIFFERENT source is not this press. */
    expect(expect_({
      ...base,
      cameraSources: [{ sceneId: "s1", sourceId: "c2", name: "Camera 2", cameraMode: "chroma", chroma: { ...SETTINGS } }],
    })).toBe(false);
    /* Older state with no cameraSources can never confirm. */
    expect(expect_({
      stageId: "stage-1", label: "Your studio", live: false, title: "Show",
      scenes: [{ id: "s1", name: "Main" }], activeSceneId: "s1", previewSceneId: "s1",
      micMuted: false, cameraOn: true, recording: false, liveSince: null,
    })).toBe(false);
    /* The real signature confirms. */
    expect(expect_({
      ...base,
      cameraSources: [{ sceneId: "s1", sourceId: "c1", name: "Camera", cameraMode: "chroma", chroma: { ...SETTINGS } }],
    })).toBe(true);
  });

  it("a kit flip confirms on the mode alone — stored settings are not the signature", () => {
    const base: ControllerState = {
      stageId: "stage-1", label: "Your studio", live: false, title: "Show",
      scenes: [{ id: "s1", name: "Main" }], activeSceneId: "s1", previewSceneId: "s1",
      cameraSources: [{ sceneId: "s1", sourceId: "c1", name: "Camera", cameraMode: "chroma", chroma: { ...SETTINGS } }],
      micMuted: false, cameraOn: true, recording: false, liveSince: null,
    };
    const expect_ = expectFor("scene.chroma.update",
      { sceneId: "s1", sourceId: "c1", cameraMode: "kit" }, base);
    expect(expect_(base)).toBe(false);
    expect(expect_({
      ...base,
      cameraSources: [{ sceneId: "s1", sourceId: "c1", name: "Camera", cameraMode: "kit", chroma: { ...SETTINGS } }],
    })).toBe(true);
  });

  it("invalid args can never confirm", () => {
    const expect_ = expectFor("scene.chroma.update",
      { sceneId: "s1", sourceId: "c1", cameraMode: "chroma", chroma: { ...SETTINGS, similarity: 0.95 } }, null);
    expect(expect_({
      stageId: "stage-1", label: "Your studio", live: false, title: "Show",
      scenes: [{ id: "s1", name: "Main" }], activeSceneId: "s1", previewSceneId: "s1",
      cameraSources: [{ sceneId: "s1", sourceId: "c1", name: "Camera", cameraMode: "chroma", chroma: { ...SETTINGS, similarity: 0.95 } }],
      micMuted: false, cameraOn: true, recording: false, liveSince: null,
    })).toBe(false);
  });
});

describe("#95 end to end over the relay — parity with the panel's apply", () => {
  it("a desk keying lands field-for-field as a direct panel apply, and confirms", async () => {
    const h = await relayHarness();
    expect(h.remote.state?.cameraSources).toEqual([{
      sceneId: h.scene.id, sourceId: h.camera.id, name: "Camera",
      cameraMode: "kit", chroma: { ...CHROMA_DEFAULTS },
    }]);

    const id = h.remote.send(SOURCE_CHROMA_UPDATE_COMMAND, chromaUpdateArgs({
      sceneId: h.scene.id, sourceId: h.camera.id, cameraMode: "chroma", chroma: SETTINGS,
    }));
    expect(id).toBeTruthy();
    expect(h.sockets.remote.lastFrame()).toMatchObject({
      type: "command", command: "scene.chroma.update",
      args: { sceneId: h.scene.id, sourceId: h.camera.id, cameraMode: "chroma", chroma: SETTINGS },
      targetStageId: "stage-1",
    });
    expect(h.remote.isPending(SOURCE_CHROMA_UPDATE_COMMAND, h.camera.id)).toBe(true);
    expect(h.remote.isPending(SOURCE_CHROMA_UPDATE_COMMAND, "some-other-source")).toBe(false);

    h.relayCommand();
    await flush();
    h.relayState();

    /* The stage's own truth. */
    const held = h.stage.previewScene().sources.find((s) => s.id === h.camera.id)!;
    expect(held.cameraMode).toBe("chroma");
    expect(held.chroma).toEqual(SETTINGS);

    /* Field-for-field the source a direct panel apply holds
       (re-read after the apply — updateSource replaces the
       source object, so a pre-apply reference would be stale). */
    const direct = new Stage(new FakeCanvas() as never);
    const dScene = direct.previewScene();
    const dCamera = dScene.sources.find((s) => s.type === "camera")!;
    direct.updateSource(dScene.id, dCamera.id, { cameraMode: "chroma", chroma: SETTINGS });
    const dHeld = direct.previewScene().sources.find((s) => s.id === dCamera.id)!;
    expect({ ...held, id: "" }).toEqual({ ...dHeld, id: "" });

    /* The desk confirms from the studio's state and the beat clears. */
    expect(h.remote.state?.cameraSources?.[0]).toMatchObject({ cameraMode: "chroma", chroma: SETTINGS });
    expect(h.remote.isPending(SOURCE_CHROMA_UPDATE_COMMAND, h.camera.id)).toBe(false);
    expect(h.remote.notice).toBeNull();
  });

  it("flipping back to the kit applies the mode only — stored settings persist", async () => {
    const h = await relayHarness();
    h.remote.send(SOURCE_CHROMA_UPDATE_COMMAND, chromaUpdateArgs({
      sceneId: h.scene.id, sourceId: h.camera.id, cameraMode: "chroma", chroma: SETTINGS,
    }));
    h.relayCommand();
    await flush();
    h.relayState();
    expect(h.remote.isPending(SOURCE_CHROMA_UPDATE_COMMAND, h.camera.id)).toBe(false);

    h.remote.send(SOURCE_CHROMA_UPDATE_COMMAND, chromaUpdateArgs({
      sceneId: h.scene.id, sourceId: h.camera.id, cameraMode: "kit", chroma: SETTINGS,
    }));
    expect(h.sockets.remote.lastFrame().args).toEqual({
      sceneId: h.scene.id, sourceId: h.camera.id, cameraMode: "kit",
    });
    h.relayCommand();
    await flush();
    h.relayState();
    const held = h.stage.previewScene().sources.find((s) => s.id === h.camera.id)!;
    expect(held.cameraMode).toBe("kit");
    expect(held.chroma).toEqual(SETTINGS);
    expect(h.remote.isPending(SOURCE_CHROMA_UPDATE_COMMAND, h.camera.id)).toBe(false);
    expect(h.remote.notice).toBeNull();
  });

  it("boundary tuning (0.9 / 0.6) applies and confirms", async () => {
    const h = await relayHarness();
    const edge = { color: "#00ff00", similarity: 0.9, smoothness: 0.6 };
    h.remote.send(SOURCE_CHROMA_UPDATE_COMMAND, chromaUpdateArgs({
      sceneId: h.scene.id, sourceId: h.camera.id, cameraMode: "chroma", chroma: edge,
    }));
    h.relayCommand();
    await flush();
    h.relayState();
    const held = h.stage.previewScene().sources.find((s) => s.id === h.camera.id)!;
    expect(held.chroma).toEqual(edge);
    expect(h.remote.isPending(SOURCE_CHROMA_UPDATE_COMMAND, h.camera.id)).toBe(false);
  });

  it("out-of-range params apply nothing and never confirm", async () => {
    const h = await relayHarness();
    h.remote.send(SOURCE_CHROMA_UPDATE_COMMAND, {
      sceneId: h.scene.id, sourceId: h.camera.id, cameraMode: "chroma",
      chroma: { color: "#00ff00", similarity: 0.95, smoothness: 0.2 },
    });
    h.relayCommand();
    await flush();
    h.relayState();
    const held = h.stage.previewScene().sources.find((s) => s.id === h.camera.id)!;
    expect(held.cameraMode).toBe("kit");
    expect(held.chroma).toEqual(CHROMA_DEFAULTS);
    /* Never confirmed — it stays pending until the ack window sweeps
       it (the harness clock is fixed, so it is still pending here;
       stream-controller.test.ts pins the expiry beat itself). */
    expect(h.remote.isPending(SOURCE_CHROMA_UPDATE_COMMAND, h.camera.id)).toBe(true);
  });

  it("a non-camera source and an unknown scene apply nothing and never confirm", async () => {
    const h = await relayHarness();
    const text = h.stage.addSource(h.scene.id, "text")!;
    h.remote.send(SOURCE_CHROMA_UPDATE_COMMAND, chromaUpdateArgs({
      sceneId: h.scene.id, sourceId: text.id, cameraMode: "chroma", chroma: SETTINGS,
    }));
    h.relayCommand();
    await flush();
    h.relayState();
    const heldText = h.stage.previewScene().sources.find((s) => s.id === text.id)!;
    expect(heldText.cameraMode).toBeUndefined();
    expect(h.remote.isPending(SOURCE_CHROMA_UPDATE_COMMAND, text.id)).toBe(true);

    h.remote.send(SOURCE_CHROMA_UPDATE_COMMAND, chromaUpdateArgs({
      sceneId: "no-such-scene", sourceId: h.camera.id, cameraMode: "chroma", chroma: SETTINGS,
    }));
    h.relayCommand();
    await flush();
    h.relayState();
    const heldCamera = h.stage.previewScene().sources.find((s) => s.id === h.camera.id)!;
    expect(heldCamera.cameraMode).toBe("kit");
    expect(h.remote.isPending(SOURCE_CHROMA_UPDATE_COMMAND, h.camera.id)).toBe(true);
  });
});

describe("#95 the stage executor and the desk (source pins)", () => {
  it("BroadcastStudio executes the command through the validator + updateSource", () => {
    expect(studioSrc).toContain('case "scene.chroma.update"');
    expect(studioSrc).toContain("parseChromaUpdate(args)");
    expect(studioSrc).toContain('st.updateSource(scene.id, source.id, { cameraMode: "kit" })');
    expect(studioSrc).toContain('st.updateSource(scene.id, source.id, { cameraMode: "chroma", chroma: update.chroma! })');
    expect(studioSrc).toContain("cameraSources:");
  });

  it("the desk renders per-source controls from the seam, under the controller deck", () => {
    expect(deskSrc).toContain('data-testid="world-live-source-chroma"');
    expect(deskSrc).toContain("world-live-chroma-${source.sourceId}");
    expect(deskSrc).toContain("CAMERA_MODE_OPTIONS.map(");
    expect(deskSrc).toContain("CHROMA_SLIDERS.map(");
    expect(deskSrc).toContain("worldDeskRemainder.liveChromaNote");
    expect(deskSrc).toContain('data-testid="world-live-chroma-unavailable"');
  });

  it("a change sends the relay command with the seam's args, pending per source", () => {
    expect(deskSrc).toContain("client?.send(SOURCE_CHROMA_UPDATE_COMMAND, chromaUpdateArgs(update))");
    expect(deskSrc).toContain("client?.isPending(SOURCE_CHROMA_UPDATE_COMMAND, source.sourceId)");
  });

  it("the desk holds no keyer of its own (the kit's keyer stays in the kit)", () => {
    expect(deskSrc).not.toContain("applyChromaKey");
    expect(deskSrc).not.toContain("chromaAlpha");
  });
});

describe("#95 the board", () => {
  it("records the carry as #95 on the wave-IV board, by containment", () => {
    const mine = LIVE_WAVE4_PROMOTIONS.filter((entry) => entry.includes("#95"));
    expect(mine).toHaveLength(1);
    expect(mine[0]).toContain("chroma");
    expect(mine[0]).toContain("scene.chroma.update");
    expect(mine[0]).toContain("updateSource");
    expect(mine[0]).toContain("Free");
  });

  it("the follow-on list no longer names the chroma key", () => {
    const joined = LIVE_NATIVE_FOLLOW_ONS.join(" ");
    expect(joined).not.toContain("chroma key");
    expect(joined).not.toContain("stage compositor");
  });
});
