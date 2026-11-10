/**
 * WebsiteBuilderDesk (the World website-builder desk) — honest
 * load states (Stack-400 C-28 components residual, deep-pins
 * tranche 2).
 *
 * - THE PROJECTS LOAD carries the rule written on itself: "A
 *   failed load is a failed load — the error state with a
 *   retry, never an empty shelf." A non-ok read throws, and a
 *   payload that fails to normalize throws too ("projects
 *   shape") — both land on projectsFailed.
 * - THE TEMPLATE GALLERY is an additive shelf: it records only
 *   from an ok response (a non-ok becomes null data), and on
 *   failure "the shelf simply does not render; the brief flow
 *   is untouched (the page's behavior)".
 * - loadVersions throws its failure to the caller — the
 *   version list is set only from a proven, parseable detail.
 *
 * NO FIX in this lane — every family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const desk = read("./WebsiteBuilderDesk.tsx");

describe("the projects load: the rule is written on it", () => {
  it("non-ok and unparseable both land on projectsFailed", () => {
    expect(desk).toContain("A failed load is a failed\n     load — the error state with a retry, never an empty shelf.");
    expect(desk).toContain("if (!res.ok) throw new Error(`projects ${res.status}`);");
    expect(desk).toContain('if (!parsed) throw new Error("projects shape");');
    expect(desk).toContain("if (!cancelled) setProjects(parsed);");
    expect(desk).toContain("if (!cancelled) setProjectsFailed(true);");
  });
});

describe("the gallery is additive; versions throw to their caller", () => {
  it("the gallery records only from ok data and simply does not render on failure", () => {
    expect(desk).toContain(".then((r) => (r.ok ? r.json() : null))");
    expect(desk).toContain("fetch fails, the shelf simply does not render; the brief flow is");
  });

  it("loadVersions sets the list only from a proven detail", () => {
    expect(desk).toContain("if (!res.ok) throw new Error(`detail ${res.status}`);");
    expect(desk).toContain('if (!detail) throw new Error("detail shape");');
    expect(desk).toContain("setVersions(detail.versions);");
  });
});
