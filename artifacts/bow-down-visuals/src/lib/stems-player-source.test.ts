/**
 * N14 Stems Player — source pins for the docking + playback-only rules
 * that unit tests on the lib can't see:
 *
 *  - StemPlayerControls renders NOTHING when the player has no stems
 *    (honest absence — no greyed-out dead buttons, no placeholder).
 *  - The controls expose mute/solo only: no download, no export, no
 *    anchor to a stem URL anywhere in the player surfaces we touch.
 *  - Controls are docked into the EXISTING surfaces (player bar +
 *    track page) — there is no standalone stems page/route.
 *  - The queue persists descriptors only: the provider never writes
 *    playable stem URLs into localStorage.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const SRC = new URL("..", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, SRC), "utf8");

const controls = read("components/player/StemPlayerControls.tsx");
const bar = read("components/player/StreamingPlayerBar.tsx");
const trackPage = read("pages/stream/track.tsx");
const provider = read("contexts/StreamingPlayerContext.tsx");
const app = read("App.tsx");

describe("StemPlayerControls — honest absence + playback only", () => {
  it("returns null when the current track has no stems", () => {
    expect(controls).toContain("if (!player || !player.stems || player.stems.length === 0) return null;");
  });

  it("renders exactly the player's stems, one mute + one solo each", () => {
    expect(controls).toContain("stems.map((stem)");
    expect(controls).toContain("toggleStemMute");
    expect(controls).toContain("toggleStemSolo");
    expect(controls).toContain("stem-mute-");
    expect(controls).toContain("stem-solo-");
  });

  it("has NO download / export / save affordance for stem audio", () => {
    const lower = controls.toLowerCase();
    expect(lower).not.toContain("download");
    expect(lower).not.toContain("export");
    expect(lower).not.toContain("<a ");
    expect(lower).not.toContain("href");
    expect(controls).not.toContain(".url");
  });
});

describe("docking — existing surfaces only, no standalone page", () => {
  it("the player bar docks the controls", () => {
    expect(bar).toContain("StemPlayerControls");
  });

  it("the stream-track page docks the controls", () => {
    expect(trackPage).toContain("StemPlayerControls");
  });

  it("no new route was added for a stems page", () => {
    expect(app).not.toContain("stems-player");
    expect(app).not.toContain("StemPlayerPage");
  });
});

describe("provider — playback-only delivery hygiene", () => {
  it("stem URLs are fetched at play time from the playback endpoint, not stored", () => {
    expect(provider).toContain("fetchTrackStemPlayback");
  });

  it("the persisted queue carries stem descriptors (keys/labels), never playable URLs", () => {
    // QueueItem.stems is StemDescriptor[] — the type carries no url field.
    expect(provider).toContain("stems?: StemDescriptor[] | null;");
    const lib = read("lib/stems-player.ts");
    const descriptorBlock = lib.slice(lib.indexOf("export interface StemDescriptor"), lib.indexOf("export interface PlayableStem"));
    expect(descriptorBlock).not.toContain("url");
  });

  it("stem mode replaces the master element only when playable stems exist", () => {
    expect(provider).toContain("if (playable.length === 0) { startMaster(); return; }");
    expect(provider).toContain("stemActiveRef.current = true;");
  });
});
