/**
 * Credit History — honest load states (Stack 400 C-28: the
 * honest-load pin layer completing the "empty lie" audit).
 *
 * Both history lists (purchases and Visual Buc activity) ride the
 * same null-state machine: the list state stays null until a load
 * succeeds, each loader throws on a non-ok answer and records its
 * own error flag in its catch, and the render shows the section's
 * error block (via the shared sectionError renderer, retry wired to
 * the real loader) whenever the list is null AND its error flag is
 * set — the "no purchases yet" / "no activity yet" panels render
 * only inside the loaded branch. A failed load therefore can never
 * pose as an empty history. What was missing is the PIN; this file
 * pins the shape in source, like the sibling honest-load pins (the
 * FE suite runs in node, no DOM).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./credit-history.tsx");

function slice(from: string, to: string): string {
  const a = page.indexOf(from);
  expect(a, `marker ${from}`).toBeGreaterThan(-1);
  return page.slice(a, page.indexOf(to, a));
}

describe("loaders — each history load records failure in its own flag", () => {
  it("the payments loader throws on non-ok and sets paymentsError in its catch", () => {
    const loader = slice("async function loadPayments(): Promise<boolean> {", "async function loadUsage()");
    expect(loader).toContain('if (!res.ok) throw new Error("Failed to load purchase history");');
    expect(loader).toContain("setPayments(payData.payments ?? []);");
    expect(loader).toContain("setPaymentsError(false);");
    expect(loader).toContain("setPaymentsError(true);");
  });

  it("the usage loader throws on non-ok and sets usageError in its catch", () => {
    const loader = slice("async function loadUsage(): Promise<boolean> {", "useEffect(() => {");
    expect(loader).toContain('if (!res.ok) throw new Error("Failed to load Visual Buc history");');
    expect(loader).toContain("setUsage(histData.usage ?? []);");
    expect(loader).toContain("setUsageError(false);");
    expect(loader).toContain("setUsageError(true);");
  });
});

describe("render — the error block replaces the section; empty renders only when loaded", () => {
  it("the payments error block renders while the list is null, before the loaded branch", () => {
    const errorAt = page.indexOf("{!loading && !payments && paymentsError && sectionError(() => { setError(null); void loadPayments(); })}");
    const loadedAt = page.indexOf("{!loading && payments && (");
    expect(errorAt).toBeGreaterThan(-1);
    expect(loadedAt).toBeGreaterThan(errorAt);
  });

  it("the usage error block renders while the list is null, before the loaded branch", () => {
    const errorAt = page.indexOf("{!loading && !usage && usageError && sectionError(() => { setError(null); void loadUsage(); })}");
    const loadedAt = page.indexOf("{!loading && usage && (");
    expect(errorAt).toBeGreaterThan(-1);
    expect(loadedAt).toBeGreaterThan(errorAt);
  });

  it("both empty panels live inside the loaded branches", () => {
    const paymentsLoadedAt = page.indexOf("{!loading && payments && (");
    const paymentsEmptyAt = page.indexOf("{payments.length === 0 ? (");
    const usageLoadedAt = page.indexOf("{!loading && usage && (");
    const usageEmptyAt = page.indexOf("{usage.length === 0 ? (");
    expect(paymentsEmptyAt).toBeGreaterThan(paymentsLoadedAt);
    expect(usageEmptyAt).toBeGreaterThan(usageLoadedAt);
  });
});
