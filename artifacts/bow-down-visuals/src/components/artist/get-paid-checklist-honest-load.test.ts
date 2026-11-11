/**
 * GetPaidChecklist (the artist get-paid checklist) — honest
 * load states (Stack-400 C-28 components residual, deep-pins
 * tranche 6).
 *
 * A classification pin: the checklist itself is driven by
 * the artist's own profile props and device-local marks
 * (the "shared" flag lives in localStorage under the
 * profile's slug — the member's own device state, never
 * presented as a server record). Its one server read, the
 * referral record, is ok-gated decoration (`if (!res.ok)
 * return;`): the referral code prefills only from a proven
 * response and its failure changes nothing the checklist
 * claims.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./get-paid-checklist.tsx");

describe("the referral prefill is ok-gated decoration", () => {
  it("the gate is pinned", () => {
    expect(src).toContain('fetch("/api/referrals/me", {');
    expect(src).toContain("if (!res.ok) return;");
  });
});
