/**
 * RemixKingSection (the monthly Remix King event section) —
 * honest load states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * JUDGMENT PIN, as-is: this is an OPTIONAL event module
 * docked on a host page. Its load has exactly two honest
 * outcomes — a proven current event renders the section, and
 * anything else (no event running, or a load that couldn't
 * prove one) renders nothing at all. Absence claims nothing:
 * the section never prints "no event" copy a failure couldn't
 * prove, and a member's own page never grows an error card
 * for a promotional module. Hiding until proven is the honest
 * direction for an optional surface (the WatchTipDoor shape).
 * - THE ENTER AND VOTE actions, by contrast, are the
 *   member's own writes and narrate fully: non-ok throws the
 *   server's message, the "Your remix is in" line lands only
 *   on an ok entry, and the voted set updates only from the
 *   proven voted flag in the response.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./RemixKingSection.tsx");

describe("the optional section renders only from a proven event", () => {
  it("an unproven load leaves the section absent, claiming nothing", () => {
    expect(src).toContain('if (!res.ok) throw new Error("load failed");');
    expect(src).toContain("if (!loaded || !view) return null;");
    expect(src).toContain("setView(data.view);");
  });
});

describe("the member's own writes narrate from their checked responses", () => {
  it("enter and vote throw the server's message on non-ok", () => {
    expect(src).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, "Could not enter your remix"));');
    expect(src).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, "Vote failed"));');
    expect(src).toContain('setMsg("Your remix is in. Good luck — the winner becomes an official release.");');
    expect(src).toContain("if (data.voted) next.add(entryId); else next.delete(entryId);");
  });
});
