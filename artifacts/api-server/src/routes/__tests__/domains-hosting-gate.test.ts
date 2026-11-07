/**
 * POST /api/domains — the Hosting gate (Stack-200 M3, owner's ruled model).
 *
 * RULED MODEL pinned here: a custom domain rides the Hosting product —
 * an active profile-hosting subscription ($9/mo) OR Creator Elite
 * (Hosting included) unlocks domain creation. Pro alone does NOT.
 * Admin accounts are exempt (standing ADMIN UNRESTRICTED ruling) via
 * the ONE predicate (lib/admin.ts isAdminUserId), checked first.
 * The refusal is honest plain copy naming both unlock paths — never a
 * bare 403 — and a refused claim writes NO domain row.
 *
 * Harness modeled on profile-hosting.test.ts (fake db chain over the
 * same tables the real resolveHostingEntitlement reads) + the
 * supabase-admin seam from theme-kit.test.ts (the admin predicate's
 * profiles.email lookup). The REAL resolver runs — nothing about the
 * entitlement logic is stubbed.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll, afterEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const FREE_USER = "00000000-0000-4000-8000-0000000000f1";
const PRO_USER = "00000000-0000-4000-8000-0000000000f2";
const HOSTED_USER = "00000000-0000-4000-8000-0000000000f3";
const ELITE_USER = "00000000-0000-4000-8000-0000000000f4";
const ADMIN_USER = "00000000-0000-4000-8000-0000000000f5";
const NOPROFILE_USER = "00000000-0000-4000-8000-0000000000f6";

const FREE_PROFILE = "11111111-1111-4111-8111-1111111111f1";
const PRO_PROFILE = "11111111-1111-4111-8111-1111111111f2";
const HOSTED_PROFILE = "11111111-1111-4111-8111-1111111111f3";
const ELITE_PROFILE = "11111111-1111-4111-8111-1111111111f4";
const ADMIN_PROFILE = "11111111-1111-4111-8111-1111111111f5";

const ADMIN_EMAIL = "boss@example.test";

const h = vi.hoisted(() => ({
  state: {
    profilesById: new Map<string, Record<string, unknown>>(),
    hostingByProfile: new Map<string, Record<string, unknown>>(),
    subscriptionsByProfile: new Map<string, Record<string, unknown>>(),
    emailsByUserId: new Map<string, string>(),
    domainInserts: [] as Array<Record<string, unknown>>,
  },
}));

const dialect = new PgDialect();
function render(cond: unknown): { sql: string; params: unknown[] } {
  const q = dialect.sqlToQuery(cond as never);
  return { sql: q.sql, params: q.params as unknown[] };
}

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const user = req.headers["x-test-user"];
    if (!user) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    req.userId = String(user);
    next();
  },
}));

/* The admin predicate's identity seam (lib/admin.ts isAdminUserId reads
   profiles.email through the Supabase admin client). Only ADMIN_USER
   resolves to the allowlisted email. */
vi.mock("../../lib/supabase-admin", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    getSupabaseAdmin: () => ({
      from: (_table: string) => {
        let wantedId = "";
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: (_col: string, value: string) => {
            wantedId = value;
            return chain;
          },
          single: async () => {
            const email = h.state.emailsByUserId.get(wantedId);
            return email
              ? { data: { email }, error: null }
              : { data: null, error: { message: "profile not found (test stub)" } };
          },
        };
        return chain;
      },
    }),
  };
});

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const state = h.state;
  const { creatorProfilesTable, creatorSubscriptionsTable, creatorHostingTable, customDomainsTable } = actual;

  function rowsFor(table: unknown, cond: unknown): unknown[] {
    const { sql, params } = render(cond);
    if (table === creatorProfilesTable) {
      if (sql.includes('"user_id"')) {
        const row = [...state.profilesById.values()].find((p) => String(p["userId"]) === String(params[0]));
        return row ? [row] : [];
      }
      if (sql.includes('"id"')) {
        const row = state.profilesById.get(String(params[0]));
        return row ? [row] : [];
      }
      return [];
    }
    if (table === creatorHostingTable) {
      const row = state.hostingByProfile.get(String(params[0]));
      return row ? [row] : [];
    }
    if (table === creatorSubscriptionsTable) {
      const row = state.subscriptionsByProfile.get(String(params[0]));
      return row ? [row] : [];
    }
    /* customDomainsTable reads: nothing is ever already claimed. */
    return [];
  }

  function chain(table: unknown, cond: unknown): any {
    const self: any = {
      limit: (_n: number) => self,
      orderBy: (..._a: unknown[]) => self,
      then: (res: any, rej: any) => Promise.resolve(rowsFor(table, cond)).then(res, rej),
    };
    return self;
  }

  const fakeDb: any = {
    select: (_fields?: unknown) => ({
      from: (table: unknown) => ({ where: (cond: unknown) => chain(table, cond) }),
    }),
    insert: (table: unknown) => ({
      values: (v: Record<string, unknown>) => ({
        returning: async () => {
          if (table === customDomainsTable) {
            state.domainInserts.push(v);
            return [
              {
                id: "99999999-9999-4999-8999-999999999999",
                profileId: v["profileId"],
                hostname: v["hostname"],
                status: v["status"],
                isPrimary: false,
                verifiedAt: null,
                createdAt: new Date(),
              },
            ];
          }
          return [];
        },
      }),
    }),
    update: (_table: unknown) => ({
      set: (_v: unknown) => ({ where: async () => [] }),
    }),
    /* resolveProfileTier's legacy profiles fallback reads no rows here —
       tiers in this harness come from creator_subscriptions only. */
    execute: async () => ({ rows: [] }),
  };
  return { ...actual, db: fakeDb };
});

