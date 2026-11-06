/**
 * ugc-briefs-escrow-partial.test.ts — the release splits what is
 * HELD, never the nominal price (C-25).
 *
 * The brand charges $100.01, then refunds $40.00 of it from the
 * Stripe dashboard BEFORE approving the delivery. escrowHeldCents
 * (mocked here to the post-refund truth: held 6001 of 10001) is the
 * guard the approve path consults — approval must release 6001 at
 * the rail's 5% (fee 300 / net 5701), stamp THOSE figures on the
 * brief, and tell the creator the truth: net released, with the
 * refunded part named. The nominal 10001 split (500 / 9501) must
 * appear nowhere in the release.
 *
 * Sandbox funding (no STRIPE_SECRET_KEY) settles the escrow first;
 * only the held-amount read is substituted, because a partial refund
 * is a Stripe-side state the sandbox cannot produce.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const BRAND = "00000000-0000-4000-8000-00000000b1a1";
const CREATOR = "00000000-0000-4000-8000-00000000c2e2";

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
  getOpenAI: () => {
    throw new Error("no provider in brief escrow tests");
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

/* THE substitution: $40.00 of the $100.01 charge was refunded, so
   6001 is held. Everything else about the rail is real. */
vi.mock("../../lib/escrow-held", () => ({
  escrowHeldCents: vi.fn(async () => ({
    heldCents: 6001,
    refundedCents: 4000,
    chargedCents: 10001,
    disputeLost: false,
  })),
}));

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

import ugcBriefsRouter, { __setUgcBriefEventNotifier } from "../ugc-briefs";
import { db, ugcAdsTable } from "@workspace/db";

const tells: Array<{ userId: string; kind: string; body: string }> = [];

let server: ReturnType<typeof express.application.listen>;
let base = "";

beforeAll(async () => {
  delete process.env["STRIPE_SECRET_KEY"];
  __setUgcBriefEventNotifier(async (input: any) => {
    tells.push({ userId: input.userId, kind: input.kind, body: input.body });
  });
  const app = express();
  app.use(express.json());
  app.use("/api", ugcBriefsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  __setUgcBriefEventNotifier(null);
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  h.fake.clear();
  tells.length = 0;
});

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

describe("approve after a partial refund", () => {
  it("releases the HELD 6001 at 5% (fee 300 / net 5701) — released + refunded = charged", async () => {
    const created = await call("POST", "/api/ugc-briefs", {
      user: BRAND,
      body: {
        productName: "Trail Boots",
        details: "Show the boots surviving a rainy festival weekend, mud and all.",
        style: "problem-fix",
        priceCents: 10001,
      },
    });
    expect(created.status).toBe(201);
    const brief = created.json.brief;
    await call("POST", `/api/ugc-briefs/${brief.id}/claim`, { user: CREATOR });
    const f = await call("POST", `/api/ugc-briefs/${brief.id}/fund`, { user: BRAND, body: {} });
    expect(f.status).toBe(200);
    const settled = await call("POST", "/api/ugc-briefs/escrow/confirm", {
      user: BRAND,
      body: { briefId: brief.id, sessionId: f.json.sessionId },
    });
    expect(settled.status).toBe(200);
    /* Funding stamped the NOMINAL split — the release must overwrite it. */
    expect(settled.json.brief.platformFeeCents).toBe(500);
    expect(settled.json.brief.creatorPayoutCents).toBe(9501);

    const [ad] = await db
      .insert(ugcAdsTable)
      .values({
        userId: CREATOR,
        briefId: brief.id,
        productSource: "upload",
        productName: "Trail Boots",
        style: "problem-fix",
        status: "ready",
        videoRef: "supabase://generated-clips/ugc-ads/v.mp4",
      })
      .returning();
    const d = await call("POST", `/api/ugc-briefs/${brief.id}/deliver`, {
      user: CREATOR,
      body: { adId: ad!.id },
    });
    expect(d.status).toBe(200);

    const a = await call("POST", `/api/ugc-briefs/${brief.id}/approve`, { user: BRAND });
    expect(a.status).toBe(200);
    expect(a.json.release).toEqual({
      grossCents: 6001,
      refundedCents: 4000,
      platformFeeCents: 300,
      creatorPayoutCents: 5701,
    });
    expect(a.json.release.grossCents + a.json.release.refundedCents).toBe(10001);
    expect(a.json.brief.releasedAmountCents).toBe(6001);
    expect(a.json.brief.platformFeeCents).toBe(300);
    expect(a.json.brief.creatorPayoutCents).toBe(5701);

    const releasedTells = tells.filter((t) => t.kind === "ugc_brief_escrow_released");
    expect(releasedTells).toHaveLength(1);
    expect(releasedTells[0]!.body).toContain("$57.01");
    expect(releasedTells[0]!.body).toContain("$40.00");
  });
});
