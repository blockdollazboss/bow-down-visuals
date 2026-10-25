import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/require-auth";
import {
  chargeCredits,
  refundCredits,
  voidChargeIdempotencyKey,
  OutOfCreditsError,
  CreditsDisabledError,
} from "../lib/credits";
import { resolveCreatorTier } from "../middlewares/require-tier";
import { feeSplit, PLATFORM_FEE_BPS } from "../lib/platform-fees";
import { logger } from "../lib/logger";
import {
  SERVER_PACKS,
  serverPackById,
  buildThemepack,
  buildKitZip,
  KIT_BUNDLE_KINDS,
  type KitBundleKind,
  type KitMode,
} from "../lib/theme-kit-build";
import { THEME_PACK_KNOWN_IDS, THEME_PACK_PREMIUM_IDS, THEME_PACK_PRICE_VB } from "./theme-packs";

/* ─── Theme kit rail (Stack-200 UPGRADES #39) ─────────────────────────
   Extends routes/theme-packs.ts (the purchase rail — price untouched:
   premium 1,000 VB one-time owned forever; house/included free; Elite
   includes all while subscribed) with the whole-device kit:

   - GET  /theme-packs/kit/manifests — every pack × 12 components.
   - POST /theme-packs/kit/:packId/download {kind, mode, assets?} —
     entitlement-gated bundle: a real .themepack (CAB) for Windows,
     zips for mac/android/ios/chrome/sounds/full. Icon/widget/share
     SVGs are rendered by the ONE glyph source (FE lib/theme-kit.ts)
     and passed in by the desk, so no second glyph source exists.
   - GET/PUT /theme-packs/customizations/:packId — the customization
     capstone storage: every component, per device.
   - Creator packs: POST /theme-packs/creator-packs (design from a
     base + mix), POST …/:id/publish, GET /theme-packs/creator-packs
     (store list), POST …/:id/purchase — charges the creator-set VB
     price, splits it through the shared flat-5% fee module
     (lib/platform-fees), credits the creator 95%, and records
     ownership in theme_pack_purchases as 'creator:<id>' (the same
     exactly-once anchor as house packs, same refund leg on failure).
   - GET /theme-packs/look/:code — public look-link resolution: the
     payload is validated, the pack summary returned; a premium pack
     reports priceRespected so the receiver lands on the pack wearing
     the mix as PREVIEW — owning still goes through the purchase rail.

   SOUND SYNC (owner ruling Oct 25 17:39): pack sounds resolve BY ROLE
   to the site sound library — see lib/theme-kit-build.ts. No per-pack
   sound data exists anywhere in this rail. */

const router = Router();

export const KIT_COMPONENT_IDS = [
  "home-wallpapers", "lock-wallpapers", "icon-set", "folder-icons", "cursors",
  "ringtone", "notification-sounds", "sound-scheme", "browser-theme",
  "widget-art", "accent-color", "site-reskin",
] as const;
export const KIT_DEVICE_IDS = ["all", "phone", "tablet", "desktop"] as const;
const APPROVED_ART_IDS = new Set([
  "pack-ground", "kings-set-throne-phone", "kings-set-plaza-phone",
  "kings-set-stage-desktop", "kings-set-throne-loop", "kings-set-plaza-loop",
  "kings-set-stage-loop",
]);
const SOUND_ROLE_SET = new Set(["notification", "message", "success", "error", "royal-sting", "ringtone"]);

/** Mirror of the FE sanitizeCustomization (lib/theme-kit.ts) — same
    rules, enforced server-side because storage is server-side. */
