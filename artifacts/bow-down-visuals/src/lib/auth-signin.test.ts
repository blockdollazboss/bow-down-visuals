/**
 * auth-signin.test.ts — bounded sign-in pins (stack800 lane 4).
 *
 * Gate #4 (Oct 28–29) watched login hang 45–60 s on "Signing in…"
 * and then surface the raw "Failed to fetch" as if it were an
 * account problem. These pins hold the fix: every attempt settles
 * inside its bound, transport/server failures retry exactly once,
 * credential decisions are never retried and never reworded.
 */
import { describe, it, expect, vi } from "vitest";
import {
  signInWithPasswordBounded,
  classifySignInError,
  signInFailureCopy,
  SignInTimeoutError,
  type PasswordSignInFn,
} from "./auth-signin";

const noSleep = async () => undefined;

function transportError(): Error {
  const e = new Error("Failed to fetch");
  e.name = "AuthRetryableFetchError";
  return e;
}

describe("signInWithPasswordBounded", () => {
  it("passes a clean success straight through, one attempt", async () => {
    const signIn = vi.fn<PasswordSignInFn>(async () => ({
      data: { user: { id: "user-1" } },
      error: null,
    }));
    const out = await signInWithPasswordBounded({ signIn, sleep: noSleep }, "a@b.c", "pw");
    expect(out).toEqual({ ok: true, user: { id: "user-1" } });
    expect(signIn).toHaveBeenCalledTimes(1);
  });

  it("bounds a stalled attempt: timeout is transport, retried once, then honest copy", async () => {
    const signIn = vi.fn<PasswordSignInFn>(() => new Promise(() => undefined)); // never settles
    const out = await signInWithPasswordBounded(
      { signIn, sleep: noSleep, timeoutMs: 20 },
      "a@b.c",
      "pw",
    );
    expect(signIn).toHaveBeenCalledTimes(2); // exactly one retry — never a loop
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.failure).toBe("transport");
      expect(out.error).toContain("Couldn't reach the sign-in server");
      expect(out.error).not.toContain("Failed to fetch");
    }
  });

  it("a transport failure that recovers on the retry signs in", async () => {
    let calls = 0;
    const signIn = vi.fn<PasswordSignInFn>(async () => {
      calls++;
      if (calls === 1) return { data: { user: null }, error: transportError() };
      return { data: { user: { id: "user-2" } }, error: null };
    });
    const out = await signInWithPasswordBounded({ signIn, sleep: noSleep }, "a@b.c", "pw");
    expect(out).toEqual({ ok: true, user: { id: "user-2" } });
    expect(signIn).toHaveBeenCalledTimes(2);
  });

  it("wrong credentials: never retried, server message verbatim", async () => {
    const signIn = vi.fn<PasswordSignInFn>(async () => ({
      data: { user: null },
      error: { message: "Invalid login credentials", name: "AuthApiError", status: 400 },
    }));
    const out = await signInWithPasswordBounded({ signIn, sleep: noSleep }, "a@b.c", "pw");
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ ok: false, error: "Invalid login credentials", failure: "credentials" });
  });

  it("unconfirmed email passes through verbatim (the resend flow keys off this text)", async () => {
    const signIn = vi.fn<PasswordSignInFn>(async () => ({
      data: { user: null },
      error: { message: "Email not confirmed", name: "AuthApiError", status: 400 },
    }));
    const out = await signInWithPasswordBounded({ signIn, sleep: noSleep }, "a@b.c", "pw");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toBe("Email not confirmed");
  });

  it("auth-server 5xx: retried once, terminal copy names the server + status", async () => {
    const signIn = vi.fn<PasswordSignInFn>(async () => ({
      data: { user: null },
      error: { message: "Internal Server Error", name: "AuthApiError", status: 502 },
    }));
    const out = await signInWithPasswordBounded({ signIn, sleep: noSleep }, "a@b.c", "pw");
    expect(signIn).toHaveBeenCalledTimes(2);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.failure).toBe("server");
      expect(out.error).toContain("HTTP 502");
      expect(out.error).not.toContain("Couldn't reach");
    }
  });

  it("a thrown network TypeError is transport, not a credentials verdict", async () => {
    const signIn = vi.fn<PasswordSignInFn>(async () => {
      throw new TypeError("Failed to fetch");
    });
    const out = await signInWithPasswordBounded({ signIn, sleep: noSleep }, "a@b.c", "pw");
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.failure).toBe("transport");
      expect(out.error).toContain("Couldn't reach");
    }
  });
});

describe("classifySignInError / signInFailureCopy", () => {
  it("classifies the three worlds apart", () => {
    expect(classifySignInError(new SignInTimeoutError(15000))).toBe("transport");
    expect(classifySignInError({ message: "x", name: "AuthRetryableFetchError", status: 0 })).toBe("transport");
    expect(classifySignInError({ message: "x", name: "AuthApiError", status: 500 })).toBe("server");
    expect(classifySignInError({ message: "x", name: "AuthApiError", status: 400 })).toBe("credentials");
    expect(classifySignInError(new TypeError("Failed to fetch"))).toBe("transport");
  });

  it("copy never leaks the raw browser message", () => {
    expect(signInFailureCopy("transport", new TypeError("Failed to fetch"))).not.toContain("Failed to fetch");
    expect(signInFailureCopy("credentials", { message: "" })).toBe("Login failed");
  });
});
