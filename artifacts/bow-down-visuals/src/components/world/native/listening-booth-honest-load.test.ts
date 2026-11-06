/**
 * World Listening Booth side shelves — honest load states (Stack-200
 * hardening D2, census section A item 15: the "empty lie" family).
 *
 * Before: in the same load(), the purchases shelf honestly set
 * setFailed(true), but playlists → setPlaylists([]) and my-music →
 * setMyMusic([]) on failure — rendering "No playlists yet — start one
 * here" for a creator whose playlist read merely failed. After:
 * per-shelf failed flags; a failed side-shelf read keeps loaded
 * entries, raises its flag, and renders the "couldn't load" line with
 * a retry; the genuine empty copy renders only on a confirmed-empty
 * successful load; and the all-empty bare-shelf state requires no
 * shelf to have failed.
 *
 * The FE suite runs in node (no DOM), so — like the sibling honest-load
 * pins — these tests pin the state machine in source: which setter each
 * load outcome calls, and which render branch each state reaches. The
 * new copy keys are English in en.json; the other nine catalogs carry
 * the English verbatim as UNREVIEWED placeholders.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const booth = read("./ListeningBooth.tsx");
const loadAt = booth.indexOf("const load = useCallback(async () => {");
const loader = booth.slice(loadAt, booth.indexOf("}, [authHeaders]);", loadAt));

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

describe("failure path — side shelves never dress a failed read up as empty", () => {
  it("a null playlists answer and a thrown playlists read both raise playlistsFailed", () => {
    expect(loader).toContain("setPlaylistsFailed(true)");
    expect(loader).toContain("setPlaylistsFailed(false)");
    expect(loader).not.toContain("setPlaylists(mine === null ? []");
  });

  it("a failed my-music read raises myMusicFailed instead of writing the empty shelf", () => {
    expect(loader).toContain('if (!res.ok) throw new Error("my-music");');
    expect(loader).toContain("setMyMusicFailed(true)");
    expect(loader).toContain("setMyMusicFailed(false)");
    expect(loader).not.toContain("setMyMusic(res.ok ?");
  });

  it("failure keeps loaded entries — the setters preserve the current value on failure", () => {
    expect(loader).toContain("setPlaylists((cur) => cur ?? [])");
    expect(loader).toContain("setMyMusic((cur) => cur ?? [])");
  });

  it("each failed shelf renders the couldn't-load line with a retry", () => {
    expect(booth).toContain('shelfRetryLine("world-shelf-playlists-load-error")');
    expect(booth).toContain('shelfRetryLine("world-shelf-mymusic-load-error")');
    expect(booth).toContain('t("worldAudioDesk.shelfLoadErrorLine")');
    expect(booth).toContain('t("worldAudioDesk.shelfRetryBtn")');
  });
});

describe("genuine-empty paths stay reachable — and only there", () => {
  it("the playlists empty copy is suppressed while the shelf has failed", () => {
    expect(booth).toContain("playlistsFailed ? null : (");
    expect(booth).toContain('t("worldAudioDesk.noPlaylistsYetBooth")');
  });

  it("the all-empty bare-shelf state requires no shelf to have failed", () => {
    expect(booth).toContain("if (allEmpty && !playlistsFailed && !myMusicFailed && playlists !== null && myMusic !== null) {");
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the booth honest-load keys", (loc) => {
    const cat = flat(JSON.parse(read(`../../../locales/${loc}.json`)));
    for (const k of ["worldAudioDesk.shelfLoadErrorLine", "worldAudioDesk.shelfRetryBtn"]) {
      expect(typeof cat[k] === "string" && cat[k]!.trim() !== "", `${loc}: ${k}`).toBe(true);
    }
  });
});
