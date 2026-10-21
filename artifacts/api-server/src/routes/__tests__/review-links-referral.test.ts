/**
 * Route tests for GET /api/review-links/:token (routes/review-links).
 *
 * THE REGRESSION: getReferralCode read its db.execute() result with [0]
 * as if it were a bare array. db.execute returns a node-postgres
 * QueryResult OBJECT ({ rows: [...] }) — indexing it with [0] is always
 * undefined — so the public review payload's referralCode was always
 * null and every shared review link silently lost the creator's 25%
 * referral attribution. The fake db below deliberately returns the real
 * QueryResult shape (an object, NOT an array) so the bug reproduces
 * exactly as it does against Postgres; an array-shaped fake would have
 * hidden it.
 *
 * The client (public review page) reads payload.referralCode to build
 * its signup CTA link — the assertion pins that field end to end.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { createHash } from "node:crypto";

const h = vi.hoisted(() => ({
  state: {
    link: null as null | Record<string, unknown>,
    referralRows: [] as Array<Record<string, unknown>>,
  },
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = "00000000-0000-4000-8000-000000000099";
    next();
  },
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
  const { reviewLinksTable, reviewCommentsTable } = actual;

  const fakeDb: any = {
    select: (_fields?: unknown) => ({
      from: (table: unknown) => ({
        where: (_cond: unknown) => {
          const rows =
            table === reviewLinksTable
              ? state.link
                ? [state.link]
                : []
              : table === reviewCommentsTable
                ? []
                : [];
          const chain: any = {
            limit: async (_n: number) => rows,
            orderBy: (..._args: unknown[]) => ({
              limit: async (_n: number) => rows,
              then: (res: any, rej: any) => Promise.resolve(rows).then(res, rej),
            }),
            then: (res: any, rej: any) => Promise.resolve(rows).then(res, rej),
          };
          return chain;
        },
      }),
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

import router from "../review-links";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

const TOKEN = "tok_abcdefghijklmnopqrstuvwx"; // matches TOKEN_RE (20–64 url-safe)

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

function linkRow(): Record<string, unknown> {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    user_id: "44444444-4444-4444-8444-444444444444",
    token_hash: createHash("sha256").update(TOKEN, "utf8").digest("hex"),
    title: "New cut — feedback please",
    video_url: "https://cdn.example.com/review-cut.mp4",
    source_type: "other",
    source_id: null,
    password_hash: null,
    status: "open",
    expires_at: null,
    feedback_seen_at: null,
    created_at: new Date("2026-10-10T00:00:00.000Z"),
    updated_at: new Date("2026-10-10T00:00:00.000Z"),
  };
}

beforeEach(() => {
  h.state.link = linkRow();
  h.state.referralRows = [];
});

async function get(path: string) {
  const r = await realFetch(`${baseUrl}${path}`);
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

describe("GET /api/review-links/:token — referral attribution", () => {
  it("carries the creator's referral code into the public payload (the share CTA's ?ref=)", async () => {
    h.state.referralRows = [{ code: "KINGPIN25" }];

    const { status, json } = await get(`/review-links/${TOKEN}`);

    expect(status).toBe(200);
    expect(json.locked).toBe(false);
    expect(json.title).toBe("New cut — feedback please");
    expect(json.referralCode).toBe("KINGPIN25");
  });

  it("serves referralCode: null (not a crash) when the creator has no code yet", async () => {
    h.state.referralRows = [];

    const { status, json } = await get(`/review-links/${TOKEN}`);

    expect(status).toBe(200);
    expect(json.referralCode).toBeNull();
  });

  it("still 404s an unknown token", async () => {
    h.state.link = null;

    const { status } = await get(`/review-links/${TOKEN}`);

    expect(status).toBe(404);
  });
});
