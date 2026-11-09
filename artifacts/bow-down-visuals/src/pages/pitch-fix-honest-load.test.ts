/**
 * Pitch & Fix boards — honest load states (Stack 400 C-28: the
 * honest-load pin layer completing the "empty lie" audit).
 *
 * Residual pin verified against both shapes: this page was wrapped
 * with SectionBoundary sections on branch
 * stack1600/s400-resilience-money @ 88b08a20b, which is not in this
 * tree. Every string asserted below is present verbatim in BOTH
 * the join14 page in this tree and the banked wrapped version
 * (verified via git show) — the wrap touched only section
 * boundaries, never the loader or the board gating.
 *
 * The board load already carries the honest machine: loadBoard()
 * throws on a non-ok answer, its catch sets loadError, and the
 * render checks loadError first, then the not-yet-loaded board
 * (the loading copy), and only then the boards themselves — whose
 * "empty" copies live inside the loaded branch. The error branch's
 * retry calls the real loadBoard. This file pins that shape in
 * source, like the sibling honest-load pins (the FE suite runs in
 * node, no DOM). All load-state copy goes through pitchFix.* keys,
 * pinned for all 10 catalogs below.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./pitch-fix.tsx");
const loadAt = page.indexOf("const loadBoard = useCallback(async () => {");
const loader = page.slice(loadAt, page.indexOf("const loadMine", loadAt));

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

describe("failure path — a failed board load never reads as empty boards", () => {
  it("the loader throws on a non-ok response and records the error state in its catch", () => {
    expect(loader).toContain('if (!res.ok) throw new Error("board failed");');
    expect(loader).toContain("setLoadError(true);");
  });

  it("a successful load records the board and clears the error state", () => {
    expect(loader).toContain("setBoard(data);");
    expect(loader).toContain("setLoadError(false);");
  });

  it("the board starts unloaded (null), which is the loading state", () => {
    expect(page).toContain("const [board, setBoard] = useState<BoardData | null>(null);");
    expect(page).toContain("const [loadError, setLoadError] = useState(false);");
  });

  it("failure renders the error panel with a retry wired to the real loader", () => {
    expect(page).toContain('t("pitchFix.loadError")');
    expect(page).toContain('t("pitchFix.retry")');
    expect(page).toContain("onClick={() => void loadBoard()}");
  });
});

describe("loading and genuine-empty paths stay distinct from failure", () => {
  it("the loading copy renders on the not-yet-loaded board, after the error branch", () => {
    expect(page).toContain('t("pitchFix.loading")');
    const errorAt = page.indexOf("{loadError ? (");
    const loadingAt = page.indexOf(") : !board ? (");
    expect(errorAt).toBeGreaterThan(-1);
    expect(loadingAt).toBeGreaterThan(errorAt);
  });

  it("the empty copies render only inside the loaded branch, after the error and loading branches", () => {
    const errorAt = page.indexOf('t("pitchFix.loadError")');
    const loadingAt = page.indexOf('t("pitchFix.loading")');
    const emptyPitchesAt = page.indexOf('t("pitchFix.emptyPitches")');
    const emptyFixesAt = page.indexOf('t("pitchFix.emptyFixes")');
    expect(emptyPitchesAt).toBeGreaterThan(errorAt);
    expect(emptyPitchesAt).toBeGreaterThan(loadingAt);
    expect(emptyFixesAt).toBeGreaterThan(emptyPitchesAt);
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the pitchFix honest-load keys", (loc) => {
    const cat = flat(JSON.parse(read(`../locales/${loc}.json`)));
    for (const k of ["pitchFix.loadError", "pitchFix.loading", "pitchFix.retry", "pitchFix.emptyPitches", "pitchFix.emptyFixes"]) {
      expect(typeof cat[k] === "string" && cat[k]!.trim() !== "", `${loc}: ${k}`).toBe(true);
    }
  });
});
