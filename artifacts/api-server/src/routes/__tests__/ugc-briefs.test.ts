/**
 * Route tests for the UGC Briefs Board (routes/ugc-briefs — owner
 * order Oct 19, 2026, the business side of UGC Product Ads):
 *   POST /api/ugc-briefs                        post a brief (open)
 *   GET  /api/ugc-briefs?scope=open|posted|claimed
 *   GET  /api/ugc-briefs/:id
 *   POST /api/ugc-briefs/:id/claim              creator takes it
 *   POST /api/ugc-briefs/:id/release            claimer hands it back
 *   POST /api/ugc-briefs/:id/deliver            claimer delivers an ad
 *   POST /api/ugc-briefs/:id/approve            brand accepts
 *   POST /api/ugc-briefs/:id/close              brand closes
 *
 * Contract pinned here:
 * - The lifecycle is a one-way walk: open → claimed → delivered →
 *   approved, with close (brand, from open/claimed) and release
 *   (claimer, from claimed) as the only side doors. Every illegal
 *   transition is refused (409) and changes nothing.
 * - Wrong-party actions on a visible brief are 403 (deliver by a
 *   non-claimer, approve/close by a non-brand, release by a
 *   non-claimer); claiming your OWN brief is a 400.
 * - A non-open brief is invisible to anyone but its brand and its
 *   claimer — a third member gets a 404 on read AND on actions.
 * - Delivery requires the claimer's own READY ad; another member's
 *   ad, a draft ad, and a missing ad are all refused the same way,
 *   and an ad made for a different brief can't be delivered here.
 * - NO PAYMENT RAIL: the DTO carries the plain-language paymentNote
 *   on every brief — payment is arranged between brand and creator
 *   directly; there is no price/fee/VB field anywhere in the shape.
 *
 * Driven against the REAL Express router on an ephemeral server with
 * the house _reach-fake-db and mocked auth (x-test-user header).
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

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
}));

/* ugc-briefs imports UGC_STYLES from ugc-ads — mock that module's deps
   so the import chain loads without providers. */
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
    throw new Error("no provider in brief tests");
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

