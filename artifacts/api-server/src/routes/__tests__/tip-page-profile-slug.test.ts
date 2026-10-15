/**
 * Route tests for GET /api/tips/page/:handle (routes/generate/tip-jar.ts)
 * — creator-profile slug resolution.
 *
 * THE REGRESSION: the handler resolved its param through
 * tipPagesByHandle ONLY — tip pages are keyed by a freely-typed tip
 * handle set via POST /tips/settings (pages/tips.tsx). But the Shorts
 * feed caller (pages/shorts.tsx) fetches
 * GET /api/tips/page/${item.creator.slug} — a CREATOR-PROFILE slug.
 * When tip handle ≠ profile slug the lookup 404'd, shorts swallowed
 * it, tipHandle stayed null, and the Tip button in the Shorts feed
 * never rendered.
 *
 * THE FIX SHAPE: handle lookup first (unchanged — the /tips/:handle
 * page and its callers keep working exactly as before); on a handle
 * miss, resolve profile slug → creator_profiles.user_id → that
 * user's tip page (tip pages are stored keyed by userId). 404 only
 * when the creator genuinely has no tip page. On success the
 * response carries the page's REAL handle, which is what shorts
 * builds its /tips/<handle> link from.
 *
 * Fake-db style mirrors creator-follow-unfollow.test.ts: real table
 * objects via importOriginal, the profile lookup answered by slug
 * only (WHERE params read back through PgDialect rendering). The tip
 * page itself is seeded through the real POST /tips/settings route,
 * exactly as pages/tips.tsx creates it.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const OWNER_ID = "22222222-2222-4222-8222-222222222222";
const NO_TIP_USER_ID = "33333333-3333-4333-8333-333333333333";
const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const PROFILE_SLUG = "queen-creator";
const NO_TIP_PROFILE_SLUG = "quiet-creator";
const TIP_HANDLE = "tip-queen";

const h = vi.hoisted(() => ({
  state: {
    profilesBySlug: new Map<string, Record<string, unknown>>(),
  },
}));

const dialect = new PgDialect();
function render(cond: unknown): { sql: string; params: unknown[] } {
  const q = dialect.sqlToQuery(cond as never);
  return { sql: q.sql, params: q.params as unknown[] };
}

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = OWNER_ID;
    next();
  },
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/logger", () => ({
  logger: { error: () => undefined, info: () => undefined, warn: () => undefined },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const state = h.state;
  const { creatorProfilesTable } = actual;

  function rowsFor(table: unknown, cond: unknown): unknown[] {
    if (table === creatorProfilesTable) {
      const { sql, params } = render(cond);
      // Slug lookup: eq(slug) — answer by slug only, the way Postgres
      // behaves (a tip handle can never equal a profile slug row here
      // unless it IS the slug).
      if (sql.includes('"slug"')) {
        const row = state.profilesBySlug.get(String(params[0] ?? ""));
        return row ? [row] : [];
      }
      return [];
    }
    return [];
  }

  function chain(table: unknown, cond: unknown): any {
    const self: any = {
      limit: (_n: number) => self,
      offset: (_n: number) => self,
      orderBy: (..._args: unknown[]) => self,
      then: (res: any, rej: any) =>
        Promise.resolve(rowsFor(table, cond)).then(res, rej),
    };
    return self;
  }

  const fakeDb: any = {
    select: (_fields?: unknown) => ({
      from: (table: unknown) => ({
        where: (cond: unknown) => chain(table, cond),
      }),
    }),
  };

  return { ...actual, db: fakeDb };
});

import router, { __resetTipJarStores } from "../generate/tip-jar";

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

beforeEach(async () => {
  __resetTipJarStores();
  h.state.profilesBySlug = new Map([
    [
      PROFILE_SLUG,
      { id: PROFILE_ID, userId: OWNER_ID, slug: PROFILE_SLUG, displayName: "Queen Creator" },
    ],
    [
      NO_TIP_PROFILE_SLUG,
      {
        id: "66666666-6666-4666-8666-666666666666",
        userId: NO_TIP_USER_ID,
        slug: NO_TIP_PROFILE_SLUG,
        displayName: "Quiet Creator",
      },
    ],
  ]);

  // Seed the owner's tip page through the real settings route, with a
  // handle that deliberately DIFFERS from the owner's profile slug.
  const r = await realFetch(`${baseUrl}/tips/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      handle: TIP_HANDLE,
      displayName: "Queen Creator",
      message: "Thanks for the love",
      suggestedAmounts: [5, 10, 25],
    }),
  });
  expect(r.status).toBe(200);
});

async function get(path: string) {
  const r = await realFetch(`${baseUrl}${path}`);
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

describe("GET /api/tips/page/:handle — creator-profile slug (Shorts feed caller)", () => {
  it("finds the tip page BY OWNER'S PROFILE SLUG when the tip handle differs from it", async () => {
    const { status, json } = await get(`/tips/page/${PROFILE_SLUG}`);

    expect(status).toBe(200);
    // The REAL handle is what shorts builds /tips/<handle> from.
    expect(json.page.handle).toBe(TIP_HANDLE);
    expect(json.page.displayName).toBe("Queen Creator");
    expect(json.page.suggestedAmounts).toEqual([5, 10, 25]);
    expect(json.paymentsLive).toBe(false);
  });

  it("404s a profile slug whose owner genuinely has no tip page", async () => {
    const { status } = await get(`/tips/page/${NO_TIP_PROFILE_SLUG}`);
    expect(status).toBe(404);
  });
});

describe("POST /api/tips/:handle/tip — same two namespaces", () => {
  it("records a tip intent addressed BY PROFILE SLUG under the page's real handle", async () => {
    const r = await realFetch(`${baseUrl}/tips/${PROFILE_SLUG}/tip`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: 10, fanName: "Shorts Fan", message: "" }),
    });
    const json: any = await r.json().catch(() => null);

    expect(r.status).toBe(201);
    expect(json.intent.handle).toBe(TIP_HANDLE);
    expect(json.intent.pageUserId).toBe(OWNER_ID);
    expect(json.intent.status).toBe("pending_payment");
  });

  it("still records a tip intent BY TIP HANDLE", async () => {
    const r = await realFetch(`${baseUrl}/tips/${TIP_HANDLE}/tip`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: 5, fanName: "Fan", message: "" }),
    });
    const json: any = await r.json().catch(() => null);

    expect(r.status).toBe(201);
    expect(json.intent.handle).toBe(TIP_HANDLE);
  });
});

describe("GET /api/tips/page/:handle — tip handle callers (regression)", () => {
  it("still resolves BY TIP HANDLE exactly as /tips/:handle does", async () => {
    const { status, json } = await get(`/tips/page/${TIP_HANDLE}`);

    expect(status).toBe(200);
    expect(json.page.handle).toBe(TIP_HANDLE);
    expect(json.page.displayName).toBe("Queen Creator");
  });

  it("404s an unknown value that is neither a tip handle nor a profile slug", async () => {
    const { status } = await get(`/tips/page/no-such-thing`);
    expect(status).toBe(404);
  });
});
