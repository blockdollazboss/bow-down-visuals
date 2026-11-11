/**
 * DropDayPanel (drop-day kits for a member's releases) —
 * honest load states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * - THE KITS LOAD keeps entries null until a proven response
 *   lands: the panel renders "Loading your releases…" only
 *   while the load is genuinely in flight, a failed load
 *   lands on the loadError state (the effect re-runs through
 *   retryNonce), and the genuine empty state renders only
 *   from a proven empty array.
 * - THE KIT ACTIONS (assemble / activate) narrate from their
 *   checked responses per release: non-ok throws the server's
 *   message into that release's own error slot, and the
 *   notice lands only on an ok response.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./DropDayPanel.tsx");

describe("the kits load: in-flight, error, proven-empty — never a fake list", () => {
  it("the loader throws on non-ok into the load-error state", () => {
    expect(src).toContain('if (!res.ok) throw new Error("load failed");');
    expect(src).toContain("if (!cancelled) setLoadError(true);");
    expect(src).toContain("setEntries(d.releases);");
    expect(src).toContain("}, [user, getAccessToken, retryNonce]);");
  });

  it("the empty state renders only from a proven array", () => {
    expect(src).toContain("Loading your releases…");
    expect(src).toContain("{entries && entries.length === 0 && (");
  });
});

describe("the kit actions narrate per release from their checked responses", () => {
  it("non-ok throws the server's message into that release's error slot", () => {
    expect(src).toContain('if (!res.ok) throw new Error(apiErrorMessage(d, "That didn\'t work"));');
    expect(src).toContain("setError({ releaseId, text: e instanceof Error ? e.message : \"That didn't work\" });");
  });
});
