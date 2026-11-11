/**
 * TeamSeats (team seat / invite management) — honest load
 * states (Stack-400 C-28 components residual, deep-pins
 * tranche 6).
 *
 * - THE SEATS LOAD is the house settings-family machine:
 *   it resets loading + loadError on every run, throws on
 *   non-ok ("load failed") into loadError, and settles
 *   loading in finally — the seat list is never painted
 *   from defaults or an error body.
 * - THE INVITE-ACCEPT write throws on non-ok with the
 *   server's message ("accept failed" fallback) — a seat
 *   is never shown as accepted on an unproven write.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./TeamSeats.tsx");

describe("the seats load errors honestly; accept gates on ok", () => {
  it("the load machine and the accept throw are pinned", () => {
    expect(src).toContain('if (!res.ok) throw new Error("load failed");');
    expect(src).toContain("setLoadError(true);");
    expect(src).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, "accept failed"));');
  });
});
