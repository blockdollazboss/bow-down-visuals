/**
 * stream-pack.test.ts — the client half of the stream-pack library +
 * studio tray.
 *
 * Pins: the tolerant DTO normalizer (the one reading of
 * GET /api/stream-pack/mine), the tray = the applied slice of the
 * library, the apply/unapply endpoint choice, and the two fetch
 * helpers (auth header carried; updated record parsed from the
 * server's answer). The page and the studio tray wirings are pinned
 * by source, the pattern enter-world-button.test.ts established.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  normalizeStreamPackAsset,
  normalizeStreamPackAssets,
  streamPackTrayAssets,
  streamPackApplyPath,
  fetchMyStreamPackAssets,
  setStreamPackAssetApplied,
  type StreamPackAssetRecord,
} from "./stream-pack";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const ROW = {
  id: "gen-1",
  assetKey: "webcam-frame",
  label: "Webcam Frame",
  themeId: "gold-luxury",
  channelName: "Nova",
  url: "https://cdn.test/frame.png",
  appliedToStudio: true,
  createdAt: "2026-01-02T03:04:05.000Z",
};

describe("normalizeStreamPackAsset(s)", () => {
  it("parses a full DTO row", () => {
    expect(normalizeStreamPackAsset(ROW)).toEqual(ROW);
  });

  it("defaults the label to the asset key and keeps a false flag false", () => {
    const parsed = normalizeStreamPackAsset({
      id: "g",
      assetKey: "screen-brb",
      url: "https://x.test/a.png",
    });
    expect(parsed).toMatchObject({
      label: "screen-brb",
      appliedToStudio: false,
      themeId: null,
      createdAt: null,
    });
  });

  it("refuses rows with nothing honest to render", () => {
    expect(normalizeStreamPackAsset(null)).toBeNull();
    expect(normalizeStreamPackAsset({})).toBeNull();
    expect(normalizeStreamPackAsset({ id: "g", assetKey: "webcam-frame" })).toBeNull();
    expect(normalizeStreamPackAssets(null)).toEqual([]);
    expect(normalizeStreamPackAssets({ assets: "nope" })).toEqual([]);
    expect(
      normalizeStreamPackAssets({ assets: [ROW, { id: "broken" }] }),
    ).toHaveLength(1);
  });
});

describe("the tray is the applied slice", () => {
  it("streamPackTrayAssets keeps only applied records", () => {
    const applied = normalizeStreamPackAsset(ROW)!;
    const plain: StreamPackAssetRecord = { ...applied, id: "gen-2", appliedToStudio: false };
    expect(streamPackTrayAssets([applied, plain])).toEqual([applied]);
    expect(streamPackTrayAssets([])).toEqual([]);
  });

  it("streamPackApplyPath picks the endpoint by direction", () => {
    expect(streamPackApplyPath(true)).toBe("/api/stream-pack/apply");
    expect(streamPackApplyPath(false)).toBe("/api/stream-pack/unapply");
  });
});

describe("fetch helpers", () => {
  const token = async () => "tok-123";

  it("fetchMyStreamPackAssets carries the token and parses the payload", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ assets: [ROW] }),
    })) as unknown as typeof fetch;
    const assets = await fetchMyStreamPackAssets(token, fetchFn);
    expect(assets).toEqual([ROW]);
    const [url, init] = (fetchFn as any).mock.calls[0];
    expect(url).toBe("/api/stream-pack/mine");
    expect((init as any).headers.Authorization).toBe("Bearer tok-123");
  });

  it("fetchMyStreamPackAssets throws on a failed load (never a fake empty)", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    })) as unknown as typeof fetch;
    await expect(fetchMyStreamPackAssets(token, fetchFn)).rejects.toThrow("500");
  });

  it("setStreamPackAssetApplied posts the id to the right endpoint and returns the server's record", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ asset: { ...ROW, appliedToStudio: false } }),
    })) as unknown as typeof fetch;
    const updated = await setStreamPackAssetApplied(token, "gen-1", false, fetchFn);
    expect(updated.appliedToStudio).toBe(false);
    const [url, init] = (fetchFn as any).mock.calls[0];
    expect(url).toBe("/api/stream-pack/unapply");
    expect(JSON.parse((init as any).body)).toEqual({ generationId: "gen-1" });
  });
});

describe("surface wiring (source pins)", () => {
  it("the Stream Pack page renders the library from the shared lib", () => {
    const page = read("../pages/stream-pack.tsx");
    expect(page).toContain('from "@/lib/stream-pack"');
    expect(page).toContain("fetchMyStreamPackAssets");
    expect(page).toContain("setStreamPackAssetApplied");
    expect(page).toContain('data-testid="stream-pack-library"');
  });

  it("the studio tray adds a graphic through the stage's own image-source path", () => {
    const tray = read("../components/go-live/studio/StreamPackTray.tsx");
    expect(tray).toContain('stage.addSource(scene.id, "image")');
    expect(tray).toContain("imageUrl: asset.url");
    expect(tray).toContain("streamPackTrayAssets");
    expect(tray).toContain("setStreamPackAssetApplied");
    expect(tray).toContain('data-testid="stream-pack-tray"');
  });

  it("SourcesPanel mounts the tray in the source stack", () => {
    const panel = read("../components/go-live/studio/SourcesPanel.tsx");
    expect(panel).toContain("StreamPackTray");
    expect(panel).toContain("<StreamPackTray");
  });
});
