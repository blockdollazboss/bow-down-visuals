/**
 * Theme kit — the bundle builders consume the STORED customization mix
 * (stack1200 theme-kit-mix lane).
 *
 * The defect these tests bite: a member saves a mix (PUT
 * /theme-packs/customizations/:packId) — or a creator designs a pack
 * with a mix (creator_theme_packs.mix) — and the downloaded kit ignored
 * it entirely, building from the pack's static defaults instead. The
 * route's own comment promises creator packs download "wearing the
 * mix"; the purchase copy promises the same. These tests pin:
 *
 *  - the saved accent (accent-color component) drives the .themepack's
 *    theme-text colorization AND its cursors;
 *  - a component accent (cursors) drives only that component's files;
 *  - home/lock wallpaper art choices (artSourceId, approved library)
 *    ship in the matching zip slots — per device, stills and living
 *    loops — while untouched slots keep the pack ground;
 *  - a creator pack download wears the CREATOR's stored mix, never
 *    the buyer's own customization of the base pack;
 *  - an unrelated mix entry (sound roles) changes nothing in the kit.
 *
 * Harness mirrors theme-kit.test.ts (pg-mem + fixture asset tree).
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import express from "express";
import type { AddressInfo } from "node:net";

const BUYER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CREATOR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const h = vi.hoisted(() => ({ db: null as any, userId: "" }));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = h.userId;
    req.userPlan = null;
    next();
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return h.db; } };
});

vi.mock("../../middlewares/require-tier", () => ({
  resolveCreatorTier: async () => ({ tier: "free", profileId: null }),
}));

vi.mock("../../lib/credits", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    chargeCredits: vi.fn(async () => 0),
    refundCredits: vi.fn(async () => undefined),
    voidChargeIdempotencyKey: vi.fn(async () => true),
  };
});

import themeKitRouter from "../theme-kit";
import { buildCursorFile, hslToHex, serverPackById } from "../../lib/theme-kit-build";
import { DESIGNED_ICON_NAMES } from "../../lib/theme-kit-build";
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

/** Minimal zip reader: central directory → entry bytes (deflate or
    stored). Test-only; archiver writes method 8 with zlib level 9. */
