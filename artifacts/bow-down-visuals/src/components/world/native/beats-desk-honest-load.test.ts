/**
 * BeatsDesk (the World beats desk) — honest load states
 * (Stack-400 C-28 components residual, deep-pins tranche 2).
 *
 * - THE BROWSE LIST: a non-ok read throws into browseFailed —
 *   but only a failed FIRST page is a failed state. The page
 *   model is honest about pagination: a failure APPENDS
 *   nothing, so the landed page stays exactly as proven, and
 *   hasMore keeps its last proven value, leaving the load-more
 *   control in place as the retry. A failed first page never
 *   paints an empty marketplace.
 * - A successful page replaces (first) or extends (append)
 *   the list and re-derives hasMore from the page's own size —
 *   never from hope.
 *
 * NO FIX in this lane — the browse family already meets the
 * standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const desk = read("./BeatsDesk.tsx");

const browse = desk.slice(desk.indexOf("const loadBrowse = useCallback("), desk.indexOf("useEffect(() => { void loadBrowse(0, false); }, [loadBrowse]);"));

describe("the browse list: a failed first page is a state; a failed append changes nothing", () => {
  it("a non-ok read throws before the list can change", () => {
    expect(browse).toContain('if (!res.ok) throw new Error("browse");');
    expect(browse).toContain("const page = parseBeatList(await res.json());");
    expect(browse.indexOf('throw new Error("browse")')).toBeLessThan(browse.indexOf("setBeats("));
  });

  it("failure flags only the first page — the proven page is never repainted", () => {
    expect(browse).toContain("if (!append) setBrowseFailed(true);");
    expect(browse).toContain("setBrowseFailed(false);");
  });

  it("success replaces or extends, and hasMore derives from the page itself", () => {
    expect(browse).toContain("setBeats((prev) => (append && prev ? [...prev, ...page] : page));");
    expect(browse).toContain("setHasMore(page.length === BEATS_PAGE_SIZE);");
  });
});
