/**
 * Showcase item detail — creator identity (stack1300 tip-return):
 * GET /api/showcase/:slug used to carry only creator_name, so no tip
 * jar could be resolved on the item page (the jar probe takes a tip
 * handle or a creator-profile slug). The payload now adds
 * creator_slug, resolved from the item's own user_id on
 * creatorProfilesTable — null when the creator has no profile slug.
 * Harness mirrors tip-jar-checkout-embedded.test.ts (fake db over the
 * real router).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const CREATOR_ID = "66666666-6666-4666-8666-666666666666";
const CREATOR_NO_PROFILE_ID = "77777777-7777-4777-8777-777777777777";

const h = vi.hoisted(() => ({
  items: [] as Array<Record<string, any>>,
  profiles: [] as Array<Record<string, any>>,
}));

const dialect = new PgDialect();
function render(cond: unknown): { sql: string; params: unknown[] } {
  const q = dialect.sqlToQuery(cond as never);
  return { sql: q.sql, params: q.params as unknown[] };
}

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { showcaseItemsTable, creatorProfilesTable } = actual;

  function selectRows(table: unknown, cond: unknown): Array<Record<string, any>> {
    const { params } = render(cond);
    if (table === showcaseItemsTable) return h.items.filter((r) => params.includes(r.slug));
    if (table === creatorProfilesTable) return h.profiles.filter((r) => params.includes(r.user_id));
    return [];
  }

  const fakeDb: any = {
    select: () => ({
      from: (table: unknown) => ({
        where: (cond: unknown) => {
          const rows = () => selectRows(table, cond);
          return {
            limit: async () => rows(),
            then: (res: any, rej: any) => Promise.resolve(rows()).then(res, rej),
          };
        },
      }),
    }),
    /* The detail handler's view-count write is fire-and-forget with a
       .catch on the where() result — a real promise is the contract. */
    update: () => ({
      set: () => ({
        where: () => Promise.resolve([]),
      }),
    }),
  };
  return { ...actual, db: fakeDb };
});

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = CREATOR_ID;
    next();
  },
}));

import router from "../showcase";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(() => {
  server.closeAllConnections?.();
  server.close();
});

beforeEach(() => {
  h.items = [
    {
      id: "item-1",
      user_id: CREATOR_ID,
      slug: "midnight-pack-vol-2-ab12cd",
      title: "Midnight Pack Vol. 2",
      description: "",
      media_type: "song",
      media_url: "https://cdn.example.com/midnight.mp3",
      thumbnail_url: null,
      creator_name: "Royal Voice",
      views: 10,
      likes: 3,
    },
    {
      id: "item-2",
      user_id: CREATOR_NO_PROFILE_ID,
      slug: "quiet-clip-ef34gh",
      title: "Quiet Clip",
      description: "",
      media_type: "video",
      media_url: "https://cdn.example.com/quiet.mp4",
      thumbnail_url: null,
      creator_name: "Anonymous Creator",
      views: 0,
      likes: 0,
    },
  ];
  h.profiles = [{ user_id: CREATOR_ID, slug: "royal-voice" }];
});

async function get(path: string) {
  const r = await realFetch(`${baseUrl}${path}`);
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

describe("showcase item detail — creator identity", () => {
  it("carries the creator's profile slug from the item's own owner record", async () => {
    const { status, json } = await get("/showcase/midnight-pack-vol-2-ab12cd");
    expect(status).toBe(200);
    expect(json.item.creator_slug).toBe("royal-voice");
    expect(json.item.creator_name).toBe("Royal Voice");
    expect(json.item.slug).toBe("midnight-pack-vol-2-ab12cd");
  });

  it("carries creator_slug null when the creator has no profile slug — never invented", async () => {
    const { status, json } = await get("/showcase/quiet-clip-ef34gh");
    expect(status).toBe(200);
    expect(json.item.creator_slug).toBeNull();
    expect(json.item.creator_name).toBe("Anonymous Creator");
  });

  it("an unknown item still 404s, unchanged", async () => {
    const { status } = await get("/showcase/no-such-item");
    expect(status).toBe(404);
  });
});
