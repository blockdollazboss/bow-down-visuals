/**
 * First100FansCard (the first-100-fans dashboard card) —
 * honest load states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * An OPTIONAL dashboard card, pinned as-is on the
 * entry-point rule: it renders ONLY from a proven status
 * (status state starts null, the card returns null until
 * shouldShowFirst100Card AND a real status agree), and a
 * failed read hides the card — the comment says it plainly:
 * "a failed read hides the card — never breaks the
 * dashboard". Absence claims nothing about the member's fans.
 * - THE CELEBRATE AND DISMISS writes update the card only
 *   from a proven fresh status (the call helper returns null
 *   on non-ok and the state is left untouched); dismiss hides
 *   locally first because the local hide IS the member's
 *   expressed intent, with the server sync as the secondary
 *   record.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./First100FansCard.tsx");

describe("the card renders only from a proven status", () => {
  it("a failed read hides the card; the render gate requires a real status", () => {
    expect(src).toContain("if (!res.ok) return;");
    expect(src).toContain("/* a failed read hides the card — never breaks the dashboard */");
    expect(src).toContain("if (!user || !shouldShowFirst100Card(status, locallyDismissed) || !status) return null;");
  });
});

describe("the writes update only from proven responses", () => {
  it("the call helper returns null on non-ok and callers set state only from a fresh status", () => {
    expect(src).toContain("if (!res.ok) return null;");
    expect(src).toContain("if (fresh) setStatus(fresh);");
    expect(src).toContain("/* the moment stays pending and can be marked again */");
  });
});
