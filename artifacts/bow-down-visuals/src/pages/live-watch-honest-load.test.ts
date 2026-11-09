/**
 * Live Watch (single stream) — honest load states (Stack 400 C-28,
 * C-27 residual pin verified against both shapes: the join14 page
 * and the SectionBoundary-wrapped shape banked on
 * stack1600/s400-resilience-live @ df87eb650 — every string asserted
 * here is present verbatim in BOTH versions, so the pin holds
 * whichever shape lands).
 *
 * The stream load carries a four-state machine (loading | ready |
 * error | notfound): fetchStream() throws on a non-ok answer (a 404
 * is its own notfound state, not an error), the load effect records
 * error in its catch and ready on success, and the render returns
 * the loading screen, then the error screen with a retry that bumps
 * the retry nonce feeding the real load effect, before the notfound
 * screen — a failed load can never dress up as a missing stream.
 * This file pins that shape in source, like the sibling honest-load
 * pins (the FE suite runs in node, no DOM). The copy is hardcoded
 * English in the page, so the literals are pinned and there is no
 * catalog block.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./live-watch.tsx");
const fetchAt = page.indexOf("const fetchStream = useCallback(async (): Promise<LiveStreamDto | null> => {");
const fetchLoader = page.slice(fetchAt, page.indexOf("/* Initial load (and manual retries). */", fetchAt));
const effectAt = page.indexOf("/* Initial load (and manual retries). */");
const loadEffect = page.slice(effectAt, page.indexOf("const isLive", effectAt));

describe("failure path — a failed stream load never reads as a missing stream", () => {
  it("the loader throws on a non-ok response, with 404 kept as its own notfound state", () => {
    expect(fetchLoader).toContain('if (!res.ok) throw new Error("load failed");');
    expect(fetchLoader).toContain('setLoad("notfound");');
  });

  it("the load effect records the error state in its catch and ready on success", () => {
    expect(loadEffect).toContain('setLoad("error");');
    expect(loadEffect).toContain('setLoad("ready");');
    expect(loadEffect).toContain('setLoad("loading");');
  });

  it("the state machine starts at loading", () => {
    expect(page).toContain('type LoadState = "loading" | "ready" | "error" | "notfound";');
    expect(page).toContain('const [load, setLoad] = useState<LoadState>("loading");');
  });

  it("failure renders the error screen with copy and a retry wired to the real load effect", () => {
    expect(page).toContain("Couldn't load this stream.");
    expect(page).toContain("the stream may well be live, it just couldn't load right now.");
    /* both the load-error retry and the player reconnect bump the
       nonce the load effect depends on */
    expect(page.match(/onClick=\{\(\) => setRetryNonce\(\(n\) => n \+ 1\)\}/g)).toHaveLength(2);
  });
});

describe("loading, error and notfound screens stay distinct and ordered", () => {
  it("the render returns loading, then error, then notfound", () => {
    const loadingAt = page.indexOf('if (load === "loading") {');
    const errorAt = page.indexOf('if (load === "error") {');
    const notfoundAt = page.indexOf('if (load === "notfound" || !stream) {');
    expect(loadingAt).toBeGreaterThan(-1);
    expect(errorAt).toBeGreaterThan(loadingAt);
    expect(notfoundAt).toBeGreaterThan(errorAt);
    expect(page).toContain("That stream doesn't exist.");
  });
});
