import { describe, expect, it } from "vitest";
import {
  HANDOFF_INTENTS, HandoffValidationError, handoffIntent, handoffRoute,
  intentsForKind, sendAssetToDesk, stashAssetHandoff, takeAssetHandoff,
} from "./asset-handoff";
import { stashBeatHandoff, takeBeatHandoff } from "./beat-handoff";
import type { HubAsset } from "./hub-project";

const projectAssets: HubAsset[] = [
  { id: "asset-1", kind: "song", url: "https://cdn.example/song.mp3", label: "My Song", createdAt: 1 },
  { id: "asset-2", kind: "image", url: "https://cdn.example/cover.jpg", label: "Cover", createdAt: 2 },
];

describe("generalized asset handoffs", () => {
  it("declares explicit typed intents for the house flows", () => {
    expect(handoffIntent("song-to-video")?.targetDesk).toBe("video");
    expect(handoffIntent("cover-to-video")?.kinds).toEqual(["image", "thumbnail"]);
    expect(handoffIntent("video-to-photo")?.targetModule).toBe("thumbnail-generate");
    expect(handoffIntent("stems-to-audio")?.targetDesk).toBe("audio");
    expect(HANDOFF_INTENTS.every((i) => i.label.startsWith("Send to"))).toBe(true);
    expect(intentsForKind("song").map((i) => i.id)).toContain("song-to-video");
  });

  it("stashes and takes a project asset one-shot", () => {
    const id = stashAssetHandoff({
      intentId: "song-to-video",
      asset: { hubAssetId: "asset-1", kind: "song", url: projectAssets[0].url, label: "My Song" },
      projectAssets,
    });
    const taken = takeAssetHandoff(id);
    expect(taken?.asset.label).toBe("My Song");
    expect(takeAssetHandoff(id)).toBeNull();
  });

  it("rejects assets that don't belong to the caller", () => {
    expect(() => stashAssetHandoff({
      intentId: "song-to-video",
      asset: { hubAssetId: "someone-elses", kind: "song", url: "https://x/y.mp3", label: "Nope" },
      projectAssets,
    })).toThrow(HandoffValidationError);
    expect(() => stashAssetHandoff({
      intentId: "song-to-video",
      asset: { kind: "song", url: "https://x/y.mp3", label: "No id, no blob" },
      projectAssets,
    })).toThrow(HandoffValidationError);
  });

  it("rejects kind/intent mismatches and unknown intents", () => {
    expect(() => stashAssetHandoff({
      intentId: "song-to-video",
      asset: { hubAssetId: "asset-2", kind: "image", url: projectAssets[1].url, label: "Cover" },
      projectAssets,
    })).toThrow(HandoffValidationError);
    expect(() => stashAssetHandoff({
      intentId: "nope",
      asset: { kind: "song", url: "u", label: "l" },
      blob: new Blob(["x"]),
    })).toThrow(HandoffValidationError);
  });

  it("builds receiver routes from the desk registry", () => {
    expect(handoffRoute("song-to-video", "h1")).toBe("/video-editor?handoff=h1");
    expect(handoffRoute("video-to-photo", "h2")).toBe("/thumbnail-studio?tab=generate&handoff=h2");
    const route = sendAssetToDesk({
      intentId: "cover-to-video",
      asset: { hubAssetId: "asset-2", kind: "image", url: projectAssets[1].url, label: "Cover" },
      projectAssets,
    });
    expect(route.startsWith("/video-editor?handoff=")).toBe(true);
  });

  it("keeps the beat handoff API working on the generalized cache", () => {
    const blob = new Blob(["wav"], { type: "audio/wav" });
    const id = stashBeatHandoff({ blob, url: "blob:beat", title: "Night Beat", bpm: 92, durationSec: 30 });
    const beat = takeBeatHandoff(id);
    expect(beat?.title).toBe("Night Beat");
    expect(beat?.bpm).toBe(92);
    expect(beat?.durationSec).toBe(30);
    expect(takeBeatHandoff(id)).toBeNull();
  });
});
