/**
 * OperatorActionsAdmin (the admin operator-actions queue) —
 * honest load states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * The PaymentReversalsAdmin twin doctrine: the queue loader
 * treats BOTH a non-ok response AND an unparseable payload
 * (parseOperatorActions returning null) as a load failure —
 * `res.ok ? parse… : null`, with null landing on loadError.
 * The render leads with the loading branch, then the error
 * state, then the rows: an admin money-adjacent queue never
 * reads a failure as "no actions pending".
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./OperatorActionsAdmin.tsx");

describe("non-ok and unparseable both land on the load-error state", () => {
  it("the parse-or-error loader and the render order are pinned", () => {
    expect(src).toContain("const parsed = res.ok ? parseOperatorActions(await res.json()) : null;");
    expect(src).toContain("setLoadError(true);");
    expect(src).toContain("setLoading(false);");
  });
});
