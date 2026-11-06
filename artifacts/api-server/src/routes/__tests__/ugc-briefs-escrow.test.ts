/**
 * Route tests for the UGC Briefs escrow rail (C-25 — owner ruling
 * Nov 5, 2026: "Build it — safe on-site payments for briefs").
 *
 * A brief may now carry an OPTIONAL price. A priced brief rides an
 * escrow rail cloned from the sponsor-deal escrow:
 *   post (priced) → claim → FUND (brand, embedded checkout) → settle
 *   (sandbox confirm here; webhook + verify in their own suites) →
 *   deliver → APPROVE = release (split of the HELD amount at the
 *   rail's 5%) · CLOSE on funded = refund of the held amount.
 *
 * Pinned here (sandbox mode — no STRIPE_SECRET_KEY in this file's
 * process, so funding is simulated and the confirm endpoint settles):
 * - a priced brief's DTO carries the money fields + the ESCROW note;
 *   the off-site note never rides a paid brief;
 * - an unpriced brief is byte-identical to v1 (also pinned by
 *   ugc-briefs.test.ts, which must pass unchanged);
 * - fund refusals: pre-claim 409, non-brand 403, foreign 404,
 *   unpriced 400, closed 409;
 * - sandbox fund → confirm settles with the nominal 5% split stamped
 *   (odd cents: $100.01 → 500 fee / 9501 net); the claimer is told
 *   exactly once — a replayed confirm is a duplicate no-op;
 * - re-funding supersedes a stale sandbox session; the stale
 *   session's confirm then fails;
 * - a funded claim cannot be released back to the board (409);
 * - approve releases at 5% with the release stamps + figures;
 *   approve-unfunded is a 409;
 * - close-on-funded closes + marks the escrow refunded; a closed
 *   brief can never be settled or approved afterwards;
 * - close while funding frees the funding claim with the brief.
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

import ugcBriefsRouter, {
  UGC_BRIEF_PAYMENT_NOTE,
  UGC_BRIEF_ESCROW_NOTE,
  __setUgcBriefEventNotifier,
} from "../ugc-briefs";
import { db, ugcAdsTable } from "@workspace/db";

const tells: Array<{ userId: string; kind: string; body: string }> = [];

let server: ReturnType<typeof express.application.listen>;
let base = "";

beforeAll(async () => {
  /* Sandbox mode is load-bearing for this file: no Stripe keys. */
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

