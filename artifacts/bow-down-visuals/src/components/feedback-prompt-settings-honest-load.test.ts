/**
 * FeedbackPromptSettings (the feedback-prompt account
 * toggle) — honest load states (Stack-400 C-28 components
 * residual, deep-pins tranche 6).
 *
 * The house settings-pattern exemplar — its own header
 * states the law: a failed load is an error state with a
 * retry, NEVER a fake "on".
 * - THE LOAD keeps the value null (and the switch disabled)
 *   until a proven response lands; non-ok throws into the
 *   loadError card, whose retry bumps retryNonce and re-runs
 *   the real load. The switch's checked state is only ever
 *   the proven value (the ?? true is the disabled switch's
 *   resting face while unproven, never an assertion about
 *   the account).
 * - THE TOGGLE WRITE is optimistic WITH proof discipline:
 *   the saved toast fires only after the PATCH answers ok
 *   with its own enabled value; any failure reverts to the
 *   previous proven value and toasts the failure.
 *
 * NO FIX in this lane — the family already meets the standard.
 * (Its settings twins — GroupDigestSettings,
 * MonthWrappedSettings, RetentionPrefsSettings,
 * SoundPrefsSettings, SocialProofSettings,
 * ViralSpikeSettings — carry the same machinery and are
 * pinned in this tranche on the same terms.)
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./FeedbackPromptSettings.tsx");

describe("the load never paints an unproven value as the account's setting", () => {
  it("non-ok lands on the error card; the switch stays disabled until proven", () => {
    expect(src).toContain('if (!res.ok) throw new Error("load failed");');
    expect(src).toContain("if (!cancelled) setLoadError(true);");
    expect(src).toContain("disabled={enabled === null || saving}");
    expect(src).toContain("onClick={() => setRetryNonce((n) => n + 1)}");
    expect(src).toContain("never a fake \"on\"");
  });
});

describe("the toggle write reverts on failure", () => {
  it("the saved toast waits for the proven response; failure restores the old value", () => {
    expect(src).toContain('if (!res.ok) throw new Error("save failed");');
    expect(src).toContain("setEnabled(d.enabled ?? nextValue);");
    expect(src).toContain("setEnabled(prev); // revert on failure");
  });
});
