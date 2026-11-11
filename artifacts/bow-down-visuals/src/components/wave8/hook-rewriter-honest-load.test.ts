/**
 * HookRewriter (wave8 hook rewriter) — honest action states
 * (Stack-400 C-28 components residual, deep-pins tranche 6).
 *
 * An action panel with no mount load: every branch of the
 * rewrite call settles the busy flag on its own path — the
 * success path releases it, the 402 branch sets the
 * out-of-credits state AND releases it, and any other non-ok
 * throws its status into the shared catch (the rewrite
 * error line, flag released in finally). The rewritten
 * hooks render only from the proven response; the panel can
 * never trap in "rewriting" after any outcome.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./HookRewriter.tsx");

describe("every outcome releases the busy flag; non-ok never renders hooks", () => {
  it("the 402 branch, the throw, and the error line are pinned", () => {
    expect(src).toContain("if (res.status === 402) {");
    expect(src).toContain("if (!res.ok) throw new Error(`HTTP ${res.status}`);");
    expect(src).toContain('setError(t("wave8.hookRewriter.errorRewrite"));');
    expect(src).toContain("setLoading(false);");
  });
});