export function sanitizeMix(input: unknown): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (typeof input !== "object" || input === null) return { ok: false, error: "mix must be an object" };
  const out: Record<string, unknown> = {};
  for (const [comp, perDevice] of Object.entries(input as Record<string, unknown>)) {
    if (!(KIT_COMPONENT_IDS as readonly string[]).includes(comp)) return { ok: false, error: `unknown component ${comp}` };
    if (typeof perDevice !== "object" || perDevice === null) return { ok: false, error: `${comp} must be an object` };
    const compOut: Record<string, unknown> = {};
    for (const [device, raw] of Object.entries(perDevice as Record<string, unknown>)) {
      if (!(KIT_DEVICE_IDS as readonly string[]).includes(device)) return { ok: false, error: `unknown device ${device}` };
      if (typeof raw !== "object" || raw === null) return { ok: false, error: `${comp}/${device} must be an object` };
      const r = raw as Record<string, unknown>;
      const clean: Record<string, unknown> = {};
      if (r.artSourceId !== undefined) {
        if (typeof r.artSourceId !== "string" || !APPROVED_ART_IDS.has(r.artSourceId))
          return { ok: false, error: "artSourceId must come from the approved library" };
        clean.artSourceId = r.artSourceId;
      }
      if (r.customArtUrl !== undefined) {
        if (typeof r.customArtUrl !== "string" || r.customArtUrl.length > 2048) return { ok: false, error: "customArtUrl invalid" };
        clean.customArtUrl = r.customArtUrl;
      }
      if (r.accentHex !== undefined) {
        if (typeof r.accentHex !== "string" || !/^#[0-9a-fA-F]{6}$/.test(r.accentHex)) return { ok: false, error: "accentHex must be #rrggbb" };
        clean.accentHex = r.accentHex.toLowerCase();
      }
      if (r.cursorId !== undefined) {
        if (typeof r.cursorId !== "string" || r.cursorId.length > 64) return { ok: false, error: "cursorId invalid" };
        clean.cursorId = r.cursorId;
      }
      if (r.extraSoundRole !== undefined) {
        if (typeof r.extraSoundRole !== "string" || !SOUND_ROLE_SET.has(r.extraSoundRole))
          return { ok: false, error: "extraSoundRole must be a library role" };
        clean.extraSoundRole = r.extraSoundRole;
      }
      if (r.branded !== undefined) {
        if (typeof r.branded !== "boolean") return { ok: false, error: "branded must be boolean" };
        clean.branded = r.branded;
      }
      if (r.note !== undefined) {
        if (typeof r.note !== "string" || r.note.length > 200) return { ok: false, error: "note too long" };
        clean.note = r.note;
      }
      compOut[device] = clean;
    }
    out[comp] = compOut;
  }
  return { ok: true, value: out };
}

async function ownedPackIds(userId: string): Promise<string[]> {
  const { rows } = await db.execute(
    sql`SELECT pack_id FROM theme_pack_purchases WHERE user_id = ${userId}`,
  );
  return (rows as Array<{ pack_id: string }>).map((r) => r.pack_id);
}

async function isElite(userId: string, plan: unknown): Promise<boolean> {
  const { tier } = await resolveCreatorTier(userId, plan as never);
  return tier === "elite";
}

/** The entitlement rule, one place: included → everyone; premium →
    owned outright or live Elite; creator packs → creator, purchased,
    or free (price 0) published. */
export async function kitUnlocked(
  req: { userId?: string; userPlan?: unknown },
  packId: string,
): Promise<boolean> {
  const userId = req.userId!;
  if (packId.startsWith("creator:")) {
    const id = packId.slice("creator:".length);
    const { rows } = await db.execute(
      sql`SELECT creator_user_id, price_vb, published FROM creator_theme_packs WHERE id = ${id} LIMIT 1`,
    );
    const row = rows[0] as { creator_user_id: string; price_vb: number; published: boolean } | undefined;
    if (!row || !row.published) return false;
    if (row.creator_user_id === userId || row.price_vb === 0) return true;
    const owned = await ownedPackIds(userId);
    return owned.includes(packId);
  }
  if (!THEME_PACK_PREMIUM_IDS.has(packId)) return THEME_PACK_KNOWN_IDS.has(packId);
  const owned = await ownedPackIds(userId);
  if (owned.includes(packId)) return true;
  return isElite(userId, req.userPlan);
}

