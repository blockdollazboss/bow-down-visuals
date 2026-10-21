/**
 * GuestFeeds registry tests — roster truth, stream attachment, and
 * the stage resolver, with an injected video factory (no DOM needed).
 */
import { describe, it, expect } from "vitest";
import { GuestFeeds } from "./guest-feeds";

function makeFeeds() {
  const videos: Array<{ srcObject: unknown; muted: boolean; playsInline: boolean; play: () => Promise<void> }> = [];
  const feeds = new GuestFeeds(() => {
    const v = {
      srcObject: null as unknown,
      muted: false,
      playsInline: false,
      play: () => Promise.resolve(),
    };
    videos.push(v);
    return v as unknown as HTMLVideoElement;
  });
  return { feeds, videos };
}

const roster = [
  { id: "g1", display_name: "Casey", state: "backstage" },
  { id: "g2", display_name: "Robin", state: "on_stage" },
  { id: "g3", display_name: "Gone", state: "left" },
];

describe("GuestFeeds", () => {
  it("roster keeps only active guests, with their DB states", () => {
    const { feeds } = makeFeeds();
    feeds.setRoster(roster);
    expect(feeds.all().map((f) => f.sessionId)).toEqual(["g1", "g2"]);
    expect(feeds.onStage().map((f) => f.sessionId)).toEqual(["g2"]);
    expect(feeds.get("g1")?.name).toBe("Casey");
  });

  it("a roster refresh preserves attached streams and drops the departed", () => {
    const { feeds } = makeFeeds();
    feeds.setRoster(roster);
    const stream = { id: "s" } as unknown as MediaStream;
    feeds.setStream("g1", stream);
    feeds.setRoster([{ id: "g1", display_name: "Casey", state: "on_stage" }]);
    expect(feeds.get("g1")?.stream).toBe(stream);
    expect(feeds.get("g1")?.state).toBe("on_stage");
    expect(feeds.get("g2")).toBeNull();
  });

  it("setStream builds one shared video element, muted + inline, and clears it on null", () => {
    const { feeds, videos } = makeFeeds();
    feeds.setRoster(roster);
    const stream = { id: "s" } as unknown as MediaStream;
    feeds.setStream("g1", stream);
    const video = feeds.videoFor("g1") as unknown as { srcObject: unknown; muted: boolean; playsInline: boolean };
    expect(video).not.toBeNull();
    expect(video.srcObject).toBe(stream);
    expect(video.muted).toBe(true);
    expect(video.playsInline).toBe(true);
    feeds.setStream("g1", null);
    expect(video.srcObject).toBeNull();
    expect(videos).toHaveLength(1);
  });

  it("subscribers are notified on roster/stream/state changes", () => {
    const { feeds } = makeFeeds();
    let calls = 0;
    const off = feeds.subscribe(() => calls++);
    feeds.setRoster(roster);
    feeds.setState("g1", "on_stage");
    feeds.drop("g2");
    expect(calls).toBe(3);
    off();
    feeds.setState("g1", "backstage");
    expect(calls).toBe(3);
  });
});
