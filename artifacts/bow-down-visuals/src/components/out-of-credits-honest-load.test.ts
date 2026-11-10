/**
 * OutOfCredits — honest load states (Stack-400 C-28 components
 * residual, deep-pins tranche 1). The "Not Enough Visual Bucs" card
 * is the classic empty-lie risk in reverse: rendered on a FAILED
 * balance read, it would tell a creator they are out of Bucs when
 * the site simply couldn't check. The gate makes that impossible.
 * The card's cost form routes the balance read (hooks/use-balance-read)
 * through lib/credits-gate's decideCreditsGate: loading → "checking"
 * (a neutral spinner state), failed → "balance-error" (an honest
 * couldn't-check panel with a retry wired to the real re-read),
 * ready → the card ONLY on a proven balance below the cost, and
 * "nothing" (renders null) on a proven sufficient balance.
 *
 * Copy rides i18n keys; the pin carries the catalog block. The FE
 * suite runs in node (no DOM), so these tests pin the machine in
 * source across the component, the gate, and the read hook.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const card = read("./OutOfCredits.tsx");
const gate = read("../lib/credits-gate.ts");
const hook = read("../hooks/use-balance-read.ts");

const LOCALES = ["en", "es", "fr", "de", "it", "pt", "ar", "hi", "ja", "ko"] as const;
function flat(o: unknown, p = "", out: Record<string, string> = {}): Record<string, string> {
  if (o && typeof o === "object" && !Array.isArray(o)) {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      const key = p ? `${p}.${k}` : k;
      if (v && typeof v === "object" && !Array.isArray(v)) flat(v, key, out);
      else out[key] = v as string;
    }
  }
  return out;
}

describe("the gate never lets a failed or pending read claim an empty balance", () => {
  it("the read is a four-state machine — loading and failed are distinct states", () => {
    expect(gate).toContain('| { status: "loading" }');
    expect(gate).toContain('| { status: "failed" }');
    expect(gate).toContain('| { status: "ready"; balance: number };');
    expect(gate).toContain('if (input.profileCredits === null) return { status: "failed" };');
  });

  it("the decision maps loading → checking and failed → balance-error", () => {
    expect(gate).toContain('case "loading":');
    expect(gate).toContain('return "checking";');
    expect(gate).toContain('case "failed":');
    expect(gate).toContain('return "balance-error";');
  });

  it("the card decision requires a PROVEN balance below the cost", () => {
    expect(gate).toContain('return read.balance < cost ? "card" : "nothing";');
  });
});

describe("the component renders each decision honestly", () => {
  it("checking renders the neutral checking state, not the card", () => {
    expect(card).toContain('if (decision === "checking") {');
    expect(card).toContain('t("outOfCredits.checkingBalance")');
  });

  it("balance-error renders the couldn't-check panel with a retry wired to the real re-read", () => {
    expect(card).toContain('if (decision === "balance-error") {');
    expect(card).toContain('t("outOfCredits.balanceErrorTitle")');
    expect(card).toContain('t("outOfCredits.balanceErrorBody")');
    expect(card).toContain("onClick={retry}");
    expect(card).toContain('t("outOfCredits.retryBtn")');
    expect(hook).toContain("retry: () => {");
  });

  it("a sufficient balance renders nothing at all", () => {
    expect(card).toContain('if (decision === "nothing") return null;');
  });

  it("the decision branches run before the card can render", () => {
    const checkingAt = card.indexOf('if (decision === "checking") {');
    const errorAt = card.indexOf('if (decision === "balance-error") {');
    const cardAt = card.indexOf("return <OutOfCreditsCard onClose={onClose} />;", errorAt);
    expect(checkingAt).toBeGreaterThan(-1);
    expect(errorAt).toBeGreaterThan(checkingAt);
    expect(cardAt).toBeGreaterThan(errorAt);
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the out-of-credits honest-load keys", (loc) => {
    const cat = flat(JSON.parse(read(`../locales/${loc}.json`)));
    for (const k of [
      "outOfCredits.checkingBalance",
      "outOfCredits.balanceErrorTitle",
      "outOfCredits.balanceErrorBody",
      "outOfCredits.retryBtn",
    ]) {
      expect(typeof cat[k] === "string" && cat[k]!.trim() !== "", `${loc}: ${k}`).toBe(true);
    }
  });
});
