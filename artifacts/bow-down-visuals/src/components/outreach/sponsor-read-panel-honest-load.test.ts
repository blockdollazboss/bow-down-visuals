/**
 * SponsorReadPanel (write a sponsor read in the outreach
 * flow) — honest action states (Stack-400 C-28 components
 * residual, deep-pins tranche 6).
 *
 * An action panel, not a collection load. Both of its calls
 * narrate only from checked responses:
 * - THE GENERATE gates on ok + the proven read payload; a
 *   success body without the read is the failure line, never
 *   a blank "your read" presented as done; the loading flag
 *   clears in finally.
 * - THE SAVE TO DRAFTS throws on non-ok into the same honest
 *   error line — a draft is never implied to exist before
 *   the server stored it.
 * - The send-to-voiceover handoff is a labeled best-effort
 *   clipboard/localStorage pass-along and claims nothing.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./SponsorReadPanel.tsx");

describe("the generate gates success on ok + the proven read", () => {
  it("non-ok or a missing read lands on the failure line", () => {
    expect(src).toContain("if (!res.ok || !data.read) {");
    expect(src).toContain('setError(plainErrorText(err, t("outreach.sponsorReadFailed")));');
    expect(src).toContain("setLoading(false);");
  });
});

describe("the draft save claims a draft only on an ok response", () => {
  it("non-ok throws the save-failed message", () => {
    expect(src).toContain('if (!res.ok) throw new Error(t("outreach.sponsorReadSaveFailed"));');
  });
});
