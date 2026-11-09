/**
 * CA-R site 7 — scheduler draft→scheduled twin on REAL Postgres
 * semantics (pg-mem), Stack 400 charge-audit follow-on CA-R.
 *
 * The reach-fake harness (ca-races.test.ts) applies an UPDATE when its
 * promise is awaited, which lets a scheduler twin's pre-charge awaits
 * interleave past BOTH claim constructions — the fake cannot model the
 * atomic WHERE evaluation a real database gives the guarded flip. So
 * the scheduler twin is asserted here instead, against pg-mem through
 * the REAL drizzle db (the house test-db harness): two concurrent
 * PATCHes race the guarded UPDATE ... WHERE status='draft'; exactly
 * one flip lands, the loser is refunded in full and answered with the
 * site's not_editable 409. Net effect: exactly one charge stands.
 *
 * The DDL below mirrors lib/db/src/schema/scheduled-posts.ts for the
 * columns this route reads/writes.
 *
 * FORCING THE OVERLAP: with an in-memory db and instant mocks, every
 * await in the handler chain resolves at microtask level, so two
 * back-to-back fetches never actually interleave — the second request
 * only starts after the first has fully finished, pre-reads
 * 'scheduled', and takes the legitimate free reschedule path (proven:
 * a diagnostic run showed statuses [200, 200] with charges [100]).
 * The test therefore arms a CHARGE BARRIER in the credits mock: the
 * handler pre-reads the post BEFORE charging, so holding the first
 * twin inside chargeCredits until the second twin also arrives
 * guarantees both pre-reads saw 'draft' and both charges landed —
 * exactly the production interleaving (two in-flight requests against
 * real Postgres) that the guarded UPDATE exists to decide. After the
 * barrier releases, the twins race the atomic UPDATE ... WHERE
 * status='draft' against the live table.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { createTestDb } from "../../lib/__tests__/test-db";
import { sql } from "drizzle-orm";

const SCHEDULED_POSTS_DDL = `
CREATE TABLE scheduled_posts (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  media_url text NOT NULL,
  media_type text NOT NULL DEFAULT 'video',
  caption text NOT NULL DEFAULT '',
  hashtags text NOT NULL DEFAULT '',
  platforms jsonb NOT NULL DEFAULT '[]'::jsonb,
  account_ids jsonb NOT NULL DEFAULT '{}'::jsonb,
  scheduled_at timestamptz,
  posted_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  credits_charged integer NOT NULL DEFAULT 0,
  credits_refunded boolean NOT NULL DEFAULT false,
  release_id uuid,
  provenance jsonb,
  ai_best_time jsonb,
  results jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);`;

const h = vi.hoisted(() => ({
  db: null as any,
  userId: "",
  balance: 100000,
  charges: [] as number[],
  refunds: [] as number[],
  /* Charge barrier (see header): when armed, chargeCredits callers
     wait until `parties` of them have arrived, then all proceed. */
  chargeBarrier: null as null | {
    parties: number;
    arrived: number;
    promise: Promise<void>;
    release: () => void;
  },
}));

function armChargeBarrier(parties: number) {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  /* Safety: never hang the suite if a twin never reaches the charge —
     release late and let the assertions report the real failure. */
  setTimeout(release, 5000).unref?.();
  h.chargeBarrier = { parties, arrived: 0, promise, release };
}

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = h.userId;
    req.userCredits = h.balance;
    next();
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    get db() {
      return h.db;
    },
  };
});

vi.mock("../../lib/credits", () => {
  class OutOfCreditsError extends Error {}
  class LedgerWriteError extends Error {}
  return {
    OutOfCreditsError,
    LedgerWriteError,
    chargeCredits: async (_userId: string, amount: number) => {
      const barrier = h.chargeBarrier;
      if (barrier) {
        barrier.arrived += 1;
        if (barrier.arrived >= barrier.parties) barrier.release();
        await barrier.promise;
      }
      if (h.balance < amount) throw new OutOfCreditsError("insufficient");
      h.balance -= amount;
      h.charges.push(amount);
      return h.balance;
    },
    refundCredits: async (_userId: string, amount: number) => {
      h.balance += amount;
      h.refunds.push(amount);
    },
  };
});

vi.mock("../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: async (v: any) => v ?? null,
}));

vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrl: async (v: any) => v,
  refreshSupabaseStorageUrlsDeep: async (v: any) => v,
}));

vi.mock("../../lib/job-poller", () => ({ requestPollerTick: vi.fn() }));

vi.mock("../../lib/ai-clients", () => ({
  getOpenAI: () => {
    throw new Error("no ai in ca-races-pg tests");
  },
  getTextModel: () => "gpt-6-sol",
  LOW_REASONING_PARAMS: { reasoning_effort: "low" },
}));

import schedulerRouter from "../scheduler";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;
const USER = randomUUID();

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { error: () => {}, info: () => {} };
    next();
  });
  app.use(schedulerRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  const { db, mem } = createTestDb();
  mem.public.none(SCHEDULED_POSTS_DDL);
  h.db = db;
  h.userId = USER;
  h.balance = 100000;
  h.charges = [];
  h.refunds = [];
  h.chargeBarrier = null;
});

async function req(method: string, path: string, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

describe("CA-R site 7 (pg-mem) — PATCH /scheduler/posts/:id draft → scheduled", () => {
  it("concurrent schedule requests net exactly one charge; the loser is refunded and 409s", async () => {
    const postId = randomUUID();
    const accountId = randomUUID();
    await h.db.execute(sql`
      INSERT INTO scheduled_posts
        (id, user_id, status, media_url, media_type, caption, platforms, account_ids, credits_charged, credits_refunded)
      VALUES
        (${postId}, ${USER}, 'draft', 'https://example.com/clip.mp4', 'video', 'race post',
         ${JSON.stringify(["instagram"])}::jsonb, ${JSON.stringify({ instagram: accountId })}::jsonb, 0, false)
    `);
    const when = new Date(Date.now() + 3_600_000).toISOString();
    /* Force the production overlap (see header): both twins must be
       past their 'draft' pre-read and inside the charge before either
       reaches the guarded UPDATE. */
    armChargeBarrier(2);
    const [a, b] = await Promise.all([
      req("PATCH", `/scheduler/posts/${postId}`, { scheduledAt: when }),
      req("PATCH", `/scheduler/posts/${postId}`, { scheduledAt: when }),
    ]);
    const statuses = [a.status, b.status].sort((x, y) => x - y);
    expect(statuses).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.json.error).toBe("not_editable");
    /* Both twins charge before the guarded flip (the audit's defect
       shape); the loser's flip matches 0 rows on the real atomic
       UPDATE, its charge is refunded in full — net one charge. */
    expect(h.charges).toEqual([100, 100]);
    expect(h.refunds).toEqual([100]);
    expect(h.balance).toBe(100000 - 100);
    const rows = await h.db.execute(sql`SELECT status, credits_charged FROM scheduled_posts WHERE id = ${postId}`);
    expect(rows.rows[0].status).toBe("scheduled");
    expect(rows.rows[0].credits_charged).toBe(100);
  });
});