import router from "../domains";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

let savedAdminEmails: string | undefined;

beforeEach(() => {
  savedAdminEmails = process.env["ADMIN_EMAILS"];
  process.env["ADMIN_EMAILS"] = ADMIN_EMAIL;
  h.state.profilesById = new Map([
    [FREE_PROFILE, { id: FREE_PROFILE, userId: FREE_USER, slug: "free-creator" }],
    [PRO_PROFILE, { id: PRO_PROFILE, userId: PRO_USER, slug: "pro-creator" }],
    [HOSTED_PROFILE, { id: HOSTED_PROFILE, userId: HOSTED_USER, slug: "hosted-creator" }],
    [ELITE_PROFILE, { id: ELITE_PROFILE, userId: ELITE_USER, slug: "elite-creator" }],
    [ADMIN_PROFILE, { id: ADMIN_PROFILE, userId: ADMIN_USER, slug: "admin-creator" }],
  ]);
  h.state.hostingByProfile = new Map([
    [HOSTED_PROFILE, { profileId: HOSTED_PROFILE, status: "active", currentPeriodEnd: null }],
  ]);
  h.state.subscriptionsByProfile = new Map([
    [PRO_PROFILE, { profileId: PRO_PROFILE, tier: "pro", status: "active", currentPeriodEnd: null }],
    [ELITE_PROFILE, { profileId: ELITE_PROFILE, tier: "elite", status: "active", currentPeriodEnd: null }],
  ]);
  h.state.emailsByUserId = new Map([[ADMIN_USER, ADMIN_EMAIL]]);
  h.state.domainInserts = [];
});

afterEach(() => {
  if (savedAdminEmails === undefined) delete process.env["ADMIN_EMAILS"];
  else process.env["ADMIN_EMAILS"] = savedAdminEmails;
});

async function claim(user: string, hostname: string) {
  const r = await realFetch(`${baseUrl}/domains`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-test-user": user },
    body: JSON.stringify({ hostname }),
  });
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

describe("POST /api/domains — the Hosting gate", () => {
  it("a free creator is refused with honest copy naming both unlock paths — and nothing is written", async () => {
    const r = await claim(FREE_USER, "free-creator.com");
    expect(r.status).toBe(403);
    expect(r.json.error).toContain("Hosting plan");
    expect(r.json.error).toContain("$9/mo");
    expect(r.json.error).toContain("Creator Elite");
    expect(h.state.domainInserts).toHaveLength(0);
  });

  it("a Pro subscription alone does NOT unlock a domain — Pro is not the domain tier", async () => {
    const r = await claim(PRO_USER, "pro-creator.com");
    expect(r.status).toBe(403);
    expect(r.json.error).toContain("Hosting plan");
    expect(r.json.error).toContain("Creator Elite");
    expect(h.state.domainInserts).toHaveLength(0);
  });

  it("an active Hosting subscription unlocks domain creation", async () => {
    const r = await claim(HOSTED_USER, "hosted-creator.com");
    expect(r.status).toBe(201);
    expect(r.json.domain.hostname).toBe("hosted-creator.com");
    expect(r.json.domain.status).toBe("pending");
    expect(r.json.dns.cname.target).toBeTruthy();
    expect(h.state.domainInserts).toHaveLength(1);
  });

  it("Creator Elite unlocks domain creation — Hosting is included, no Hosting row needed", async () => {
    const r = await claim(ELITE_USER, "elite-creator.com");
    expect(r.status).toBe(201);
    expect(r.json.domain.hostname).toBe("elite-creator.com");
    expect(h.state.domainInserts).toHaveLength(1);
  });

  it("an admin account is exempt — no Hosting row, no tier, still 201", async () => {
    const r = await claim(ADMIN_USER, "admin-creator.com");
    expect(r.status).toBe(201);
    expect(r.json.domain.hostname).toBe("admin-creator.com");
    expect(h.state.domainInserts).toHaveLength(1);
  });

  it("the profile check still comes first: no creator page reads 404, gate or not", async () => {
    const r = await claim(NOPROFILE_USER, "nobody.com");
    expect(r.status).toBe(404);
    expect(h.state.domainInserts).toHaveLength(0);
  });
});
