import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  ALBUM_PUBLISH_COST_VB,
  albumFormReady,
  albumPath,
  albumPublicPath,
  albumPublishPath,
  buildAlbumCreateBody,
  buildAlbumPatchBody,
  buildTracklistBody,
  moveTrackId,
  normalizeAlbumDetail,
  normalizeAlbums,
  normalizeLibrarySongs,
  type AlbumForm,
} from "./albums-desk";

/* ─── Albums desk (stack1100 world parity) ─────────────────────────
   Album & EP building native at My Studio, on the albums router's
   own rails. These tests pin the seam: the snake_case rows
   normalized once, the tracklist as a full-replacement PATCH (the
   page's own chain), the publish price against the registry, and
   the form rules against the rail's zod schema. */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const ROW = {
  id: "alb-1",
  user_id: "u-1",
  title: "Midnight Fins",
  album_type: "album",
  release_notes: "First wave.",
  cover_art_url: "https://cdn.example/cover.png",
  status: "draft",
  slug: null,
  track_count: 2,
  created_at: "2026-10-01T00:00:00.000Z",
  updated_at: "2026-10-02T00:00:00.000Z",
};

describe("rails + price", () => {
  it("the paths are the albums tab's own endpoints; publish is the registry's pinned 300", () => {
    expect(albumPath("alb-1")).toBe("/api/albums/alb-1");
    expect(albumPublishPath("alb-1")).toBe("/api/album-publish/alb-1");
    expect(ALBUM_PUBLISH_COST_VB).toBe(300);
    const costs = read("../credit-costs.ts");
    expect(costs).toContain('"/api/album-publish": { cost: 300, feature: "Publish Album" }');
    expect(albumPublicPath("midnight-fins")).toBe("/albums/midnight-fins");
  });
});

describe("normalizers", () => {
  it("the list rows map field-for-field; a broken row fails the read", () => {
    const [a] = normalizeAlbums({ albums: [ROW] })!;
    expect(a).toEqual({
      id: "alb-1",
      title: "Midnight Fins",
      albumType: "album",
      releaseNotes: "First wave.",
      coverArtUrl: "https://cdn.example/cover.png",
      status: "draft",
      slug: null,
      trackCount: 2,
    });
    expect(normalizeAlbums({ albums: [{ id: "x" }] })).toBeNull();
    expect(normalizeAlbums({})).toBeNull();
    expect(normalizeAlbums({ albums: [] })).toEqual([]);
  });

  it("the detail carries the ordered tracklist (song_id + title)", () => {
    const detail = normalizeAlbumDetail({
      album: {
        ...ROW,
        status: "published",
        slug: "midnight-fins",
        tracks: [
          { song_id: "s-1", title: "Opener", audio_url: "https://cdn.example/1.mp3" },
          { song_id: "s-2", title: "Closer", audio_url: "https://cdn.example/2.mp3" },
        ],
      },
    });
    expect(detail?.tracks).toEqual([
      { songId: "s-1", title: "Opener" },
      { songId: "s-2", title: "Closer" },
    ]);
    expect(detail?.trackCount).toBe(2);
    expect(detail?.slug).toBe("midnight-fins");
    expect(normalizeAlbumDetail({ album: { ...ROW, tracks: [{ title: "no id" }] } })).toBeNull();
  });

  it("the library picker reads { songs } like the Release Desk does", () => {
    expect(normalizeLibrarySongs({ songs: [{ id: "s-1", title: "Opener" }] })).toEqual([
      { id: "s-1", title: "Opener" },
    ]);
    expect(normalizeLibrarySongs({})).toBeNull();
  });
});

describe("forms + tracklist edits", () => {
  const form: AlbumForm = { title: "Midnight Fins", albumType: "ep", releaseNotes: "", coverArtUrl: "" };

  it("readiness mirrors the rail's schema (title 1–120, type enum, notes ≤2000)", () => {
    expect(albumFormReady(form)).toBe(true);
    expect(albumFormReady({ ...form, title: " " })).toBe(false);
    expect(albumFormReady({ ...form, albumType: "mixtape" })).toBe(false);
    expect(albumFormReady({ ...form, releaseNotes: "n".repeat(2001) })).toBe(false);
  });

  it("create + patch bodies are the rail's snake_case shape", () => {
    expect(buildAlbumCreateBody({ ...form, title: "  Midnight Fins " }, ["s-1", "s-2"])).toEqual({
      title: "Midnight Fins",
      album_type: "ep",
      release_notes: "",
      cover_art_url: null,
      song_ids: ["s-1", "s-2"],
    });
    expect(buildAlbumPatchBody(form)).toEqual({
      title: "Midnight Fins",
      album_type: "ep",
      release_notes: "",
      cover_art_url: null,
    });
    expect(buildTracklistBody(["s-2", "s-1"])).toEqual({ song_ids: ["s-2", "s-1"] });
  });

  it("moves swap neighbours and refuse at the edges", () => {
    expect(moveTrackId(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
    expect(moveTrackId(["a", "b", "c"], 2, -1)).toEqual(["a", "c", "b"]);
    expect(moveTrackId(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]);
    expect(moveTrackId(["a", "b", "c"], 2, 1)).toEqual(["a", "b", "c"]);
  });
});

describe("the desk stands in My Studio and rides the confirmation", () => {
  const deskSrc = read("../../components/world/native/AlbumsDesk.tsx");
  const boardSrc = read("../../components/world/native/boards/StudioBoard.tsx");

  it("StudioBoard mounts it in the card stack (the controller path: my-studio → board → desk)", () => {
    expect(boardSrc).toContain('import { AlbumsDesk } from "@/components/world/native/AlbumsDesk"');
    expect(boardSrc).toContain("<AlbumsDesk isLight={isLight} />");
  });

  it("publish rides confirmedFetch with the pinned cost; delete is two-step", () => {
    expect(deskSrc).toContain('data-testid="world-albums-desk"');
    expect(deskSrc).toContain("confirmedFetch(albumPublishPath(detail.id)");
    expect(deskSrc).toContain("overrideCost: ALBUM_PUBLISH_COST_VB");
    expect(deskSrc).toContain("worldCatalogLibrary.sharedDeleteConfirm");
    expect(deskSrc).toContain('method: "PATCH"');
    expect(deskSrc).toContain("buildTracklistBody(ids)");
  });
});