async function postBrief(extra: Record<string, unknown> = {}): Promise<any> {
  const r = await call("POST", "/api/ugc-briefs", {
    user: BRAND,
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

async function seedAd(userId: string, briefId: string): Promise<any> {
  const [row] = await db
    .insert(ugcAdsTable)
    .values({
      userId,
      briefId,
      productSource: "upload",
      productName: "Trail Boots",
      style: "problem-fix",
      status: "ready",
      videoRef: "supabase://generated-clips/ugc-ads/v.mp4",
    })
    .returning();
  return row;
}

async function postPricedClaimed(priceCents = 10001): Promise<any> {
  const brief = await postBrief({ priceCents });
  const c = await call("POST", `/api/ugc-briefs/${brief.id}/claim`, { user: CREATOR });
  expect(c.status).toBe(200);
  return c.json.brief;
}

async function fundOk(briefId: string): Promise<any> {
  const f = await call("POST", `/api/ugc-briefs/${briefId}/fund`, { user: BRAND, body: {} });
  expect(f.status).toBe(200);
  expect(f.json.sandbox).toBe(true);
  return f.json;
}

async function confirmOk(briefId: string, sessionId: string): Promise<any> {
  const c = await call("POST", "/api/ugc-briefs/escrow/confirm", {
    user: BRAND,
    body: { briefId, sessionId },
  });
  expect(c.status).toBe(200);
  return c.json;
}

async function deliverOk(briefId: string): Promise<void> {
  const ad = await seedAd(CREATOR, briefId);
  const d = await call("POST", `/api/ugc-briefs/${briefId}/deliver`, {
    user: CREATOR,
    body: { adId: ad.id },
  });
  expect(d.status).toBe(200);
}

describe("priced vs free briefs", () => {
  it("a priced brief carries the money fields and the escrow note — never the off-site note", async () => {
    const brief = await postBrief({ priceCents: 10001 });
    expect(brief.priceCents).toBe(10001);
    expect(brief.escrowStatus).toBe("unfunded");
    expect(brief.feeBps).toBe(500);
    expect(brief.platformFeeCents).toBeNull();
    expect(brief.creatorPayoutCents).toBeNull();
    expect(brief.paymentNote).toBe(UGC_BRIEF_ESCROW_NOTE);
    expect(brief.paymentNote).not.toBe(UGC_BRIEF_PAYMENT_NOTE);
  });

  it("an unpriced brief stays byte-identical to v1 — no money keys, off-site note intact", async () => {
    const brief = await postBrief();
    expect(brief.paymentNote).toBe(UGC_BRIEF_PAYMENT_NOTE);
    for (const k of Object.keys(brief)) {
      expect(k.toLowerCase()).not.toMatch(/price|fee|escrow|amount|vb|credit/);
    }
  });

  it("a price under the $1 floor is refused", async () => {
    const r = await call("POST", "/api/ugc-briefs", {
      user: BRAND,
      body: {
        productName: "Trail Boots",
        details: "Show the boots surviving a rainy festival weekend, mud and all.",
        style: "problem-fix",
        priceCents: 50,
      },
    });
    expect(r.status).toBe(400);
  });
});

describe("funding", () => {
  it("refusals: pre-claim 409, non-brand 403, foreign 404, unpriced 400", async () => {
    const open = await postBrief({ priceCents: 5000 });
    /* Nobody has claimed it yet — money never locks on an unclaimed brief. */
    expect((await call("POST", `/api/ugc-briefs/${open.id}/fund`, { user: BRAND, body: {} })).status).toBe(409);
    /* An open brief is visible to all, but only its brand can fund. */
    expect((await call("POST", `/api/ugc-briefs/${open.id}/fund`, { user: THIRD, body: {} })).status).toBe(403);

    const claimed = await postPricedClaimed(5000);
    expect((await call("POST", `/api/ugc-briefs/${claimed.id}/fund`, { user: CREATOR, body: {} })).status).toBe(403);
    /* Once claimed, the brief is invisible to a third member. */
    expect((await call("POST", `/api/ugc-briefs/${claimed.id}/fund`, { user: THIRD, body: {} })).status).toBe(404);

    const free = await postBrief();
    await call("POST", `/api/ugc-briefs/${free.id}/claim`, { user: CREATOR });
    expect((await call("POST", `/api/ugc-briefs/${free.id}/fund`, { user: BRAND, body: {} })).status).toBe(400);
  });

  it("sandbox fund → confirm settles with the nominal 5% split stamped; the claimer is told once", async () => {
    const brief = await postPricedClaimed(10001);
    const f = await fundOk(brief.id);
    expect(f.amountCents).toBe(10001);
    expect(f.sessionId).toMatch(/^sandbox_/);

    const mid = await call("GET", `/api/ugc-briefs/${brief.id}`, { user: BRAND });
    expect(mid.json.brief.escrowStatus).toBe("funding");

    const settled = await confirmOk(brief.id, f.sessionId);
    expect(settled.success).toBe(true);
    expect(settled.duplicate).toBe(false);
    expect(settled.brief.escrowStatus).toBe("funded");
    /* Odd cents at 5%: fee = round(10001 × 0.05) = 500, net 9501. */
    expect(settled.brief.platformFeeCents).toBe(500);
    expect(settled.brief.creatorPayoutCents).toBe(9501);

    const fundedTells = tells.filter((t) => t.kind === "ugc_brief_escrow_funded");
    expect(fundedTells).toHaveLength(1);
    expect(fundedTells[0]!.userId).toBe(CREATOR);
    expect(fundedTells[0]!.body).toContain("$100.01");
  });

  it("a replayed confirm is a duplicate no-op — settle is exactly-once, the tell stays single", async () => {
    const brief = await postPricedClaimed(5000);
    const f = await fundOk(brief.id);
    await confirmOk(brief.id, f.sessionId);
    const again = await confirmOk(brief.id, f.sessionId);
    expect(again.success).toBe(true);
    expect(again.duplicate).toBe(true);
    expect(again.brief.escrowStatus).toBe("funded");
    expect(tells.filter((t) => t.kind === "ugc_brief_escrow_funded")).toHaveLength(1);
  });

  it("confirm guards: non-brand 403, wrong session 400", async () => {
    const brief = await postPricedClaimed(5000);
    const f = await fundOk(brief.id);
    expect(
      (await call("POST", "/api/ugc-briefs/escrow/confirm", { user: CREATOR, body: { briefId: brief.id, sessionId: f.sessionId } })).status,
    ).toBe(403);
    expect(
      (await call("POST", "/api/ugc-briefs/escrow/confirm", { user: BRAND, body: { briefId: brief.id, sessionId: "sandbox_not_the_session" } })).status,
    ).toBe(400);
  });

  it("re-funding supersedes a stale sandbox session — the stale confirm then fails", async () => {
    const brief = await postPricedClaimed(5000);
    const first = await fundOk(brief.id);
    const second = await fundOk(brief.id);
    expect(second.sessionId).not.toBe(first.sessionId);
    expect(
      (await call("POST", "/api/ugc-briefs/escrow/confirm", { user: BRAND, body: { briefId: brief.id, sessionId: first.sessionId } })).status,
    ).toBe(400);
    const settled = await confirmOk(brief.id, second.sessionId);
    expect(settled.brief.escrowStatus).toBe("funded");
  });

  it("verify refuses in sandbox mode", async () => {
    const brief = await postPricedClaimed(5000);
    expect((await call("POST", `/api/ugc-briefs/${brief.id}/verify`, { user: BRAND })).status).toBe(400);
  });

  it("a funded brief can't be funded again, and its claim can't be released", async () => {
    const brief = await postPricedClaimed(5000);
    const f = await fundOk(brief.id);
    /* While funding is in flight the claim is already locked. */
    expect((await call("POST", `/api/ugc-briefs/${brief.id}/release`, { user: CREATOR })).status).toBe(409);
    await confirmOk(brief.id, f.sessionId);
    expect((await call("POST", `/api/ugc-briefs/${brief.id}/fund`, { user: BRAND, body: {} })).status).toBe(409);
    expect((await call("POST", `/api/ugc-briefs/${brief.id}/release`, { user: CREATOR })).status).toBe(409);
  });
});

describe("approve = release", () => {
  it("releases at 5% with the stamps and figures — odd cents split held-true", async () => {
    const brief = await postPricedClaimed(10001);
    const f = await fundOk(brief.id);
    await confirmOk(brief.id, f.sessionId);
    await deliverOk(brief.id);
    const a = await call("POST", `/api/ugc-briefs/${brief.id}/approve`, { user: BRAND });
    expect(a.status).toBe(200);
    expect(a.json.brief.status).toBe("approved");
    expect(a.json.brief.escrowStatus).toBe("released");
    expect(a.json.brief.releasedAmountCents).toBe(10001);
    expect(a.json.brief.platformFeeCents).toBe(500);
    expect(a.json.brief.creatorPayoutCents).toBe(9501);
    expect(a.json.brief.releasedAt).toBeTruthy();
    expect(a.json.release).toEqual({ grossCents: 10001, platformFeeCents: 500, creatorPayoutCents: 9501 });
    const releasedTells = tells.filter((t) => t.kind === "ugc_brief_escrow_released");
    expect(releasedTells).toHaveLength(1);
    expect(releasedTells[0]!.userId).toBe(CREATOR);
    expect(releasedTells[0]!.body).toContain("$95.01");
  });

  it("approve before funding is a 409 — a paid brief never approves for free", async () => {
    const brief = await postPricedClaimed(5000);
    await deliverOk(brief.id);
    expect((await call("POST", `/api/ugc-briefs/${brief.id}/approve`, { user: BRAND })).status).toBe(409);
    const after = await call("GET", `/api/ugc-briefs/${brief.id}`, { user: BRAND });
    expect(after.json.brief.status).toBe("delivered");
    expect(after.json.brief.escrowStatus).toBe("unfunded");
  });

  it("approve while funding is in flight is a 409", async () => {
    const brief = await postPricedClaimed(5000);
    await fundOk(brief.id);
    await deliverOk(brief.id);
    expect((await call("POST", `/api/ugc-briefs/${brief.id}/approve`, { user: BRAND })).status).toBe(409);
  });
});

describe("close on funded", () => {
  it("closing a funded brief refunds the held amount and locks the brief", async () => {
    const brief = await postPricedClaimed(10001);
    const f = await fundOk(brief.id);
    await confirmOk(brief.id, f.sessionId);
    const c = await call("POST", `/api/ugc-briefs/${brief.id}/close`, { user: BRAND });
    expect(c.status).toBe(200);
    expect(c.json.brief.status).toBe("closed");
    expect(c.json.brief.escrowStatus).toBe("refunded");
    expect(c.json.refundedCents).toBe(10001);
    const refundTells = tells.filter((t) => t.kind === "ugc_brief_escrow_refunded");
    expect(refundTells).toHaveLength(1);
    expect(refundTells[0]!.userId).toBe(CREATOR);
    /* A closed brief can never be settled or approved afterwards. */
    expect(
      (await call("POST", "/api/ugc-briefs/escrow/confirm", { user: BRAND, body: { briefId: brief.id, sessionId: f.sessionId } })).status,
    ).toBe(409);
    expect((await call("POST", `/api/ugc-briefs/${brief.id}/approve`, { user: BRAND })).status).toBe(409);
  });

  it("closing while funding frees the claim with the brief — a late confirm settles nothing", async () => {
    const brief = await postPricedClaimed(5000);
    const f = await fundOk(brief.id);
    const c = await call("POST", `/api/ugc-briefs/${brief.id}/close`, { user: BRAND });
    expect(c.status).toBe(200);
    expect(c.json.brief.status).toBe("closed");
    expect(c.json.brief.escrowStatus).toBe("unfunded");
    expect(
      (await call("POST", "/api/ugc-briefs/escrow/confirm", { user: BRAND, body: { briefId: brief.id, sessionId: f.sessionId } })).status,
    ).toBe(400);
  });

  it("a closed priced brief can't be funded", async () => {
    const brief = await postBrief({ priceCents: 5000 });
    await call("POST", `/api/ugc-briefs/${brief.id}/close`, { user: BRAND });
    expect((await call("POST", `/api/ugc-briefs/${brief.id}/fund`, { user: BRAND, body: {} })).status).toBe(409);
  });
});
