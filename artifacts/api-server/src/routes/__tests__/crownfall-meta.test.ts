/**
 * Crownfall Run — prestige meta server home (join19, migration 0336).
 *
 *  - The pure core (lib/crownfall-meta.ts): sanitize clamps any
 *    untrusted shape into a valid meta; the merge is MONOTONIC, so
 *    progress only ever rises.
 *  - The HTTP layer (routes/crownfall.ts GET/PUT
 *    /arcade/crownfall/meta): a member's meta persists on their
 *    account — save, reload, and the tier is intact; a stale device
 *    syncing late can never roll it back; members never see or move
 *    each other's meta.
 *
 * No credits module exists anywhere in this stack — prestige is
 * power + status only and carries no Visual Bucs.
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

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../lib/supabase-admin", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        in: async (_col: string, ids: string[]) => ({ data: [] as { id: string }[] }),
      }),
    }),
  }),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { createFakeDb } = await import("./_reach-fake-db");
  const fake = createFakeDb({
    creatorProfiles: actual.creatorProfilesTable,
    arcadeScores: actual.arcadeScoresTable,
    retentionPrefs: actual.retentionPrefsTable,
    crownfallMeta: actual.crownfallMetaTable,
  });
  h.fake = fake;
  return { ...actual, db: fake.db };
});

import crownfallRouter from "../crownfall";
import {
  CROWNFALL_META_DEFAULTS,
  mergeCrownfallMeta,
  sanitizeCrownfallMeta,
} from "../../lib/crownfall-meta";

/* ─── HTTP boot ────────────────────────────────────────────────────── */

let base = "";
let server: ReturnType<express.Express["listen"]>;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(crownfallRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
});
beforeEach(() => {
  h.fake.clear();
  h.userId = ME;
});

