/**
 * EvergreenPanel (evergreen content scheduling) — honest
 * load states (Stack-400 C-28 components residual, deep-pins
 * tranche 6).
 *
 * - THE API HELPER's failure names its status: "Request
 *   failed (${res.status})" behind the server's own message
 *   — a failed call is diagnosable from its error alone,
 *   and no payload is ever read from an error body.
 * - THE LOAD is the house machine: loading + loadError
 *   reset per run, failures land on loadError, loading
 *   settles in the finally path — the evergreen queue is
 *   never painted as empty on a failed load.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./EvergreenPanel.tsx");

describe("failures name their status; the load errors honestly", () => {
  it("the helper throw and the load machine are pinned", () => {
    expect(src).toContain("if (!res.ok) throw new Error(apiErrorMessage(data, `Request failed (${res.status})`));");
    expect(src).toContain("setLoadError(true);");
    expect(src).toContain("setLoading(false);");
  });
});
