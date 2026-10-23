/**
 * S27-29 — GET /api/explore per-section settle.
 *
 * Explore blends five independent sources (shorts, creators, posts,
 * events, groups) behind ONE handler. It used to run all five queries
 * in a single try/catch, so any one source failing 500'd the whole
 * page. Now each section settles on its own (the earnings.ts pattern):
 * a failed section returns its empty shape ([]), the response carries
 * the surviving sections plus partial/failed_sections, and the request
 * 500s only when EVERY section failed.
 *
 * Fake-db style mirrors creator-profile-public.test.ts: table identity
 * decides the rows, and a per-table fail switch makes a source throw.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => ({
  state: {
    fail: new Set<string>(),
  },
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = "00000000-0000-4000-8000-000000000099";
    next();
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const {
    creatorProfilesTable,
    profileVideosTable,
    groupPostsTable,
    eventsTable,
    groupsTable,
  } = actual;

  const CREATOR = {
    id: "11111111-1111-4111-8111-111111111111",
    userId: "00000000-0000-4000-8000-000000000001",
    slug: "some-creator",
    displayName: "Some Creator",
    avatarUrl: null,
    vertical: "music",
    followerCount: 42,
    isPublic: true,
  };
  const VIDEO = {
    id: "22222222-2222-4222-8222-222222222222",
    title: "A short",
    thumbnailUrl: null,
    viewCount: 100,
    durationSec: 30,
  };
  const POST = {
    id: "33333333-3333-4333-8333-333333333333",
    body: "hot take",
    likeCount: 7,
    createdAt: new Date("2026-10-20T00:00:00.000Z"),
    authorUserId: CREATOR.userId,
  };
  const EVENT = {
    id: "44444444-4444-4444-8444-444444444444",
    title: "Launch night",
    kind: "stream",
    startsAt: new Date("2026-11-01T00:00:00.000Z"),
    coverUrl: null,
    rsvpCount: 3,
  };
  const GROUP = {
    id: "55555555-5555-4555-8555-555555555555",
    slug: "crew",
    name: "The Crew",
    description: "a group",
    coverUrl: null,
    memberCount: 9,
    isPublic: true,
  };

  function rowsFor(table: unknown): unknown[] {
    const fail = h.state.fail;
    if (table === profileVideosTable) {
      if (fail.has("shorts")) throw new Error("shorts source down");
      return [{ video: VIDEO, hostSlug: CREATOR.slug, hostName: CREATOR.displayName, hostAvatar: null }];
    }
    if (table === creatorProfilesTable) {
      // Two callers read this table: the creators section (fields-less
      // select, orderBy->limit) and profileCards (author cards for the
      // posts section). Both get the creator row; the fail switch is
      // only wired to the section query below via the chain mode.
      return [CREATOR];
    }
    if (table === groupPostsTable) {
      if (fail.has("posts")) throw new Error("posts source down");
      return [{ post: POST, groupSlug: GROUP.slug, groupName: GROUP.name }];
    }
    if (table === eventsTable) {
      if (fail.has("events")) throw new Error("events source down");
      return [{ event: EVENT, hostSlug: CREATOR.slug, hostName: CREATOR.displayName, hostAvatar: null }];
    }
    if (table === groupsTable) {
      if (fail.has("groups")) throw new Error("groups source down");
      return [GROUP];
    }
    return [];
  }

  function creatorsSectionRows(): unknown[] {
    if (h.state.fail.has("creators")) throw new Error("creators source down");
    return [CREATOR];
  }

  const fakeDb: any = {
    select: (fields?: unknown) => ({
      from: (table: unknown) => {
        // The creators section is the only fields-less select from
        // creatorProfilesTable that goes through orderBy->limit;
        // profileCards awaits its where-chain directly.
        const isCreatorsSection = table === creatorProfilesTable && !fields;
        const resolve = () => (isCreatorsSection ? creatorsSectionRows() : rowsFor(table));
        const chain: any = {
          innerJoin: () => chain,
          where: () => chain,
          orderBy: () => chain,
          limit: async (_n: number) => resolve(),
          then: (res: any, rej: any) => Promise.resolve().then(resolve).then(res, rej),
        };
        return chain;
      },
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

beforeEach(() => {
  h.state.fail = new Set<string>();
});

async function getExplore() {
  const r = await realFetch(`${baseUrl}/explore`);
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

describe("GET /api/explore — per-section settle (S27-29)", () => {
  it("serves every section when all sources are healthy, not partial", async () => {
    const { status, json } = await getExplore();
    expect(status).toBe(200);
    expect(json.partial).toBe(false);
    expect(json.failed_sections).toEqual([]);
    expect(json.shorts).toHaveLength(1);
    expect(json.shorts[0].title).toBe("A short");
    expect(json.creators).toHaveLength(1);
    expect(json.creators[0].slug).toBe("some-creator");
    expect(json.posts).toHaveLength(1);
    expect(json.posts[0].author?.slug).toBe("some-creator");
    expect(json.events).toHaveLength(1);
    expect(json.groups).toHaveLength(1);
  });

  it("one failing section degrades to [] and the others still answer", async () => {
    h.state.fail.add("creators");
    const { status, json } = await getExplore();
    expect(status).toBe(200);
    expect(json.creators).toEqual([]);
    expect(json.partial).toBe(true);
    expect(json.failed_sections).toEqual(["creators"]);
    expect(json.shorts).toHaveLength(1);
    expect(json.posts).toHaveLength(1);
    expect(json.events).toHaveLength(1);
    expect(json.groups).toHaveLength(1);
  });

  it("several failing sections are all named, survivors still answer", async () => {
    h.state.fail.add("shorts");
    h.state.fail.add("groups");
    const { status, json } = await getExplore();
    expect(status).toBe(200);
    expect(json.shorts).toEqual([]);
    expect(json.groups).toEqual([]);
    expect(json.failed_sections).toEqual(["shorts", "groups"]);
    expect(json.partial).toBe(true);
    expect(json.creators).toHaveLength(1);
    expect(json.events).toHaveLength(1);
  });

  it("500s only when EVERY section source fails", async () => {
    for (const s of ["shorts", "creators", "posts", "events", "groups"]) h.state.fail.add(s);
    const { status, json } = await getExplore();
    expect(status).toBe(500);
    expect(json.error).toBe("Couldn't load Explore — try again.");
  });
});
