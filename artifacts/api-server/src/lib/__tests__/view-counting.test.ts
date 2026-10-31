/**
 * View-count dedup (stack1100 lane X5) — lib/view-counting unit pins
 * plus a door-level proof on the showcase read door.
 *
 * The counters this guards are pure counters (no row source): beats
 * plays, album / bio-page / showcase / content-plan views. Their
 * truth is their minting bound — one count per viewer per item per
 * 60s window, the play doors' house standard. Before the helper, a
 * refresh storm could mint unbounded views of the same item under
 * only the global 300/min limiter.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { shouldCountView, viewKey, resetViewCounting } from "../view-counting";

describe("shouldCountView — the minting bound", () => {
  beforeEach(() => resetViewCounting());

  it("counts the first view of an item from a viewer", () => {
    expect(shouldCountView(viewKey("showcase", "a", "1.1.1.1"), 1_000)).toBe(true);
  });

  it("refuses repeats inside the window, per viewer and per item", () => {
    const t = 1_000_000;
    expect(shouldCountView(viewKey("showcase", "a", "1.1.1.1"), t)).toBe(true);
    expect(shouldCountView(viewKey("showcase", "a", "1.1.1.1"), t + 30_000)).toBe(false);
    expect(shouldCountView(viewKey("showcase", "a", "1.1.1.1"), t + 59_999)).toBe(false);
    // A different item from the same viewer still counts.
    expect(shouldCountView(viewKey("showcase", "b", "1.1.1.1"), t + 1_000)).toBe(true);
    // The same item from a different viewer still counts.
    expect(shouldCountView(viewKey("showcase", "a", "2.2.2.2"), t + 1_000)).toBe(true);
    // A different surface with the same id is a different counter.
    expect(shouldCountView(viewKey("album", "a", "1.1.1.1"), t + 1_000)).toBe(true);
  });

  it("counts again once the window has passed", () => {
    const t = 5_000_000;
    expect(shouldCountView(viewKey("beat", "x", "1.1.1.1"), t)).toBe(true);
    expect(shouldCountView(viewKey("beat", "x", "1.1.1.1"), t + 60_000)).toBe(true);
    expect(shouldCountView(viewKey("beat", "x", "1.1.1.1"), t + 60_001)).toBe(false);
  });

  it("an unknown ip still dedups under its own key", () => {
    const t = 9_000_000;
    expect(shouldCountView(viewKey("beat", "x", undefined), t)).toBe(true);
    expect(shouldCountView(viewKey("beat", "x", undefined), t + 1_000)).toBe(false);
  });
});

/* ─── Door-level proof: GET /showcase/:slug ─────────────────────── */

const h = vi.hoisted(() => {
  process.env["DATABASE_URL"] = "postgres://test:test@localhost:5432/test";
  process.env["SUPABASE_URL"] = "http://localhost";
  process.env["SUPABASE_SERVICE_ROLE_KEY"] = "test";
  return { db: null as any, mem: null as any };
});

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const u = req.headers["x-test-user"];
    if (!u) return res.status(401).json({ error: "Unauthorized" });
    req.userId = String(u);
    next();
  },
}));
vi.mock("../mirrorMedia", () => ({
  mirrorExternalMediaUrl: async (v: unknown) => v,
}));
vi.mock("../objectStorage", () => ({
  refreshSupabaseStorageUrl: (u: any) => u,
  refreshSupabaseStorageUrlsDeep: (v: any) => v,
  isStorageRef: () => false,
}));
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return h.db; } };
});

import { createTestDb } from "./test-db";
import showcaseRouter from "../../routes/showcase";

const ITEM = "22222222-2222-4222-8222-2222222222c1";
const USER = "00000000-0000-4000-8000-0000000000a1";
const DDL = `
CREATE TABLE showcase_items (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, slug text NOT NULL UNIQUE,
  title text NOT NULL, description text NOT NULL DEFAULT '',
  media_type text NOT NULL DEFAULT 'image', media_url text NOT NULL,
  thumbnail_url text, creator_name text NOT NULL DEFAULT 'Anonymous Creator',
  likes integer NOT NULL DEFAULT 0, views integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE showcase_likes (
  item_id uuid NOT NULL, voter_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now());
`;

let server: any;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { error: () => {}, info: () => {}, warn: () => {} };
    next();
  });
  app.use("/api", showcaseRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe("GET /showcase/:slug — a refresh storm mints one view (stack1100 X5)", () => {
  beforeEach(() => {
    const t = createTestDb();
    h.db = t.db;
    h.mem = t.mem;
    h.mem.public.none(DDL);
    h.mem.public.none(`
      INSERT INTO showcase_items (id, user_id, slug, title, media_url, views)
      VALUES ('${ITEM}', '${USER}', 'my-item', 'My Item', 'https://x/i.png', 10);
    `);
    resetViewCounting();
  });

  it("first read counts, immediate re-reads don't, and the echo matches what landed", async () => {
    const get = async () => {
      const res = await fetch(`${base}/showcase/my-item`);
      return { status: res.status, body: await res.json().catch(() => ({})) };
    };
    const first = await get();
    expect(first.status).toBe(200);
    expect(first.body.item.views).toBe(11);
    const second = await get();
    expect(second.status).toBe(200);
    // The echo no longer claims a +1 that never landed.
    expect(second.body.item.views).toBe(11);
    // Let the fire-and-forget bump settle, then read the store.
    await new Promise((r) => setTimeout(r, 25));
    const rows = h.mem.public.many(`SELECT views FROM showcase_items WHERE id = '${ITEM}';`);
    expect(rows[0].views).toBe(11);
  });
});
