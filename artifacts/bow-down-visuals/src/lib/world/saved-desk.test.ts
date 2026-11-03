/**
 * saved-desk — stack1500 world parity wave #3 item 30 pins.
 *
 * The Saved desk is the bookmark shelf's native form. These
 * pins hold: the guard reads the rail's exact row shape
 * (kind / target_id / saved_at + the embedded thing); a row
 * whose thing has gone reads as gone — kept, labelled honestly,
 * unsaveable — never dropped and never dressed up; kinds
 * outside the schema's enum drop; tab filters and counts are
 * the page's own; the delete path encodes kind + target.
 */
import { describe, expect, it } from "vitest";
import {
  SAVES_PATH,
  SAVE_KINDS,
  buildSavePayload,
  saveCounts,
  saveDeletePath,
  savesForTab,
  savesOfResponse,
  withoutSave,
} from "./saved-desk";

const RESPONSE = {
  saves: [
    {
      kind: "track",
      target_id: "t1",
      saved_at: "2026-11-02T00:00:00.000Z",
      track: { id: "t1", title: "Crown Talk", artwork_url: "https://x/a.png", profile_id: "p1" },
    },
    {
      kind: "profile",
      target_id: "p1",
      saved_at: "2026-11-01T00:00:00.000Z",
      profile: { id: "p1", slug: "thycheatcode", display_name: "Thy Cheat Code", avatar_url: null, is_verified: true },
    },
    {
      kind: "post",
      target_id: "post1",
      saved_at: "2026-10-31T00:00:00.000Z",
      post: { id: "post1", body: "Studio day three. The crown is heavy.", author: { display_name: "Thy Cheat Code" } },
    },
    { kind: "video", target_id: "v1", saved_at: "2026-10-30T00:00:00.000Z", video: null },
    { kind: "hologram", target_id: "h1", saved_at: "2026-10-29T00:00:00.000Z" },
    { kind: "track", saved_at: "2026-10-28T00:00:00.000Z", track: { id: "x" } },
  ],
};

describe("the guard — the rail's row shape", () => {
  it("reads labels from each kind's embedded thing", () => {
    const items = savesOfResponse(RESPONSE)!;
    expect(items.map((i) => i.targetId)).toEqual(["t1", "p1", "post1", "v1"]);
    expect(items[0]).toMatchObject({ kind: "track", label: "Crown Talk", gone: false });
    expect(items[1]).toMatchObject({ kind: "profile", label: "Thy Cheat Code", sublabel: "@thycheatcode" });
    expect(items[2]).toMatchObject({ kind: "post", label: "Studio day three. The crown is heavy.", sublabel: "Thy Cheat Code" });
  });

  it("a null embed reads as gone — kept and honest, never dropped or dressed up", () => {
    const items = savesOfResponse(RESPONSE)!;
    const video = items.find((i) => i.kind === "video")!;
    expect(video.gone).toBe(true);
    expect(video.label).toBeNull();
  });

  it("unknown kinds and target-less rows drop; a non-state body is failure", () => {
    expect(savesOfResponse(RESPONSE)!.some((i) => i.targetId === "h1")).toBe(false);
    expect(savesOfResponse({})).toBeNull();
    expect(savesOfResponse(null)).toBeNull();
    expect(savesOfResponse({ saves: "all" })).toBeNull();
  });

  it("a long post body truncates with an ellipsis, never mid-word dress-up", () => {
    const items = savesOfResponse({
      saves: [{ kind: "post", target_id: "p9", saved_at: "", post: { body: "x".repeat(200) } }],
    })!;
    expect(items[0]!.label).toHaveLength(141);
    expect(items[0]!.label!.endsWith("…")).toBe(true);
  });
});

describe("tabs, counts, removal — the page's own arithmetic", () => {
  it("counts per kind and filters per tab", () => {
    const items = savesOfResponse(RESPONSE)!;
    expect(saveCounts(items)).toEqual({ post: 1, track: 1, video: 1, profile: 1 });
    expect(savesForTab(items, "all")).toHaveLength(4);
    expect(savesForTab(items, "track").map((i) => i.targetId)).toEqual(["t1"]);
    expect(SAVE_KINDS).toEqual(["post", "track", "video", "profile"]);
  });

  it("removal matches on kind + target together", () => {
    const items = savesOfResponse(RESPONSE)!;
    const next = withoutSave(items, "track", "t1");
    expect(next).toHaveLength(3);
    expect(withoutSave(items, "video", "t1")).toHaveLength(4);
  });

  it("the save + delete bodies/paths are the rails' own", () => {
    expect(buildSavePayload("track", "t1")).toEqual({ kind: "track", target_id: "t1" });
    expect(saveDeletePath("track", "t1")).toBe("/api/saves/track/t1");
    expect(SAVES_PATH).toBe("/api/saves/mine");
  });
});
