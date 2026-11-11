/**
 * PromoteButton (the storefront promote / email-blast
 * button) — honest action states (Stack-400 C-28 components
 * residual, deep-pins tranche 6).
 *
 * - THE CAMPAIGN SEND runs an explicit state machine
 *   (idle / loading / done / error): done is reachable only
 *   through the ok response — the send throws on non-ok
 *   ("The email list API said no.") into the error state,
 *   so a blast is never shown as sent on an unproven write.
 * - THE REFERRAL READ is a fail-soft prefill (the
 *   WidgetsDeskPanel doctrine): the code decorates the
 *   promote link from whatever the read returns and its
 *   failure simply leaves the link uncoded — it never
 *   fabricates a code and never blocks promoting.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./PromoteButton.tsx");

describe("sent is a state the send must earn", () => {
  it("the machine and the non-ok throw are pinned", () => {
    expect(src).toContain('useState<"idle" | "loading" | "done" | "error">("idle")');
    expect(src).toContain('if (!res.ok) throw new Error("The email list API said no.");');
  });
});
