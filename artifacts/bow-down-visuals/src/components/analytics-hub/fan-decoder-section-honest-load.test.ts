/**
 * FanDecoderSection (the fan-comment decoder) — honest
 * action states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * An action panel with no mount load: the decode runs only
 * with actual comments pasted in (the button is disabled on
 * an empty box, and the handler returns early on the same
 * condition), and the result applies only from an ok
 * response carrying the decoded payload — `!res.ok ||
 * !data.wants` throws into the error line, so a failure body
 * never renders as a decode of the member's fans. The busy
 * flag clears in finally.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./FanDecoderSection.tsx");

describe("the decode applies only from an ok response carrying the payload", () => {
  it("the gate and the busy-flag release are pinned", () => {
    expect(src).toContain('if (!res.ok || !data.wants) throw new Error(apiErrorMessage(data, "Decode failed."));');
    expect(src).toContain('setError(plainErrorText(e, "Decode failed."));');
    expect(src).toContain("disabled={loading || comments.length === 0}");
    expect(src).toContain("setLoading(false);");
  });
});
