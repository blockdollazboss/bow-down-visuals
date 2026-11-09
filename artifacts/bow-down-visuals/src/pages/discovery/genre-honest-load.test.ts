/**
 * Genre detail (/genre/:genre) — honest load states (Stack 400 C-28:
 * the honest-load pin layer completing the "empty lie" audit).
 *
 * The genre payload (creators + tracks + videos) already carries the
 * honest machine: getJson() returns null ONLY on failure (non-ok or
 * network), the effect turns that null into loadError, and the render
 * reaches the per-section EmptyStates ("No audio here yet", "No
 * videos here yet", the all-empty "Nothing tagged … yet") only after
 * the error branch and the loading branch, with the error branch's
 * retry bumping retryNonce to re-run the real effect. This file pins
 * that shape in source, like the sibling honest-load pins (the FE
 * suite runs in node, no DOM). The error/empty copy is hardcoded
 * English in the page, so the literals are pinned and there is no
 * catalog block.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./genre.tsx");
const helper = page.slice(page.indexOf("async function getJson"), page.indexOf("export default function GenrePage()"));
const loadAt = page.indexOf("const d = await getJson<GenrePayload>(");
const loader = page.slice(loadAt, page.indexOf("}, [genre, vertical, retryNonce]);", loadAt));

describe("failure path — a failed genre load never reads as an unclaimed genre", () => {
  it("the fetch helper returns null on a non-ok response", () => {
    expect(helper).toContain("if (!r.ok) return null;");
  });

  it("the effect records the error state on a failed load and data on success", () => {
    expect(loader).toContain("if (!d) setLoadError(true); else setData(d);");
    expect(loader).toContain("setLoading(false);");
  });

  it("the state machine starts loading with a distinct error state", () => {
    expect(page).toContain("const [loading, setLoading] = useState(true);");
    expect(page).toContain("const [loadError, setLoadError] = useState(false);");
  });

  it("failure renders the error panel with a retry wired to the real load", () => {
    expect(page).toContain("Couldn't load this genre.");
    expect(page).toContain("the genre exists, it just couldn't load.");
    expect(page).toContain("onClick={() => setRetryNonce((n) => n + 1)}");
    expect(page).toContain("Try again");
  });
});

describe("loading and genuine-empty paths stay distinct from failure", () => {
  it("the empty states render only after the error and loading branches", () => {
    const errorAt = page.indexOf("{loadError ? (");
    const loadingAt = page.indexOf(") : loading || !data ? (");
    const emptyAt = page.indexOf('title="No audio here yet"');
    expect(errorAt).toBeGreaterThan(-1);
    expect(loadingAt).toBeGreaterThan(errorAt);
    expect(emptyAt).toBeGreaterThan(loadingAt);
    expect(page).toContain('title="No videos here yet"');
  });
});
