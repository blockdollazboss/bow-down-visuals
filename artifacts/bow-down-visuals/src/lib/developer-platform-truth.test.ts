/**
 * developer-platform-truth.test.ts — stack1100 Lane X6.
 *
 * The Developer door's webhook copy promised "Failed deliveries retry
 * 5 times (30s, 5 min, 30 min, 2 hrs)" — five retries but only four
 * delays listed. The delivery engine (lib/api-webhooks.ts) makes
 * MAX_ATTEMPTS = 5 attempts TOTAL: the first attempt plus four retries
 * after exactly those four delays. The copy now says so, and these
 * pins re-derive the engine side from source so the sentence and the
 * engine cannot drift apart silently again.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readFe(rel: string): string {
  return readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
}

function readApi(rel: string): string {
  return readFileSync(new URL(`../../../api-server/src/${rel}`, import.meta.url), "utf8");
}

describe("Developer door — webhook retry copy == delivery engine", () => {
  it("the engine attempts 5 times total with 4 retry delays (30s, 5m, 30m, 2h)", () => {
    const engine = readApi("lib/api-webhooks.ts");
    expect(engine).toContain("export const MAX_ATTEMPTS = 5;");
    const delays = engine.match(/export const RETRY_DELAYS_MS = \[([^\]]+)\]/);
    expect(delays, "RETRY_DELAYS_MS in lib/api-webhooks.ts").toBeTruthy();
    expect(delays![1]).toContain("30_000");
    expect(delays![1]).toContain("300_000");
    expect(delays![1]).toContain("1_800_000");
    expect(delays![1]).toContain("7_200_000");
  });

  it("the copy states attempts-in-total and the same four delays — never 'retry 5 times'", () => {
    const src = readFe("components/DeveloperApiSettings.tsx");
    expect(src).not.toContain("retry 5 times");
    expect(src).toContain("attempted up to 5 times in total");
    expect(src).toContain("30s, 5 min, 30 min and 2 hrs");
  });
});
