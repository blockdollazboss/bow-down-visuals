/**
 * VaultSettings (the creator Vault start/settings) — honest
 * action states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * Both of the panel's legs throw on non-ok before any state
 * may change: the read helper throws into its failure
 * handling, and the start-Vault write throws into the
 * panel's error line with its plain copy ("Could not start
 * your Vault. Please try again.") — a Vault is never shown
 * as started, or its settings as saved, on an unproven
 * response. The throws are bare (the server's message is
 * not surfaced), but the STATE is always honest: failure
 * shows as failure.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./VaultSettings.tsx");

describe("both legs throw on non-ok before claiming anything", () => {
  it("the throws and the error copy are pinned", () => {
    expect(src.split("if (!res.ok) throw new Error();").length - 1).toBe(2);
    expect(src).toContain("Could not start your Vault. Please try again.");
  });
});
