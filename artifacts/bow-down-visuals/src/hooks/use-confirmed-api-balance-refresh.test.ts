/**
 * Balance-display freshness — the confirmed-spend hook must refresh
 * the profile balance when a PAID call settles (Nov 11 $0 probe:
 * ledger charges posted from ~12:40 EST while the on-screen balance
 * sat at the pre-probe number until an unrelated refetch at 13:19 —
 * AuthContext only refetches at bootstrap / auth change, and this
 * hook, the shared spend path, never asked it to).
 *
 * The FE suite runs in node (no DOM), so these pins are in source:
 * the refresh is wired into the settle paths of confirmedFetch and
 * gated to confirmed paid calls only.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync(new URL("./use-confirmed-api.ts", import.meta.url), "utf8");

describe("confirmedFetch refreshes the balance when a paid call settles", () => {
  it("pulls refreshProfile from the auth context", () => {
    expect(src).toContain("const { getAccessToken, refreshProfile } = useAuth();");
  });

  it("refreshes on BOTH settle paths — a response and a network throw", () => {
    expect(src.split("refreshBalanceAfterSettle();").length - 1).toBe(2);
    /* the throw path refreshes and then rethrows the caller's error */
    expect(src).toContain("refreshBalanceAfterSettle();\n        throw err;");
  });

  it("only paid calls refresh — the gate is the resolved price, and a cancelled confirm returns before any fetch or refresh", () => {
    expect(src).toContain("const paidCall = paidCost > 0;");
    expect(src).toContain("if (!paidCall) return;");
    const cancelReturn = src.indexOf("if (!confirmed) return null;");
    const helperDefined = src.indexOf("const refreshBalanceAfterSettle");
    expect(cancelReturn).toBeGreaterThan(-1);
    expect(helperDefined).toBeGreaterThan(cancelReturn);
  });

  it("the refresh can never break the caller's response", () => {
    expect(src).toContain("void refreshProfile().catch(() => {});");
  });

  it("the spent toast keeps its exact condition shape: ok response on a paid call", () => {
    expect(src).toContain("if (response.ok && paidCall) {");
    expect(src).toContain("Visual Bucs spent");
  });
});