function unzipEntries(buf: Buffer): Map<string, Buffer> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  expect(eocd, "zip EOCD present").toBeGreaterThanOrEqual(0);
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  for (let n = 0; n < count; n++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const comp = buf.subarray(dataStart, dataStart + compSize);
    out.set(name, method === 8 ? inflateRawSync(comp) : Buffer.from(comp));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** The .theme ColorizationColor integer for a #rrggbb accent. */
function colorizationOf(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return (b << 16) | (g << 8) | r;
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
const PACK_IDS = ["golden-marble", "shark-tank", "golden-hour", "kings-set", "arcade-gold"];

beforeAll(async () => {
  const root = mkdtempSync(join(tmpdir(), "theme-kit-mix-assets-"));
  mkdirSync(join(root, "wallpapers/theme-packs/devices"), { recursive: true });
  mkdirSync(join(root, "sounds"), { recursive: true });
  mkdirSync(join(root, "theme-packs/app-icons"), { recursive: true });
  for (const id of PACK_IDS) {
    mkdirSync(join(root, `theme-packs/icons/${id}`), { recursive: true });
    for (const mode of ["dark", "light"]) {
      writeFileSync(join(root, `wallpapers/theme-packs/${id}-${mode}.webp`), Buffer.from(`art-${id}-${mode}`));
      writeFileSync(join(root, `theme-packs/app-icons/${id}-${mode}.webp`), Buffer.from(`appicon-${id}-${mode}`));
      for (const device of ["phone", "tablet", "desktop"]) {
        writeFileSync(join(root, `wallpapers/theme-packs/devices/${id}-${mode}-${device}.webp`), Buffer.from(`device-${id}-${mode}-${device}`));
      }
      for (const icon of DESIGNED_ICON_NAMES) {
        writeFileSync(join(root, `theme-packs/icons/${id}/${icon}-${mode}.webp`), Buffer.from(`icon-${id}-${icon}-${mode}`));
      }
    }
  }
  for (const loop of ["kings-set-throne-loop.mp4", "kings-set-plaza-loop.mp4", "kings-set-stage-loop.mp4"]) {
    writeFileSync(join(root, `wallpapers/${loop}`), Buffer.from(`loop-${loop}`));
  }
  for (const still of ["kings-set-throne-phone.webp", "kings-set-plaza-phone.webp", "kings-set-stage-desktop.webp"]) {
    writeFileSync(join(root, `wallpapers/${still}`), Buffer.from(`still-${still}`));
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
  await h.db.execute(sql`DELETE FROM theme_pack_purchases`);
  await h.db.execute(sql`DELETE FROM theme_pack_customizations`);
  await h.db.execute(sql`DELETE FROM creator_theme_packs`);
  await h.db.execute(sql`DELETE FROM creator_subscriptions`);
});

async function saveMix(packId: string, mix: unknown): Promise<void> {
  const r = await call("PUT", `/theme-packs/customizations/${packId}`, { mix });
  expect(r.status).toBe(200);
}

const GM_DARK_DEFAULT = () => hslToHex(serverPackById("golden-marble")!.colors.dark.primary);

describe("saved mix → house pack bundle", () => {
  it("accent-color mix drives the themepack's colorization AND cursors", async () => {
    await saveMix("golden-marble", { "accent-color": { all: { accentHex: "#123456" } } });
    const r = await callBytes("POST", "/theme-packs/kit/golden-marble/download", { kind: "windows", mode: "dark" });
    expect(r.status).toBe(200);
    expect(r.buf.includes(Buffer.from(`ColorizationColor=${colorizationOf("#123456")}`))).toBe(true);
    expect(r.buf.includes(buildCursorFile("#123456", "arrow"))).toBe(true);
    expect(r.buf.includes(buildCursorFile("#123456", "hand"))).toBe(true);
    // …and the pack default is nowhere in the theme text anymore.
    expect(r.buf.includes(Buffer.from(`ColorizationColor=${colorizationOf(GM_DARK_DEFAULT())}`))).toBe(false);
  });

  it("a cursors-only accent recolors the cursors but not the theme text", async () => {
    await saveMix("golden-marble", { cursors: { all: { accentHex: "#abcdef" } } });
    const r = await callBytes("POST", "/theme-packs/kit/golden-marble/download", { kind: "windows", mode: "dark" });
    expect(r.status).toBe(200);
    expect(r.buf.includes(buildCursorFile("#abcdef", "arrow"))).toBe(true);
    expect(r.buf.includes(Buffer.from(`ColorizationColor=${colorizationOf(GM_DARK_DEFAULT())}`))).toBe(true);
  });

  it("home-wallpapers art choice ships in every home slot; lock keeps the ground", async () => {
    await saveMix("golden-marble", { "home-wallpapers": { all: { artSourceId: "kings-set-throne-phone" } } });
    const r = await callBytes("POST", "/theme-packs/kit/golden-marble/download", { kind: "mac", mode: "dark" });
    expect(r.status).toBe(200);
    const entries = unzipEntries(r.buf);
    const still = Buffer.from("still-kings-set-throne-phone.webp");
    for (const mode of ["dark", "light"]) {
      expect(entries.get(`golden-marble-dark/mac/wallpaper-${mode}-original.webp`)).toEqual(still);
      for (const device of ["phone", "tablet", "desktop"]) {
        expect(entries.get(`golden-marble-dark/mac/wallpaper-${mode}-${device}.webp`)).toEqual(still);
        expect(entries.get(`golden-marble-dark/mac/lock-${mode}-${device}.webp`))
          .toEqual(Buffer.from(`device-golden-marble-${mode}-${device}`));
      }
    }
  });

  it("a per-device living-loop choice ships as that device's home wallpaper only", async () => {
    await saveMix("golden-marble", { "home-wallpapers": { phone: { artSourceId: "kings-set-throne-loop" } } });
    const r = await callBytes("POST", "/theme-packs/kit/golden-marble/download", { kind: "mac", mode: "dark" });
    expect(r.status).toBe(200);
    const entries = unzipEntries(r.buf);
    const loop = Buffer.from("loop-kings-set-throne-loop.mp4");
    for (const mode of ["dark", "light"]) {
      expect(entries.get(`golden-marble-dark/mac/wallpaper-${mode}-phone.mp4`)).toEqual(loop);
      expect(entries.has(`golden-marble-dark/mac/wallpaper-${mode}-phone.webp`)).toBe(false);
      expect(entries.get(`golden-marble-dark/mac/wallpaper-${mode}-tablet.webp`))
        .toEqual(Buffer.from(`device-golden-marble-${mode}-tablet`));
      expect(entries.get(`golden-marble-dark/mac/wallpaper-${mode}-original.webp`))
        .toEqual(Buffer.from(`art-golden-marble-${mode}`));
    }
  });

  it("lock-wallpapers art is independent of the home choice", async () => {
    await saveMix("golden-marble", { "lock-wallpapers": { all: { artSourceId: "kings-set-plaza-phone" } } });
    const r = await callBytes("POST", "/theme-packs/kit/golden-marble/download", { kind: "mac", mode: "dark" });
    expect(r.status).toBe(200);
    const entries = unzipEntries(r.buf);
    const still = Buffer.from("still-kings-set-plaza-phone.webp");
    expect(entries.get("golden-marble-dark/mac/lock-dark-phone.webp")).toEqual(still);
    expect(entries.get("golden-marble-dark/mac/lock-light-desktop.webp")).toEqual(still);
    expect(entries.get("golden-marble-dark/mac/wallpaper-dark-phone.webp"))
      .toEqual(Buffer.from("device-golden-marble-dark-phone"));
  });

  it("a cross-pack ground source (QC fix #13) saves and ships that pack's ground", async () => {
    // Before the fix the rail rejected pack-ground-* ids outright and
    // the builder had no path for them: only King's Set scenes could
    // ever be chosen. Shark Tank's ground must now ride a Golden
    // Marble kit exactly like a scene choice does.
    await saveMix("golden-marble", { "home-wallpapers": { all: { artSourceId: "pack-ground-shark-tank-dark" } } });
    const r = await callBytes("POST", "/theme-packs/kit/golden-marble/download", { kind: "mac", mode: "dark" });
    expect(r.status).toBe(200);
    const entries = unzipEntries(r.buf);
    const ground = Buffer.from("art-shark-tank-dark");
    for (const mode of ["dark", "light"]) {
      expect(entries.get(`golden-marble-dark/mac/wallpaper-${mode}-original.webp`)).toEqual(ground);
      for (const device of ["phone", "tablet", "desktop"]) {
        expect(entries.get(`golden-marble-dark/mac/wallpaper-${mode}-${device}.webp`)).toEqual(ground);
      }
    }
  });

  it("the zip's kit.json names the mix accent", async () => {
    await saveMix("golden-marble", { "accent-color": { all: { accentHex: "#123456" } } });
    const r = await callBytes("POST", "/theme-packs/kit/golden-marble/download", { kind: "mac", mode: "dark" });
    expect(r.status).toBe(200);
    const entries = unzipEntries(r.buf);
    const kit = JSON.parse(entries.get("golden-marble-dark/kit.json")!.toString("utf8"));
    expect(kit.accent).toBe("#123456");
  });

  it("an unrelated mix entry (sound roles) leaves the kit at pack defaults", async () => {
    await saveMix("golden-marble", { ringtone: { all: { extraSoundRole: "royal-sting" } } });
    const r = await callBytes("POST", "/theme-packs/kit/golden-marble/download", { kind: "windows", mode: "dark" });
    expect(r.status).toBe(200);
    expect(r.buf.includes(Buffer.from(`ColorizationColor=${colorizationOf(GM_DARK_DEFAULT())}`))).toBe(true);
    expect(r.buf.includes(Buffer.from("art-golden-marble-dark"))).toBe(true);
  });
});

describe("creator pack mix → buyer bundle", () => {
  it("the download wears the CREATOR's mix — never the buyer's own base-pack mix", async () => {
    h.userId = CREATOR;
    const created = await call("POST", "/theme-packs/creator-packs", {
      name: "Throne Room",
      basePackId: "golden-marble",
      priceVb: 0,
      mix: {
        "accent-color": { all: { accentHex: "#22cc44" } },
        "home-wallpapers": { all: { artSourceId: "kings-set-throne-phone" } },
      },
    });
    expect(created.status).toBe(200);
    const id = created.json.id as string;
    const pub = await call("POST", `/theme-packs/creator-packs/${id}/publish`, {});
    expect(pub.status).toBe(200);

    h.userId = BUYER;
    // The buyer's own saved mix on the base pack must NOT leak in.
    await saveMix("golden-marble", { "accent-color": { all: { accentHex: "#ff0000" } } });
    const buy = await call("POST", `/theme-packs/creator-packs/${id}/purchase`, {});
    expect(buy.status).toBe(200);
    expect(buy.json).toMatchObject({ owned: true, chargedVb: 0 });

    const r = await callBytes("POST", `/theme-packs/kit/creator:${id}/download`, { kind: "mac", mode: "dark" });
    expect(r.status).toBe(200);
    const entries = unzipEntries(r.buf);
    const kit = JSON.parse(entries.get("golden-marble-dark/kit.json")!.toString("utf8"));
    expect(kit.accent).toBe("#22cc44");
    expect(entries.get("golden-marble-dark/mac/wallpaper-dark-original.webp"))
      .toEqual(Buffer.from("still-kings-set-throne-phone.webp"));

    const win = await callBytes("POST", `/theme-packs/kit/creator:${id}/download`, { kind: "windows", mode: "dark" });
    expect(win.status).toBe(200);
    expect(win.buf.includes(Buffer.from(`ColorizationColor=${colorizationOf("#22cc44")}`))).toBe(true);
    expect(win.buf.includes(Buffer.from("still-kings-set-throne-phone.webp"))).toBe(true);
  });
});

describe("bundle paperwork honesty — unraised designed sets (Stack-300 A4)", () => {
  /* The fixture tree carries designed files for the five raised packs
     only. crimson-marble + sapphire-marble + emerald-marble sets are NOT raised: their
     bundles must say so in their own paperwork (README, kit.json,
     install texts) instead of claiming all 50 icons, and the
     manifests endpoint must carry the missing list. A raised pack
     (golden-marble) is the control: complete, missing []. */
  async function buyPack(packId: string): Promise<void> {
    await h.db.execute(
      sql`INSERT INTO theme_pack_purchases (user_id, pack_id, price_vb) VALUES (${BUYER}, ${packId}, 1000)`,
    );
  }

  for (const packId of ["crimson-marble", "sapphire-marble", "emerald-marble"]) {
    it(`${packId}: the full bundle names its missing designed set everywhere`, async () => {
      await buyPack(packId);
      const r = await callBytes("POST", `/theme-packs/kit/${packId}/download`, { kind: "full", mode: "dark" });
      expect(r.status).toBe(200);
      const entries = unzipEntries(r.buf);
      const base = `${packId}-dark/`;
      const kit = JSON.parse(entries.get(`${base}kit.json`)!.toString("utf8"));
      expect(kit.icons.complete).toBe(false);
      expect(kit.icons.missing).toHaveLength(100);
      expect(kit.icons.missing).toContain(`/theme-packs/icons/${packId}/phone-light.webp`);
      const readme = entries.get(`${base}README.txt`)!.toString("utf8");
      expect(readme).toContain("has NOT been raised yet");
      expect(readme).not.toContain("the designed emblem set approved for this pack — all 50 icons");
      const android = entries.get(`${base}android/INSTALL.txt`)!.toString("utf8");
      expect(android).toContain("has not been raised yet");
      const ios = entries.get(`${base}ios/GUIDED-SETUP.txt`)!.toString("utf8");
      expect(ios).toContain("not complete in this bundle");
      const mac = entries.get(`${base}mac/INSTALL.txt`)!.toString("utf8");
      expect(mac).toContain("has not been raised yet");
      // The missing note itself ships in both icon folders.
      expect(entries.get(`${base}android/icons/ICONS-MISSING.txt`)).toBeDefined();
      expect(entries.get(`${base}ios/icons/ICONS-MISSING.txt`)).toBeDefined();
    });
  }

  it("golden-marble (raised set): the paperwork stays the complete claim", async () => {
    const r = await callBytes("POST", "/theme-packs/kit/golden-marble/download", { kind: "full", mode: "dark" });
    expect(r.status).toBe(200);
    const entries = unzipEntries(r.buf);
    const kit = JSON.parse(entries.get("golden-marble-dark/kit.json")!.toString("utf8"));
    expect(kit.icons.complete).toBe(true);
    expect(kit.icons.missing).toEqual([]);
    const readme = entries.get("golden-marble-dark/README.txt")!.toString("utf8");
    expect(readme).toContain("all 50 icons in light");
    expect(entries.get("golden-marble-dark/android/icons/ICONS-MISSING.txt")).toBeUndefined();
  });

  it("manifests endpoint: missing lists + notes separate raised from unraised packs", async () => {
    const r = await call("GET", "/theme-packs/kit/manifests");
    expect(r.status).toBe(200);
    const byId = new Map(r.json.packs.map((p: any) => [p.packId, p]));
    expect(byId.get("golden-marble").icons.missing).toEqual([]);
    expect(byId.get("golden-marble").icons.note).toContain("downloads ship these files");
    for (const packId of ["crimson-marble", "sapphire-marble", "emerald-marble"]) {
      expect(byId.get(packId).icons.missing).toHaveLength(100);
      expect(byId.get(packId).icons.note).toContain("has not been raised yet");
    }
  });
});
