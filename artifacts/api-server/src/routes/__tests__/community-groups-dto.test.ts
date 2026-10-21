/**
 * Route tests for the group DTO contract (routes/community).
 *
 * THE REGRESSION: GET /groups and GET /groups/:slug sent the raw Drizzle
 * group row — camelCase table keys (memberCount, coverUrl, isPublic,
 * ownerProfileId, createdAt) — while the frontend contract
 * (pages/groups.tsx, pages/group-detail.tsx) is snake_case end to end.
 * member_count was undefined, so member_count.toLocaleString() crashed
 * BOTH pages whenever a group rendered; covers and public/private badges
 * were dead beneath the crash. toGroupDto now builds the payload
 * field-by-field; these tests pin the snake_case keys AND the absence of
 * the camelCase leaks, and pin that the group detail's hand-built parts
 * (owner_profile, members, viewer_role) ride along unchanged.
 *
 * Fake-db style mirrors routes/__tests__/social-feed-dto.test.ts:
 * real table objects via importOriginal, a chainable select whose rows
 * dispatch on table identity.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const GROUP_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_PROFILE_ID = "22222222-2222-4222-8222-222222222222";
const OWNER_USER_ID = "33333333-3333-4333-8333-333333333333";
const MEMBER_PROFILE_ID = "55555555-5555-4555-8555-555555555555";
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
    // Honor drizzle's column projection: select({ slug, displayName })
    // returns rows carrying only those keys (the aliases in this router
    // match the row property names).
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

function groupRow(): Record<string, unknown> {
  return {
    id: GROUP_ID,
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

function profileRows(): Array<Record<string, unknown>> {
  return [
    {
      id: OWNER_PROFILE_ID,
      userId: OWNER_USER_ID,
      slug: "crew-owner",
      displayName: "Crew Owner",
      avatarUrl: "https://cdn.example.com/owner.png",
    },
    {
      id: MEMBER_PROFILE_ID,
      userId: MEMBER_USER_ID,
      slug: "crew-member",
      displayName: "Crew Member",
      avatarUrl: null,
    },
  ];
}

function memberRows(): Array<Record<string, unknown>> {
  return [
    { groupId: GROUP_ID, userId: OWNER_USER_ID, role: "owner", joinedAt: JOINED },
    { groupId: GROUP_ID, userId: MEMBER_USER_ID, role: "member", joinedAt: JOINED },
  ];
}

beforeEach(() => {
  h.state.groups = [groupRow()];
  h.state.members = memberRows();
  h.state.profiles = profileRows();
});

async function get(path: string) {
  const r = await realFetch(`${baseUrl}${path}`);
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

function expectGroupDto(group: any) {
  expect(group.id).toBe(GROUP_ID);
  expect(group.slug).toBe("shark-tank-crew");
  expect(group.name).toBe("Shark Tank Crew");
  expect(group.description).toBe("We make waves.");
  // The regression pins: count, cover and visibility under snake_case.
  expect(group.member_count).toBe(1234);
  expect(typeof group.member_count).toBe("number");
  expect(group.cover_url).toBe("https://cdn.example.com/cover.jpg");
  expect(group.is_public).toBe(true);
  expect(group.owner_profile_id).toBe(OWNER_PROFILE_ID);
  expect(group.created_at).toBe("2026-09-01T12:00:00.000Z");
  // The camelCase table keys must NOT leak through the DTO.
  expect(group).not.toHaveProperty("memberCount");
  expect(group).not.toHaveProperty("coverUrl");
  expect(group).not.toHaveProperty("isPublic");
  expect(group).not.toHaveProperty("ownerProfileId");
  expect(group).not.toHaveProperty("createdAt");
}

describe("GET /api/groups — group DTO contract", () => {
  it("ships snake_case group fields (member_count, cover_url, is_public)", async () => {
    const { status, json } = await get("/groups");

    expect(status).toBe(200);
    expect(json.groups).toHaveLength(1);
    expectGroupDto(json.groups[0]);
  });

  it("keeps the DTO through the ?member= membership filter", async () => {
    const { status, json } = await get(`/groups?member=${MEMBER_USER_ID}`);

    expect(status).toBe(200);
    expect(json.groups).toHaveLength(1);
    expectGroupDto(json.groups[0]);
  });
});

describe("GET /api/groups/:slug — group detail DTO contract", () => {
  it("ships the snake_case group DTO with hand-built parts intact", async () => {
    const { status, json } = await get("/groups/shark-tank-crew");

    expect(status).toBe(200);
    expectGroupDto(json.group);
    // Hand-built parts are already snake_case / client-shaped — unchanged.
    expect(json.owner_profile).toEqual({ slug: "crew-owner", displayName: "Crew Owner" });
    expect(json.viewer_role).toBeNull();
    expect(json.members).toHaveLength(2);
    expect(json.members[0].user_id).toBe(OWNER_USER_ID);
    expect(json.members[0].role).toBe("owner");
    expect(json.members[0].joined_at).toBe("2026-09-02T12:00:00.000Z");
    expect(json.members[0].profile).toEqual({
      slug: "crew-owner",
      displayName: "Crew Owner",
      avatarUrl: "https://cdn.example.com/owner.png",
    });
    expect(json.members[1].user_id).toBe(MEMBER_USER_ID);
    expect(json.members[1].profile?.displayName).toBe("Crew Member");
  });
});
