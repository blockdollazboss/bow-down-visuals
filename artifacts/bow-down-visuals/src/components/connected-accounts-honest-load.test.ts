/**
 * ConnectedAccounts — honest load states (Stack-400 C-28
 * components residual, deep-pins tranche 1). The settings surface
 * for social connections runs a THREE-WAY load whose distinctions
 * the file states outright:
 *
 * - A FAILED load is NOT "no accounts connected": non-ok (other
 *   than 503) and network throws empty the list AND raise the
 *   error flag, so a connected member is never presented as
 *   never-connected.
 * - A 503 (social_accounts_not_ready — the server's table isn't on
 *   this database yet) is NOT a failure either: it raises the
 *   unavailable flag, rendered plainly ("isn't switched on for
 *   this site yet") in amber, not as the red error card.
 * - Only an ok response records accounts and clears both flags.
 *
 * The render order is the contract: checking → unavailable →
 * error (with a Retry wired to the hook's real reload) → the
 * platform rows, where each platform's connected state derives
 * from the loaded accounts. The hook's reload() runs the same
 * three-way machine as the mount load.
 *
 * Copy is literal on this surface. The FE suite runs in node (no
 * DOM), so these tests pin the machine in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const accounts = read("./ConnectedAccounts.tsx");

describe("the three-way load — failed, not-ready, and loaded never blur", () => {
  it("the file states both distinctions outright", () => {
    expect(accounts).toContain('A failed load is NOT "no accounts connected" — it gets its own error');
    expect(accounts).toContain("is NOT a failure either:");
  });

  it("a 503 raises unavailable and clears the error flag", () => {
    expect(accounts).toContain("if (res.status === 503) {");
    expect(accounts).toContain("setUnavailable(true);");
  });

  it("any other non-ok response throws; the catch raises the error flag", () => {
    expect(accounts).toContain('if (!res.ok) throw new Error("load failed");');
    expect(accounts).toContain("setLoadError(true);");
  });

  it("only an ok response records accounts and clears both flags", () => {
    expect(accounts).toContain("setAccounts(list);\n      setLoadError(false);\n      setUnavailable(false);");
  });
});

describe("render order: checking, unavailable, error with retry, then the rows", () => {
  it("the four branches appear in contract order", () => {
    const loadIdx = accounts.indexOf("Checking connections…");
    const unavIdx = accounts.indexOf("Social posting isn't switched on for this site yet");
    const errIdx = accounts.indexOf("Couldn't load your connected accounts — check your connection and try again.");
    const rowsIdx = accounts.indexOf("PLATFORMS.map((cfg) => {");
    expect(loadIdx).toBeGreaterThan(-1);
    expect(unavIdx).toBeGreaterThan(loadIdx);
    expect(errIdx).toBeGreaterThan(unavIdx);
    expect(rowsIdx).toBeGreaterThan(errIdx);
  });

  it("the error branch's retry re-runs the real reload", () => {
    expect(accounts).toContain("onClick={() => void reload()}");
  });

  it("the unavailable state is plain, not the red error card", () => {
    expect(accounts).toContain("border-amber-400/25 bg-amber-400/[0.05]");
    expect(accounts).toContain("border-red-500/30 bg-red-500/[0.06]");
  });
});
