/**
 * ugc-briefs-guards.test.ts — Stack 400 lane s400-ugc-escrow (C-11).
 *
 * The claim transition used to be a load-check-save: the handler
 * checked `status === "open"` in memory, then wrote through an
 * UPDATE guarded only by id. Two creators claiming the same open
 * brief in the same instant both passed the check and both were
 * told they had won; the second write silently stole the brief.
 * The same load-check-save shape sat in release and deliver.
 *
 * C-11 makes all three guarded flips whose predicates ride the
 * UPDATE itself. These tests fire the harmful interleaves for real:
 * a write-delay seam (below) holds every UPDATE's execution open
 * long enough for a second request to load and validate against
 * the pre-write state — exactly the production race window — and
 * then asserts exactly one request lands, the loser gets the
 * honest 409, and the final row belongs to the winner.
 *
 * (The escrow money path is pinned by ugc-briefs-escrow.test.ts
 * and stripe-webhook-ugc-brief.test.ts; this file is lifecycle
 * only, sandbox mode throughout.)
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";

const BRAND = "00000000-0000-4000-8000-00000000b1a1";
const CREATOR = "00000000-0000-4000-8000-00000000c2e2";
const THIRD = "00000000-0000-4000-8000-00000000d3d3";

const h = vi.hoisted(() => ({ fake: null as any }));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const user = req.headers["x-test-user"];
    if (!user) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    req.userId = String(user);
    req.userCredits = 10000;
    req.log = { info: () => {}, error: () => {}, warn: () => {} };
    next();
  },
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
  generationLimiter: (_req: any, _res: any, next: any) => next(),
  freeAiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/credits", () => ({
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  LedgerWriteError: class LedgerWriteError extends Error {},
  chargeCredits: vi.fn(async () => 0),
  refundCredits: vi.fn(async () => {}),
  buildChargeIdempotencyKey: () => "k",
}));
vi.mock("../../lib/ai-clients", () => ({
  getTextModel: () => "test-model",
  LOW_REASONING_PARAMS: { reasoning_effort: "low" },
  getOpenAI: () => {
    throw new Error("no provider in brief guard tests");
  },
}));
vi.mock("../../lib/objectStorage", () => ({
  SUPABASE_CLIPS_BUCKET: "generated-clips",
  normalizeToStorageRef: (v: string | null | undefined) => v ?? null,
  refreshSupabaseStorageUrl: async (v: string) => v,
  uploadPublicMediaToR2: async () => "https://r2.test/x",
  uploadFileStreamToSupabaseStorage: async () => "supabase://generated-clips/x",
}));
vi.mock("../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: async (v: string) => v,
}));
vi.mock("../../lib/brand-record", () => ({ readBrandKit: async () => null }));
vi.mock("@runwayml/sdk", () => ({ default: class {} }));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { createFakeDb } = await import("./_reach-fake-db");
  const fake = createFakeDb({
    ugcBriefs: actual.ugcBriefsTable,
    ugcAds: actual.ugcAdsTable,
  });
  h.fake = fake;
  return { ...actual, db: fake.db };
});

import ugcBriefsRouter from "../ugc-briefs";
import { db, ugcAdsTable } from "@workspace/db";

let server: ReturnType<typeof express.application.listen>;
let base = "";

beforeAll(async () => {
  delete process.env["STRIPE_SECRET_KEY"];
  const app = express();
  app.use(express.json());
  app.use("/api", ugcBriefsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  h.fake.clear();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ── The race seam ────────────────────────────────────────────────
   The fake db executes an UPDATE the moment .returning()/.then
   resolves. Wrapping both so execution waits `ms` reproduces the
   production interleave deterministically: request A has loaded
   and validated and is "in" its write while request B loads the
   same pre-write row and validates too. On the unguarded code both
   writes land (two 200s, last writer steals the row); on the
   guarded flips the second UPDATE's predicate no longer matches. */
function installWriteDelay(ms: number): () => void {
  const dbObj = h.fake.db;
  const origUpdate = dbObj.update;
  dbObj.update = (table: unknown) => {
    const upd = origUpdate(table);
    const origSet = upd.set;
    upd.set = (values: unknown) => {
      const chain = origSet(values);
      const origReturning = chain.returning;
      chain.returning = async () => {
        await sleep(ms);
        return origReturning();
      };
      const origThen = chain.then;
      chain.then = (res: unknown, rej: unknown) => sleep(ms).then(() => origThen(res, rej));
      return chain;
    };
    return upd;
  };
  return () => {
    dbObj.update = origUpdate;
  };
}

