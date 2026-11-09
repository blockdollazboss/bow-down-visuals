/**
 * Publish — honest load states for the "My content" drafts list
 * (Stack 400 C-28 follow-on: the lying-loads lane).
 *
 * This list was one of the four LYING findings the honest-load
 * census pinned as a defect: the per-source loaders returned []
 * on a non-ok answer, Promise.allSettled folded every failure
 * to an empty list, the catch was commented "drafts are a
 * bonus", and there was no drafts error state at all — so any
 * failed load rendered the genuine "Nothing here yet" copy.
 * The per-source loaders now throw on a non-ok answer (the
 * S27-44 per-source settle is preserved: one rejected leg still
 * cannot discard the other's drafts), any rejected leg raises
 * draftsError, and the render reaches the empty copy only after
 * the draftsLoading and draftsError branches, with the error
 * branch's retry wired to the real loader; a partial failure
 * with drafts on screen shows an honest note above the list
 * instead of failing silently. This file pins that shape in
 * source, like the sibling honest-load pins (the FE suite runs
 * in node, no DOM). The page is hardcoded English, so the pin
 * asserts the literal copy and carries no catalog block (the
 * discovery/charts-pin precedent).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./publish.tsx");
const loadAt = page.indexOf("async function loadDrafts() {");
const loader = page.slice(loadAt, page.indexOf("useEffect(() => {", loadAt));

describe("failure path — a failed drafts load never reads as an empty content list", () => {
  it("both per-source loaders throw on a non-ok answer instead of folding to []", () => {
    expect(loader).toContain("if (!tr.ok) throw new Error();");
    expect(loader).toContain("if (!vr.ok) throw new Error();");
  });

  it("the per-source settle is preserved and any rejected leg records the error state", () => {
    expect(loader).toContain("Promise.allSettled([loadTracks(), loadVideos()])");
    expect(loader).toContain('setDraftsError(tracksSettled.status === "rejected" || videosSettled.status === "rejected");');
    expect(loader).toContain("setDraftsError(true);");
    expect(loader).toContain("setDraftsLoading(false);");
  });

  it("failure with nothing loaded renders the error panel with a retry wired to the real loader", () => {
    expect(page).toContain("We couldn&apos;t load your content — your drafts are safe, this just couldn&apos;t reach them.");
    expect(page).toContain('data-testid="btn-retry-drafts"');
    expect(page).toContain("onClick={() => void loadDrafts()}");
  });

  it("a partial failure with drafts on screen shows an honest note instead of failing silently", () => {
    expect(page).toContain("Some of your content couldn&apos;t load");
    expect(page.split('data-testid="btn-retry-drafts"').length - 1).toBe(2);
  });
});

describe("loading and genuine-empty paths stay distinct from failure", () => {
  it("the first load renders the pending state, not the empty panel", () => {
    expect(page).toContain("Loading…");
  });

  it("the empty panel renders only after the loading and error branches", () => {
    const loadingAt = page.indexOf("draftsLoading ? (");
    const errorAt = page.indexOf(") : draftsError && drafts.length === 0 ? (");
    const emptyAt = page.indexOf(") : drafts.length === 0 ? (");
    expect(loadingAt).toBeGreaterThan(-1);
    expect(errorAt).toBeGreaterThan(loadingAt);
    expect(emptyAt).toBeGreaterThan(errorAt);
    expect(page).toContain("Nothing here yet — drop your first file above and go live.");
  });
});
