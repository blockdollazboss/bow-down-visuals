/**
 * DiscountCodesDesk (the in-World discount-codes desk) —
 * honest load states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * - THE CODES LOAD distinguishes its answers: a 404 whose
 *   body says NO_PROFILE lands on the no-profile state (the
 *   truth "no shop profile yet"), while any other non-ok
 *   throws "load failed" into the desk's error state — a
 *   failed load never renders as an empty code list.
 * - THE WRITES (create/toggle through the shared callApi)
 *   throw on non-ok with the server's message, and the form
 *   validates the code itself first (discountsCheckCode) —
 *   a code is never shown saved on an unproven write.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./DiscountCodesDesk.tsx");

describe("no-profile is an answer, not a failure; other failures error", () => {
  it("the distinction and the write gate are pinned", () => {
    expect(src).toContain('if (res.status === 404 && (data as { error?: string })?.error === "NO_PROFILE") {');
    expect(src).toContain('if (!res.ok) throw new Error("load failed");');
    expect(src).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, t("worldCommerceStands.discountsErrorFallback")));');
    expect(src).toContain('setError(t("worldCommerceStands.discountsCheckCode"));');
  });
});
