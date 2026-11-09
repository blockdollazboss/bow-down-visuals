/**
 * My Clips — honest load states (Stack 400 C-28, C-27 residual pin
 * verified against both shapes: the join14 page and the
 * SectionBoundary-wrapped shape banked on
 * stack1600/s400-resilience-live @ df87eb650 — every string asserted
 * here is present verbatim in BOTH versions, so the pin holds
 * whichever shape lands).
 *
 * Both list loads on this page carry the honest machine. The page's
 * clips load throws on a non-ok answer, its catch records the error
 * state, and the "No clips yet" panel is gated on !loading && !error
 * after the loading and error blocks. The attach modal's project
 * load (loadProjects) throws likewise, and its render reaches
 * "No projects with scenes found" only after the loading and error
 * branches, the error branch carrying a retry wired to the real
 * loader. This file pins that shape in source, like the sibling
 * honest-load pins (the FE suite runs in node, no DOM). The pinned
 * error/empty copy is hardcoded English in the page, so the literals
 * are pinned and there is no catalog block.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./my-clips.tsx");
const projectsAt = page.indexOf("const loadProjects = useCallback(async () => {");
const projectsLoader = page.slice(projectsAt, page.indexOf("void loadProjects();", projectsAt));
const clipsAt = page.indexOf('const res = await fetch("/api/generated-clips", {');
const clipsLoader = page.slice(clipsAt, page.indexOf("async function handleDelete", clipsAt));

describe("clips list — a failed load never reads as an empty library", () => {
  it("the loader throws on a non-ok response and records the error state in its catch", () => {
    expect(clipsLoader).toContain("if (!res.ok) throw new Error(`HTTP ${res.status}`);");
    expect(clipsLoader).toContain('setError(plainErrorText(err, "Failed to load clips"));');
  });

  it("a successful load records the clips and always clears loading", () => {
    expect(clipsLoader).toContain("setClips(data.clips ?? []);");
    expect(clipsLoader).toContain("setLoading(false);");
  });

  it("the empty panel is gated on the error state being clear, after the loading and error blocks", () => {
    const loadingAt = page.indexOf("{/* Loading */}");
    const errorAt = page.indexOf("{/* Error */}");
    const emptyAt = page.indexOf("{!loading && !error && clips.length === 0 && (");
    expect(loadingAt).toBeGreaterThan(-1);
    expect(errorAt).toBeGreaterThan(loadingAt);
    expect(emptyAt).toBeGreaterThan(errorAt);
    expect(page).toContain("{error && (");
    expect(page).toContain("No clips yet");
  });
});

describe("attach-modal projects — a failed load never reads as 'no projects'", () => {
  it("the loader throws on a non-ok response and records the error state in its catch", () => {
    expect(projectsLoader).toContain('if (!res.ok) throw new Error("Failed to load projects");');
    expect(projectsLoader).toContain("setLoadError(true);");
  });

  it("a successful load records the projects and always clears loading", () => {
    expect(projectsLoader).toContain("setProjects(allProjects);");
    expect(projectsLoader).toContain("setLoadingProjects(false);");
  });

  it("failure renders the error panel with a retry wired to the real loader", () => {
    expect(page).toContain("Couldn't load your projects.");
    expect(page).toContain("your projects are safe, this list just couldn't reach them.");
    expect(page).toContain("onClick={() => void loadProjects()}");
    expect(page).toContain("Try again");
  });

  it("the empty panel renders only after the loading and error branches", () => {
    const loadingAt = page.indexOf("{loadingProjects ? (");
    const errorAt = page.indexOf(") : loadError ? (");
    const emptyAt = page.indexOf(") : projects.length === 0 ? (");
    expect(loadingAt).toBeGreaterThan(-1);
    expect(errorAt).toBeGreaterThan(loadingAt);
    expect(emptyAt).toBeGreaterThan(errorAt);
    expect(page).toContain("No projects with scenes found");
  });
});
