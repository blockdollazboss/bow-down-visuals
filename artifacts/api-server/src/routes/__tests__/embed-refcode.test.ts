/**
 * Route tests for embed referral attribution (routes/embed).
 *
 * THE REGRESSION: refCodeForUser() read its db.execute() result with
 * [0] as if it were a bare array. db.execute returns a node-postgres
 * QueryResult OBJECT ({ rows: [...] }) — indexing it with [0] is
 * always undefined — so every embed payload's ref_code was always
 * null and embed pages fell back to a bare /signup, silently losing
 * the creator's referral attribution. The fake db below deliberately
 * returns the real QueryResult shape (an object, NOT an array) so
 * the bug reproduces exactly as it does against Postgres; an
 * array-shaped fake would have hidden it. Sibling precedent:
 * review-links-referral.test.ts / the fix in routes/review-links.ts.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_ID = "44444444-4444-4444-8444-444444444444";
const TRACK_ID = "22222222-2222-4222-8222-222222222222";
const PROFILE_SLUG = "some-creator";

const h = vi.hoisted(() => ({
  state: {
    profiles: [] as Array<Record<string, unknown>>,
    tracks: [] as Array<Record<string, unknown>>,
    referralRows: [] as Array<Record<string, unknown>>,
  },
}));

/* Embed imports the storage refresh helper (media payloads); simulate
   its contract (refs become signed https URLs, else passthrough) so
   this file stays independent of real storage. */
function signedFor(ref: string): string {
  return `https://signed.example.com/${ref.replace(/^(r2|supabase):\/\//, "")}?sig=test`;
}
vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrl: async (v: unknown) =>
    typeof v === "string" && (v.startsWith("r2://") || v.startsWith("supabase://"))
      ? signedFor(v)
      : v,
  refreshSupabaseStorageUrlsDeep: async (v: unknown) => v,
  isStorageRef: (v: unknown) =>
    typeof v === "string" && (v.startsWith("r2://") || v.startsWith("supabase://")),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const state = h.state;
  const { creatorProfilesTable, profileTracksTable } = actual;

  function rowsFor(table: unknown): unknown[] {
    if (table === creatorProfilesTable) return state.profiles;
    if (table === profileTracksTable) return state.tracks;
    return [];
  }

  function chain(table: unknown): any {
    const c: any = {
      where: (_cond: unknown) => c,
      orderBy: (..._args: unknown[]) => c,
      limit: async (n: number) => rowsFor(table).slice(0, n),
      then: (res: any, rej: any) => Promise.resolve(rowsFor(table)).then(res, rej),
    };
    return c;
  }

  const fakeDb: any = {
    select: (_fields?: unknown) => ({
      from: (table: unknown) => chain(table),
    }),
    // node-postgres QueryResult shape — the whole point of this test.
    execute: async (_query: unknown) => ({
      command: "SELECT",
      rowCount: state.referralRows.length,
      oid: 0,
      fields: [],
      rows: state.referralRows,
    }),
  };

  return { ...actual, db: fakeDb };
});

import { embedApiRouter } from "../embed";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", embedApiRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  h.state.profiles = [
    {
      id: PROFILE_ID,
      userId: OWNER_ID,
      slug: PROFILE_SLUG,
      displayName: "Some Creator",
      isPublic: true,
      avatarUrl: null,
      bio: null,
    },
  ];
  h.state.tracks = [
    {
      id: TRACK_ID,
      profileId: PROFILE_ID,
      title: "Some Song",
      isPublished: true,
      artworkUrl: null,
      audioUrl: "https://cdn.example.com/song.mp3",
      playCount: 1,
    },
  ];
  // QueryResult-shaped: { rows: [ { code: "ABC" } ], rowCount: 1 }
  h.state.referralRows = [{ code: "ABC" }];
});

async function get(path: string) {
  const r = await realFetch(`${baseUrl}${path}`);
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

describe("embed referral code — QueryResult unwrapping", () => {
  it("GET /api/embed/refcode/:slug returns the creator's code from QueryResult.rows", async () => {
    const { status, json } = await get(`/embed/refcode/${PROFILE_SLUG}`);

    expect(status).toBe(200);
    expect(json.code).toBe("ABC");
  });

  it("track embed payload carries ref_code from QueryResult.rows", async () => {
    const { status, json } = await get(`/embed/track/${TRACK_ID}`);

    expect(status).toBe(200);
    expect(json.ref_code).toBe("ABC");
  });

  it("serves code: null (not a crash) when the creator has no referral code yet", async () => {
    h.state.referralRows = [];

    const { status, json } = await get(`/embed/refcode/${PROFILE_SLUG}`);

    expect(status).toBe(200);
    expect(json.code).toBeNull();
  });

  it("still 404s an unknown slug", async () => {
    h.state.profiles = [];

    const { status } = await get(`/embed/refcode/${PROFILE_SLUG}`);

    expect(status).toBe(404);
  });
});
