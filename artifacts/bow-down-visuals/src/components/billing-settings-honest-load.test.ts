/**
 * BillingSettings — honest load states (Stack-400 C-28 components
 * residual, deep-pins tranche 1). The settings billing card's load
 * rides the bounded, classified loader in lib/billing-load (its own
 * suite covers the classifier); this pin covers the COMPONENT
 * wiring of that machine:
 *
 * - Every attempt clears the prior failure first; a failed attempt
 *   records a TYPED failure kind (the loader's BillingLoadError
 *   classification, defaulting to "unreachable" for anything
 *   unclassified) — never a silent blank and never a stale plan.
 * - The render runs loading (only while no billing AND no failure)
 *   → the failure block, whose copy is keyed by the failure kind
 *   and whose retry bumps the nonce the load effect depends on →
 *   the loaded card. A failed load can never render as a Free plan.
 * - The beside-read of hosting state is best-effort BY DESIGN
 *   ("the tier card stands on its own"): it records only on ok.
 * - Money actions stay truthful under conflict: the shared post()
 *   helper ADOPTS the server-shipped billing state on an honest
 *   409 before throwing, so the card never shows a stale plan
 *   after a refused change; action failures toast destructively.
 *
 * Copy rides settings.billing.* keys. The FE suite runs in node
 * (no DOM), so these tests pin the wiring in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const billing = read("./BillingSettings.tsx");

describe("the load records a typed failure — never a blank, never a stale plan", () => {
  it("billing and failure start empty; every attempt clears the prior failure", () => {
    expect(billing).toContain("const [billing, setBilling] = useState<BillingStateView | null>(null);");
    expect(billing).toContain("const [loadFailure, setLoadFailure] = useState<BillingLoadFailureKind | null>(null);");
    expect(billing).toContain("setLoadFailure(null);");
  });

  it("failure records the loader's classification, defaulting to unreachable", () => {
    expect(billing).toContain('setLoadFailure(err instanceof BillingLoadError ? err.failure : "unreachable");');
    expect(billing).toContain("const view = await loadBilling({");
  });

  it("the load effect re-runs on the retry nonce", () => {
    expect(billing).toContain("}, [user, getAccessToken, retryNonce]);");
  });
});

describe("render order: loading, failure with retry, then the card", () => {
  it("the loading line shows only while there is neither billing nor failure", () => {
    expect(billing).toContain("{!billing && !loadFailure && (");
    expect(billing).toContain('t("settings.billing.loading")');
  });

  it("the failure block's copy is keyed by the failure kind and its retry bumps the nonce", () => {
    expect(billing).toContain("{t(LOAD_ERROR_KEYS[loadFailure])}");
    expect(billing).toContain("onClick={() => setRetryNonce((n) => n + 1)}");
    expect(billing).toContain('t("settings.billing.retry")');
  });

  it("the loaded card renders only behind loaded billing", () => {
    expect(billing).toContain("{billing && display && (");
  });
});

describe("the beside-reads and actions stay truthful", () => {
  it("the hosting beside-read records only on ok, under its best-effort note", () => {
    expect(billing).toContain("Best-effort: a failed read\n     leaves the tier card exactly as it was.");
    expect(billing).toContain("if (!res.ok) return;");
  });

  it("a refused money action adopts the server-shipped state before throwing", () => {
    expect(billing).toContain("The server ships the current billing state on honest 409s —");
    expect(billing).toContain("if (d.billing) setBilling(d.billing);");
  });

  it("action failures toast destructively", () => {
    expect(billing).toContain('toast({ title: t("settings.billing.cancelFailed"), variant: "destructive" });');
  });
});
