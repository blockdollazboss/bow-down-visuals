/**
 * ChannelAuditPanel (the AI channel audit) — honest action
 * states (Stack-400 C-28 components residual, deep-pins
 * tranche 6).
 *
 * An action panel with no mount load: the audit runs only on
 * a submit the form itself validates (a niche of at least
 * two characters), and the result applies only when the
 * response is BOTH ok and error-free — `!res.ok ||
 * data.error` routes to the error line, so an ok-looking
 * failure payload never renders as an audit. The busy flag
 * clears in finally, so the panel can never trap in
 * "auditing" after any outcome.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./ChannelAuditPanel.tsx");

describe("the audit result applies only from an ok, error-free response", () => {
  it("the gate and the busy-flag release are pinned", () => {
    expect(src).toContain("if (!res.ok || data.error) {");
    expect(src).toContain('setError(plainErrorText(err, t("audit.errorAuditFailed")));');
    expect(src).toContain("setLoading(false);");
    expect(src).toContain("const canSubmit = niche.trim().length >= 2 && !loading;");
  });
});
