/**
 * One Tip Jar (Stack-200 upgrade N4) — GET /api/tips/jar/:handle over
 * the REAL tip-jar router with the house fake db.
 *
 * Pins:
 *  - the jar resolves by tip handle AND by creator-profile slug (the
 *    two namespaces every door already uses), 404 when neither hits;
 *  - the response carries the ONE canonical address + QR target every
 *    surface points at;
 *  - totals keep the rails in separate lanes: paid tip-page dollars
 *    (pending rows are NOT money and never count), live-stream VB and
 *    World-stage VB apart and summed only within VB;
 *  - the activity feed merges all three doors newest-first, each
 *    entry labeled with its door, its own unit, and the tipper's name.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => ({
  fake: null as any,
  userId: "",
}));

vi.mock("../../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = h.userId;
    next();
  },
}));

vi.mock("../../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("stripe", () => ({
  default: class FakeStripe {
    checkout = { sessions: { create: async () => ({ id: "cs_fake", url: "https://checkout.example/x" }), retrieve: async () => ({}) } };
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { createFakeDb } = await import("../../__tests__/_reach-fake-db");
  const fake = createFakeDb({
    creatorProfiles: actual.creatorProfilesTable,
    tipJarTips: actual.tipJarTipsTable,
    liveStreamTips: actual.liveStreamTipsTable,
    worldStageTips: actual.worldStageTipsTable,
  });
  h.fake = fake;
  return { ...actual, db: fake.db };
});

import router, { __resetTipJarStores } from "../tip-jar";

const OWNER = randomUUID();
const TIPPER = randomUUID();
const OWNER_PROFILE = randomUUID();
const TIPPER_PROFILE = randomUUID();

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
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

const d = (iso: string) => new Date(iso);

beforeEach(async () => {
  h.fake.clear();
  __resetTipJarStores();
  h.userId = OWNER;
  h.fake.seed("creatorProfiles", [
    { id: OWNER_PROFILE, userId: OWNER, displayName: "Jar Owner", slug: "jar-owner", avatarUrl: null, isVerified: false },
    { id: TIPPER_PROFILE, userId: TIPPER, displayName: "Fan Fred", slug: "fan-fred", avatarUrl: null, isVerified: false },
  ]);
  // Create the jar through the real settings route.
  const res = await realFetch(`${baseUrl}/tips/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ handle: "jarowner", displayName: "Jar Owner", suggestedAmounts: [5, 10, 25] }),
  });
  expect(res.status).toBe(200);

  h.fake.seed("tipJarTips", [
    {
      id: randomUUID(), page_user_id: OWNER, handle: "jarowner", fan_name: "Page Pam",
      message: "love the new song", amount_cents: 2500, currency: "usd", status: "paid",
      stripe_session_id: "cs_paid_1", created_at: d("2026-10-26T10:00:00Z"), paid_at: d("2026-10-26T10:01:00Z"),
    },
    {
      id: randomUUID(), page_user_id: OWNER, handle: "jarowner", fan_name: "Pending Pete",
      message: "", amount_cents: 9900, currency: "usd", status: "pending_payment",
      stripe_session_id: "cs_pending_1", created_at: d("2026-10-27T09:00:00Z"), paid_at: null,
    },
  ]);
  h.fake.seed("liveStreamTips", [
    {
      id: randomUUID(), stream_id: randomUUID(), tipper_user_id: TIPPER, creator_user_id: OWNER,
      amount_vb: 300, message_id: null, pinned_until: null, creator_credited_at: d("2026-10-27T08:00:00Z"),
      idempotency_key: "live-tip-1", created_at: d("2026-10-27T08:00:00Z"),
    },
  ]);
  h.fake.seed("worldStageTips", [
    {
      id: randomUUID(), fromUserId: TIPPER, toUserId: OWNER, amountVb: 1000, roomId: "kings-plaza",
      idempotencyKey: "stage-tip-1", creatorCreditedAt: d("2026-10-27T12:00:00Z"), createdAt: d("2026-10-27T12:00:00Z"),
    },
  ]);
});

async function get(path: string) {
  const r = await realFetch(`${baseUrl}${path}`);
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

describe("one tip jar view", () => {
  it("resolves by handle and carries the one canonical address", async () => {
    const r = await get("/tips/jar/jarowner");
    expect(r.status).toBe(200);
    expect(r.json.jar.handle).toBe("jarowner");
    expect(r.json.jar.canonicalUrl).toBe("/tips/jarowner");
    expect(r.json.jar.qrTarget).toBe("/tips/jarowner");
    expect(r.json.jar.displayName).toBe("Jar Owner");
  });

  it("resolves by profile slug too — same jar, same canonical address", async () => {
    const r = await get("/tips/jar/jar-owner");
    expect(r.status).toBe(200);
    expect(r.json.jar.canonicalUrl).toBe("/tips/jarowner");
  });

  it("404s for a handle nobody owns", async () => {
    const r = await get("/tips/jar/no-such-jar");
    expect(r.status).toBe(404);
  });

  it("totals keep the rails in separate lanes; pending page tips never count", async () => {
    const r = await get("/tips/jar/jarowner");
    expect(r.json.totals).toEqual({
      usdCentsPaid: 2500,
      usdTipsCount: 1,
      vbLive: 300,
      vbStage: 1000,
      vbTotal: 1300,
    });
  });

  it("the activity feed merges all three doors newest-first, labeled by door and unit", async () => {
    const r = await get("/tips/jar/jarowner");
    const feed = r.json.activity as any[];
    expect(feed.map((e) => e.door)).toEqual(["world_stage", "live_stream", "tip_page"]);
    expect(feed[0]).toMatchObject({ unit: "VB", amount: 1000, fromLabel: "Fan Fred" });
    expect(feed[1]).toMatchObject({ unit: "VB", amount: 300, fromLabel: "Fan Fred" });
    expect(feed[2]).toMatchObject({ unit: "USD", amount: 2500, fromLabel: "Page Pam", message: "love the new song" });
    // The pending intent-era row is not money and never appears.
    expect(feed.some((e) => e.fromLabel === "Pending Pete")).toBe(false);
  });
});
