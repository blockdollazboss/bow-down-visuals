/**
 * Promo-card history (STACK-20 R2 #17, migration 0161) — route tests
 * on the REAL mounted promo-cards router over the house fake db.
 *
 *  - recordPromoCardPack writes one promo_cards row per card, keyed
 *    by the owner, and returns the row ids in card order — this is
 *    the record the generation POST writes in-request.
 *  - GET /api/promo-cards lists ONLY the caller's cards, newest
 *    first, with the page bound stated (limit applied, capped at
 *    100; hasMore honest), and every URL minted fresh from the row's
 *    stable storage ref — never a stored URL.
 *  - DELETE /api/promo-cards/:id removes the caller's own row; the
 *    same id under another owner is a 404 and the row survives.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

const h = vi.hoisted(() => ({
  fake: null as any,
  userId: "",
}));
h.userId = ME;

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = h.userId;
    next();
  },
}));

vi.mock("../../lib/credits", () => ({
  chargeCredits: vi.fn(async () => 0),
  refundCredits: vi.fn(async () => {}),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
}));

vi.mock("../../lib/ai-clients", () => ({
  getOpenAI: () => {
    throw new Error("no provider in route tests");
  },
}));

vi.mock("../../lib/objectStorage", () => ({
  uploadMediaToSupabaseStorage: vi.fn(async () => "supabase://generated-clips/unused.png"),
  /* The playable URL is minted from the stable ref at read time;
     echoing the ref back makes that minting observable in the DTO. */
  refreshSupabaseStorageUrl: async (ref: string) => `https://playable.test/${ref}`,
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { createFakeDb } = await import("./_reach-fake-db");
  const fake = createFakeDb({
    promoCards: actual.promoCardsTable,
  });
  h.fake = fake;
  return { ...actual, db: fake.db };
});

import promoCardsRouter, { recordPromoCardPack } from "../generate/promo-cards";

let base = "";
let server: ReturnType<express.Express["listen"]>;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    next();
  });
  app.use(promoCardsRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
});
beforeEach(() => {
  h.fake.clear();
  h.userId = ME;
});

async function get(path: string) {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}
async function del(path: string) {
  const res = await fetch(`${base}${path}`, { method: "DELETE" });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}

let seedSeq = 0;
function seedCard(userId: string, over: Record<string, unknown> = {}) {
  seedSeq += 1;
  const row = {
    id: `99999999-9999-4999-8999-${String(seedSeq).padStart(12, "0")}`,
    userId,
    jobId: `job-${seedSeq}`,
    style: "out-now",
    size: "1:1",
    storageRef: `r2://generated-clips/promo-cards/${userId}/job-${seedSeq}/out-now-1x1.png`,
    releaseTitle: "Midnight Gold",
    artistName: "Lil Nova",
    caption: "OUT NOW",
    width: 1080,
    height: 1080,
    platforms: ["instagram", "facebook"],
    createdAt: new Date(Date.UTC(2026, 0, seedSeq)),
    ...over,
  };
  h.fake.seed("promoCards", [row]);
  return row;
}

/* ─── The record step ─────────────────────────────────────────────── */

describe("recordPromoCardPack", () => {
  it("writes one row per card for the owner and returns ids in card order", async () => {
    const ids = await recordPromoCardPack({
      userId: ME,
      jobId: "job-abc",
      releaseTitle: "Midnight Gold",
      artistName: "Lil Nova",
      caption: "OUT NOW — streaming everywhere",
      cards: [
        { style: "out-now", size: "1:1", storageRef: "r2://generated-clips/promo-cards/x/1.png", width: 1080, height: 1080, platforms: ["instagram"] },
        { style: "out-now", size: "9:16", storageRef: "r2://generated-clips/promo-cards/x/2.png", width: 1080, height: 1920, platforms: ["tiktok"] },
      ],
    });
    expect(ids).toHaveLength(2);
    expect(ids.every((id) => typeof id === "string" && id.length > 0)).toBe(true);

    const store = h.fake.store("promoCards");
    expect(store.rows).toHaveLength(2);
    expect(store.rows.map((r: any) => r.id)).toEqual(ids);
    expect(store.rows[0]).toMatchObject({
      userId: ME, jobId: "job-abc", style: "out-now", size: "1:1",
      releaseTitle: "Midnight Gold", artistName: "Lil Nova",
      caption: "OUT NOW — streaming everywhere",
    });
    expect(store.rows[1].size).toBe("9:16");
  });

  it("an empty pack records nothing and returns no ids", async () => {
    const ids = await recordPromoCardPack({
      userId: ME, jobId: "job-empty", releaseTitle: "T", artistName: "A", caption: null, cards: [],
    });
    expect(ids).toEqual([]);
    expect(h.fake.store("promoCards").rows).toHaveLength(0);
  });
});

