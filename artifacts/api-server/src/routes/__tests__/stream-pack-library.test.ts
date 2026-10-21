/**
 * Stream-pack library + studio tray (Ring 4 follow-on: the apply path) —
 * route tests on the REAL mounted stream-pack router over the house
 * fake db.
 *
 *  - A successful POST /stream-pack/generate records the graphic on
 *    the generations rail as the maker's own stream-pack record (the
 *    record is the ownership proof — there is no pack table).
 *  - GET /api/stream-pack/mine lists ONLY the caller's pack graphics,
 *    newest first, with playable URLs minted fresh from each record's
 *    stable storage ref — never the stored (stale) URL.
 *  - POST /api/stream-pack/apply flips the record's appliedToStudio
 *    flag, preserving the rest of its metadata; the flag reads back
 *    through /mine (the other surface's read). Unapply flips it back.
 *  - Another member's id, a non-pack generation, a soft-deleted
 *    record, and an unknown id all answer the same 404 on apply.
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
    req.userCredits = 100_000;
    next();
  },
}));

vi.mock("../../lib/credits", () => ({
  chargeCredits: vi.fn(async () => 99_900),
  LedgerWriteError: class LedgerWriteError extends Error {},
}));

vi.mock("../../lib/ai-clients", () => ({
  getOpenAI: () => ({
    images: {
      generate: async () => ({ data: [{ b64_json: "aGVsbG8=" }] }),
    },
  }),
}));

vi.mock("../../lib/objectStorage", () => ({
  uploadMediaToSupabaseStorage: vi.fn(async () => "stream-packs/test/ref.png"),
  /* The playable URL is minted from the stable ref at read time;
     making the mint obvious proves /mine never serves a stored URL. */
  refreshSupabaseStorageUrl: async (ref: string) => `https://minted.test/${ref}`,
  normalizeToStorageRef: (v: string) => v,
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { createFakeDb } = await import("./_reach-fake-db");
  const fake = createFakeDb({
    generations: actual.generationsTable,
  });
  h.fake = fake;
  return { ...actual, db: fake.db };
});

import streamPackRouter from "../generate/stream-pack";

let base = "";
let server: ReturnType<express.Express["listen"]>;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    next();
  });
  app.use(streamPackRouter);
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
async function post(path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}

let seedSeq = 0;
function seedPack(userId: string, over: Record<string, unknown> = {}) {
  seedSeq += 1;
  const row = {
    id: `99999999-9999-4999-8999-${String(seedSeq).padStart(12, "0")}`,
    user_id: userId,
    type: "image",
    title: "Stream Pack: Webcam Frame",
    file_url: "https://stale.test/old.png",
    thumbnail_url: null,
    prompt: "prompt",
    credits_spent: 100,
    metadata: {
      kind: "stream-pack",
      assetKey: "webcam-frame",
      label: "Webcam Frame",
      themeId: "gold-luxury",
      channelName: "Nova",
      storagePath: `stream-packs/${userId}/seed-${seedSeq}.png`,
      appliedToStudio: false,
    },
    artist_vault_id: null,
    created_at: new Date(Date.UTC(2026, 0, seedSeq)),
    deleted_at: null,
    ...over,
  };
  h.fake.seed("generations", [row]);
  return row;
}

/* ─── The record step ─────────────────────────────────────────────── */

describe("generate records the graphic in the maker's library", () => {
  it("writes a generations row the maker owns, readable via /mine", async () => {
    const res = await post("/stream-pack/generate", {
      channelName: "Nova",
      theme: "gold-luxury",
      asset: "webcam-frame",
    });
    expect(res.status).toBe(200);
    expect(res.body.url).toBe("https://minted.test/stream-packs/test/ref.png");

    /* saveGeneration is fire-and-forget — wait for the row to land. */
    await vi.waitFor(() => {
      expect(h.fake.store("generations").rows).toHaveLength(1);
    });
    const row = h.fake.store("generations").rows[0];
    expect(row).toMatchObject({
      user_id: ME,
      type: "image",
      title: "Stream Pack: Webcam Frame",
      credits_spent: 100,
    });
    expect(row.metadata).toMatchObject({
      kind: "stream-pack",
      assetKey: "webcam-frame",
      themeId: "gold-luxury",
      channelName: "Nova",
      appliedToStudio: false,
    });

    const mine = await get("/stream-pack/mine");
    expect(mine.status).toBe(200);
    expect(mine.body.assets).toHaveLength(1);
    expect(mine.body.assets[0]).toMatchObject({
      assetKey: "webcam-frame",
      label: "Webcam Frame",
      appliedToStudio: false,
    });
  });
});