async function call(
  method: string,
  path: string,
  opts: { user?: string; body?: unknown } = {},
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(opts.user ? { "x-test-user": opts.user } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function postBrief(): Promise<any> {
  const r = await call("POST", "/api/ugc-briefs", {
    user: BRAND,
    body: {
      productName: "Trail Boots",
      details: "Show the boots surviving a rainy festival weekend, mud and all.",
      style: "problem-fix",
      deadline: "2026-11-01T00:00:00.000Z",
    },
  });
  expect(r.status).toBe(201);
  return r.json.brief;
}

async function seedUnstampedAd(userId: string): Promise<any> {
  const [row] = await db
    .insert(ugcAdsTable)
    .values({
      userId,
      briefId: null,
      productSource: "upload",
      productName: "Trail Boots",
      style: "problem-fix",
      status: "ready",
      videoRef: "supabase://generated-clips/ugc-ads/v.mp4",
    })
    .returning();
  return row;
}

describe("C-11 — guarded lifecycle flips", () => {
  it("claim race: two creators claim one open brief concurrently — exactly one wins, the loser gets the 409 copy, the row names the winner", async () => {
    const brief = await postBrief();
    const restore = installWriteDelay(75);
    let a: { status: number; json: any }, b: { status: number; json: any };
    try {
      [a, b] = await Promise.all([
        call("POST", `/api/ugc-briefs/${brief.id}/claim`, { user: CREATOR }),
        call("POST", `/api/ugc-briefs/${brief.id}/claim`, { user: THIRD }),
      ]);
    } finally {
      restore();
    }
    expect([a!.status, b!.status].sort()).toEqual([200, 409]);
    const loser = a!.status === 409 ? a! : b!;
    const winner = a!.status === 200 ? a! : b!;
    const winnerId = a!.status === 200 ? CREATOR : THIRD;
    expect(loser.json.error).toMatch(/only an open brief can be claimed/);
    expect(winner.json.brief.status).toBe("claimed");
    expect(winner.json.brief.claimedByUserId).toBe(winnerId);

    const after = await call("GET", `/api/ugc-briefs/${brief.id}`, { user: BRAND });
    expect(after.json.brief.status).toBe("claimed");
    expect(after.json.brief.claimedByUserId).toBe(winnerId);
  });

  it("deliver ∥ release: exactly one lands — the final state is the winner's, and a refused delivery never stamps the ad", async () => {
    const brief = await postBrief();
    const claim = await call("POST", `/api/ugc-briefs/${brief.id}/claim`, { user: CREATOR });
    expect(claim.status).toBe(200);
    const ad = await seedUnstampedAd(CREATOR);

    const restore = installWriteDelay(75);
    let rel: { status: number; json: any }, del: { status: number; json: any };
    try {
      [rel, del] = await Promise.all([
        call("POST", `/api/ugc-briefs/${brief.id}/release`, { user: CREATOR }),
        call("POST", `/api/ugc-briefs/${brief.id}/deliver`, { user: CREATOR, body: { adId: ad.id } }),
      ]);
    } finally {
      restore();
    }
    expect([rel!.status, del!.status].sort()).toEqual([200, 409]);

    const after = await call("GET", `/api/ugc-briefs/${brief.id}`, { user: BRAND });
    const [adRow] = await db.select().from(ugcAdsTable).where(eq(ugcAdsTable.id, ad.id));
    if (del!.status === 200) {
      /* Delivery won: the brief is delivered against the claim, the
         ad carries the brief stamp, the release was refused. */
      expect(after.json.brief.status).toBe("delivered");
      expect(after.json.brief.claimedByUserId).toBe(CREATOR);
      expect(after.json.brief.deliveredAdId).toBe(ad.id);
      expect(adRow.briefId).toBe(brief.id);
      expect(rel!.json.error).toMatch(/changed while you were releasing/);
    } else {
      /* Release won: the brief is back on the board unclaimed, the
         delivery was refused, and the ad was never pinned to a
         brief it was not delivered to. */
      expect(rel!.status).toBe(200);
      expect(after.json.brief.status).toBe("open");
      expect(after.json.brief.claimedByUserId).toBeNull();
      expect(adRow.briefId).toBeNull();
      expect(del!.json.error).toMatch(/changed while you were delivering/);
    }
  });

  it("the guarded flips keep the plain lifecycle intact: claim → release reopens → another creator can claim → deliver lands and stamps the ad", async () => {
    const brief = await postBrief();
    const c1 = await call("POST", `/api/ugc-briefs/${brief.id}/claim`, { user: CREATOR });
    expect(c1.status).toBe(200);

    const rel = await call("POST", `/api/ugc-briefs/${brief.id}/release`, { user: CREATOR });
    expect(rel.status).toBe(200);
    expect(rel.json.brief.status).toBe("open");
    expect(rel.json.brief.claimedByUserId).toBeNull();

    /* The released claimer no longer owns a delivery door. */
    const ad = await seedUnstampedAd(CREATOR);
    const staleDeliver = await call("POST", `/api/ugc-briefs/${brief.id}/deliver`, {
      user: CREATOR,
      body: { adId: ad.id },
    });
    expect(staleDeliver.status).toBe(403);

    const c2 = await call("POST", `/api/ugc-briefs/${brief.id}/claim`, { user: THIRD });
    expect(c2.status).toBe(200);
    expect(c2.json.brief.claimedByUserId).toBe(THIRD);

    const ad2 = await seedUnstampedAd(THIRD);
    const del = await call("POST", `/api/ugc-briefs/${brief.id}/deliver`, {
      user: THIRD,
      body: { adId: ad2.id },
    });
    expect(del.status).toBe(200);
    expect(del.json.brief.status).toBe("delivered");
    expect(del.json.brief.deliveredAdId).toBe(ad2.id);
    const [ad2Row] = await db.select().from(ugcAdsTable).where(eq(ugcAdsTable.id, ad2.id));
    expect(ad2Row.briefId).toBe(brief.id);
  });
});
