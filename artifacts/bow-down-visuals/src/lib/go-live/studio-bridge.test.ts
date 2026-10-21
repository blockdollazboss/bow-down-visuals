/**
 * Studio bridge tests — promote/demote semantics against fake Stage
 * + AudioMixer shapes: putGuestOnStage adds exactly one bound guest
 * source to the program scene and wires the mixer channel;
 * takeGuestOffStage removes the source from EVERY scene and the
 * channel with it (no ghost tiles, no hot mics).
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  registerStudioStage,
  registerStudioMixer,
  putGuestOnStage,
  takeGuestOffStage,
  attachGuestAudio,
  guestMixerInputId,
} from "./studio-bridge";
import { guestFeeds } from "./guest-feeds";
import type { Scene, SceneSource } from "@/lib/stream-kit/scenes";

function fakeStage() {
  const scenes: Scene[] = [
    { id: "program", name: "Main", sources: [] },
    { id: "other", name: "Second", sources: [] },
  ];
  let seq = 0;
  const stage = {
    scenes,
    programScene: () => scenes[0],
    addSource: (sceneId: string, type: SceneSource["type"]) => {
      const scene = scenes.find((s) => s.id === sceneId);
      if (!scene) return null;
      const source: SceneSource = {
        id: `src-${++seq}`,
        type,
        name: "Guest",
        visible: true,
        locked: false,
        opacity: 1,
        x: 0.6,
        y: 0.58,
        w: 0.37,
        h: 0.37,
        fit: "cover",
        guest: { sessionId: "", name: "" },
      };
      scene.sources = [...scene.sources, source];
      return source;
    },
    updateSource: (sceneId: string, sourceId: string, patch: Partial<SceneSource>) => {
      const scene = scenes.find((s) => s.id === sceneId);
      if (!scene) return;
      scene.sources = scene.sources.map((s) => (s.id === sourceId ? { ...s, ...patch } : s));
    },
    removeSource: (sceneId: string, sourceId: string) => {
      const scene = scenes.find((s) => s.id === sceneId);
      if (!scene) return;
      scene.sources = scene.sources.filter((s) => s.id !== sourceId);
    },
  };
  return { stage: stage as never, scenes };
}

function fakeMixer() {
  const inputs = new Map<string, unknown>();
  const removed: string[] = [];
  return {
    inputs,
    removed,
    setInputStream: (id: string, stream: unknown) => inputs.set(id, stream),
    removeInput: (id: string) => {
      removed.push(id);
      inputs.delete(id);
    },
  };
}

beforeEach(() => {
  guestFeeds.clear();
});

describe("studio bridge", () => {
  it("putGuestOnStage adds one bound source to Program and is idempotent", () => {
    const { stage, scenes } = fakeStage();
    registerStudioStage(stage);
    expect(putGuestOnStage({ id: "g1", display_name: "Casey" })).toBe(true);
    expect(putGuestOnStage({ id: "g1", display_name: "Casey" })).toBe(true);
    const guestSources = scenes[0].sources.filter((s) => s.type === "guest");
    expect(guestSources).toHaveLength(1);
    expect(guestSources[0].guest).toEqual({ sessionId: "g1", name: "Casey" });
    expect(guestSources[0].name).toBe("Casey");
  });

  it("guest audio attaches to the guest mixer channel, incl. streams that arrive after promotion", () => {
    const { stage } = fakeStage();
    const mixer = fakeMixer();
    registerStudioStage(stage);
    guestFeeds.setRoster([{ id: "g1", display_name: "Casey", state: "on_stage" }]);
    /* promote before the stream lands: channel pending */
    putGuestOnStage({ id: "g1", display_name: "Casey" });
    const stream = { id: "stream" };
    guestFeeds.setStream("g1", stream as unknown as MediaStream);
    /* mixer registers later (camera start) and picks the feed up */
    registerStudioMixer(mixer as never);
    attachGuestAudio("g1", guestFeeds.streamFor("g1"));
    expect(mixer.inputs.get(guestMixerInputId("g1"))).toBe(stream);
  });

  it("takeGuestOffStage removes the source from every scene and kills the channel", () => {
    const { stage, scenes } = fakeStage();
    const mixer = fakeMixer();
    registerStudioStage(stage);
    registerStudioMixer(mixer as never);
    putGuestOnStage({ id: "g1", display_name: "Casey" });
    /* a copy of the tile in a second scene goes too */
    const dup = stage.addSource("other", "guest");
    stage.updateSource("other", dup!.id, { guest: { sessionId: "g1", name: "Casey" } });
    attachGuestAudio("g1", { id: "s" } as unknown as MediaStream);
    takeGuestOffStage("g1");
    expect(scenes[0].sources.filter((s) => s.type === "guest")).toHaveLength(0);
    expect(scenes[1].sources.filter((s) => s.type === "guest")).toHaveLength(0);
    expect(mixer.removed).toContain(guestMixerInputId("g1"));
    expect(mixer.inputs.has(guestMixerInputId("g1"))).toBe(false);
  });

  it("without a mounted studio, putGuestOnStage reports false instead of pretending", () => {
    registerStudioStage(null as never);
    expect(putGuestOnStage({ id: "g1", display_name: "Casey" })).toBe(false);
  });
});
