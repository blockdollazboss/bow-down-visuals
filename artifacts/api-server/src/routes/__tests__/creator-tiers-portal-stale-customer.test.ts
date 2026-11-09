/**
 * Route tests for POST /creator-tiers/portal — the stale-customer
 * hardening (Stack 400 C-10 + C-35).
 *
 * C-10 — THE GAP: the portal resolved the stored Stripe customer id
 * read-only and handed it straight to billingPortal.sessions.create.
 * A member whose customer was deleted in Stripe (test-mode cleanup,
 * dashboard deletion) got an unhandled provider 500 — and the
 * getTestStripe() failure branch above it returned the raw provider
 * message to the client. The portal now verifies the customer first
 * (lib/creator-stripe-customer's verifyStoredStripeCustomer — the
 * retrieve + deleted/resource_missing check checkout's resolver
 * already trusted): a dead customer falls through to the existing
 * honest 404 copy, session creation is wrapped, and every failure
 * answers the plain 502 copy. The portal still never mints or
 * replaces a customer — re-resolution ends at the honest state.
 *
 * C-35 — THE GAP: `returnTo` was accepted on a bare startsWith("/"),
 * which also passes "//evil.example/…" — a protocol-relative
 * absolute URL. The check is now the shared isSameSitePath shape
 * (single leading slash, no backslash); anything else falls back to
 * the portal's own page.
 *
 * Driven over an ephemeral server against a cond-aware fake db + a
 * fake guarded Stripe client whose customers.retrieve is scripted
 * per customer id, in the creator-tiers-portal-hosting.test.ts
 * harness pattern.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const USER_OK = "66666666-6666-4666-8666-666666666666";
const USER_STALE = "77777777-7777-4777-8777-777777777777";
const USER_DELETED = "88888888-8888-4888-8888-888888888888";
const USER_BOOM = "99999999-9999-4999-8999-999999999999";
const PROFILE_OK = "f1111111-f111-4f11-8f11-f111111111111";
const PROFILE_STALE = "f2222222-f222-4f22-8f22-f222222222222";
const PROFILE_DELETED = "f3333333-f333-4f33-8f33-f333333333333";
const PROFILE_BOOM = "f4444444-f444-4f44-8f44-f444444444444";

const PROVIDER_SECRET = "rawr provider detail that must never reach the client";

const h = vi.hoisted(() => ({
  state: {
    profilesByUserId: new Map<string, Record<string, unknown>>(),
    subsByProfileId: new Map<string, Record<string, unknown>>(),
    hostingByProfileId: new Map<string, Record<string, unknown>>(),
    customersByUserId: new Map<string, Record<string, unknown>>(),
  },
  /* Scripted customers.retrieve outcomes, by customer id:
     "missing" → throws resource_missing (deleted outright);
     "deleted" → resolves with deleted: true (Stripe's soft-delete);
     "boom"    → throws a non-missing provider error. */
  retrieveScript: new Map<string, "missing" | "deleted" | "boom">(),
  retrieveCalls: [] as string[],
  portalCalls: [] as Array<Record<string, unknown>>,
  portalBoom: false,
}));

const dialect = new PgDialect();
function render(cond: unknown): { sql: string; params: unknown[] } {
  const q = dialect.sqlToQuery(cond as never);
  return { sql: q.sql, params: q.params as unknown[] };
}

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (req.headers["x-anon"]) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    req.userId = req.headers["x-user-id"] ?? USER_OK;
    req.userEmail = "portal-stale@example.test";
    next();
  },
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/kings-welcome", () => ({
  ensureKingsWelcome: async () => undefined,
}));

