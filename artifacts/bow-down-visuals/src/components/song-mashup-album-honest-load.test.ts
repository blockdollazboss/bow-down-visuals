/**
 * Song Mashup — honest load standard, album + write half
 * (deep-pins tranche 3, batch 2).
 *
 * The songs-library half of this component is already pinned by the
 * Stack-200 file (song-mashup-honest-load.test.ts: failed library
 * read raises the error note above the pickers). This pin covers
 * what that file did not: the ALBUM picker load and every write.
 *
 * Two defects were fixed in this tranche and are pinned here
 * (red-before proven against the pre-fix bodies):
 * 1. loadAlbums fell through SILENTLY on a non-ok read
 *    (`if (res.ok) setAlbums(...)` with no else) — the picker stood
 *    open on an empty list reading as "you have no albums" when the
 *    read merely failed. The non-ok path now throws into the catch
 *    that toasts mashup.albumLoadFailed.
 * 2. handleAddToAlbum parsed the album-detail GET unchecked
 *    (`await (await fetch(...)).json()`) — a failed read became
 *    `existing = []`, so an already-present song looked absent (the
 *    add was skipped and success was claimed for a no-op) or absent
 *    looked present. The detail read now throws the server's words
 *    on non-ok BEFORE the tracks are read.
 *
 * The remaining writes pin as-is: upload, the mashup POST itself,
 * and the lyric-video / cover-art handoffs all throw on non-ok or a
 * missing result field BEFORE any success state or toast; a decline
 * at the confirmation runs nothing.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./SongMashup.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

const LOCALES = ["en", "es", "fr", "de", "it", "pt", "ar", "hi", "ja", "ko"] as const;
function flat(o: unknown, p = "", out: Record<string, string> = {}): Record<string, string> {
  if (o && typeof o === "object" && !Array.isArray(o)) {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      const key = p ? `${p}.${k}` : k;
      if (v && typeof v === "object" && !Array.isArray(v)) flat(v, key, out);
      else out[key] = v as string;
    }
  }
  return out;
}

describe("album picker load — a failed read says so (fix 1)", () => {
  it("loadAlbums throws on non-ok into the failure toast", () => {
    const loader = slice(src, "async function loadAlbums() {", "async function handleAddToAlbum()");
    expect(loader).toContain('if (!res.ok) throw new Error("albums load failed");');
    expect(loader).toContain('toast({ title: t("mashup.albumLoadFailed"), variant: "destructive" })');
    expect(loader.indexOf("setAlbums(data.albums ?? [])")).toBeGreaterThan(
      loader.indexOf('if (!res.ok) throw new Error("albums load failed");'),
    );
    expect(loader).not.toContain("if (res.ok) setAlbums(");
  });

  it("the picker still opens after a failed load — the flag settles in finally", () => {
    const loader = slice(src, "async function loadAlbums() {", "async function handleAddToAlbum()");
    expect(loader).toContain("setAlbumsLoaded(true)");
    expect(loader).toContain("} finally {");
  });
});

describe("add-to-album — the detail read is checked before it decides anything (fix 2)", () => {
  it("a failed detail read throws the server's words before the tracks are trusted", () => {
    const body = slice(src, "async function handleAddToAlbum() {", "function shareUrl()");
    expect(body).toContain("const detailRes = await fetch(`/api/albums/${albumId}`, { headers });");
    expect(body).toContain('if (!detailRes.ok) throw new Error(apiErrorMessage(detail, "Could not add to album."));');
    expect(body.indexOf("const existing = (detail.tracks ?? [])")).toBeGreaterThan(
      body.indexOf("if (!detailRes.ok) throw"),
    );
    expect(body).not.toContain("await (await fetch(`/api/albums/${albumId}`)).json()");
  });

  it("album create and the PATCH both throw on non-ok or a missing album before success is claimed", () => {
    const body = slice(src, "async function handleAddToAlbum() {", "function shareUrl()");
    expect(body).toContain('if (!res.ok || !data.album) throw new Error(apiErrorMessage(data, "Could not create album."));');
    expect(body).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, "Could not add to album."));');
    expect(body.indexOf("setAlbumAdded(albumTitle)")).toBeGreaterThan(body.indexOf("if (!res.ok) throw"));
    expect(body).toContain('toast({ title: `${t("mashup.albumAdded")}: ${albumTitle}` })');
  });
});

describe("the other writes — checked before any success state", () => {
  it("upload throws on non-ok or a missing song before prepending", () => {
    const body = slice(src, "async function handleUpload(", "const canSubmit =");
    expect(body).toContain('if (!res.ok || !data.song) throw new Error(apiErrorMessage(data, "Upload failed."));');
    expect(body.indexOf("setSongs((prev) => [data.song!, ...prev])")).toBeGreaterThan(
      body.indexOf("if (!res.ok || !data.song) throw"),
    );
  });

  it("the mashup POST: decline unwinds working with no result; non-ok or missing song throws", () => {
    const body = slice(src, "async function handleMashup() {", "/* ── Handoffs ── */");
    expect(body).toContain("if (!res) {");
    expect(body).toContain("setWorking(false); // user cancelled the credit confirmation");
    expect(body).toContain("if (!res.ok || !data.song) {");
    expect(body.indexOf("setResult(data.song)")).toBeGreaterThan(body.indexOf("if (!res.ok || !data.song)"));
  });

  it("lyric-video and cover-art handoffs throw on non-ok or a missing url before URL state", () => {
    const lyric = slice(src, "async function handleLyricVideo() {", "async function handleCoverArt()");
    expect(lyric).toContain('if (!res.ok || !data.url) throw new Error(apiErrorMessage(data, "Lyric video failed."));');
    expect(lyric.indexOf("setLyricVideoUrl(data.url)")).toBeGreaterThan(lyric.indexOf("if (!res.ok || !data.url)"));
    const cover = slice(src, "async function handleCoverArt() {", "async function loadAlbums()");
    expect(cover).toContain('if (!res.ok || !data.url) throw new Error(apiErrorMessage(data, "Cover art failed."));');
    expect(cover.indexOf("setCoverArtUrl(data.url)")).toBeGreaterThan(cover.indexOf("if (!res.ok || !data.url)"));
  });
});

describe("copy key exists in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the album-load failure key", (loc) => {
    const cat = flat(JSON.parse(read(`../locales/${loc}.json`)));
    const k = cat["mashup.albumLoadFailed"];
    expect(typeof k === "string" && k.trim() !== "", `${loc}: mashup.albumLoadFailed`).toBe(true);
  });
});
