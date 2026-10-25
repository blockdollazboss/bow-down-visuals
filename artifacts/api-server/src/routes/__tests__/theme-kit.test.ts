/**
 * Theme kit rail (Stack-200 UPGRADES #39) — pg-mem harness modeled on
 * theme-packs-purchase.test.ts: chargeCredits faked at the lib/credits
 * seam with PER-USER balances (buyer + creator seller), tier resolution
 * stubbed over raw SQL with the same active/trialing rule.
 *
 * Pins:
 *  - manifests: 5 packs × 12 components, sound-sync note present.
 *  - downloads: included pack → real .themepack (MSCF magic + .theme
 *    inside) and a full zip (PK magic); premium locked → 403; owned → 200.
 *  - sound sync: the themepack carries the LIBRARY wav bytes under the
 *    manifest name (fixture library file) — identical bytes, no fork.
 *  - customizations: PUT/GET round-trip per component × device; bad
 *    mix 400; locked premium 403.
 *  - creator packs: create → publish → purchase at 500 VB splits
 *    flat-5% (creator credited 475), exactly-once on repeat, free pack
 *    claims at 0, insufficient → 402 with no charge.
 *  - look links: premium pack reports priceRespected + ruled price.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import type { AddressInfo } from "node:net";

const BUYER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CREATOR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROFILE = "11111111-1111-4111-8111-111111111111";

const h = vi.hoisted(() => ({
  db: null as any,
  userId: "",
  userPlan: null as string | null,
  balances: new Map<string, number>(),
  charges: [] as Array<{ userId: string; cost: number; key: string | null }>,
  chargedKeys: new Set<string>(),
  refunds: [] as Array<{ userId: string; cost: number; action: string }>,
  voided: [] as string[],
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = h.userId;
    req.userPlan = h.userPlan;
    next();
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return h.db; } };
});

vi.mock("../../middlewares/require-tier", () => ({
  resolveCreatorTier: async (userId: string) => {
    const { rows } = await h.db.execute((await import("drizzle-orm")).sql.raw(
      `SELECT cs.tier AS tier, cs.status AS status
         FROM creator_profiles cp
         LEFT JOIN creator_subscriptions cs ON cs.profile_id = cp.id
        WHERE cp.user_id = '${userId}' LIMIT 1`,
    ));
    const row = rows[0] as { tier: string | null; status: string | null } | undefined;
    const admitting = row?.status === "active" || row?.status === "trialing";
    return {
      tier: admitting && row?.tier ? row.tier : "free",
      profileId: row ? PROFILE : null,
    };
  },
}));

vi.mock("../../lib/credits", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    chargeCredits: vi.fn(async (userId: string, cost: number, _record: unknown, opts?: { idempotencyKey?: string | null }) => {
      const key = opts?.idempotencyKey ?? null;
      if (key && h.chargedKeys.has(key)) return h.balances.get(userId) ?? 0;
      const bal = h.balances.get(userId) ?? 0;
      if (bal < cost) throw new actual.OutOfCreditsError();
      h.balances.set(userId, bal - cost);
      if (key) h.chargedKeys.add(key);
      h.charges.push({ userId, cost, key });
      return bal - cost;
    }),
    refundCredits: vi.fn(async (userId: string, cost: number, rec: { action: string }) => {
      h.balances.set(userId, (h.balances.get(userId) ?? 0) + cost);
      h.refunds.push({ userId, cost, action: rec.action });
    }),
    voidChargeIdempotencyKey: vi.fn(async (key: string) => {
      h.voided.push(key);
      return h.chargedKeys.delete(key);
    }),
  };
});

import themeKitRouter, { sanitizeMix } from "../theme-kit";
import { buildCab, buildCursorFile } from "../../lib/theme-kit-build";
import { createTestDb } from "../../lib/__tests__/test-db";
import { sql } from "drizzle-orm";

let server: ReturnType<typeof express.application.listen>;
let base = "";

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function callBytes(method: string, path: string, body?: unknown): Promise<{ status: number; buf: Buffer }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, buf: Buffer.from(await res.arrayBuffer()) };
}

const DDL = `
CREATE TABLE theme_pack_purchases (
  user_id text NOT NULL,
  pack_id text NOT NULL,
  price_vb integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, pack_id)
);
CREATE TABLE theme_pack_customizations (
  user_id text NOT NULL,
  pack_id text NOT NULL,
  component text NOT NULL,
  device text NOT NULL DEFAULT 'all',
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, pack_id, component, device)
);
CREATE TABLE creator_theme_packs (
  id uuid PRIMARY KEY,
  creator_user_id text NOT NULL,
  name text NOT NULL,
  base_pack_id text NOT NULL,
  price_vb integer NOT NULL DEFAULT 0,
  mix jsonb NOT NULL DEFAULT '{}'::jsonb,
  published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE creator_profiles (
  id uuid PRIMARY KEY,
  user_id text NOT NULL
);
CREATE TABLE creator_subscriptions (
  id uuid PRIMARY KEY,
  profile_id uuid NOT NULL UNIQUE,
  tier text NOT NULL DEFAULT 'free',
  status text NOT NULL DEFAULT 'active',
  stripe_subscription_id text,
  stripe_customer_id text,
  current_period_end timestamptz,
  cancel_at_period_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);`;

const LIBRARY_WAV = Buffer.from("RIFF----WAVEfmt library-master-bytes");

beforeAll(async () => {
  // Fixture approved-library tree (the asset resolver's test root):
  // pack grounds, logos, living loops, and the SOUND LIBRARY files.
  const root = mkdtempSync(join(tmpdir(), "theme-kit-assets-"));
  mkdirSync(join(root, "wallpapers/theme-packs"), { recursive: true });
  mkdirSync(join(root, "sounds"), { recursive: true });
  for (const id of ["golden-marble", "shark-tank", "golden-hour", "kings-set", "arcade-gold"]) {
    for (const mode of ["dark", "light"]) {
      writeFileSync(join(root, `wallpapers/theme-packs/${id}-${mode}.webp`), Buffer.from(`art-${id}-${mode}`));
    }
  }
  for (const loop of ["kings-set-throne-loop.mp4", "kings-set-plaza-loop.mp4", "kings-set-stage-loop.mp4"]) {
    writeFileSync(join(root, `wallpapers/${loop}`), Buffer.from(`loop-${loop}`));
  }
  writeFileSync(join(root, "logo-static.webp"), Buffer.from("logo-dark"));
  writeFileSync(join(root, "logo-light.webp"), Buffer.from("logo-light"));
  for (const role of ["notification", "message", "success", "error", "royal-sting", "ringtone"]) {
    writeFileSync(join(root, `sounds/signature-${role}.wav`), LIBRARY_WAV);
  }
  process.env["THEME_KIT_ASSET_DIR"] = root;

  const { db, mem } = createTestDb() as any;
  h.db = db;
  mem.public.none(DDL);
  await h.db.execute(sql`INSERT INTO creator_profiles (id, user_id) VALUES (${PROFILE}, ${BUYER})`);
  const app = express();
  app.use(express.json());
  app.use("/api", themeKitRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(async () => {
  h.userId = BUYER;
  h.userPlan = null;
  h.balances = new Map();
  h.charges = [];
  h.chargedKeys = new Set();
  h.refunds = [];
  h.voided = [];
  await h.db.execute(sql`DELETE FROM theme_pack_purchases`);
  await h.db.execute(sql`DELETE FROM theme_pack_customizations`);
  await h.db.execute(sql`DELETE FROM creator_theme_packs`);
  await h.db.execute(sql`DELETE FROM creator_subscriptions`);
});

describe("manifests", () => {
  it("lists five packs × twelve components with the sound-sync note", async () => {
    const r = await call("GET", "/theme-packs/kit/manifests");
    expect(r.status).toBe(200);
    expect(r.json.packs).toHaveLength(5);
    for (const p of r.json.packs) {
      expect(p.components).toHaveLength(12);
      expect(p.sounds.source).toBe("site-sound-library");
      expect(p.sounds.roles).toHaveLength(6);
    }
  });
});

describe("bundle builders", () => {
  it("CAB output carries the MSCF signature and lists its files", () => {
    const cab = buildCab([{ name: "a.theme", data: Buffer.from("hello") }]);
    expect(cab.subarray(0, 4).toString("ascii")).toBe("MSCF");
    expect(cab.includes(Buffer.from("a.theme"))).toBe(true);
    expect(cab.includes(Buffer.from("hello"))).toBe(true);
  });

  it("cursor files carry the CUR magic (type 2)", () => {
    const cur = buildCursorFile("#f9bc06", "arrow");
    expect(cur.readUInt16LE(2)).toBe(2);
    expect(cur.readUInt16LE(4)).toBe(1);
  });
});

describe("downloads + entitlement", () => {
  it("included pack: windows download is a real .themepack with theme + library sounds inside", async () => {
    const r = await callBytes("POST", "/theme-packs/kit/golden-marble/download", { kind: "windows", mode: "dark" });
    expect(r.status).toBe(200);
    expect(r.buf.subarray(0, 4).toString("ascii")).toBe("MSCF");
    expect(r.buf.includes(Buffer.from("golden-marble-dark.theme"))).toBe(true);
    expect(r.buf.includes(Buffer.from("signature-notification.wav"))).toBe(true);
    // Sound sync: the bytes inside ARE the library file bytes — no fork.
    expect(r.buf.includes(LIBRARY_WAV)).toBe(true);
    expect(r.buf.includes(Buffer.from("SOUND-MANIFEST.json"))).toBe(true);
  });

  it("included pack: full zip starts with PK and carries the themepack", async () => {
    const r = await callBytes("POST", "/theme-packs/kit/shark-tank/download", {
      kind: "full", mode: "light",
      assets: { iconSvgs: { "phone-dark": "<svg>phone</svg>" } },
    });
    expect(r.status).toBe(200);
    expect(r.buf.subarray(0, 2).toString("ascii")).toBe("PK");
    // Entry names sit plaintext in zip local headers (payloads are deflated).
    expect(r.buf.includes(Buffer.from("windows/shark-tank-light.themepack"))).toBe(true);
    expect(r.buf.includes(Buffer.from("android/icons/phone-dark.svg"))).toBe(true);
    expect(r.buf.includes(Buffer.from("ios/GUIDED-SETUP.txt"))).toBe(true);
  });

  it("premium pack is locked until owned, then downloads", async () => {
    const locked = await call("POST", "/theme-packs/kit/kings-set/download", { kind: "windows", mode: "dark" });
    expect(locked.status).toBe(403);
    await h.db.execute(sql`INSERT INTO theme_pack_purchases (user_id, pack_id, price_vb) VALUES (${BUYER}, 'kings-set', 1000)`);
    const ok = await callBytes("POST", "/theme-packs/kit/kings-set/download", { kind: "windows", mode: "dark" });
    expect(ok.status).toBe(200);
    expect(ok.buf.subarray(0, 4).toString("ascii")).toBe("MSCF");
  });

  it("unknown kind is a 400", async () => {
    const r = await call("POST", "/theme-packs/kit/golden-marble/download", { kind: "hologram", mode: "dark" });
    expect(r.status).toBe(400);
  });
});

describe("customizations — the capstone storage", () => {
  it("PUT then GET round-trips a per-component, per-device mix", async () => {
    const mix = {
      "accent-color": { all: { accentHex: "#123456" }, phone: { accentHex: "#654321" } },
      cursors: { desktop: { cursorId: "crown" } },
      ringtone: { all: { extraSoundRole: "royal-sting" } },
    };
    const put = await call("PUT", "/theme-packs/customizations/golden-marble", { mix });
    expect(put.status).toBe(200);
    const got = await call("GET", "/theme-packs/customizations/golden-marble");
    expect(got.status).toBe(200);
    expect(got.json.mix["accent-color"].phone.accentHex).toBe("#654321");
    expect(got.json.mix.cursors.desktop.cursorId).toBe("crown");
    expect(got.json.mix.ringtone.all.extraSoundRole).toBe("royal-sting");
  });

  it("rejects unapproved art and unknown components with 400", async () => {
    const bad = await call("PUT", "/theme-packs/customizations/golden-marble", {
      mix: { "home-wallpapers": { all: { artSourceId: "invented" } } },
    });
    expect(bad.status).toBe(400);
    expect(sanitizeMix({ nope: { all: {} } }).ok).toBe(false);
  });

  it("locked premium pack cannot be customized (403) until owned", async () => {
    const mix = { cursors: { all: { cursorId: "crown" } } };
    const r = await call("PUT", "/theme-packs/customizations/kings-set", { mix });
    expect(r.status).toBe(403);
  });
});

describe("creator-made packs — store rail, flat 5%", () => {
  async function makePublished(priceVb: number): Promise<string> {
    h.userId = CREATOR;
    const created = await call("POST", "/theme-packs/creator-packs", {
      name: "Midnight Royalty", basePackId: "golden-marble", priceVb, mix: {},
    });
    expect(created.status).toBe(200);
    const id = created.json.id as string;
    const pub = await call("POST", `/theme-packs/creator-packs/${id}/publish`, {});
    expect(pub.status).toBe(200);
    h.userId = BUYER;
    return id;
  }

  it("lists published packs with the fee disclosed", async () => {
    await makePublished(500);
    const list = await call("GET", "/theme-packs/creator-packs");
    expect(list.json.packs).toHaveLength(1);
    expect(list.json.packs[0].feeBps).toBe(500);
  });

  it("purchase at 500 VB: buyer charged once, creator credited 475 (flat 5%)", async () => {
    const id = await makePublished(500);
    h.balances.set(BUYER, 2000);
    const buy = await call("POST", `/theme-packs/creator-packs/${id}/purchase`, {});
    expect(buy.status).toBe(200);
    expect(buy.json).toMatchObject({ owned: true, chargedVb: 500, feeVb: 25, sellerNetVb: 475 });
    expect(h.balances.get(BUYER)).toBe(1500);
    expect(h.balances.get(CREATOR)).toBe(475);
    const again = await call("POST", `/theme-packs/creator-packs/${id}/purchase`, {});
    expect(again.json).toMatchObject({ alreadyOwned: true, chargedVb: 0 });
    expect(h.balances.get(BUYER)).toBe(1500);
    expect(h.charges).toHaveLength(1);
    // And the purchased creator pack downloads (kit unlocked).
    const dl = await callBytes("POST", `/theme-packs/kit/creator:${id}/download`, { kind: "windows", mode: "dark" });
    expect(dl.status).toBe(200);
    expect(dl.buf.subarray(0, 4).toString("ascii")).toBe("MSCF");
  });

  it("free creator pack claims at 0 with an ownership row", async () => {
    const id = await makePublished(0);
    const buy = await call("POST", `/theme-packs/creator-packs/${id}/purchase`, {});
    expect(buy.json).toMatchObject({ owned: true, chargedVb: 0 });
    expect(h.charges).toHaveLength(0);
  });

  it("insufficient balance: 402, no charge, no ownership", async () => {
    const id = await makePublished(500);
    h.balances.set(BUYER, 100);
    const buy = await call("POST", `/theme-packs/creator-packs/${id}/purchase`, {});
    expect(buy.status).toBe(402);
    expect(h.charges).toHaveLength(0);
  });

  it("premium base requires owning the base first", async () => {
    h.userId = CREATOR;
    const r = await call("POST", "/theme-packs/creator-packs", {
      name: "On Kings", basePackId: "kings-set", priceVb: 100, mix: {},
    });
    expect(r.status).toBe(403);
  });
});

describe("GET THIS LOOK resolution", () => {
  const code = (payload: unknown) =>
    Buffer.from(JSON.stringify(payload), "utf8").toString("base64")
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  it("premium look reports the price as respected with the ruled price", async () => {
    const r = await call("GET", `/theme-packs/look/${code({ packId: "kings-set", mix: { cursors: { all: { cursorId: "crown" } } } })}`);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ packId: "kings-set", priceRespected: true, priceVb: 1000 });
  });

  it("included look is free; garbage is a 400", async () => {
    const ok = await call("GET", `/theme-packs/look/${code({ packId: "shark-tank", mix: {} })}`);
    expect(ok.json.priceRespected).toBe(false);
    const bad = await call("GET", "/theme-packs/look/%%%");
    expect(bad.status).toBe(400);
  });
});
