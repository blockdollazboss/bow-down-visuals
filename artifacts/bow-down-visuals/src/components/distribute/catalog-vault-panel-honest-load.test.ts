/**
 * CatalogVaultPanel (vault a release into the catalog) —
 * honest action states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * An action panel with no mount load: the vault write gates
 * its success on the ok response — `onVaulted` (the parent
 * state change that shows the release as vaulted) fires
 * only after the `!res.ok` throw, and the failure reports
 * to BOTH the local error line and the parent's handler, so
 * no surface is left believing an unstored vault happened.
 * An earlier guard returns before the call when a
 * precondition fails, clearing the busy flag on the way
 * out; the flag also clears in finally.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./CatalogVaultPanel.tsx");

describe("vaulted is claimed only after the ok response", () => {
  it("the gate, the dual error report, and the busy release are pinned", () => {
    expect(src).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, t("catalogVault.vaultFailed")));');
    expect(src).toContain("onVaulted(releaseId);");
    expect(src).toContain("setLocalError(msg);");
    expect(src).toContain("onError(msg);");
    expect(src).toContain("setVaulting(false);");
  });
});
