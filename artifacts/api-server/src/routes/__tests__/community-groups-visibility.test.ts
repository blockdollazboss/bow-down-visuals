/**
 * Route tests for the group DIRECTORY visibility rule (routes/community).
 *
 * THE LEAK: GET /api/groups returned every group — name, description,
 * cover, member_count — to anyone, guests included. The rest of the
 * codebase enforces the opposite rule: GET /groups/:slug 403s a
 * private group to non-members, and GET /explore filters its groups
 * rail to is_public = true. The list was the outlier.
 *
 * THE RULE (now applied in the handler): public groups are browsable
 * by anyone; a private group is listed only when the viewer is one of
 * its members — including through ?member= / ?mine= views of someone
 * else's crews, which a guest must not be able to use as a window
 * into private groups.
 *
 * Harness mirrors community-groups-dto.test.ts (fake-db style: real
 * table objects via importOriginal, a chainable select dispatching on
 * table identity). The fake's where() is a pass-through, so the guest
 * cases are the load-bearing ones (the guest branch never consults
 * the members table — the leak closes by construction), and the
 * member case proves the composition: with a member row present, the
 * private group rides along for the member's own browse. Viewer
 * identity rides the REAL optionalAuth path via a mocked Supabase
 * client: "member-token" resolves to MEMBER_USER_ID, anything else
 * resolves to no user.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const PUBLIC_ID = "11111111-1111-4111-8111-111111111111";
const PRIVATE_ID = "66666666-6666-4666-8666-666666666666";
const OWNER_PROFILE_ID = "22222222-2222-4222-8222-222222222222";
const OWNER_USER_ID = "33333333-3333-4333-8333-333333333333";
const MEMBER_USER_ID = "44444444-4444-4444-8444-444444444444";
const CREATED = new Date("2026-09-01T12:00:00.000Z");
const JOINED = new Date("2026-09-02T12:00:00.000Z");

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
    auth: {
      getUser: async (token: string) =>
        token === "member-token"
          ? { data: { user: { id: MEMBER_USER_ID } } }
          : { data: { user: null } },
    },
  }),
}));

vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrl: async (v: unknown) => v,
  refreshSupabaseStorageUrlsDeep: async (v: unknown) => v,
  isStorageRef: () => false,
}));

vi.mock("../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: async (v: unknown) => v,
  isExternalHttpUrl: (v: unknown) =>
    typeof v === "string" && /^https?:\/\//i.test(v),
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
    delete: (_table: unknown) => ({
      where: (_cond: unknown) => Promise.resolve(),
    }),
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

function publicGroup(): Record<string, unknown> {
  return {
    id: PUBLIC_ID,
    slug: "shark-tank-crew",
    name: "Shark Tank Crew",
    description: "We make waves.",
    coverUrl: "https://cdn.example.com/cover.jpg",
    ownerProfileId: OWNER_PROFILE_ID,
    memberCount: 1234,
    isPublic: true,
    createdAt: CREATED,
  };
}

function privateGroup(): Record<string, unknown> {
  return {
    id: PRIVATE_ID,
    slug: "inner-circle",
    name: "Inner Circle",
    description: "Members only, no exceptions.",
    coverUrl: null,
    ownerProfileId: OWNER_PROFILE_ID,
    memberCount: 7,
    isPublic: false,
    createdAt: CREATED,
  };
}

function memberRows(): Array<Record<string, unknown>> {
  return [
    { groupId: PUBLIC_ID, userId: OWNER_USER_ID, role: "owner", joinedAt: JOINED },
    { groupId: PUBLIC_ID, userId: MEMBER_USER_ID, role: "member", joinedAt: JOINED },
    { groupId: PRIVATE_ID, userId: OWNER_USER_ID, role: "owner", joinedAt: JOINED },
    { groupId: PRIVATE_ID, userId: MEMBER_USER_ID, role: "member", joinedAt: JOINED },
  ];
}

beforeEach(() => {
  h.state.groups = [publicGroup(), privateGroup()];
  h.state.members = memberRows();
  h.state.profiles = [
    { id: OWNER_PROFILE_ID, userId: OWNER_USER_ID, slug: "crew-owner", displayName: "Crew Owner", avatarUrl: null },
  ];
});

async function get(path: string, token?: string) {
  const r = await realFetch(`${baseUrl}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

function slugs(json: any): string[] {
  return (json.groups as Array<{ slug: string }>).map((g) => g.slug).sort();
}

describe("GET /api/groups — directory visibility", () => {
  it("a guest browsing the directory sees public groups only", async () => {
    const { status, json } = await get("/groups");

    expect(status).toBe(200);
    expect(slugs(json)).toEqual(["shark-tank-crew"]);
    // The private group's metadata must not appear anywhere in the payload.
    expect(JSON.stringify(json)).not.toContain("Inner Circle");
    expect(JSON.stringify(json)).not.toContain("inner-circle");
  });

  it("a guest cannot surface a private group through search", async () => {
    const { status, json } = await get("/groups?q=inner");

    expect(status).toBe(200);
    expect(json.groups).toHaveLength(0);
  });

  it("a guest cannot use ?member= to look into someone else's private crews", async () => {
    const { status, json } = await get(`/groups?member=${MEMBER_USER_ID}`);

    expect(status).toBe(200);
    expect(slugs(json)).toEqual(["shark-tank-crew"]);
  });

  it("a member browsing sees their own private groups alongside public ones", async () => {
    const { status, json } = await get("/groups", "member-token");

    expect(status).toBe(200);
    expect(slugs(json)).toEqual(["inner-circle", "shark-tank-crew"]);
    const priv = (json.groups as Array<any>).find((g) => g.slug === "inner-circle");
    expect(priv.is_public).toBe(false);
    expect(priv.member_count).toBe(7);
  });

  it("a member's ?member= self-view keeps their private groups", async () => {
    const { status, json } = await get(`/groups?member=${MEMBER_USER_ID}`, "member-token");

    expect(status).toBe(200);
    expect(slugs(json)).toEqual(["inner-circle", "shark-tank-crew"]);
  });
});

describe("GET /api/groups/:slug — the detail rule the directory now matches", () => {
  beforeEach(() => {
    // The fake's getGroupBySlug reads the first seeded row; seed the
    // private group alone so the detail assertions are unambiguous.
    h.state.groups = [privateGroup()];
  });

  it("still 403s a private group to a guest (no metadata leak)", async () => {
    const { status, json } = await get("/groups/inner-circle");

    expect(status).toBe(403);
    expect(JSON.stringify(json)).not.toContain("Members only");
  });
});
