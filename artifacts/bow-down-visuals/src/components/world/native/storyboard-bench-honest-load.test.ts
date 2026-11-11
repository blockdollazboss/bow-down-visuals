/**
 * StoryboardBench (the World storyboard bench) — honest load
 * classification (Stack-400 C-28 components residual,
 * deep-pins tranche 2). The bench is a generation surface
 * (analyze + runway clip generation); its result discipline is
 * the house poll pattern, carried exactly:
 *
 * - THE START: a declined price confirmation runs nothing and
 *   says nothing ("The member declined the price — nothing
 *   ran."); a start response without a taskId throws.
 * - THE POLL: a done read without a URL is an error, not a
 *   clip; the scene's clip records only from a proven URL; a
 *   thrown poll STOPS the poll and lands the network error —
 *   never an endless spin, never a fake finish. The library
 *   save rides the same proven URL, after the scene updates.
 *
 * NO FIX in this lane — the flows already meet the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const bench = read("./StoryboardBench.tsx");

describe("the clip flow: nothing claimed before the rail proves it", () => {
  it("a declined confirmation runs nothing; a start without a taskId throws", () => {
    expect(bench).toContain("/* The member declined the price — nothing ran. */");
    expect(bench).toContain("if (!res.ok || !data.taskId) throw new Error(apiErrorMessage(data, t(\"worldCreateMedia.sbErrClipStart\")));");
  });

  it("a done read without a URL is an error; the clip records only from a proven URL", () => {
    expect(bench).toContain("if (read.failed || !read.url) {");
    expect(bench).toContain("setScenes((prev) => withSceneClip(prev, scene.id, read.url!));");
  });

  it("a thrown poll stops the poll and lands the network error", () => {
    expect(bench).toContain('setError(t("worldCreateMedia.sbErrClipNetwork"));');
    expect(bench).toContain("if (pollRef.current) clearInterval(pollRef.current);");
  });
});