/* ── Manifests ─────────────────────────────────────────────────────── */
router.get("/theme-packs/kit/manifests", async (_req, res) => {
  res.json({
    packs: SERVER_PACKS.map((p) => ({
      packId: p.id,
      name: p.name,
      tier: p.tier,
      components: KIT_COMPONENT_IDS.map((id) => ({ id, modes: ["light", "dark"] })),
      bundleKinds: KIT_BUNDLE_KINDS,
      sounds: {
        source: "site-sound-library",
        roles: [...SOUND_ROLE_SET],
        note: "Pack ringtone/notification/scheme ARE the house signature set by role — synced, never forked per pack.",
      },
    })),
  });
});

/* ── Downloads ─────────────────────────────────────────────────────── */
router.post("/theme-packs/kit/:packId/download", requireAuth, async (req, res) => {
  const packId = req.params.packId!;
  const body = (req.body ?? {}) as {
    kind?: string; mode?: string;
    assets?: { iconSvgs?: Record<string, string>; folderSvg?: string; widgetSvg?: string; chromeManifest?: string; shareCardSvg?: string };
  };
  const kind = (body.kind ?? "full") as KitBundleKind;
  const mode: KitMode = body.mode === "light" ? "light" : "dark";
  if (!KIT_BUNDLE_KINDS.includes(kind)) {
    res.status(400).json({ error: "KIND_UNKNOWN", message: "That's not a kit bundle." });
    return;
  }
  try {
    if (!(await kitUnlocked(req, packId))) {
      res.status(403).json({ error: "PACK_LOCKED", message: "That pack isn't yours yet — the kit unlocks with the pack." });
      return;
    }
    if (packId.startsWith("creator:")) {
      // Creator packs download as their base pack's kit wearing the mix.
      const id = packId.slice("creator:".length);
      const { rows } = await db.execute(sql`SELECT base_pack_id FROM creator_theme_packs WHERE id = ${id} LIMIT 1`);
      const baseId = (rows[0] as { base_pack_id: string } | undefined)?.base_pack_id;
      const base = baseId ? serverPackById(baseId) : undefined;
      if (!base) { res.status(404).json({ error: "PACK_UNKNOWN" }); return; }
      await streamBundle(res, base, kind, mode, body.assets);
      return;
    }
    const pack = serverPackById(packId);
    if (!pack) { res.status(404).json({ error: "PACK_UNKNOWN", message: "That's not a theme pack." }); return; }
    await streamBundle(res, pack, kind, mode, body.assets);
  } catch (err) {
    logger.error({ err, userId: req.userId, packId }, "theme-kit download failed");
    if (!res.headersSent) res.status(500).json({ error: "DOWNLOAD_FAILED" });
  }
});

async function streamBundle(
  res: { setHeader: (k: string, v: string) => void; status: (n: number) => { json: (b: unknown) => void } },
  pack: (typeof SERVER_PACKS)[number],
  kind: KitBundleKind,
  mode: KitMode,
  assets: { iconSvgs?: Record<string, string>; folderSvg?: string; widgetSvg?: string; chromeManifest?: string; shareCardSvg?: string } | undefined,
): Promise<void> {
  const r = res as unknown as import("express").Response;
  if (kind === "windows") {
    const buf = buildThemepack(pack, mode);
    r.setHeader("Content-Type", "application/octet-stream");
    r.setHeader("Content-Disposition", `attachment; filename="${pack.id}-${mode}.themepack"`);
    r.setHeader("Content-Length", String(buf.length));
    r.end(buf);
    return;
  }
  const archive = buildKitZip(pack, kind, {
    mode,
    iconSvgs: assets?.iconSvgs,
    folderSvg: assets?.folderSvg,
    widgetSvg: assets?.widgetSvg,
    chromeManifest: assets?.chromeManifest,
    shareCardSvg: assets?.shareCardSvg,
  });
  r.setHeader("Content-Type", "application/zip");
  r.setHeader("Content-Disposition", `attachment; filename="${pack.id}-${mode}-${kind}.zip"`);
  archive.pipe(r);
  await archive.finalize();
}

