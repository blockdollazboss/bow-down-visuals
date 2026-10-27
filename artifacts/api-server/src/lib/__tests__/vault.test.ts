/**
 * The Vault (#162) — packager + inventory + progress tests.
 *
 * The promises under test:
 *  - inventory finds every distinct media original exactly once,
 *    classified and foldered, from the same rows the data export reads;
 *  - the archive contains the originals (stored), the data payload,
 *    a README, and a manifest that NAMES anything skipped + why;
 *  - one dead file never fails the Vault, but zero packaged media
 *    (when media existed) fails loudly instead of shipping a shell.
 */
import { describe, it, expect } from "vitest";
import { Readable } from "node:stream";
import {
  buildVaultArchive,
  collectMediaInventory,
  type VaultMediaItem,
} from "../vault-archive";
import { describeVaultProgress } from "../vault-jobs";

async function drain(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks);
}

describe("collectMediaInventory", () => {
  it("collects songs, clips and art once each, foldered by kind", () => {
    const items = collectMediaInventory({
      songs: [
        {
          id: "s1",
          title: "Midnight Crown",
          audio_url: "https://cdn.example.com/audio/midnight.mp3",
          cover_art_url: "https://cdn.example.com/art/midnight.png",
        },
      ],
      generated_clips: [
        { id: "c1", video_url: "https://cdn.example.com/v/clip one.mp4" },
      ],
      projects: [
        // Same cover URL as the song's — must be packaged only once.
        { id: "p1", name: "Proj", image_url: "https://cdn.example.com/art/midnight.png" },
      ],
      project_drafts: [{ id: "d1", notes: "no media here" }],
    });

    expect(items).toHaveLength(3);
    const audio = items.find((i) => i.kind === "audio")!;
    expect(audio.path).toBe("media/songs/s1-midnight.mp3");
    const art = items.find((i) => i.kind === "image")!;
    expect(art.path).toBe("media/songs/s1-midnight.png");
    const video = items.find((i) => i.kind === "video")!;
    expect(video.path.startsWith("media/videos/c1-")).toBe(true);
    expect(video.path).toContain("clip-one.mp4");
  });

  it("ignores empty, non-URL and non-object values", () => {
    const items = collectMediaInventory({
      songs: [
        { id: "s1", audio_url: "", video_url: null },
        { id: "s2", audio_url: "not a url at all" },
        "garbage",
        null,
      ],
    });
    expect(items).toEqual([]);
  });

  it("accepts site-relative media paths", () => {
    const items = collectMediaInventory({
      generated_clips: [{ id: "c9", video_url: "/media/clips/c9.mp4" }],
    });
    expect(items).toHaveLength(1);
    expect(items[0]!.kind).toBe("video");
  });
});

describe("buildVaultArchive", () => {
  const payload = { exportedAt: "2026-10-27T00:00:00.000Z", profile: { id: "u1" } };
  const inventory: VaultMediaItem[] = [
    { path: "media/songs/s1-track.mp3", url: "https://x/track.mp3", kind: "audio", label: "Track (audio_url)" },
    { path: "media/videos/c1-clip.mp4", url: "https://x/clip.mp4", kind: "video", label: "Clip (video_url)" },
  ];

  it("packages originals + data + manifest, naming skips with reasons", async () => {
    let zip: Buffer | null = null;
    const progress: Array<[number, number]> = [];
    const result = await buildVaultArchive(
      {
        fetchMedia: async (url) => {
          if (url.endsWith("clip.mp4")) throw new Error("HTTP 410 fetching original");
          return Buffer.from("ORIGINAL-BYTES");
        },
        storeArchive: async (body) => {
          zip = await drain(body);
        },
        onMediaProgress: (d, t) => {
          progress.push([d, t]);
        },
      },
      { exportedAt: payload.exportedAt, dataPayload: payload, inventory },
    );

    expect(result.fileCount).toBe(1);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.reason).toContain("410");
    expect(progress).toEqual([
      [1, 2],
      [2, 2],
    ]);
    expect(zip).not.toBeNull();
    const text = zip!.toString("latin1");
    expect(text).toContain("README.txt");
    expect(text).toContain("data/account-export.json");
    expect(text).toContain("manifest.json");
    expect(text).toContain("media/songs/s1-track.mp3");
    expect(text).toContain("ORIGINAL-BYTES");
    expect(text).not.toContain("media/videos/c1-clip.mp4");
  });

  it("fails loudly when media existed but none could be fetched", async () => {
    await expect(
      buildVaultArchive(
        {
          fetchMedia: async () => {
            throw new Error("HTTP 500 fetching original");
          },
          storeArchive: async (body) => {
            await drain(body).catch(() => undefined);
          },
        },
        { exportedAt: payload.exportedAt, dataPayload: payload, inventory },
      ),
    ).rejects.toThrow(/None of your media files could be fetched/);
  });

  it("ships a data-only vault when the creator owns no media yet", async () => {
    let zip: Buffer | null = null;
    const result = await buildVaultArchive(
      {
        fetchMedia: async () => Buffer.from("unused"),
        storeArchive: async (body) => {
          zip = await drain(body);
        },
      },
      { exportedAt: payload.exportedAt, dataPayload: payload, inventory: [] },
    );
    expect(result.fileCount).toBe(0);
    expect(result.skipped).toEqual([]);
    expect(zip!.toString("latin1")).toContain("data/account-export.json");
  });
});

describe("describeVaultProgress", () => {
  it("maps stages to honest labels + progress", () => {
    expect(describeVaultProgress({ state: "queued", stage: "queued", progress: 0 }).progress).toBe(2);
    expect(
      describeVaultProgress({ state: "active", stage: "packaging media 3/4", progress: 0 }),
    ).toEqual({ stage: "Packaging your originals (3 of 4)…", progress: 70 });
    expect(describeVaultProgress({ state: "done", stage: "completed", progress: 100 }).progress).toBe(100);
    expect(describeVaultProgress({ state: "failed", stage: "failed", progress: 0 }).progress).toBe(0);
  });
});
