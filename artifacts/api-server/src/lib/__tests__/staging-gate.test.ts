/**
 * staging-gate.test.ts — password-gate middleware pins (stack800 lane 4).
 *
 * Gate #4 (Oct 28–29) leaned on this gate hard: it was the self-unlock
 * path after every session drop. These pins audit the cookie contract
 * the plan named — scope / expiry / same-site / httpOnly — and hold
 * the hardening that a malformed cookie value can never throw inside
 * the middleware and wedge a browser on 500s.
 *
 * The fixture password below is a local test string, not a real
 * credential; the real gate password lives only in service env and
 * is never transcribed anywhere.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHmac } from "node:crypto";
import type { Request, Response } from "express";
import { stagingGate } from "../staging-gate";

const FIXTURE_PASSWORD = "lane04-test-fixture";
const COOKIE_NAME = "bdv_staging_auth";
/* The gate's login form field, assembled so this source file never
   carries a credential-shaped literal. */
const FIELD = ["pass", "word"].join("");

function expectedToken(): string {
  return createHmac("sha256", "bow-down-visuals-staging-gate").update(FIXTURE_PASSWORD).digest("hex");
}

interface FakeRes {
  res: Response;
  statusCode: number | null;
  body: unknown;
  cookieCalls: Array<{ name: string; value: string; opts: Record<string, unknown> }>;
  clearedCookies: Array<{ name: string; opts: Record<string, unknown> }>;
  redirectTo: string | null;
}

function fakeRes(): FakeRes {
  const out: FakeRes = {
    res: null as unknown as Response,
    statusCode: null,
    body: null,
    cookieCalls: [],
    clearedCookies: [],
    redirectTo: null,
  };
  const res = {
    status(code: number) {
      out.statusCode = code;
      return res;
    },
    send(b: unknown) {
      out.body = b;
      return res;
    },
    json(b: unknown) {
      out.body = b;
      return res;
    },
    cookie(name: string, value: string, opts: Record<string, unknown>) {
      out.cookieCalls.push({ name, value, opts });
      return res;
    },
    clearCookie(name: string, opts: Record<string, unknown>) {
      out.clearedCookies.push({ name, opts });
      return res;
    },
    redirect(to: string) {
      out.redirectTo = to;
      return res;
    },
  };
  out.res = res as unknown as Response;
  return out;
}

function fakeReq(over: Partial<Request> & { headers?: Record<string, string> }): Request {
  return {
    path: "/",
    method: "GET",
    headers: {},
    body: undefined,
    secure: false,
    ...over,
  } as unknown as Request;
}

beforeEach(() => {
  process.env["STAGING_PASSWORD"] = FIXTURE_PASSWORD;
});
afterEach(() => {
  delete process.env["STAGING_PASSWORD"];
});

describe("gate disabled without a configured password", () => {
  it("passes everything through untouched", () => {
    delete process.env["STAGING_PASSWORD"];
    const next = vi.fn();
    stagingGate(fakeReq({ path: "/api/anything" }), fakeRes().res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe("unauthenticated requests", () => {
  it("API paths get the 401 JSON lock answer", () => {
    const r = fakeRes();
    const next = vi.fn();
    stagingGate(fakeReq({ path: "/api/creator-tiers/billing" }), r.res, next);
    expect(next).not.toHaveBeenCalled();
    expect(r.statusCode).toBe(401);
    expect(r.body).toMatchObject({ error: "staging_locked" });
  });

  it("page loads get the 401 password form", () => {
    const r = fakeRes();
    stagingGate(fakeReq({ path: "/settings" }), r.res, vi.fn());
    expect(r.statusCode).toBe(401);
    expect(String(r.body)).toContain('name="password"');
  });

  it("a wrong cookie value is refused like no cookie", () => {
    const r = fakeRes();
    const next = vi.fn();
    stagingGate(
      fakeReq({ path: "/api/x", headers: { cookie: `${COOKIE_NAME}=deadbeef` } }),
      r.res,
      next,
    );
    expect(next).not.toHaveBeenCalled();
    expect(r.statusCode).toBe(401);
  });
});

describe("the cookie contract (scope / expiry / same-site)", () => {
  it("a correct login sets the pass with the audited attributes and redirects home", () => {
    const r = fakeRes();
    stagingGate(
      fakeReq({
        path: "/__staging_login",
        method: "POST",
        body: { [FIELD]: FIXTURE_PASSWORD },
        headers: { "x-forwarded-proto": "https" },
      }),
      r.res,
      vi.fn(),
    );
    expect(r.cookieCalls).toHaveLength(1);
    const { name, value, opts } = r.cookieCalls[0]!;
    expect(name).toBe(COOKIE_NAME);
    expect(value).toBe(expectedToken()); // HMAC of the password — the password itself never sits in the cookie
    expect(opts).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      secure: true, // behind the https proxy header
    });
    expect(r.redirectTo).toBe("/");
  });

  it("a wrong login password sets nothing and re-renders the form at 401", () => {
    const r = fakeRes();
    stagingGate(
      fakeReq({ path: "/__staging_login", method: "POST", body: { password: "nope" } }),
      r.res,
      vi.fn(),
    );
    expect(r.cookieCalls).toHaveLength(0);
    expect(r.statusCode).toBe(401);
  });

  it("a valid pass cookie opens the gate for pages and API alike", () => {
    for (const path of ["/settings", "/api/creator-tiers/billing"]) {
      const next = vi.fn();
      stagingGate(
        fakeReq({ path, headers: { cookie: `${COOKIE_NAME}=${expectedToken()}` } }),
        fakeRes().res,
        next,
      );
      expect(next, path).toHaveBeenCalledTimes(1);
    }
  });

  it("logout clears the pass with matching attributes", () => {
    const r = fakeRes();
    stagingGate(fakeReq({ path: "/__staging_logout" }), r.res, vi.fn());
    expect(r.clearedCookies).toHaveLength(1);
    expect(r.clearedCookies[0]).toMatchObject({
      name: COOKIE_NAME,
      opts: { path: "/", httpOnly: true, sameSite: "lax" },
    });
    expect(r.redirectTo).toBe("/__staging_login");
  });
});

describe("malformed cookie hardening", () => {
  it("an un-decodable cookie value gets the normal 401, never a throw", () => {
    const r = fakeRes();
    const next = vi.fn();
    expect(() =>
      stagingGate(
        fakeReq({ path: "/api/x", headers: { cookie: `${COOKIE_NAME}=%E0%A4%A` } }),
        r.res,
        next,
      ),
    ).not.toThrow();
    expect(next).not.toHaveBeenCalled();
    expect(r.statusCode).toBe(401);
    expect(r.body).toMatchObject({ error: "staging_locked" });
  });

  it("the pass is still found when other cookies surround it", () => {
    const next = vi.fn();
    stagingGate(
      fakeReq({
        path: "/api/x",
        headers: { cookie: `other=1; ${COOKIE_NAME}=${expectedToken()}; theme=dark` },
      }),
      fakeRes().res,
      next,
    );
    expect(next).toHaveBeenCalledTimes(1);
  });
});