/* ── Customizations (capstone storage) ─────────────────────────────── */
router.get("/theme-packs/customizations/:packId", requireAuth, async (req, res) => {
  const packId = req.params.packId!;
  try {
    const { rows } = await db.execute(
      sql`SELECT component, device, settings FROM theme_pack_customizations
          WHERE user_id = ${req.userId!} AND pack_id = ${packId}`,
    );
    const mix: Record<string, Record<string, unknown>> = {};
    for (const row of rows as Array<{ component: string; device: string; settings: unknown }>) {
      mix[row.component] = { ...(mix[row.component] ?? {}), [row.device]: row.settings };
    }
    res.json({ packId, mix });
  } catch (err) {
    logger.error({ err, userId: req.userId, packId }, "theme-kit customization read failed");
    res.status(500).json({ error: "READ_FAILED" });
  }
});

router.put("/theme-packs/customizations/:packId", requireAuth, async (req, res) => {
  const packId = req.params.packId!;
  if (!THEME_PACK_KNOWN_IDS.has(packId) && !packId.startsWith("creator:")) {
    res.status(400).json({ error: "PACK_UNKNOWN" });
    return;
  }
  const clean = sanitizeMix((req.body as { mix?: unknown })?.mix ?? {});
  if (!clean.ok) {
    res.status(400).json({ error: "MIX_INVALID", message: clean.error });
    return;
  }
  try {
    if (!(await kitUnlocked(req, packId))) {
      res.status(403).json({ error: "PACK_LOCKED", message: "Customize unlocks with the pack — previews stay free." });
      return;
    }
    for (const [component, perDevice] of Object.entries(clean.value)) {
      for (const [device, settings] of Object.entries(perDevice as Record<string, unknown>)) {
        await db.execute(sql`
          INSERT INTO theme_pack_customizations (user_id, pack_id, component, device, settings, updated_at)
          VALUES (${req.userId!}, ${packId}, ${component}, ${device}, ${JSON.stringify(settings)}::jsonb, now())
          ON CONFLICT (user_id, pack_id, component, device)
          DO UPDATE SET settings = EXCLUDED.settings, updated_at = now()`);
      }
    }
    res.json({ saved: true, packId });
  } catch (err) {
    logger.error({ err, userId: req.userId, packId }, "theme-kit customization save failed");
    res.status(500).json({ error: "SAVE_FAILED" });
  }
});

/* ── Creator-made packs ────────────────────────────────────────────── */
router.post("/theme-packs/creator-packs", requireAuth, async (req, res) => {
  const body = (req.body ?? {}) as { name?: unknown; basePackId?: unknown; priceVb?: unknown; mix?: unknown };
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
  const basePackId = typeof body.basePackId === "string" ? body.basePackId : "";
  const priceVb = typeof body.priceVb === "number" ? Math.floor(body.priceVb) : NaN;
  if (!name) { res.status(400).json({ error: "NAME_REQUIRED" }); return; }
  if (!THEME_PACK_KNOWN_IDS.has(basePackId)) { res.status(400).json({ error: "BASE_UNKNOWN" }); return; }
  if (!Number.isFinite(priceVb) || priceVb < 0 || priceVb > 100000) {
    res.status(400).json({ error: "PRICE_INVALID", message: "Price must be 0–100,000 VB (0 = free)." });
    return;
  }
  const clean = sanitizeMix(body.mix ?? {});
  if (!clean.ok) { res.status(400).json({ error: "MIX_INVALID", message: clean.error }); return; }
  try {
    // Designing on a premium base requires owning/unlocking that base.
    if (THEME_PACK_PREMIUM_IDS.has(basePackId) && !(await kitUnlocked(req, basePackId))) {
      res.status(403).json({ error: "BASE_LOCKED", message: "You can design on a premium base once it's yours." });
      return;
    }
    const { rows } = await db.execute(sql`
      INSERT INTO creator_theme_packs (creator_user_id, name, base_pack_id, price_vb, mix)
      VALUES (${req.userId!}, ${name}, ${basePackId}, ${priceVb}, ${JSON.stringify(clean.value)}::jsonb)
      RETURNING id`);
    const id = (rows[0] as { id: string }).id;
    res.json({ id, packId: `creator:${id}`, published: false });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "creator pack create failed");
    res.status(500).json({ error: "CREATE_FAILED" });
  }
});

