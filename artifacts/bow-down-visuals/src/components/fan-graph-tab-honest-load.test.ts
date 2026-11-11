/**
 * FanGraphTab (the email-list fan graph) — honest load
 * states (Stack-400 C-28 components residual, deep-pins
 * tranche 6).
 *
 * A textbook four-state data tab: the loader resets to
 * loading + clears the error on every run, throws on non-ok
 * with the server's own message ("Couldn't load your fan
 * graph.") into the dedicated error state, and clears
 * loading in finally; the render leads with the loading
 * branch, and pagination is disabled while a load is in
 * flight — the graph never paints fan data from an error
 * body, and the member can never page against a half-loaded
 * state.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./FanGraphTab.tsx");

describe("the fan graph loads, errors, and pages honestly", () => {
  it("the throw, the error state, and the in-flight page lock are pinned", () => {
    expect(src).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, "Couldn\'t load your fan graph."));');
    expect(src).toContain('setError(t("email-list.fan_graph_error"));');
    expect(src).toContain("setLoading(false);");
    expect(src).toContain("disabled={page >= pages || loading}");
  });
});
