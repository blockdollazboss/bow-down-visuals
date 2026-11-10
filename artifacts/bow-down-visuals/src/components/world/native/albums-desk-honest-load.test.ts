/**
 * AlbumsDesk (the World albums desk) — honest load states
 * (Stack-400 C-28 components residual, deep-pins tranche 2).
 * The BooksDesk discipline, carried exactly:
 *
 * - THE ALBUMS LOAD: a non-ok read throws, and a payload that
 *   fails to normalize throws too ("albums shape") — both land
 *   on loadFailed; a malformed answer is never an empty shelf.
 * - THE ALBUM DETAIL (openAlbum): the previous detail is
 *   cleared before the attempt, and a failed open lands on
 *   detailFailed — never the last album shown as this one.
 * - THE SONG LIBRARY feeds only the pickers: records only on
 *   ok + parseable, and its failure is documented tolerant —
 *   "its failure only empties the picker (the album rails still
 *   stand) — never the whole desk."
 *
 * NO FIX in this lane — every family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const desk = read("./AlbumsDesk.tsx");

describe("the albums load: non-ok and unparseable are both failures", () => {
  it("the read throws on both before recording", () => {
    expect(desk).toContain("if (!res.ok) throw new Error(`albums ${res.status}`);");
    expect(desk).toContain('if (!parsed) throw new Error("albums shape");');
    expect(desk).toContain("if (!cancelled) setAlbums(parsed);");
    expect(desk).toContain("if (!cancelled) setLoadFailed(true);");
    expect(desk.indexOf('throw new Error("albums shape")')).toBeLessThan(desk.indexOf("setAlbums(parsed);"));
  });
});

describe("the detail: a failed open shows no album, not the last album", () => {
  it("openAlbum clears first, then records only from a proven payload", () => {
    const open = desk.slice(desk.indexOf("async function openAlbum(id: string)"), desk.indexOf("const createAlbum"));
    expect(open).toContain("setDetail(null);");
    expect(open).toContain("setDetailFailed(false);");
    expect(open).toContain("if (!res.ok) throw new Error(`album ${res.status}`);");
  });
});

describe("the song library is a tolerant picker feed — documented", () => {
  it("it records only on ok + parseable, and its failure empties only the picker", () => {
    expect(desk).toContain("if (!res.ok) return;");
    expect(desk).toContain("if (!cancelled && parsed) setSongs(parsed);");
    expect(desk).toContain("its failure only empties the\n     picker (the album rails still stand) — never the whole desk.");
  });
});
