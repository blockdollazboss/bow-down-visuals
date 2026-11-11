/**
 * GrantsDesk (the in-World grants desk) — honest load
 * states (Stack-400 C-28 components residual, deep-pins
 * tranche 6).
 *
 * - THE GRANTS LOAD is parse-or-fail, twice over: non-ok
 *   throws, and an ok body the surface parser rejects
 *   throws too (`if (!parsed) throw`) — both land on the
 *   desk's loadFailed state. A grant list is never painted
 *   from an unproven or malformed payload.
 * - THE ACTION helper (callApi) throws on non-ok with the
 *   server's message into the desk's error line — apply /
 *   save outcomes are claimed only from proven responses.
 * - A GUEST's headers resolve fail-soft to undefined (the
 *   desk's public read), which changes WHOSE grants load,
 *   never whether the load must prove itself.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./GrantsDesk.tsx");

describe("the grants surface loads parse-or-fail", () => {
  it("both throws and the failed state are pinned", () => {
    expect(src).toContain('if (!res.ok) throw new Error("load failed");');
    expect(src).toContain('if (!parsed) throw new Error("load failed");');
    expect(src).toContain("setLoadFailed(true);");
    expect(src).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, t("worldSponsorPress.grErrorFallback")));');
  });
});
