import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Referral attribution wiring — source pins.
 *
 * Live failure (payments Pass 0, Oct 24 2026): a referred signup never
 * bound. The signup form fired POST /api/referrals/apply immediately
 * after Supabase signUp() — before email confirmation, so there was no
 * session, the call went out as `Bearer null` and 401'd — and it had
 * already deleted the stored ?ref code, so the later real sign-in
 * never retried. These pins keep the fixed wiring from regressing:
 *
 *   - App.tsx captures ?ref into localStorage on every navigation.
 *   - AuthContext applies the stored code once a session exists, and
 *     removes it ONLY when the server adjudicates (200 / 400 / 404).
 *   - signup.tsx never fires or consumes the code at form submit.
 *   - The trial-claim localStorage gate is keyed per account (a second
 *     account in the same browser was denied its trial — Account C).
 */

const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("referral attribution: capture (App.tsx)", () => {
  const app = src("../App.tsx");

  it("captures ?ref into localStorage", () => {
    expect(app).toContain('localStorage.setItem("bdv_referral_code"');
  });

  it("re-runs capture on navigation, not just first mount", () => {
    const captureAt = app.indexOf('localStorage.setItem("bdv_referral_code"');
    expect(captureAt).toBeGreaterThan(-1);
    const depsAt = app.indexOf("}, [location]);", captureAt);
    expect(depsAt).toBeGreaterThan(captureAt);
  });
});

describe("referral attribution: bind at first session (AuthContext)", () => {
  const ctx = src("./AuthContext.tsx");

  it("applies the stored code through the authed apply endpoint", () => {
    expect(ctx).toContain('localStorage.getItem("bdv_referral_code")');
    expect(ctx).toContain('"/api/referrals/apply"');
  });

  it("removes the code only on server adjudication (200 via res.ok, or 400/404)", () => {
    expect(ctx).toContain('localStorage.removeItem("bdv_referral_code")');
    expect(ctx).toContain("res.status === 400 || res.status === 404");
  });

  it("keys the trial-claim gate per account, never bare", () => {
    const keyed = ctx.match(/bdv_trial_claimed:\$\{user\.id\}/g) ?? [];
    expect(keyed.length).toBeGreaterThanOrEqual(2); // get + set
    expect(ctx).not.toContain('getItem("bdv_trial_claimed")');
    expect(ctx).not.toContain('setItem("bdv_trial_claimed", "1")');
  });
});

describe("referral attribution: signup form stays out of it (signup.tsx)", () => {
  const page = src("../pages/signup.tsx");

  it("does not fire the apply endpoint at form submit", () => {
    expect(page).not.toContain("referrals/apply");
  });

  it("does not consume the stored code", () => {
    expect(page).not.toContain('removeItem("bdv_referral_code")');
  });
});
