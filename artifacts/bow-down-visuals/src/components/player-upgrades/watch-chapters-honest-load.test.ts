/**
 * WatchChapters (auto-chapters on a showcase watch page) —
 * honest load states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * The DuelCover twin doctrine: an ok-gated enhancement —
 * chapters render ONLY from an ok response carrying the
 * autoChapters payload, and the component returns null
 * until then (and forever, if the read fails or the list is
 * empty). A watch page never shows fabricated chapter marks,
 * and the absence of the chapter bar claims nothing about
 * the video.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./WatchChapters.tsx");

describe("chapters render only from a proven payload", () => {
  it("the ok gate and the null-until-proven rule are pinned", () => {
    expect(src).toContain(".then((r) => (r.ok ? r.json() : null))");
    expect(src).toContain("if (live && d?.autoChapters) setData(d.autoChapters);");
    expect(src).toContain("if (!data || data.chapters.length === 0) return null;");
  });
});
