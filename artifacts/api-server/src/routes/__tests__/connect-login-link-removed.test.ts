/**
 * Item 7 (0132): /connect/login-link always returned 501 — connected
 * accounts are created via the v2 API, which has no login-link endpoint
 * (documented in lib/stripe-connect.ts). The endpoint and its only
 * frontend caller were removed; creators manage payout setup through
 * the working /connect/refresh onboarding link instead. These source
 * assertions keep a button that can only fail from coming back.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

describe("connect login-link removal", () => {
  it("the API no longer registers a login-link route", () => {
    const src = readFileSync(join(here, "../stripe-connect.ts"), "utf8");
    expect(src).not.toContain('"/connect/login-link"');
    expect(src).not.toContain("NO_LOGIN_LINK");
    /* The working paths stay. */
    expect(src).toContain('"/connect/onboard"');
    expect(src).toContain('"/connect/refresh"');
    expect(src).toContain('"/connect/payout"');
  });

  it("no frontend code calls the removed endpoint", () => {
    const dash = readFileSync(
      join(here, "../../../bow-down-visuals/src/pages/store-dashboard.tsx"),
      "utf8",
    );
    expect(dash).not.toContain("/api/connect/login-link");
    expect(dash).toContain('goOnboard("/api/connect/refresh")');
  });
});