/* ─── /mine ───────────────────────────────────────────────────────── */

describe("GET /stream-pack/mine", () => {
  it("lists only the caller's pack graphics, newest first", async () => {
    const older = seedPack(ME);
    const newer = seedPack(ME, {
      metadata: {
        kind: "stream-pack",
        assetKey: "alert-follower",
        label: "New Follower Alert",
        themeId: "neon-cyber",
        channelName: "Nova",
        storagePath: "stream-packs/me/newer.png",
        appliedToStudio: true,
      },
    });
    seedPack(OTHER);
    seedPack(ME, { metadata: { kind: "song" }, title: "A song, not a pack" });
    seedPack(ME, { deleted_at: new Date() });

    const mine = await get("/stream-pack/mine");
    expect(mine.status).toBe(200);
    expect(mine.body.assets.map((a: any) => a.id)).toEqual([newer.id, older.id]);
    expect(mine.body.assets[0]).toMatchObject({
      assetKey: "alert-follower",
      appliedToStudio: true,
    });
  });

  it("mints the playable URL fresh from the storage ref, never the stored URL", async () => {
    const row = seedPack(ME);
    const mine = await get("/stream-pack/mine");
    expect(mine.body.assets[0].url).toBe(
      `https://minted.test/${(row.metadata as any).storagePath}`,
    );
    expect(mine.body.assets[0].url).not.toContain("stale.test");
  });

  it("is honestly empty for a member with no pack graphics", async () => {
    seedPack(OTHER);
    const mine = await get("/stream-pack/mine");
    expect(mine.status).toBe(200);
    expect(mine.body.assets).toEqual([]);
  });
});

/* ─── apply / unapply ─────────────────────────────────────────────── */

describe("POST /stream-pack/apply + /unapply", () => {
  it("apply flips the flag, preserves the record, and /mine reads it back", async () => {
    const row = seedPack(ME);
    const res = await post("/stream-pack/apply", { generationId: row.id });
    expect(res.status).toBe(200);
    expect(res.body.asset).toMatchObject({ id: row.id, appliedToStudio: true });

    const stored = h.fake.store("generations").rows.find((r: any) => r.id === row.id);
    expect(stored.metadata).toMatchObject({
      kind: "stream-pack",
      assetKey: "webcam-frame",
      storagePath: (row.metadata as any).storagePath,
      appliedToStudio: true,
    });

    const mine = await get("/stream-pack/mine");
    expect(mine.body.assets[0].appliedToStudio).toBe(true);

    const un = await post("/stream-pack/unapply", { generationId: row.id });
    expect(un.status).toBe(200);
    expect(un.body.asset.appliedToStudio).toBe(false);
    const mineAfter = await get("/stream-pack/mine");
    expect(mineAfter.body.assets[0].appliedToStudio).toBe(false);
  });

  it("another member's graphic cannot be applied — same 404, row untouched", async () => {
    const row = seedPack(OTHER);
    const res = await post("/stream-pack/apply", { generationId: row.id });
    expect(res.status).toBe(404);
    const stored = h.fake.store("generations").rows.find((r: any) => r.id === row.id);
    expect(stored.metadata.appliedToStudio).toBe(false);
  });

  it("a non-pack generation answers the same 404", async () => {
    const row = seedPack(ME, { metadata: { kind: "song" } });
    const res = await post("/stream-pack/apply", { generationId: row.id });
    expect(res.status).toBe(404);
  });

  it("a soft-deleted pack graphic answers the same 404", async () => {
    const row = seedPack(ME, { deleted_at: new Date() });
    const res = await post("/stream-pack/apply", { generationId: row.id });
    expect(res.status).toBe(404);
  });

  it("an unknown id answers the same 404", async () => {
    const res = await post("/stream-pack/apply", {
      generationId: "99999999-9999-4999-8999-000000000000",
    });
    expect(res.status).toBe(404);
  });

  it("a malformed body is a 400", async () => {
    const res = await post("/stream-pack/apply", {});
    expect(res.status).toBe(400);
  });
});
