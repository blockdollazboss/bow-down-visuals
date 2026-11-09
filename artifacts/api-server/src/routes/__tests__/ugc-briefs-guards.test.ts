/**
 * ugc-briefs-guards.test.ts — Stack 400 lane s400-ugc-escrow (C-11),
 * extended by follow-on lane f-ugc-savebrief.
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
 * f-ugc-savebrief closes the escrow lane's named residual: the two
 * writes that still went through the unguarded saveBrief — the
 * FREE brief's approve and the close route's fallback (no money
 * held) — are guarded flips now too, pinned by the last describe
 * block: two same-actor requests racing the same transition land
 * exactly once, and a close that validated against a brief that
 * has since been claimed (or had its funding claimed) can no
 * longer stamp "closed" over a state it never saw.
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
import { db, ugcAdsTable, ugcBriefsTable } from "@workspace/db";

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

/* ── Ordered interleave seam (f-ugc-savebrief) ────────────────────
   installWriteDelay holds EVERY update, so when two requests carry
   different roles the delayed winner lands at scheduler whim and
   the interleave is not the one under test. This variant delays
   only updates whose SET values match `holdIf` and lets the rest
   land immediately: the held request parks mid-write while the
   peer runs to completion — the deterministic shape of "actor B
   moves while actor A's flip is in flight". It also lets the test
   wait until the held request is actually parked (its flip issued
   but not landed) instead of guessing with a sleep. */
