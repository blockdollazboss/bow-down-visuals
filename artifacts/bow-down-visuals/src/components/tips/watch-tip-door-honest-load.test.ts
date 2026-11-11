/**
 * WatchTipDoor (the tip door on a watch page + the tip flow)
 * — honest load states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * - THE TIP-PAGE PROBE is an entry-point check, pinned as-is:
 *   the door renders only from a proven tip page; a non-ok
 *   or thrown probe leaves the door HIDDEN ("no tip jar —
 *   the door stays hidden"). Absence is the honest direction
 *   for an entry point: the door never claims a jar exists
 *   that wasn't proven.
 * - THE TIP ITSELF narrates from every checked response:
 *   the checkout leg and the record leg each surface the
 *   server's most specific message (the first detail when
 *   the server sends details, else its error message), and
 *   a thrown request lands on the generic error line — a tip
 *   is never implied to have landed before the record call
 *   proves it.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./WatchTipDoor.tsx");

describe("the door exists only from a proven tip page", () => {
  it("an unproven probe leaves the door hidden", () => {
    expect(src).toContain("if (!res.ok) return;");
    expect(src).toContain("} catch { /* no tip jar — the door stays hidden */ }");
  });
});

describe("the tip narrates from every checked response", () => {
  it("the record leg surfaces the server's most specific message", () => {
    expect(src).toContain('setError(coJson?.details?.[0]?.message ?? apiErrorMessage(coJson, t("tipPage.recordFailed")));');
    expect(src).toContain('setError(json.details?.[0]?.message ?? apiErrorMessage(json, t("tipPage.recordFailed")));');
    expect(src).toContain('setError(t("tipPage.genericError"));');
  });
});
