/**
 * MerchBench (the World merch bench) — honest load states
 * (Stack-400 C-28 components residual, deep-pins tranche 2).
 *
 * - THE STORE LOAD is a boolean-proof loader: loadStore
 *   returns true only when the response landed AND parsed —
 *   a declined confirmation (null res), a non-ok, and an
 *   unparseable payload each return false, and the mount maps
 *   that onto the explicit loading/ready/failed storeState
 *   machine. The designs, commission, and payments-live flags
 *   record only inside the proven branch — a failed load can
 *   never paint an empty store with a made-up commission.
 * - THE DROP PLANS ride the same boolean discipline
 *   (loadPlans): saved plans record only on proof.
 *
 * NO FIX in this lane — every family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const bench = read("./MerchBench.tsx");

describe("the store load: proof or failed, nothing between", () => {
  it("loadStore returns false on declined, non-ok, and unparseable alike", () => {
    expect(bench).toContain('if (!res) throw new Error("load");');
    expect(bench).toContain("const store = parseMerchStore((await res.json().catch(() => null)) as unknown);");
    expect(bench).toContain('if (!res.ok || !store) throw new Error("load");');
    expect(bench).toContain("setDesigns(store.designs);");
    expect(bench).toContain("setPaymentsLive(store.paymentsLive);");
    expect(bench).toContain("return true;");
    expect(bench).toContain("return false;");
  });

  it("the mount maps the proof onto the loading/ready/failed machine", () => {
    expect(bench).toContain('useState<"loading" | "failed" | "ready">("loading")');
    expect(bench).toContain('setStoreState(ok ? "ready" : "failed");');
  });

  it("the plans loader mirrors the discipline", () => {
    expect(bench).toContain("const plans = parseMerchDropPlans((await res.json().catch(() => null)) as unknown);");
    expect(bench).toContain('if (!res.ok || !plans) throw new Error("load");');
    expect(bench).toContain("setSavedPlans(plans);");
  });
});
