/**
 * AwayDigestModal (the "while you were away" digest) —
 * honest load states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * An entry-point surface with the WatchTipDoor doctrine:
 * the digest read is ok-gated at the door (`if (!res.ok)
 * return;`) — a failed or refused read leaves the modal
 * unpopulated and unopened rather than fabricating a digest
 * of activity that may not have happened. The digest's
 * contents render only from the proven payload; absence of
 * a modal claims nothing about the member's away period.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./AwayDigestModal.tsx");

describe("the digest populates only from a proven read", () => {
  it("the ok gate at the door is pinned", () => {
    expect(src).toContain('fetch("/api/retention/away-digest", {');
    expect(src).toContain("if (!res.ok) return;");
  });
});