router.post("/theme-packs/creator-packs/:id/publish", requireAuth, async (req, res) => {
  const id = req.params.id!;
  try {
    const { rows } = await db.execute(
      sql`UPDATE creator_theme_packs SET published = true, updated_at = now()
          WHERE id = ${id} AND creator_user_id = ${req.userId!} RETURNING id`,
    );
    if (rows.length === 0) { res.status(404).json({ error: "NOT_YOURS" }); return; }
    res.json({ published: true, packId: `creator:${id}` });
  } catch (err) {
    logger.error({ err, userId: req.userId, id }, "creator pack publish failed");
    res.status(500).json({ error: "PUBLISH_FAILED" });
  }
});

router.get("/theme-packs/creator-packs", async (req, res) => {
  try {
    const mine = (req as { userId?: string }).userId;
    const { rows } = mine
      ? await db.execute(sql`SELECT id, creator_user_id, name, base_pack_id, price_vb, mix, published, created_at
                               FROM creator_theme_packs WHERE published = true OR creator_user_id = ${mine}
                               ORDER BY created_at DESC LIMIT 100`)
      : await db.execute(sql`SELECT id, creator_user_id, name, base_pack_id, price_vb, mix, published, created_at
                               FROM creator_theme_packs WHERE published = true
                               ORDER BY created_at DESC LIMIT 100`);
    res.json({
      packs: (rows as Array<Record<string, unknown>>).map((r) => ({
        id: r.id, packId: `creator:${r.id}`, creatorUserId: r.creator_user_id, name: r.name,
        basePackId: r.base_pack_id, priceVb: r.price_vb, mix: r.mix, published: r.published,
        feeBps: PLATFORM_FEE_BPS,
      })),
    });
  } catch (err) {
    logger.error({ err }, "creator pack list failed");
    res.status(500).json({ error: "LIST_FAILED" });
  }
});

