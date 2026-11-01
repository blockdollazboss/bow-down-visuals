/**
 * Group directory SEARCH truth (Stack1100 lane Y5) — GET /api/groups?q=.
 *
 * THE DISEASE: search ran as a whole-string substring filter over the
 * 100 biggest groups only — "drum weekly" (name word + description
 * word) could never match, and any group outside the top-100 window
 * was unfindable by search no matter how exact the query.
 *
 * THE FIX: the shared token-AND rule (lib/search-match) runs as a SQL
 * predicate (so the 100 cap applies to MATCHES) and is re-applied in
 * JS with the same matcher, before the untouched visibility
 * composition. Harness mirrors community-groups-visibility.test.ts
 * (pass-through where()): the JS re-check is what these cases
 * exercise; the private-group case re-proves the leak stays shut
 * through the new search path.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const OWNER_PROFILE_ID = "22222222-2222-4222-8222-222222222222";
const OWNER_USER_ID = "33333333-3333-4333-8333-333333333333";
const CREATED = new Date("2026-09-01T12:00:00.000Z");

const h = vi.hoisted(() => ({
  state: {
    groups: [] as Array<Record<string, unknown>>,
    members: [] as Array<Record<string, unknown>>,
    profiles: [] as Array<Record<string, unknown>>,
  },
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = OWNER_USER_ID;
    next();
  },
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
  }),
}));

vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrl: async (v: unknown) => v,
  refreshSupabaseStorageUrlsDeep: async (v: unknown) => v,
  isStorageRef: () => false,
}));

vi.mock("../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: async (v: unknown) => v,
  isExternalHttpUrl: (v: unknown) => typeof v === "string" && /^https?:\/\//i.test(v),
  isPermanentMediaValue: () => false,
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const state = h.state;
  const { groupsTable, groupMembersTable, creatorProfilesTable } = actual;

  function rowsFor(table: unknown, fields?: Record<string, unknown>): unknown[] {
    let rows: Array<Record<string, unknown>>;
    if (table === groupsTable) rows = state.groups;
    else if (table === groupMembersTable) rows = state.members;
    else if (table === creatorProfilesTable) rows = state.profiles;
    else rows = [];
    if (fields && Object.keys(fields).length > 0) {
      const keys = Object.keys(fields);
      rows = rows.map((r) => Object.fromEntries(keys.map((k) => [k, r[k]])));
    }
    return rows;
  }

  function chain(table: unknown, fields?: Record<string, unknown>): any {
    const c: any = {
      where: (_cond: unknown) => c,
      orderBy: (..._args: unknown[]) => c,
      limit: async (n: number) => rowsFor(table, fields).slice(0, n),
      then: (res: any, rej: any) => Promise.resolve(rowsFor(table, fields)).then(res, rej),
    };
    return c;
  }

  const fakeDb: any = {
    select: (fields?: Record<string, unknown>) => ({
      from: (table: unknown) => chain(table, fields),
    }),
    delete: (_table: unknown) => ({ where: (_cond: unknown) => Promise.resolve() }),
  };

  return { ...actual, db: fakeDb };
});

import router from "../community";

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

function group(id: string, slug: string, name: string, description: string, memberCount: number, isPublic = true) {
  return {
    id, slug, name, description, coverUrl: null,
    ownerProfileId: OWNER_PROFILE_ID, memberCount, isPublic, createdAt: CREATED,
  };
}

beforeEach(() => {
  h.state.groups = [
    group("11111111-1111-4111-8111-111111111111", "beat-makers", "Beat Makers Union", "For producers and engineers", 5000),
    group("22222222-2222-4222-8222-222222222222", "drum-circle", "Drum Circle", "Weekly rhythm meetup", 3),
    group("33333333-3333-4333-8333-333333333333", "cafe-createurs", "Café Créateurs", "French-speaking creators", 50),
    group("66666666-6666-4666-8666-666666666666", "inner-circle", "Inner Circle", "Members only, no exceptions.", 7, false),
  ];
  h.state.members = [];
  h.state.profiles = [];
});

async function slugs(qs: string): Promise<string[]> {
  const r = await realFetch(`${baseUrl}/groups${qs}`);
  expect(r.status).toBe(200);
  const json = (await r.json()) as any;
  return (json.groups as Array<{ slug: string }>).map((g) => g.slug).sort();
}

describe("GET /groups?q= — token-AND across name/slug/description", () => {
  it("matches words split across a group's name and description", async () => {
    expect(await slugs(`?q=${encodeURIComponent("drum weekly")}`)).toEqual(["drum-circle"]);
    expect(await slugs(`?q=${encodeURIComponent("beat producers")}`)).toEqual(["beat-makers"]);
  });

  it("folds accents and case", async () => {
    expect(await slugs(`?q=${encodeURIComponent("CAFÉ createurs")}`)).toEqual(["cafe-createurs"]);
    expect(await slugs(`?q=${encodeURIComponent("cafe createurs")}`)).toEqual(["cafe-createurs"]);
  });

  it("a word the group doesn't carry excludes it; no match is an honest empty", async () => {
    expect(await slugs(`?q=${encodeURIComponent("drum producers")}`)).toEqual([]);
    expect(await slugs(`?q=${encodeURIComponent("zzz")}`)).toEqual([]);
  });

  it("the private group stays invisible to a guest through the new search path", async () => {
    expect(await slugs(`?q=${encodeURIComponent("inner circle")}`)).toEqual([]);
    expect(await slugs("")).toEqual(["beat-makers", "cafe-createurs", "drum-circle"]);
  });
});