import ugcBriefsRouter, { UGC_BRIEF_PAYMENT_NOTE } from "../ugc-briefs";
import { db, ugcAdsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

let server: ReturnType<typeof express.application.listen>;
let base = "";

beforeAll(async () => {
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

async function postBrief(user = BRAND, extra: Record<string, unknown> = {}): Promise<any> {
  const r = await call("POST", "/api/ugc-briefs", {
    user,
    body: {
      productName: "Trail Boots",
      details: "Show the boots surviving a rainy festival weekend, mud and all.",
      style: "problem-fix",
      deadline: "2026-11-01T00:00:00.000Z",
      ...extra,
    },
  });
  expect(r.status).toBe(201);
  return r.json.brief;
}

async function seedAd(userId: string, status: string, briefId: string | null = null): Promise<any> {
  const [row] = await db
    .insert(ugcAdsTable)
    .values({
      userId,
      briefId,
      productSource: "upload",
      productName: "Trail Boots",
      style: "problem-fix",
      status,
      videoRef: status === "ready" ? "supabase://generated-clips/ugc-ads/v.mp4" : null,
    })
    .returning();
  return row;
}

async function walkToDelivered(): Promise<{ brief: any; ad: any }> {
  const brief = await postBrief();
  await call("POST", `/api/ugc-briefs/${brief.id}/claim`, { user: CREATOR });
  const ad = await seedAd(CREATOR, "ready", brief.id);
  const d = await call("POST", `/api/ugc-briefs/${brief.id}/deliver`, {
    user: CREATOR,
    body: { adId: ad.id },
  });
  expect(d.status).toBe(200);
  return { brief: d.json.brief, ad };
}

describe("posting + reading the board", () => {
  it("posts an open brief carrying the plain-language payment note", async () => {
    const brief = await postBrief();
    expect(brief.status).toBe("open");
    expect(brief.brandUserId).toBe(BRAND);
    expect(brief.paymentNote).toBe(UGC_BRIEF_PAYMENT_NOTE);
    expect(brief.paymentNote).toContain("arranged between the brand and the creator directly");
    expect(brief.deadline).toBe("2026-11-01T00:00:00.000Z");
    /* No money fields exist in the shape at all. */
    for (const k of Object.keys(brief)) {
      expect(k.toLowerCase()).not.toMatch(/price|fee|escrow|amount|vb|credit/);
    }
  });

  it("refuses a nonsense deadline and a too-thin brief", async () => {
    const badDate = await call("POST", "/api/ugc-briefs", {
      user: BRAND,
      body: { productName: "X", details: "A perfectly reasonable brief body.", style: "grwm", deadline: "next Friday-ish" },
    });
    expect(badDate.status).toBe(400);
    const thin = await call("POST", "/api/ugc-briefs", {
      user: BRAND,
      body: { productName: "X", details: "short", style: "grwm" },
    });
    expect(thin.status).toBe(400);
  });

  it("scopes: open is the shared board, posted is the brand's, claimed is the creator's", async () => {
    const b1 = await postBrief(BRAND);
    await postBrief(THIRD, { productName: "Other Brand Thing" });
    const open = await call("GET", "/api/ugc-briefs?scope=open", { user: CREATOR });
    expect(open.json.briefs).toHaveLength(2);
    const posted = await call("GET", "/api/ugc-briefs?scope=posted", { user: BRAND });
    expect(posted.json.briefs.map((b: any) => b.id)).toEqual([b1.id]);
    await call("POST", `/api/ugc-briefs/${b1.id}/claim`, { user: CREATOR });
    const claimed = await call("GET", "/api/ugc-briefs?scope=claimed", { user: CREATOR });
    expect(claimed.json.briefs.map((b: any) => b.id)).toEqual([b1.id]);
    /* Once claimed it leaves the open board. */
    const openAfter = await call("GET", "/api/ugc-briefs?scope=open", { user: CREATOR });
    expect(openAfter.json.briefs).toHaveLength(1);
  });

  it("a claimed brief is invisible to a third member (404), visible to brand + claimer", async () => {
    const brief = await postBrief();
    await call("POST", `/api/ugc-briefs/${brief.id}/claim`, { user: CREATOR });
    expect((await call("GET", `/api/ugc-briefs/${brief.id}`, { user: THIRD })).status).toBe(404);
    expect((await call("GET", `/api/ugc-briefs/${brief.id}`, { user: BRAND })).status).toBe(200);
    expect((await call("GET", `/api/ugc-briefs/${brief.id}`, { user: CREATOR })).status).toBe(200);
  });
});

describe("claim + release", () => {
  it("claiming your own brief is a 400; a claimed brief can't be claimed again", async () => {
    const brief = await postBrief();
    expect((await call("POST", `/api/ugc-briefs/${brief.id}/claim`, { user: BRAND })).status).toBe(400);
    const ok = await call("POST", `/api/ugc-briefs/${brief.id}/claim`, { user: CREATOR });
    expect(ok.status).toBe(200);
    expect(ok.json.brief.status).toBe("claimed");
    expect(ok.json.brief.claimedByUserId).toBe(CREATOR);
    /* Third member can't even see it now. */
    expect((await call("POST", `/api/ugc-briefs/${brief.id}/claim`, { user: THIRD })).status).toBe(404);
    /* The claimer re-claiming hits the state wall. */
    expect((await call("POST", `/api/ugc-briefs/${brief.id}/claim`, { user: CREATOR })).status).toBe(409);
  });

  it("release hands the brief back to the board; only the claimer can release", async () => {
    const brief = await postBrief();
    await call("POST", `/api/ugc-briefs/${brief.id}/claim`, { user: CREATOR });
    expect((await call("POST", `/api/ugc-briefs/${brief.id}/release`, { user: BRAND })).status).toBe(403);
    const r = await call("POST", `/api/ugc-briefs/${brief.id}/release`, { user: CREATOR });
    expect(r.status).toBe(200);
    expect(r.json.brief.status).toBe("open");
    expect(r.json.brief.claimedByUserId).toBeNull();
  });
});

describe("deliver", () => {
  it("only the claimer can deliver, and only their own ready ad", async () => {
    const brief = await postBrief();
    await call("POST", `/api/ugc-briefs/${brief.id}/claim`, { user: CREATOR });
    const readyAd = await seedAd(CREATOR, "ready", brief.id);
    const draftAd = await seedAd(CREATOR, "draft", brief.id);
    const foreignAd = await seedAd(THIRD, "ready", brief.id);

    expect(
      (await call("POST", `/api/ugc-briefs/${brief.id}/deliver`, { user: BRAND, body: { adId: readyAd.id } })).status,
    ).toBe(403);
    expect(
      (await call("POST", `/api/ugc-briefs/${brief.id}/deliver`, { user: CREATOR, body: { adId: draftAd.id } })).status,
    ).toBe(400);
    expect(
      (await call("POST", `/api/ugc-briefs/${brief.id}/deliver`, { user: CREATOR, body: { adId: foreignAd.id } })).status,
    ).toBe(400);
    const ok = await call("POST", `/api/ugc-briefs/${brief.id}/deliver`, {
      user: CREATOR,
      body: { adId: readyAd.id },
    });
    expect(ok.status).toBe(200);
    expect(ok.json.brief.status).toBe("delivered");
    expect(ok.json.brief.deliveredAdId).toBe(readyAd.id);
    /* Delivered is terminal for delivery — no second delivery. */
    expect(
      (await call("POST", `/api/ugc-briefs/${brief.id}/deliver`, { user: CREATOR, body: { adId: readyAd.id } })).status,
    ).toBe(409);
  });

  it("an ad made for a different brief can't be delivered here; an unlinked ad gets linked", async () => {
    const briefA = await postBrief(BRAND, { productName: "Brief A Boots" });
    const briefB = await postBrief(BRAND, { productName: "Brief B Boots" });
    await call("POST", `/api/ugc-briefs/${briefA.id}/claim`, { user: CREATOR });
    await call("POST", `/api/ugc-briefs/${briefB.id}/claim`, { user: CREATOR });
    const adForB = await seedAd(CREATOR, "ready", briefB.id);
    expect(
      (await call("POST", `/api/ugc-briefs/${briefA.id}/deliver`, { user: CREATOR, body: { adId: adForB.id } })).status,
    ).toBe(400);
    const unlinked = await seedAd(CREATOR, "ready", null);
    const ok = await call("POST", `/api/ugc-briefs/${briefA.id}/deliver`, {
      user: CREATOR,
      body: { adId: unlinked.id },
    });
    expect(ok.status).toBe(200);
    const [row] = await db.select().from(ugcAdsTable).where(eq(ugcAdsTable.id, unlinked.id));
    expect(row!.briefId).toBe(briefA.id);
  });
});

describe("approve + close", () => {
  it("only the brand can approve, and only a delivered brief", async () => {
    const { brief } = await walkToDelivered();
    expect((await call("POST", `/api/ugc-briefs/${brief.id}/approve`, { user: CREATOR })).status).toBe(403);
    const ok = await call("POST", `/api/ugc-briefs/${brief.id}/approve`, { user: BRAND });
    expect(ok.status).toBe(200);
    expect(ok.json.brief.status).toBe("approved");
    /* Approved is terminal. */
    expect((await call("POST", `/api/ugc-briefs/${brief.id}/approve`, { user: BRAND })).status).toBe(409);
    expect((await call("POST", `/api/ugc-briefs/${brief.id}/close`, { user: BRAND })).status).toBe(409);
  });

  it("approving an open brief is a 409; closing works from open and claimed, brand only", async () => {
    const brief = await postBrief();
    expect((await call("POST", `/api/ugc-briefs/${brief.id}/approve`, { user: BRAND })).status).toBe(409);
    expect((await call("POST", `/api/ugc-briefs/${brief.id}/close`, { user: CREATOR })).status).toBe(403);
    await call("POST", `/api/ugc-briefs/${brief.id}/claim`, { user: CREATOR });
    const closed = await call("POST", `/api/ugc-briefs/${brief.id}/close`, { user: BRAND });
    expect(closed.status).toBe(200);
    expect(closed.json.brief.status).toBe("closed");
  });
});