vi.mock("../../lib/stripe-client", () => ({
  createGuardedStripeClient: () => ({
    customers: {
      retrieve: async (id: string) => {
        h.retrieveCalls.push(id);
        const scripted = h.retrieveScript.get(id);
        if (scripted === "missing") {
          throw Object.assign(new Error(`No such customer: ${PROVIDER_SECRET}`), {
            code: "resource_missing",
          });
        }
        if (scripted === "boom") {
          throw Object.assign(new Error(PROVIDER_SECRET), { code: "api_error" });
        }
        if (scripted === "deleted") return { id, deleted: true };
        return { id };
      },
    },
    billingPortal: {
      sessions: {
        create: async (params: Record<string, unknown>) => {
          h.portalCalls.push(params);
          if (h.portalBoom) throw new Error(PROVIDER_SECRET);
          return { url: "https://billing.stripe.test/session" };
        },
      },
    },
    checkout: { sessions: { create: async () => ({ id: "cs_test", url: "https://checkout.stripe.test/x" }) } },
  }),
  buildCheckoutSessionIdempotencyKey: () => "test-idempotency-key",
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const state = h.state;
  const {
    creatorProfilesTable,
    creatorSubscriptionsTable,
    creatorHostingTable,
    userStripeCustomersTable,
  } = actual;

  function rowsFor(table: unknown, cond: unknown): unknown[] {
    const { params } = render(cond);
    const key = String(params[0] ?? "");
    if (table === creatorProfilesTable) {
      const row = state.profilesByUserId.get(key);
      return row ? [row] : [];
    }
    if (table === creatorSubscriptionsTable) {
      const row = state.subsByProfileId.get(key);
      return row ? [row] : [];
    }
    if (table === creatorHostingTable) {
      const row = state.hostingByProfileId.get(key);
      return row ? [row] : [];
    }
    if (table === userStripeCustomersTable) {
      const row = state.customersByUserId.get(key);
      return row ? [row] : [];
    }
    return [];
  }

  const fakeDb: any = {
    select: (_fields?: unknown) => ({
      from: (table: unknown) => ({
        where: (cond: unknown) => {
          const chain: any = {
            limit: async (_n: number) => rowsFor(table, cond),
            orderBy: (..._a: unknown[]) => ({
              limit: async (_n: number) => rowsFor(table, cond),
              then: (res: any, rej: any) => Promise.resolve(rowsFor(table, cond)).then(res, rej),
            }),
            then: (res: any, rej: any) => Promise.resolve(rowsFor(table, cond)).then(res, rej),
          };
          return chain;
        },
      }),
    }),
    update: (_table: unknown) => ({
      set: (_patch: Record<string, unknown>) => ({
        where: (_cond: unknown) => ({
          returning: async () => [],
          then: (res: any, rej: any) => Promise.resolve([]).then(res, rej),
        }),
      }),
    }),
    execute: async () => ({ rows: [{ n: 0, gross: 0, fee: 0, net: 0 }] }),
  };

  return { ...actual, db: fakeDb };
});

import creatorTiersRouter, { isSameSitePath } from "../creator-tiers";
import { verifyStoredStripeCustomer } from "../../lib/creator-stripe-customer";

let base = "";
let server: ReturnType<typeof express.application.listen>;

function seedProfile(userId: string, profileId: string, customerId: string) {
  h.state.profilesByUserId.set(userId, { id: profileId, userId, slug: `creator-${profileId.slice(1, 5)}` });
  h.state.subsByProfileId.set(profileId, {
    id: `sub-row-${profileId.slice(1, 5)}`,
    profileId,
    tier: "pro",
    status: "active",
    stripeSubscriptionId: "sub_test",
    stripeCustomerId: customerId,
    currentPeriodEnd: new Date("2026-11-25T12:00:00.000Z"),
    cancelAtPeriodEnd: null,
  });
}

function seed() {
  h.state.profilesByUserId.clear();
  h.state.subsByProfileId.clear();
  h.state.hostingByProfileId.clear();
  h.state.customersByUserId.clear();
  h.retrieveScript.clear();
  h.retrieveCalls.length = 0;
  h.portalCalls.length = 0;
  h.portalBoom = false;
  seedProfile(USER_OK, PROFILE_OK, "cus_alive");
  seedProfile(USER_STALE, PROFILE_STALE, "cus_gone_missing");
  seedProfile(USER_DELETED, PROFILE_DELETED, "cus_gone_deleted");
  seedProfile(USER_BOOM, PROFILE_BOOM, "cus_verify_boom");
  h.retrieveScript.set("cus_gone_missing", "missing");
  h.retrieveScript.set("cus_gone_deleted", "deleted");
  h.retrieveScript.set("cus_verify_boom", "boom");
}

async function callPortal(userId: string, returnTo?: unknown) {
  const res = await fetch(`${base}/creator-tiers/portal`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-user-id": userId },
    body: JSON.stringify(returnTo === undefined ? {} : { returnTo }),
  });
  const body = (await res.json().catch(() => ({}))) as any;
  return { status: res.status, body };
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(creatorTiersRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(seed);

describe("POST /creator-tiers/portal — stale stored customer (Stack 400 C-10)", () => {
  it("a live stored customer still reaches the portal (verification passes through)", async () => {
    const { status, body } = await callPortal(USER_OK);
    expect(status).toBe(200);
    expect(body.url).toBe("https://billing.stripe.test/session");
    expect(h.retrieveCalls).toEqual(["cus_alive"]);
    expect(h.portalCalls).toHaveLength(1);
    expect(h.portalCalls[0]!["customer"]).toBe("cus_alive");
  });

  it("a stored customer Stripe reports missing gets the honest 404 — never a 500, never a session", async () => {
    const { status, body } = await callPortal(USER_STALE);
    expect(status).toBe(404);
    expect(body.error).toContain("No billing record yet");
    expect(JSON.stringify(body)).not.toContain(PROVIDER_SECRET);
    expect(h.portalCalls).toHaveLength(0);
  });

  it("a stored customer Stripe returns as deleted gets the honest 404 — never a session", async () => {
    const { status, body } = await callPortal(USER_DELETED);
    expect(status).toBe(404);
    expect(body.error).toContain("No billing record yet");
    expect(h.portalCalls).toHaveLength(0);
  });

  it("a non-missing verification failure answers the plain 502 copy — no raw provider text", async () => {
    const { status, body } = await callPortal(USER_BOOM);
    expect(status).toBe(502);
    expect(body.error).toBe("Billing is unavailable right now — try again in a moment.");
    expect(JSON.stringify(body)).not.toContain(PROVIDER_SECRET);
    expect(h.portalCalls).toHaveLength(0);
  });

  it("a portal session failure answers the plain 502 copy — no raw provider text, no unhandled throw", async () => {
    h.portalBoom = true;
    const { status, body } = await callPortal(USER_OK);
    expect(status).toBe(502);
    expect(body.error).toBe("Billing is unavailable right now — try again in a moment.");
    expect(JSON.stringify(body)).not.toContain(PROVIDER_SECRET);
  });
});

describe("POST /creator-tiers/portal — returnTo hardening (Stack 400 C-35)", () => {
  it("a protocol-relative returnTo falls back to the portal's own page", async () => {
    const { status } = await callPortal(USER_OK, "//evil.example/phish");
    expect(status).toBe(200);
    const returnUrl = String(h.portalCalls[0]!["return_url"]);
    expect(returnUrl).not.toContain("evil.example");
    expect(returnUrl.endsWith("/creator-pricing")).toBe(true);
  });

  it("a backslash returnTo falls back to the portal's own page", async () => {
    const { status } = await callPortal(USER_OK, "/\\evil.example");
    expect(status).toBe(200);
    const returnUrl = String(h.portalCalls[0]!["return_url"]);
    expect(returnUrl).not.toContain("evil.example");
    expect(returnUrl.endsWith("/creator-pricing")).toBe(true);
  });

  it("an absolute-URL returnTo falls back to the portal's own page", async () => {
    const { status } = await callPortal(USER_OK, "https://evil.example/phish");
    expect(status).toBe(200);
    const returnUrl = String(h.portalCalls[0]!["return_url"]);
    expect(returnUrl).not.toContain("evil.example");
    expect(returnUrl.endsWith("/creator-pricing")).toBe(true);
  });

  it("a genuine same-site returnTo is honored", async () => {
    const { status } = await callPortal(USER_OK, "/settings/billing");
    expect(status).toBe(200);
    expect(String(h.portalCalls[0]!["return_url"])).toContain("/settings/billing");
  });

  it("a missing returnTo defaults to the portal's own page", async () => {
    const { status } = await callPortal(USER_OK);
    expect(status).toBe(200);
    expect(String(h.portalCalls[0]!["return_url"]).endsWith("/creator-pricing")).toBe(true);
  });
});

describe("isSameSitePath — the C-35 check itself", () => {
  it("accepts plain same-site paths", () => {
    expect(isSameSitePath("/creator-pricing")).toBe(true);
    expect(isSameSitePath("/settings/billing?tab=plan")).toBe(true);
    expect(isSameSitePath("/")).toBe(true);
  });

  it("rejects protocol-relative, backslash, absolute, and non-string shapes", () => {
    expect(isSameSitePath("//evil.example/phish")).toBe(false);
    expect(isSameSitePath("/\\evil.example")).toBe(false);
    expect(isSameSitePath("\\evil.example")).toBe(false);
    expect(isSameSitePath("https://evil.example/phish")).toBe(false);
    expect(isSameSitePath("settings/billing")).toBe(false);
    expect(isSameSitePath("")).toBe(false);
    expect(isSameSitePath(undefined)).toBe(false);
    expect(isSameSitePath(null)).toBe(false);
    expect(isSameSitePath(42)).toBe(false);
  });
});

describe("verifyStoredStripeCustomer — the C-10 verification seam", () => {
  function scriptedStripe(mode: "alive" | "deleted" | "missing" | "boom") {
    return {
      customers: {
        retrieve: async (id: string) => {
          if (mode === "missing") {
            throw Object.assign(new Error("No such customer"), { code: "resource_missing" });
          }
          if (mode === "boom") {
            throw Object.assign(new Error("provider down"), { code: "api_error" });
          }
          return mode === "deleted" ? { id, deleted: true } : { id };
        },
      },
    } as any;
  }

  it("a live customer verifies true", async () => {
    await expect(verifyStoredStripeCustomer(scriptedStripe("alive"), "cus_x")).resolves.toBe(true);
  });

  it("a deleted customer verifies false", async () => {
    await expect(verifyStoredStripeCustomer(scriptedStripe("deleted"), "cus_x")).resolves.toBe(false);
  });

  it("a resource_missing retrieve verifies false", async () => {
    await expect(verifyStoredStripeCustomer(scriptedStripe("missing"), "cus_x")).resolves.toBe(false);
  });

  it("any other Stripe error propagates — the caller fails closed, nothing is minted", async () => {
    await expect(verifyStoredStripeCustomer(scriptedStripe("boom"), "cus_x")).rejects.toMatchObject({
      code: "api_error",
    });
  });
});