router.post("/theme-packs/creator-packs/:id/purchase", requireAuth, async (req, res) => {
  const id = req.params.id!;
  const packId = `creator:${id}`;
  const userId = req.userId!;
  try {
    const { rows } = await db.execute(
      sql`SELECT creator_user_id, price_vb, published, name FROM creator_theme_packs WHERE id = ${id} LIMIT 1`,
    );
    const row = rows[0] as { creator_user_id: string; price_vb: number; published: boolean; name: string } | undefined;
    if (!row || !row.published) { res.status(404).json({ error: "PACK_UNKNOWN" }); return; }
    if (row.creator_user_id === userId) { res.json({ owned: true, ownPack: true, chargedVb: 0 }); return; }
    const owned = await ownedPackIds(userId);
    if (owned.includes(packId)) { res.json({ owned: true, alreadyOwned: true, chargedVb: 0 }); return; }
    if (row.price_vb === 0) {
      await db.execute(sql`INSERT INTO theme_pack_purchases (user_id, pack_id, price_vb)
                             VALUES (${userId}, ${packId}, 0) ON CONFLICT DO NOTHING`);
      res.json({ owned: true, chargedVb: 0 });
      return;
    }
    let balance: number;
    try {
      balance = await chargeCredits(
        userId, row.price_vb,
        { action: "creator_theme_pack_purchase" },
        { idempotencyKey: `creator-theme-pack:${userId}:${id}` },
      );
    } catch (err) {
      if (err instanceof OutOfCreditsError) {
        res.status(402).json({ error: "INSUFFICIENT_VB", message: `That pack is ${row.price_vb.toLocaleString()} VB — nothing was charged.`, priceVb: row.price_vb });
        return;
      }
      if (err instanceof CreditsDisabledError) { res.status(403).json({ error: "CREDITS_DISABLED" }); return; }
      throw err;
    }
    try {
      await db.execute(sql`INSERT INTO theme_pack_purchases (user_id, pack_id, price_vb)
                             VALUES (${userId}, ${packId}, ${row.price_vb}) ON CONFLICT DO NOTHING`);
    } catch (insertErr) {
      // Same D5 refund leg as the house rail: refund + void the key.
      let refunded = false;
      try {
        await refundCredits(userId, row.price_vb, { action: "creator_theme_pack_purchase (ownership record failed refund)" });
        refunded = true;
        await voidChargeIdempotencyKey(`creator-theme-pack:${userId}:${id}`);
      } catch (refundErr) {
        logger.error({ err: refundErr, userId, id }, "creator-packs: CRITICAL — insert failed AND refund failed");
      }
      logger.error({ err: insertErr, userId, id, refunded }, "creator-packs: insert failed after charge — refunded");
      throw insertErr;
    }
    // Flat-5% fee law: creator nets 95% of the price (shared fee module).
    const split = feeSplit(row.price_vb, PLATFORM_FEE_BPS);
    const sellerNet = split.net;
    if (sellerNet > 0) {
      try {
        await refundCredits(row.creator_user_id, sellerNet, {
          action: `creator_theme_pack_sale proceeds (${row.name})`,
        });
      } catch (payoutErr) {
        logger.error({ err: payoutErr, userId, id, sellerNet }, "creator-packs: seller proceeds credit failed — buyer keeps the pack; reconcile manually");
      }
    }
    res.json({ owned: true, chargedVb: row.price_vb, balance, feeVb: split.fee, sellerNetVb: sellerNet });
  } catch (err) {
    logger.error({ err, userId, id }, "creator pack purchase failed");
    res.status(500).json({ error: "PURCHASE_FAILED", message: "That purchase hit a snag — if you were charged, the Visual Bucs were refunded." });
  }
});

/* ── GET THIS LOOK — public resolution ─────────────────────────────── */
router.get("/theme-packs/look/:code", async (req, res) => {
  try {
    const b64 = req.params.code!.replace(/-/g, "+").replace(/_/g, "/");
    const parsed = JSON.parse(Buffer.from(b64, "base64").toString("utf8")) as {
      packId?: unknown; mix?: unknown; creatorPackId?: unknown;
    };
    const packId = typeof parsed.packId === "string" ? parsed.packId : "";
    const clean = sanitizeMix(parsed.mix ?? {});
    if (!clean.ok) { res.status(400).json({ error: "LOOK_INVALID" }); return; }
    if (packId.startsWith("creator:")) {
      const id = packId.slice("creator:".length);
      const { rows } = await db.execute(sql`SELECT name, base_pack_id, price_vb, published FROM creator_theme_packs WHERE id = ${id} LIMIT 1`);
      const row = rows[0] as { name: string; base_pack_id: string; price_vb: number; published: boolean } | undefined;
      if (!row || !row.published) { res.status(404).json({ error: "LOOK_UNKNOWN" }); return; }
      res.json({ packId, name: row.name, basePackId: row.base_pack_id, priceVb: row.price_vb, priceRespected: row.price_vb > 0, mix: clean.value });
      return;
    }
    const pack = serverPackById(packId);
    if (!pack) { res.status(404).json({ error: "LOOK_UNKNOWN" }); return; }
    res.json({
      packId,
      name: pack.name,
      tier: pack.tier,
      priceVb: pack.tier === "premium" ? THEME_PACK_PRICE_VB : 0,
      priceRespected: pack.tier === "premium",
      mix: clean.value,
    });
  } catch {
    res.status(400).json({ error: "LOOK_INVALID" });
  }
});

export default router;
