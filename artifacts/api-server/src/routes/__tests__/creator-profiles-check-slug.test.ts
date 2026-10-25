/**
 * Route tests for GET /api/creator-profiles/check-slug (routes/creator-platform).
 *
 * THE REGRESSION: the route was registered AFTER GET /creator-profiles/:slug,
 * so Express matched "check-slug" as a slug and the public-profile handler
 * answered 404. The Lightning Setup client (lightning-setup.tsx) reads
 * data.available from the payload — a 404 payload has no `available`, so
 * EVERY handle read "taken" and step 0 (name + handle) could never
 * complete. These tests drive the endpoint exactly the way the client
 * does: GET /api/creator-profiles/check-slug?slug=<handle>, authed.
 *
 * Fake-db style mirrors creator-profile-public.test.ts: real table
 * objects via importOriginal, WHERE params read back through PgDialect.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

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

const AUTH_USER_ID = "00000000-0000-4000-8000-000000000099";

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = AUTH_USER_ID;
    next();
  },
}));

vi.mock("../referrals", () => ({
  getRecruiterBadgeForUser: async () => null,
}));

vi.mock("../generate/milestones", () => ({
  computeAchievements: () => [],
}));

vi.mock("../../lib/email", () => ({
  sendEmail: async () => undefined,
  emailShell: (x: string) => x,
  emailButton: (href: string, label: string) => `<a href="${href}">${label}</a>`,
  emailDetailBox: (html: string) => html,
  escapeHtml: (s: string) => s,
  isEmailConfigured: () => false,
}));

vi.mock("../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: async (v: unknown) => v,
  isExternalHttpUrl: (v: unknown) =>
    typeof v === "string" && /^https?:\/\//i.test(v),
  isPermanentMediaValue: (v: unknown) =>
    typeof v === "string" &&
    (v.startsWith("r2://") || v.startsWith("supabase://")),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const state = h.state;
  const { creatorProfilesTable } = actual;

  function rowsFor(table: unknown, cond: unknown): unknown[] {
    if (table === creatorProfilesTable) {
      const slug = String(render(cond).params[0] ?? "");
      const row = state.profilesBySlug.get(slug);
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
            orderBy: (..._args: unknown[]) => ({
              limit: async (_n: number) => rowsFor(table, cond),
              then: (res: any, rej: any) =>
                Promise.resolve(rowsFor(table, cond)).then(res, rej),
            }),
            then: (res: any, rej: any) =>
              Promise.resolve(rowsFor(table, cond)).then(res, rej),
          };
          return chain;
        },
      }),
    }),
  };

  return { ...actual, db: fakeDb };
});

import router from "../creator-platform";

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

beforeEach(() => {
  h.state.profilesBySlug = new Map();
});

async function get(path: string) {
  const r = await realFetch(`${baseUrl}${path}`);
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

describe("GET /api/creator-profiles/check-slug — Lightning Setup handle check", () => {
  it("reports a fresh handle as available (the client reads data.available)", async () => {
    const { status, json } = await get("/creator-profiles/check-slug?slug=brand-new-handle");

    expect(status).toBe(200);
    expect(json.valid).toBe(true);
    expect(json.available).toBe(true);
    expect(json.slug).toBe("brand-new-handle");
  });

  it("reports another creator's handle as taken", async () => {
    h.state.profilesBySlug.set("taken-handle", {
      id: "33333333-3333-4333-8333-333333333333",
      userId: "44444444-4444-4444-8444-444444444444",
      slug: "taken-handle",
    });

    const { status, json } = await get("/creator-profiles/check-slug?slug=taken-handle");

    expect(status).toBe(200);
    expect(json.valid).toBe(true);
    expect(json.available).toBe(false);
  });

  it("reports the caller's OWN handle as available (editing your profile isn't 'taken')", async () => {
    h.state.profilesBySlug.set("my-handle", {
      id: "55555555-5555-4555-8555-555555555555",
      userId: AUTH_USER_ID,
      slug: "my-handle",
    });

    const { status, json } = await get("/creator-profiles/check-slug?slug=my-handle");

    expect(status).toBe(200);
    expect(json.available).toBe(true);
  });

  it("still rejects a malformed handle as invalid, not available", async () => {
    const { status, json } = await get("/creator-profiles/check-slug?slug=NO!!");

    expect(status).toBe(200);
    expect(json.valid).toBe(false);
    expect(json.available).toBe(false);
  });
});
