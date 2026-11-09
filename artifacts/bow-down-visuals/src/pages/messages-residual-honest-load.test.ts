/**
 * Messages conversation list — honest load states (Stack 400 C-28
 * residual pin; the in-thread call history is pinned separately by
 * messages-calls-honest-load.test.ts).
 *
 * The conversation list carries the strongest honest shape in the
 * family — full-page gates: the page returns the loading screen
 * while loading, then the error box (with a retry wired to the real
 * loader) on failure, and only then the list UI whose "No
 * conversations yet" line a failed load can therefore never reach.
 * loadConvs()'s catch records the error text; the thread load does
 * the same per-thread. What was missing is the PIN for the list;
 * this file pins the shape in source, like the sibling honest-load
 * pins (the FE suite runs in node, no DOM). The copy is hardcoded
 * English in the page, so the literals are pinned and there is no
 * catalog block.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./messages.tsx");
const loadAt = page.indexOf("async function loadConvs() {");
const loader = page.slice(loadAt, page.indexOf("async function loadCalls(", loadAt));

describe("failure path — a failed conversation load never reaches the empty list", () => {
  it("the loader records the error text in its catch and always clears loading", () => {
    expect(loader).toContain('setError(friendlyLoadError(e, "your messages"));');
    expect(loader).toContain("setInbox(d.inbox); setRequests(d.requests);");
    expect(loader).toContain("finally { setLoading(false); }");
  });

  it("the page gates on loading, then on error with a retry wired to the real loader", () => {
    const loadingAt = page.indexOf('if (loading) return <div className="min-h-screen bg-black text-white"><Loading label="Loading DMs" /></div>;');
    const errorAt = page.indexOf("if (error) return", loadingAt);
    const emptyAt = page.indexOf("{list.length === 0 && (", errorAt);
    expect(loadingAt).toBeGreaterThan(-1);
    expect(errorAt).toBeGreaterThan(loadingAt);
    expect(emptyAt).toBeGreaterThan(errorAt);
    expect(page).toContain("onRetry={() => { setError(null); setLoading(true); loadConvs(); }}");
    expect(page).toContain("No conversations yet — go meet some creators.");
  });

  it("the thread load records its own error text the same way", () => {
    expect(page).toContain('setThreadError(friendlyLoadError(e, "these messages"));');
  });
});