/* ─── The history list ────────────────────────────────────────────── */

describe("GET /promo-cards (history)", () => {
  it("lists ONLY the caller's cards, newest first, URLs minted from refs", async () => {
    const older = seedCard(ME);
    const newer = seedCard(ME, { style: "milestone", size: "16:9", width: 1920, height: 1080 });
    seedCard(OTHER);
    seedCard(OTHER);

    const { status, body } = await get("/promo-cards");
    expect(status).toBe(200);
    expect(body.cards.map((c: any) => c.id)).toEqual([newer.id, older.id]);
    expect(body.cards[0]).toMatchObject({
      style: "milestone",
      size: "16:9",
      releaseTitle: "Midnight Gold",
      artistName: "Lil Nova",
      caption: "OUT NOW",
      width: 1920,
      height: 1080,
      platforms: ["instagram", "facebook"],
    });
    /* The DTO URL is minted from the stable storage ref at read time. */
    expect(body.cards[0].url).toBe(`https://playable.test/${newer.storageRef}`);
    expect(body.cards[0].createdAt).toBe(newer.createdAt.toISOString());
    expect(body.limit).toBe(50);
    expect(body.hasMore).toBe(false);
  });

  it("a member with no cards gets a successful empty read, not an error", async () => {
    seedCard(OTHER);
    const { status, body } = await get("/promo-cards");
    expect(status).toBe(200);
    expect(body.cards).toEqual([]);
    expect(body.hasMore).toBe(false);
  });

  it("the page bound is stated and enforced: limit applies, hasMore is honest, the cap is 100", async () => {
    seedCard(ME);
    seedCard(ME);
    seedCard(ME);

    const page = await get("/promo-cards?limit=2");
    expect(page.status).toBe(200);
    expect(page.body.cards).toHaveLength(2);
    expect(page.body.limit).toBe(2);
    expect(page.body.hasMore).toBe(true);

    const capped = await get("/promo-cards?limit=500");
    expect(capped.body.limit).toBe(100);
    expect(capped.body.cards).toHaveLength(3);
    expect(capped.body.hasMore).toBe(false);

    const junk = await get("/promo-cards?limit=banana");
    expect(junk.body.limit).toBe(50);
  });
});

/* ─── Delete ──────────────────────────────────────────────────────── */

describe("DELETE /promo-cards/:id", () => {
  it("deletes the caller's own card row; it leaves the list", async () => {
    const mine = seedCard(ME);
    const keep = seedCard(ME);

    const res = await del(`/promo-cards/${mine.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, id: mine.id });

    const store = h.fake.store("promoCards");
    expect(store.rows.map((r: any) => r.id)).toEqual([keep.id]);

    const list = await get("/promo-cards");
    expect(list.body.cards.map((c: any) => c.id)).toEqual([keep.id]);
  });

  it("another member's card is a 404 and the row survives", async () => {
    const theirs = seedCard(OTHER);

    const res = await del(`/promo-cards/${theirs.id}`);
    expect(res.status).toBe(404);

    const store = h.fake.store("promoCards");
    expect(store.rows.map((r: any) => r.id)).toEqual([theirs.id]);

    /* And the owner still sees it in their own history. */
    h.userId = OTHER;
    const list = await get("/promo-cards");
    expect(list.body.cards.map((c: any) => c.id)).toEqual([theirs.id]);
  });

  it("a card that never existed — or a malformed id — is the same 404", async () => {
    seedCard(ME);
    const ghost = await del("/promo-cards/99999999-9999-4999-8999-999999999999");
    expect(ghost.status).toBe(404);
    const malformed = await del("/promo-cards/not-a-card");
    expect(malformed.status).toBe(404);
    expect(h.fake.store("promoCards").rows).toHaveLength(1);
  });
});
