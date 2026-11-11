/**
 * PaymentReversalsAdmin (the admin payment-reversals queue)
 * — honest load states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * - THE QUEUE LOAD is a four-state exemplar: loading, then
 *   the load-error card (title + body + retryNonce retry),
 *   then the genuine empty state, then the rows. The loader
 *   treats BOTH a non-ok response AND an unparseable payload
 *   (parsePaymentReversals returning null) as a load failure
 *   — a money-queue failure never reads as "no reversals".
 * - THE RESOLVE action requires its note for a dismissal up
 *   front (its own validation line) and applies the decision
 *   only from the checked response — a reversal is never
 *   shown resolved before the server resolves it.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./PaymentReversalsAdmin.tsx");

describe("the queue load: loading, error, empty, rows — in that order", () => {
  it("non-ok and unparseable payloads both land on the load-error state", () => {
    expect(src).toContain("const parsed = res.ok ? parsePaymentReversals(await res.json()) : null;");
    expect(src).toContain("else setLoadError(true);");
    expect(src).toContain("}, [load, retryNonce]);");
  });

  it("the render chain puts the error card before the genuine empty state", () => {
    const loadingIdx = src.indexOf("{loading ? (");
    const errorIdx = src.indexOf(") : loadError ? (");
    const emptyIdx = src.indexOf(") : rows.length === 0 ? (");
    expect(loadingIdx).toBeGreaterThan(-1);
    expect(errorIdx).toBeGreaterThan(loadingIdx);
    expect(emptyIdx).toBeGreaterThan(errorIdx);
    expect(src).toContain('t("admin.reversals.loadErrorTitle")');
  });
});
