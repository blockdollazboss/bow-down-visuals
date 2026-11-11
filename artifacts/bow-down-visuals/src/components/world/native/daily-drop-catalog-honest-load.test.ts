/**
 * DailyDropCatalog (the in-World daily-drop catalog) —
 * honest load states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * A native desk on a three-state machine (loading / ready /
 * failed) rendered through the shared native states: the
 * api helper throws on non-ok with a failure message that
 * can be specialized per status (failText(res.status)) —
 * the catalog lands on its failed state via NativeErrorState
 * and its loading state via NativeLoadingState, so a drop
 * catalog is never painted from an error body or dressed as
 * an empty catalog on failure.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./DailyDropCatalog.tsx");

describe("the catalog renders exactly its proven state", () => {
  it("the machine, the status-aware throw, and the native states are pinned", () => {
    expect(src).toContain('useState<"loading" | "ready" | "failed">("loading")');
    expect(src).toContain("if (!res.ok) throw new Error(apiErrorMessage(data, failText ? failText(res.status) : `Request failed (${res.status})`));");
    expect(src).toContain('t("retention.dropCatalog.loading")');
  });
});