async function put(path: string, body: unknown) {
  const res = await fetch(`${base}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}
async function get(path: string) {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}

const META_PATH = "/arcade/crownfall/meta";

/* ─── The pure core ────────────────────────────────────────────────── */

describe("crownfall meta: sanitize + monotonic merge", () => {
  it("sanitize clamps the tier, floors the counters, filters achievements", () => {
    const m = sanitizeCrownfallMeta({
      tier: 99,
      lifetimeKills: -5,
      lifetimeBossKills: 3.9,
      bestDepth: 12,
      achievements: ["centurion", "bogus-id", 42, "centurion"],
      lastBountyDay: "yesterday",
    });
    expect(m.tier).toBe(10);
    expect(m.lifetimeKills).toBe(0);
    expect(m.lifetimeBossKills).toBe(3);
    expect(m.bestDepth).toBe(12);
    expect(m.achievements).toEqual(["centurion"]);
    expect(m.lastBountyDay).toBe("");
    expect(sanitizeCrownfallMeta(null)).toEqual(CROWNFALL_META_DEFAULTS);
    expect(sanitizeCrownfallMeta("junk")).toEqual(CROWNFALL_META_DEFAULTS);
  });

  it("the merge only ever rises: max counters, union achievements, later bounty day", () => {
    const stored = sanitizeCrownfallMeta({
      tier: 3, lifetimeKills: 500, lifetimeBossKills: 4, bestDepth: 9,
      achievements: ["first-crown"], lastBountyDay: "2026-11-09",
    });
    const stale = sanitizeCrownfallMeta({
      tier: 1, lifetimeKills: 120, lifetimeBossKills: 9, bestDepth: 4,
      achievements: ["centurion"], lastBountyDay: "2026-11-08",
    });
    const merged = mergeCrownfallMeta(stored, stale);
    expect(merged.tier).toBe(3);
    expect(merged.lifetimeKills).toBe(500);
    expect(merged.lifetimeBossKills).toBe(9);
    expect(merged.bestDepth).toBe(9);
    expect(merged.achievements).toEqual(["first-crown", "centurion"]);
    expect(merged.lastBountyDay).toBe("2026-11-09");
  });
});

/* ─── The routes ───────────────────────────────────────────────────── */

describe("crownfall meta HTTP: the server home", () => {
  it("a new member's meta is the honest default — nothing invented", async () => {
    const { status, body } = await get(META_PATH);
    expect(status).toBe(200);
    expect(body.meta).toEqual(CROWNFALL_META_DEFAULTS);
  });

  it("save → reload → the tier is intact on the account", async () => {
    const saved = await put(META_PATH, {
      tier: 2, lifetimeKills: 137, lifetimeBossKills: 1, bestDepth: 6,
      achievements: ["first-crown"], lastBountyDay: "2026-11-10",
    });
    expect(saved.status).toBe(200);
    expect(saved.body.meta.tier).toBe(2);

    const reloaded = await get(META_PATH);
    expect(reloaded.status).toBe(200);
    expect(reloaded.body.meta).toEqual({
      tier: 2, lifetimeKills: 137, lifetimeBossKills: 1, bestDepth: 6,
      achievements: ["first-crown"], lastBountyDay: "2026-11-10",
    });
  });

  it("a stale device can never roll progress back (the fold is monotonic)", async () => {
    await put(META_PATH, {
      tier: 3, lifetimeKills: 500, lifetimeBossKills: 4, bestDepth: 9,
      achievements: ["first-crown"], lastBountyDay: "2026-11-09",
    });
    const stale = await put(META_PATH, {
      tier: 1, lifetimeKills: 120, lifetimeBossKills: 4, bestDepth: 2,
      achievements: [], lastBountyDay: "2026-11-01",
    });
    expect(stale.body.meta.tier).toBe(3);
    expect(stale.body.meta.lifetimeKills).toBe(500);
    expect(stale.body.meta.bestDepth).toBe(9);
    const reloaded = await get(META_PATH);
    expect(reloaded.body.meta.tier).toBe(3);
    expect(reloaded.body.meta.achievements).toEqual(["first-crown"]);
  });

  it("two devices converge: achievements union, counters take the max", async () => {
    await put(META_PATH, {
      tier: 1, lifetimeKills: 90, lifetimeBossKills: 1, bestDepth: 5,
      achievements: ["first-crown"], lastBountyDay: "",
    });
    const second = await put(META_PATH, {
      tier: 1, lifetimeKills: 140, lifetimeBossKills: 1, bestDepth: 3,
      achievements: ["centurion"], lastBountyDay: "2026-11-10",
    });
    expect(second.body.meta.lifetimeKills).toBe(140);
    expect(second.body.meta.bestDepth).toBe(5);
    expect(second.body.meta.achievements).toEqual(["first-crown", "centurion"]);
    expect(second.body.meta.lastBountyDay).toBe("2026-11-10");
  });

  it("forged values are sanitized at the door, never stored raw", async () => {
    const forged = await put(META_PATH, {
      tier: 99, lifetimeKills: -50, lifetimeBossKills: 2, bestDepth: 7,
      achievements: ["centurion", "made-up-id"], lastBountyDay: "not-a-date",
    });
    expect(forged.body.meta.tier).toBe(10);
    expect(forged.body.meta.lifetimeKills).toBe(0);
    expect(forged.body.meta.achievements).toEqual(["centurion"]);
    expect(forged.body.meta.lastBountyDay).toBe("");
  });

  it("one member's meta is never another's", async () => {
    await put(META_PATH, {
      tier: 4, lifetimeKills: 800, lifetimeBossKills: 6, bestDepth: 11,
      achievements: ["prestigious"], lastBountyDay: "2026-11-10",
    });
    h.userId = OTHER;
    const other = await get(META_PATH);
    expect(other.body.meta).toEqual(CROWNFALL_META_DEFAULTS);
    const otherSave = await put(META_PATH, {
      tier: 1, lifetimeKills: 12, lifetimeBossKills: 0, bestDepth: 2,
      achievements: [], lastBountyDay: "",
    });
    expect(otherSave.body.meta.tier).toBe(1);
    h.userId = ME;
    const mine = await get(META_PATH);
    expect(mine.body.meta.tier).toBe(4);
    expect(mine.body.meta.lifetimeKills).toBe(800);
  });
});
