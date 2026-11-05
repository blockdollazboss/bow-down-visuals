/**
 * admin-limiter-skips.test.ts — Nov 4, 2026 re-verification pins.
 *
 * The Oct 29 admin-unrestricted lane put the house skip
 * (`skip: skipIfAdmin`, lib/admin.ts) on the five session limiters in
 * lib/rate-limit.ts. The Nov 4 re-verification census found two older
 * per-user CREATE limiters (both predate that lane — domains Oct 8,
 * review-links Oct 7) that pace a signed-in account's own creations
 * and never carried the skip, so the owner's account burned their
 * buckets like any customer's. They now carry it.
 *
 * These are wiring pins in the chat-voice.test.ts style: the limiter
 * objects are module-private, so the pin reads the source and asserts
 * (a) the skip is on the definition, (b) it comes from the ONE admin
 * module (no second definition of "admin"), and (c) the mount runs
 * requireAuth BEFORE the limiter, so the skip can actually see the
 * caller's identity. The predicate's own behaviour (admin → true,
 * member → false, unset env → false) is pinned behaviourally in
 * lib/__tests__/admin-unrestricted.test.ts, and a limiter using this
 * exact skip is exercised behaviourally in chat-voice.test.ts.
 *
 * The neighbouring limiters in the same files deliberately carry NO
 * skip — they key on IP/domain/token and pace public, third-party-
 * facing or anti-brute-force surfaces — and the last two tests pin
 * that they stayed that way, so a future "helpful" sweep can't
 * quietly exempt them.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";

function srcOf(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

/** The definition block of one limiter: from its const to the end of
 *  the rateLimit({ ... }) call. */
function limiterBlock(src: string, constName: string): string {
  const start = src.indexOf(`const ${constName}`);
  expect(start, `${constName} definition exists`).toBeGreaterThan(-1);
  const end = src.indexOf("});", start);
  expect(end, `${constName} definition terminates`).toBeGreaterThan(start);
  return src.slice(start, end);
}

describe("domains createLimiter — owner exemption wiring", () => {
  const src = srcOf("../domains.ts");

  it("the per-user create limiter carries the house admin skip", () => {
    const block = limiterBlock(src, "createLimiter");
    expect(block).toContain("limit: 10");
    expect(block).toContain("skip: skipIfAdmin");
  });

  it("the skip comes from the ONE admin module", () => {
    expect(src).toContain('import { skipIfAdmin } from "../lib/admin";');
  });

  it("the mount runs requireAuth before the limiter (identity first)", () => {
    expect(src).toContain('router.post("/domains", requireAuth, createLimiter');
  });

  it("the DNS-facing verify/resolve limiters deliberately carry NO skip", () => {
    expect(limiterBlock(src, "verifyLimiter")).not.toContain("skip:");
    expect(limiterBlock(src, "resolveLimiter")).not.toContain("skip:");
  });
});

describe("review-links reviewCreateLimiter — owner exemption wiring", () => {
  const src = srcOf("../review-links.ts");

  it("the per-user create limiter carries the house admin skip", () => {
    const block = limiterBlock(src, "reviewCreateLimiter");
    expect(block).toContain("limit: 30");
    expect(block).toContain("skip: skipIfAdmin");
  });

  it("the skip comes from the ONE admin module", () => {
    expect(src).toContain('import { skipIfAdmin } from "../lib/admin";');
  });

  it("the mount runs requireAuth before the limiter (identity first)", () => {
    expect(src).toContain('router.post("/review-links", requireAuth, reviewCreateLimiter');
  });

  it("the token unlock limiter deliberately carries NO skip (anti-brute-force)", () => {
    expect(limiterBlock(src, "reviewUnlockLimiter")).not.toContain("skip:");
  });
});
