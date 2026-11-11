/**
 * SocialKitPanel (the hub social-kit generator) — honest
 * action states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * An action panel with no mount load, the hub family shape:
 * the generate call throws on non-ok with the server's
 * message; the catch translates the out_of_credits outcome
 * to its own line instead of showing a raw code; and a
 * DECLINED credit confirmation is handled on its own branch
 * (busy flag released, no error) — a member changing their
 * mind at the confirm step is never shown a failure.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./SocialKitPanel.tsx");

describe("the kit generates only from an ok response; a cancel is not an error", () => {
  it("the gate, the credits translation, and the cancel branch are pinned", () => {
    expect(src).toContain('if (!res.ok) throw new Error(apiThrowMessage(data, t("hubSpine.socialKit.failed")));');
    expect(src).toContain('setError(msg === "out_of_credits" ? t("hubSpine.handoffs.outOfCredits") : msg);');
    expect(src).toContain("setLoading(false); // user cancelled the credit confirmation");
  });
});
