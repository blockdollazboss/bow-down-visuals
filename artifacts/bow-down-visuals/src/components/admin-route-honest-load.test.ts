/**
 * AdminRoute (the admin-only route guard) — honest load
 * states (Stack-400 C-28 components residual, deep-pins
 * tranche 6).
 *
 * The fail-closed exemplar, stated in its own header: the
 * guard trusts ONLY `res.ok && isAdmin === true`. While the
 * check is in flight nothing admin renders; a non-ok
 * response, a false flag, a missing flag, and a thrown read
 * ALL resolve to not-admin. For a permission gate the
 * honest direction is claiming LESS on failure — an
 * unproven check must never dress up as an authorized
 * session, and this guard never does.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./AdminRoute.tsx");

describe("admin is trusted only from an ok response with an explicit true", () => {
  it("the fail-closed gate is pinned", () => {
    expect(src).toContain("trust only `res.ok && isAdmin === true`");
    expect(src).toContain("if (!cancelled) setIsAdmin(res.ok && status.isAdmin === true);");
  });
});
