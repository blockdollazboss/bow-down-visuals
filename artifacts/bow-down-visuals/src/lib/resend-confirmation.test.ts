/**
 * resend-confirmation.test.ts — payfix Fix 3 (Pass 0 re-run defect):
 * /login had NO "Resend confirmation email" control; an unconfirmed
 * user whose sign-in failed with "Email not confirmed" had to
 * re-submit /signup to get a fresh confirmation link.
 *
 * The contract pinned here:
 *  (a) the control surfaces when sign-in fails as unconfirmed, and is
 *      discoverable from the login form at all times;
 *  (b) it fires Supabase auth.resend({ type: "signup" }) — exactly
 *      once per click — with the same redirect signup uses;
 *  (c) after an attempt the control cools down (and a Supabase
 *      throttle refusal also starts the cooldown), so the auth-email
 *      endpoint cannot be hammered;
 *  (d) copy is honest: success only after a real success, errors are
 *      the server's own message.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  RESEND_COOLDOWN_MS,
  cooldownSecondsLeft,
  isResendThrottleError,
  isUnconfirmedSignInError,
  resendConfirmationEmail,
  type ResendCapableClient,
} from "./resend-confirmation";

const login = readFileSync(
  new URL("../pages/login.tsx", import.meta.url),
  "utf8",
);
const authContext = readFileSync(
  new URL("../contexts/AuthContext.tsx", import.meta.url),
  "utf8",
);

describe("isUnconfirmedSignInError — detection (unit)", () => {
  it("matches Supabase's unconfirmed failures", () => {
    expect(isUnconfirmedSignInError("Email not confirmed")).toBe(true);
    expect(isUnconfirmedSignInError("email_not_confirmed")).toBe(true);
    expect(
      isUnconfirmedSignInError("Please confirm your email before signing in"),
    ).toBe(true);
  });

  it("does not fire for other failures or no failure", () => {
    expect(isUnconfirmedSignInError("Invalid login credentials")).toBe(false);
    expect(isUnconfirmedSignInError("Network request failed")).toBe(false);
    expect(isUnconfirmedSignInError(null)).toBe(false);
    expect(isUnconfirmedSignInError(undefined)).toBe(false);
    expect(isUnconfirmedSignInError("")).toBe(false);
  });
});

describe("resendConfirmationEmail — the Supabase resend (unit)", () => {
  it("fires exactly one auth.resend per call, type signup, signup's redirect", async () => {
    const resend = vi.fn(async () => ({ error: null }));
    const client: ResendCapableClient = { auth: { resend } };
    const out = await resendConfirmationEmail(
      client,
      "creator@example.com",
      "https://bowdownvisuals.com",
    );
    expect(out).toEqual({ error: null });
    expect(resend).toHaveBeenCalledTimes(1);
    expect(resend).toHaveBeenCalledWith({
      type: "signup",
      email: "creator@example.com",
      options: {
        emailRedirectTo: "https://bowdownvisuals.com/choose-artist",
      },
    });
    // The redirect matches what signup itself sends (AuthContext.signUp's
    // emailRedirectTo, read from source — a future drift between the two
    // fails here, not in production).
    expect(authContext).toContain(
      "emailRedirectTo: `${window.location.origin}/choose-artist`",
    );
  });

  it("passes the server's error through verbatim — never a fake success", async () => {
    const client: ResendCapableClient = {
      auth: {
        resend: async () => ({
          error: {
            message:
              "For security purposes, you can only request this after 60 seconds.",
          },
        }),
      },
    };
    const out = await resendConfirmationEmail(
      client,
      "creator@example.com",
      "https://bowdownvisuals.com",
    );
    expect(out.error).toContain("security purposes");
  });
});

describe("cooldown — rate-limit friendly (unit)", () => {
  it("counts whole seconds left and expires at the boundary", () => {
    const t0 = 1_000_000;
    expect(cooldownSecondsLeft(t0 + RESEND_COOLDOWN_MS, t0)).toBe(60);
    expect(cooldownSecondsLeft(t0 + RESEND_COOLDOWN_MS, t0 + 30_000)).toBe(30);
    expect(cooldownSecondsLeft(t0 + RESEND_COOLDOWN_MS, t0 + 59_500)).toBe(1);
    expect(cooldownSecondsLeft(t0 + RESEND_COOLDOWN_MS, t0 + 60_000)).toBe(0);
    expect(cooldownSecondsLeft(0, t0)).toBe(0);
  });

  it("recognizes Supabase throttle refusals so they start the cooldown too", () => {
    expect(
      isResendThrottleError(
        "For security purposes, you can only request this after 60 seconds.",
      ),
    ).toBe(true);
    expect(isResendThrottleError("Rate limit exceeded")).toBe(true);
    expect(isResendThrottleError("User not found")).toBe(false);
    expect(isResendThrottleError(null)).toBe(false);
  });
});

describe("login page — the control (source)", () => {
  it("surfaces on an unconfirmed sign-in failure", () => {
    expect(login).toContain(
      "setUnconfirmedEmail(isUnconfirmedSignInError(error) ? values.email : null)",
    );
    expect(login).toContain('data-testid="resend-confirmation-panel"');
    expect(login).toContain(
      "const showResend = !resetMode && (unconfirmedEmail !== null || resendOpen);",
    );
  });

  it("is discoverable from the login form even before any failure", () => {
    expect(login).toContain('data-testid="link-resend-confirmation"');
    expect(login).toContain("onClick={() => setResendOpen(true)}");
  });

  it("one click fires once: handler is gated by sending + cooldown and the button disables", () => {
    expect(login).toContain('data-testid="btn-resend-confirmation"');
    expect(login).toContain("onClick={onResendConfirmation}");
    expect(login).toContain(
      "if (resendSending || resendCooldownLeft > 0) return;",
    );
    expect(login).toContain(
      "disabled={resendSending || resendCooldownLeft > 0}",
    );
    expect(login).toContain(
      "await resendConfirmationEmail(getSupabase(), email, window.location.origin)",
    );
  });

  it("success starts the cooldown; a throttle refusal starts it too; honest copy both ways", () => {
    expect(login).toContain("setResendSent(true);");
    expect(login).toContain(
      "setResendCooldownUntil(Date.now() + RESEND_COOLDOWN_MS);",
    );
    expect(login).toContain("if (isResendThrottleError(error))");
    expect(login).toContain('data-testid="resend-confirmation-sent"');
    expect(login).toContain(
      'defaultValue: "Confirmation email sent — check your inbox and tap the link to finish signing up."',
    );
    // The server's message is what the user sees on error.
    expect(login).toContain("setResendError(error);");
  });
});