function installInterleaveDelay(
  ms: number,
  holdIf: (values: any) => boolean,
): { restore: () => void; held: Promise<void> } {
  const dbObj = h.fake.db;
  const origUpdate = dbObj.update;
  let signalHeld: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    signalHeld = resolve;
  });
  dbObj.update = (table: unknown) => {
    const upd = origUpdate(table);
    const origSet = upd.set;
    upd.set = (values: unknown) => {
      const chain = origSet(values);
      if (!holdIf(values)) return chain;
      const origReturning = chain.returning;
      chain.returning = async () => {
        signalHeld();
        await sleep(ms);
        return origReturning();
      };
      const origThen = chain.then;
      chain.then = (res: unknown, rej: unknown) => {
        signalHeld();
        return sleep(ms).then(() => origThen(res, rej));
      };
      return chain;
    };
    return upd;
  };
  return {
    restore: () => {
      dbObj.update = origUpdate;
    },
    held,
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

async function postPricedBrief(): Promise<any> {
  const r = await call("POST", "/api/ugc-briefs", {
    user: BRAND,
    body: {
      productName: "Trail Boots",
      details: "Show the boots surviving a rainy festival weekend, mud and all.",
      style: "problem-fix",
      deadline: "2026-11-01T00:00:00.000Z",
      priceCents: 5000,
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

/* ── f-ugc-savebrief: the last two unguarded writes ─────────────────
   The escrow lane's residual: the free brief's approve and the
   close route's fallback (free briefs, and priced briefs nobody
   has funded) still wrote through the id-only saveBrief. No money
   moves on either path, but an unguarded write can stamp its
   transition over a state another actor set inside the race
   window. Both are guarded flips now; saveBrief is gone. */
describe("f-ugc-savebrief — guarded approve fallback + close fallback", () => {
  it("approve race: two brand approvals of one free delivery concurrently — exactly one lands, the loser gets the changed-while-approving 409, the row is approved once", async () => {
    const brief = await postBrief();
    const claim = await call("POST", `/api/ugc-briefs/${brief.id}/claim`, { user: CREATOR });
    expect(claim.status).toBe(200);
    const ad = await seedUnstampedAd(CREATOR);
    const del = await call("POST", `/api/ugc-briefs/${brief.id}/deliver`, {
      user: CREATOR,
      body: { adId: ad.id },
    });
    expect(del.status).toBe(200);

    const restore = installWriteDelay(75);
    let a: { status: number; json: any }, b: { status: number; json: any };
    try {
      [a, b] = await Promise.all([
        call("POST", `/api/ugc-briefs/${brief.id}/approve`, { user: BRAND }),
        call("POST", `/api/ugc-briefs/${brief.id}/approve`, { user: BRAND }),
      ]);
    } finally {
      restore();
    }
    expect([a!.status, b!.status].sort()).toEqual([200, 409]);
    const loser = a!.status === 409 ? a! : b!;
    const winner = a!.status === 200 ? a! : b!;
    expect(loser.json.error).toMatch(/changed while you were approving/);
    /* The winner's success body is the v1 free-approve shape: the
       approved brief and NO release figures (no money moved). */
    expect(winner.json.brief.status).toBe("approved");
    expect(winner.json.release).toBeUndefined();

    const after = await call("GET", `/api/ugc-briefs/${brief.id}`, { user: BRAND });
    expect(after.json.brief.status).toBe("approved");
    /* A later plain retry is the ordinary state refusal, unchanged. */
    const retry = await call("POST", `/api/ugc-briefs/${brief.id}/approve`, { user: BRAND });
    expect(retry.status).toBe(409);
    expect(retry.json.error).toMatch(/only a delivered brief can be approved/);
  });

  it("close race on a free claimed brief: two brand closes concurrently — exactly one lands, the loser gets the changed-while-closing 409, the row is the winner's closed state", async () => {
    const brief = await postBrief();
    const claim = await call("POST", `/api/ugc-briefs/${brief.id}/claim`, { user: CREATOR });
    expect(claim.status).toBe(200);

    const restore = installWriteDelay(75);
    let a: { status: number; json: any }, b: { status: number; json: any };
    try {
      [a, b] = await Promise.all([
        call("POST", `/api/ugc-briefs/${brief.id}/close`, { user: BRAND }),
        call("POST", `/api/ugc-briefs/${brief.id}/close`, { user: BRAND }),
      ]);
    } finally {
      restore();
    }
    expect([a!.status, b!.status].sort()).toEqual([200, 409]);
    const loser = a!.status === 409 ? a! : b!;
    const winner = a!.status === 200 ? a! : b!;
    expect(loser.json.error).toMatch(/changed while you were closing/);
    expect(winner.json.brief.status).toBe("closed");

    const after = await call("GET", `/api/ugc-briefs/${brief.id}`, { user: BRAND });
    expect(after.json.brief.status).toBe("closed");
    expect(after.json.brief.claimedByUserId).toBe(CREATOR);
  });

  it("close ∥ claim: a close that validated the brief as open cannot stamp closed over a claim that lands in the window — the close gets the 409 and the claim stands", async () => {
    const brief = await postBrief();

    /* The close's flip is held mid-write while the claim runs to
       completion: the claim flips against the pre-close row, then
       the close's flip executes against a row that no longer
       matches the state the close validated (a claimer now stands
       where the close read none). On the unguarded code the close's
       delayed write stamped "closed" over the fresh claim — the
       creator was told they had won a brief that was already gone. */
    const gate = installInterleaveDelay(150, (v) => v?.status === "closed");
    let close: { status: number; json: any };
    try {
      const closeP = call("POST", `/api/ugc-briefs/${brief.id}/close`, { user: BRAND });
      await gate.held;
      const claim = await call("POST", `/api/ugc-briefs/${brief.id}/claim`, { user: CREATOR });
      expect(claim.status).toBe(200);
      expect(claim.json.brief.status).toBe("claimed");
      close = await closeP;
    } finally {
      gate.restore();
    }
    expect(close!.status).toBe(409);
    expect(close!.json.error).toMatch(/changed while you were closing/);

    const after = await call("GET", `/api/ugc-briefs/${brief.id}`, { user: BRAND });
    expect(after.json.brief.status).toBe("claimed");
    expect(after.json.brief.claimedByUserId).toBe(CREATOR);
  });

  it("close ∥ funding-claim: a close that validated an unfunded priced brief cannot close over a funding claim that lands in the window — the brief stays claimed and fundable", async () => {
    const brief = await postPricedBrief();
    const claim = await call("POST", `/api/ugc-briefs/${brief.id}/claim`, { user: CREATOR });
    expect(claim.status).toBe(200);

    /* Same ordered interleave: the close's flip is held mid-write
       while the brand's own fund call flips the escrow claim to
       "funding" and persists its session. The close's flip then
       executes against a row whose escrow no longer matches what
       the close read. On the unguarded code the close closed the
       brief underneath the live funding claim. (This is the
       mirror of the in-flight case the close route already
       handles: a "funding" row read at load closes through the
       guarded abandon branch, pinned in the escrow suite.) */
    const gate = installInterleaveDelay(150, (v) => v?.status === "closed");
    let close: { status: number; json: any };
    try {
      const closeP = call("POST", `/api/ugc-briefs/${brief.id}/close`, { user: BRAND });
      await gate.held;
      const fund = await call("POST", `/api/ugc-briefs/${brief.id}/fund`, { user: BRAND, body: {} });
      expect(fund.status).toBe(200);
      expect(fund.json.sandbox).toBe(true);
      close = await closeP;
      /* The funding claim the close tried to bury is fully alive:
         the sandbox session settles against it. */
      const settled = await call("POST", "/api/ugc-briefs/escrow/confirm", {
        user: BRAND,
        body: { briefId: brief.id, sessionId: fund.json.sessionId },
      });
      expect(settled.status).toBe(200);
      expect(settled.json.brief.escrowStatus).toBe("funded");
    } finally {
      gate.restore();
    }
    expect(close!.status).toBe(409);
    expect(close!.json.error).toMatch(/changed while you were closing/);

    const after = await call("GET", `/api/ugc-briefs/${brief.id}`, { user: BRAND });
    expect(after.json.brief.status).toBe("claimed");
    expect(after.json.brief.escrowStatus).toBe("funded");
  });

  it("an uncontended close through the fallback answers the plain v1 shape — closed brief, no money keys, no refund field", async () => {
    const brief = await postBrief();
    const c = await call("POST", `/api/ugc-briefs/${brief.id}/close`, { user: BRAND });
    expect(c.status).toBe(200);
    expect(c.json.brief.status).toBe("closed");
    expect(c.json.refundedCents).toBeUndefined();
    for (const k of Object.keys(c.json.brief)) {
      expect(k.toLowerCase()).not.toMatch(/price|fee|escrow|amount/);
    }
    const [row] = await db.select().from(ugcBriefsTable).where(eq(ugcBriefsTable.id, brief.id));
    expect(row.status).toBe("closed");
    expect(row.escrowStatus).toBe("unfunded");
  });
});
