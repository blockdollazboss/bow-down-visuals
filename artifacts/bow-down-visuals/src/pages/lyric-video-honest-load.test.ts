/**
 * Lyric Video — honest load states for the library songs picker
 * (Stack 400 C-28 follow-on: the lying-loads lane).
 *
 * This picker was one of the four LYING findings the honest-load
 * census pinned as a defect: loadSongs() never threw (state was
 * set only when res.ok && Array.isArray(...)) and its catch
 * swallowed failures with "library is optional" — so any failed
 * load rendered the genuine "no songs" copy. The loader now
 * throws on a non-ok or non-array answer, its catch sets
 * songsError, and the render reaches the empty copy only after
 * the songsLoading and songsError branches, with the error
 * branch's retry wired to the real loader. This file pins that
 * shape in source, like the sibling honest-load pins (the FE
 * suite runs in node, no DOM). The honest-load copy goes through
 * lyricVideo.* keys, pinned for all 10 catalogs below.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./lyric-video.tsx");
const loadAt = page.indexOf("async function loadSongs() {");
const loader = page.slice(loadAt, page.indexOf("async function alignLyrics() {", loadAt));

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

describe("failure path — a failed songs load never reads as an empty library", () => {
  it("the loader throws on a non-ok or non-array answer and records the error state in its catch", () => {
    expect(loader).toContain("if (!res.ok || !Array.isArray(data.songs)) throw new Error();");
    expect(loader).toContain("setSongsError(true);");
  });

  it("a successful load records the songs, clears the error, and always clears loading", () => {
    expect(loader).toContain("setSongs(data.songs);");
    expect(loader).toContain("setSongsError(false);");
    expect(loader).toContain("setSongsLoading(false);");
  });

  it("failure renders the error panel with a retry wired to the real loader", () => {
    expect(page).toContain('t("lyricVideo.songsLoadError", { defaultValue: "We couldn');
    expect(page).toContain('data-testid="btn-retry-songs"');
    expect(page).toContain("onClick={() => void loadSongs()}");
    expect(page).toContain('t("lyricVideo.retryLoad", { defaultValue: "Try again" })');
  });
});

describe("loading and genuine-empty paths stay distinct from failure", () => {
  it("the load renders the pending state, not the empty panel", () => {
    expect(page).toContain('t("lyricVideo.loadingSongs")');
  });

  it("the empty panel renders only after the loading and error branches", () => {
    const loadingAt = page.indexOf("{songsLoading ? (");
    const errorAt = page.indexOf(") : songsError ? (");
    const emptyAt = page.indexOf(") : songs.length === 0 ? (");
    expect(loadingAt).toBeGreaterThan(-1);
    expect(errorAt).toBeGreaterThan(loadingAt);
    expect(emptyAt).toBeGreaterThan(errorAt);
    expect(page).toContain('t("lyricVideo.noSongs")');
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the lyricVideo honest-load keys", (loc) => {
    const cat = flat(JSON.parse(read(`../locales/${loc}.json`)));
    for (const k of ["lyricVideo.loadingSongs", "lyricVideo.songsLoadError", "lyricVideo.retryLoad", "lyricVideo.noSongs"]) {
      expect(typeof cat[k] === "string" && cat[k]!.trim() !== "", `${loc}: ${k}`).toBe(true);
    }
  });
});
