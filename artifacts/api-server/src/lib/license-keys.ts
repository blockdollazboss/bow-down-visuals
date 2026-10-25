/**
 * license-keys.ts — digital license keys + per-buyer download limits
 * (Wave 4 #35, migration 0234).
 *
 * A seller opts a digital-store item into license keys (settings row in
 * digital_product_settings). Every purchase of that item then issues
 * the buyer ONE key (digital_license_keys), delivered in the verify
 * response + receipt email and re-readable in the buyer's library.
 *
 * Design law:
 *  - EXACTLY ONCE: UNIQUE (sale_id, item_kind, item_id) is the issuance
 *    gate. Fulfillment (verify / gift-card checkout) may replay any
 *    number of times — the insert conflicts and the existing row is
 *    returned, never a second key. A re-issue ROTATES the key in place
 *    (new secret, count reset), so the one-row invariant never breaks.
 *  - THE CAP LIVES ON THE KEY, not on download links. Download counting
 *    increments digital_license_keys.download_count; minting a fresh
 *    link (POST /api/store/token) can never reset it. The seller's cap
 *    is SNAPSHOTTED onto the key at issuance — later settings edits
 *    never rewrite a sold purchase's terms.
 *  - KEY HYGIENE: keys are 100-bit crypto-random (BDV-XXXXX-… ×4 from
 *    an unambiguous alphabet). Stored: SHA-256 hash (exact lookup, the
 *    gift-card pattern), an AES-256-GCM ciphertext the buyer's library
 *    decrypts for display (the social-crypto pattern — a license key
 *    is a durable ownership artifact the buyer must be able to re-read,
 *    unlike a spent bearer code), and the final group in the clear for
 *    the seller's masked list. The full key NEVER appears in a log line.
 *  - FAIL SOFT AT FULFILLMENT: issuance runs after the sale is already
 *    recorded; any failure returns null and the purchase completes
 *    exactly as it did before this feature existed. Settings reads
 *    likewise degrade to "keys off" on a pre-migration database.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

/* ── Key format ──────────────────────────────────────────────────────────
   BDV-XXXXX-XXXXX-XXXXX-XXXXX — 20 chars from a 32-char unambiguous
   alphabet (no 0/O/1/I/L) = 100 bits of entropy. */
const KEY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const LICENSE_KEY_RE = /^BDV(?:-[A-HJ-KM-NP-Z2-9]{5}){4}$/;

export function generateLicenseKey(): string {
  const bytes = randomBytes(20);
  const groups: string[] = [];
  for (let g = 0; g < 4; g++) {
    let group = "";
    for (let i = 0; i < 5; i++) {
      group += KEY_ALPHABET[bytes[g * 5 + i]! % KEY_ALPHABET.length];
    }
    groups.push(group);
  }
  return `BDV-${groups.join("-")}`;
}

export function isLicenseKeyShape(raw: string): boolean {
  return LICENSE_KEY_RE.test(String(raw ?? "").trim().toUpperCase());
}

export function hashLicenseKey(key: string): string {
  return createHash("sha256").update(String(key).trim().toUpperCase()).digest("hex");
}

/** The final group (5 chars) — the only cleartext fragment stored,
    shown in the seller's masked list and quoted by buyers in support. */
export function licenseKeySuffix(key: string): string {
  return String(key).trim().toUpperCase().split("-").pop() ?? "";
}

export function maskLicenseKey(suffix: string): string {
  return `BDV-•••••-•••••-•••••-${suffix}`;
}

/* ── Encryption at rest (AES-256-GCM, social-crypto pattern) ─────────────
   The key derives from the same server secret family the download-token
   scheme already requires (store.ts getTokenSecret): downloads cannot
   work at all without one of these configured, so key display adds no
   new env requirement. Domain-separated via HMAC label. */
function encryptionKey(): Buffer {
  const secret =
    process.env["STORE_DOWNLOAD_SECRET"] ||
    process.env["STRIPE_WEBHOOK_SECRET"] ||
    process.env["STRIPE_SECRET_KEY"];
  if (!secret) throw new Error("No license-key secret configured");
  return createHmac("sha256", secret).update("bdv-license-key-encryption-v1").digest();
}

export function encryptLicenseKey(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${enc.toString("hex")}:${tag.toString("hex")}`;
}

/** Returns null (never throws) on any failure — a library row with an
    undecryptable key renders as "unavailable", not a 500. */
export function decryptLicenseKey(payload: string): string | null {
  try {
    const parts = String(payload ?? "").split(":");
    if (parts.length !== 3) return null;
    const [ivHex, encHex, tagHex] = parts as [string, string, string];
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return Buffer.concat([
      decipher.update(Buffer.from(encHex, "hex")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

/* ── Row shapes ────────────────────────────────────────────────────────── */
export interface LicenseKeyRow extends Record<string, unknown> {
  id: string;
  sale_id: string;
  profile_id: string;
  buyer_user_id: string;
  item_kind: string;
  item_id: string;
  item_title: string;
  file_url: string;
  key_hash: string;
  key_cipher: string;
  key_suffix: string;
  max_downloads: number | null;
  download_count: number;
  status: "active" | "revoked";
  revoked_at: string | null;
  revoked_reason: string | null;
  reissue_count: number;
  created_at: string;
}

export interface LicenseSettings {
  licenseKeysEnabled: boolean;
  maxDownloads: number | null;
}

export const LICENSE_SETTINGS_OFF: LicenseSettings = { licenseKeysEnabled: false, maxDownloads: null };
export const MAX_DOWNLOADS_CEILING = 100000;

const KEY_COLUMNS = `id, sale_id, profile_id, buyer_user_id, item_kind, item_id,
  item_title, file_url, key_hash, key_cipher, key_suffix, max_downloads,
  download_count, status, revoked_at, revoked_reason, reissue_count, created_at`;

function asKeyRow(r: Record<string, unknown> | undefined): LicenseKeyRow | null {
  if (!r) return null;
  return {
    ...r,
    id: String(r["id"]),
    sale_id: String(r["sale_id"]),
    profile_id: String(r["profile_id"]),
    buyer_user_id: String(r["buyer_user_id"]),
    item_kind: String(r["item_kind"]),
    item_id: String(r["item_id"]),
    item_title: String(r["item_title"] ?? ""),
    file_url: String(r["file_url"]),
    key_hash: String(r["key_hash"]),
    key_cipher: String(r["key_cipher"]),
    key_suffix: String(r["key_suffix"]),
    max_downloads: r["max_downloads"] == null ? null : Number(r["max_downloads"]),
    download_count: Number(r["download_count"] ?? 0),
    status: (String(r["status"]) === "revoked" ? "revoked" : "active") as "active" | "revoked",
    revoked_at: r["revoked_at"] == null ? null : String(r["revoked_at"]),
    revoked_reason: r["revoked_reason"] == null ? null : String(r["revoked_reason"]),
    reissue_count: Number(r["reissue_count"] ?? 0),
    created_at: String(r["created_at"]),
  };
}

/* ── Settings ──────────────────────────────────────────────────────────── */
/** Settings for one item; absence (or a pre-migration database) = off. */
export async function getLicenseSettings(itemKind: string, itemId: string): Promise<LicenseSettings> {
  try {
    const rows = await db.execute(sql`
      SELECT license_keys_enabled, max_downloads FROM digital_product_settings
      WHERE item_kind = ${itemKind} AND item_id = ${itemId} LIMIT 1
    `);
    const row = rows.rows[0] as Record<string, unknown> | undefined;
    if (!row) return { ...LICENSE_SETTINGS_OFF };
    return {
      licenseKeysEnabled: row["license_keys_enabled"] === true,
      maxDownloads: row["max_downloads"] == null ? null : Number(row["max_downloads"]),
    };
  } catch {
    return { ...LICENSE_SETTINGS_OFF };
  }
}

/** The /store/products payload shape (rides beside bumpConfig). */
export async function fetchLicenseConfig(itemKind: string, itemId: string): Promise<{
  licenseKeysEnabled: boolean;
  maxDownloads: number | null;
} | null> {
  try {
    const rows = await db.execute(sql`
      SELECT license_keys_enabled, max_downloads FROM digital_product_settings
      WHERE item_kind = ${itemKind} AND item_id = ${itemId} LIMIT 1
    `);
    const row = rows.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      licenseKeysEnabled: row["license_keys_enabled"] === true,
      maxDownloads: row["max_downloads"] == null ? null : Number(row["max_downloads"]),
    };
  } catch {
    return null;
  }
}

export async function setLicenseSettings(
  itemKind: string,
  itemId: string,
  settings: LicenseSettings,
): Promise<LicenseSettings> {
  await db.execute(sql`
    INSERT INTO digital_product_settings (item_kind, item_id, license_keys_enabled, max_downloads, updated_at)
    VALUES (${itemKind}, ${itemId}, ${settings.licenseKeysEnabled}, ${settings.maxDownloads}, now())
    ON CONFLICT (item_kind, item_id) DO UPDATE
      SET license_keys_enabled = EXCLUDED.license_keys_enabled,
          max_downloads = EXCLUDED.max_downloads,
          updated_at = now()
  `);
  return getLicenseSettings(itemKind, itemId);
}

/* ── Issuance ──────────────────────────────────────────────────────────── */
export interface IssueLicenseKeyArgs {
  saleId: string;
  buyerUserId: string;
  profileId: string;
  itemKind: string;
  itemId: string;
  itemTitle: string;
  fileUrl: string;
}

/**
 * Issue the key for one purchased item — exactly once. Returns the row
 * (existing or new) when the item has keys enabled, null when it does
 * not or on any failure (fulfillment must never break on key issuance).
 * A REVOKED row is returned as-is: replays never resurrect a key the
 * seller or a refund already killed.
 */
export async function ensureLicenseKeyForItem(args: IssueLicenseKeyArgs): Promise<LicenseKeyRow | null> {
  try {
    const settings = await getLicenseSettings(args.itemKind, args.itemId);
    if (!settings.licenseKeysEnabled) return null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const key = generateLicenseKey();
      const inserted = await db.execute(sql`
        INSERT INTO digital_license_keys
          (sale_id, profile_id, buyer_user_id, item_kind, item_id, item_title,
           file_url, key_hash, key_cipher, key_suffix, max_downloads)
        VALUES (${args.saleId}, ${args.profileId}, ${args.buyerUserId}, ${args.itemKind},
                ${args.itemId}, ${args.itemTitle}, ${args.fileUrl},
                ${hashLicenseKey(key)}, ${encryptLicenseKey(key)}, ${licenseKeySuffix(key)},
                ${settings.maxDownloads})
        ON CONFLICT (sale_id, item_kind, item_id) DO NOTHING
        RETURNING ${sql.raw(KEY_COLUMNS)}
      `);
      const row = asKeyRow(inserted.rows[0] as Record<string, unknown> | undefined);
      if (row) return row;
      /* Conflict: the purchase already has its key — unless the clash
         was the (astronomically unlikely) key_hash of a DIFFERENT
         purchase, in which case no row exists for THIS purchase and
         the loop retries with a fresh key. */
      const existing = await getLicenseKeyForPurchase(args.saleId, args.itemKind, args.itemId);
      if (existing) return existing;
    }
    logger.error({ saleId: args.saleId, itemKind: args.itemKind }, "[license] issuance exhausted retries");
    return null;
  } catch (err) {
    logger.error({ err, saleId: args.saleId, itemKind: args.itemKind }, "[license] issuance failed (purchase unaffected)");
    return null;
  }
}

export async function getLicenseKeyForPurchase(
  saleId: string,
  itemKind: string,
  itemId: string,
): Promise<LicenseKeyRow | null> {
  try {
    const rows = await db.execute(sql`
      SELECT ${sql.raw(KEY_COLUMNS)} FROM digital_license_keys
      WHERE sale_id = ${saleId} AND item_kind = ${itemKind} AND item_id = ${itemId} LIMIT 1
    `);
    return asKeyRow(rows.rows[0] as Record<string, unknown> | undefined);
  } catch {
    return null;
  }
}

/** The key governing one download link (sale + the file it serves). */
export async function getLicenseKeyForDownload(saleId: string, fileUrl: string): Promise<LicenseKeyRow | null> {
  try {
    const rows = await db.execute(sql`
      SELECT ${sql.raw(KEY_COLUMNS)} FROM digital_license_keys
      WHERE sale_id = ${saleId} AND file_url = ${fileUrl} LIMIT 1
    `);
    return asKeyRow(rows.rows[0] as Record<string, unknown> | undefined);
  } catch {
    return null;
  }
}

/* ── Download counting ─────────────────────────────────────────────────── */
/**
 * Count one served download against the key — a single conditional
 * UPDATE, so the cap can never be overshot by concurrent downloads and
 * a revoked key can't accrue count. Returns the post-increment state,
 * or null when the key is revoked / at cap / missing.
 */
export async function noteLicenseDownload(keyId: string): Promise<{ downloadCount: number; maxDownloads: number | null } | null> {
  const rows = await db.execute(sql`
    UPDATE digital_license_keys
    SET download_count = download_count + 1
    WHERE id = ${keyId} AND status = 'active'
      AND (max_downloads IS NULL OR download_count < max_downloads)
    RETURNING download_count, max_downloads
  `);
  const row = rows.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    downloadCount: Number(row["download_count"]),
    maxDownloads: row["max_downloads"] == null ? null : Number(row["max_downloads"]),
  };
}

/** True when minting a fresh link for this purchase would be a lie —
    the key is revoked or its download cap is already spent. */
export function licenseBlocksMint(key: LicenseKeyRow | null): { blocked: false } | { blocked: true; reason: "revoked" | "cap" } {
  if (!key) return { blocked: false };
  if (key.status === "revoked") return { blocked: true, reason: "revoked" };
  if (key.max_downloads !== null && key.download_count >= key.max_downloads) {
    return { blocked: true, reason: "cap" };
  }
  return { blocked: false };
}

/* ── Reads for buyer + seller ──────────────────────────────────────────── */
/** All keys riding one set of sales (buyer library / verify payloads). */
export async function listLicenseKeysForSales(saleIds: string[]): Promise<LicenseKeyRow[]> {
  if (saleIds.length === 0) return [];
  try {
    const rows = await db.execute(sql`
      SELECT ${sql.raw(KEY_COLUMNS)} FROM digital_license_keys
      WHERE sale_id IN (${sql.join(saleIds.map((id) => sql`${id}`), sql`, `)})
      ORDER BY created_at ASC
    `);
    return rows.rows.map((r) => asKeyRow(r as Record<string, unknown>)).filter((k): k is LicenseKeyRow => k !== null);
  } catch {
    return [];
  }
}

/** Keys issued for one product, newest first (seller dashboard). */
export async function listLicenseKeysForProduct(
  profileId: string,
  itemKind: string,
  itemId: string,
  limit = 200,
): Promise<LicenseKeyRow[]> {
  const rows = await db.execute(sql`
    SELECT ${sql.raw(KEY_COLUMNS)} FROM digital_license_keys
    WHERE profile_id = ${profileId} AND item_kind = ${itemKind} AND item_id = ${itemId}
    ORDER BY created_at DESC LIMIT ${limit}
  `);
  return rows.rows.map((r) => asKeyRow(r as Record<string, unknown>)).filter((k): k is LicenseKeyRow => k !== null);
}

/* ── Seller actions + refund clawback ──────────────────────────────────── */
/** Revoke one key the caller sells. Returns the updated row, or null
    when the key isn't theirs / doesn't exist. Idempotent. */
export async function revokeLicenseKey(keyId: string, profileId: string, reason: string): Promise<LicenseKeyRow | null> {
  const rows = await db.execute(sql`
    UPDATE digital_license_keys
    SET status = 'revoked', revoked_at = now(), revoked_reason = ${reason}
    WHERE id = ${keyId} AND profile_id = ${profileId}
    RETURNING ${sql.raw(KEY_COLUMNS)}
  `);
  return asKeyRow(rows.rows[0] as Record<string, unknown> | undefined);
}

/**
 * Re-issue: rotate the key IN PLACE — the old key string dies (its hash
 * is replaced), the download count resets, a revoked (seller-revoked)
 * key becomes active again for the same buyer. Refused for a refunded
 * sale: the money went back, so no key may live again. Returns the
 * fresh row, or null when the key isn't theirs / the sale is refunded.
 */
export async function reissueLicenseKey(keyId: string, profileId: string): Promise<LicenseKeyRow | null> {
  const current = await db.execute(sql`
    SELECT k.id, ds.status AS sale_status FROM digital_license_keys k
    JOIN digital_sales ds ON ds.id = k.sale_id
    WHERE k.id = ${keyId} AND k.profile_id = ${profileId} LIMIT 1
  `);
  const cur = current.rows[0] as Record<string, unknown> | undefined;
  if (!cur || String(cur["sale_status"]) === "refunded") return null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const key = generateLicenseKey();
    const rows = await db.execute(sql`
      UPDATE digital_license_keys
      SET key_hash = ${hashLicenseKey(key)}, key_cipher = ${encryptLicenseKey(key)},
          key_suffix = ${licenseKeySuffix(key)},
          download_count = 0, status = 'active',
          revoked_at = NULL, revoked_reason = NULL,
          reissue_count = reissue_count + 1
      WHERE id = ${keyId} AND profile_id = ${profileId}
      RETURNING ${sql.raw(KEY_COLUMNS)}
    `);
    const row = asKeyRow(rows.rows[0] as Record<string, unknown> | undefined);
    if (row) return row;
    /* A key_hash collision with another purchase's key makes the whole
       UPDATE fail on the UNIQUE constraint — retry with a fresh key. */
  }
  return null;
}

/** Refund clawback (payment-reversals): every key on the given sales
    dies with the sale. Already-revoked rows keep their first reason. */
export async function revokeLicenseKeysForSales(saleIds: string[], reason: string): Promise<void> {
  if (saleIds.length === 0) return;
  await db.execute(sql`
    UPDATE digital_license_keys
    SET status = 'revoked', revoked_at = now(), revoked_reason = ${reason}
    WHERE sale_id IN (${sql.join(saleIds.map((id) => sql`${id}`), sql`, `)})
      AND status = 'active'
  `);
}

/* ── Payload shaping ───────────────────────────────────────────────────── */
/** What the BUYER sees: the full key (decrypted), honestly labelled. */
export function buyerLicenseView(key: LicenseKeyRow): {
  id: string;
  itemKind: string;
  itemId: string;
  itemTitle: string;
  key: string | null;
  status: "active" | "revoked";
  maxDownloads: number | null;
  downloadsUsed: number;
  downloadsLeft: number | null;
} {
  return {
    id: key.id,
    itemKind: key.item_kind,
    itemId: key.item_id,
    itemTitle: key.item_title,
    key: decryptLicenseKey(key.key_cipher),
    status: key.status,
    maxDownloads: key.max_downloads,
    downloadsUsed: key.download_count,
    downloadsLeft: key.max_downloads === null ? null : Math.max(0, key.max_downloads - key.download_count),
  };
}

/** What the SELLER sees: masked key only — never the full key, never
    the hash, never the cipher. */
export function sellerLicenseView(key: LicenseKeyRow): {
  id: string;
  saleId: string;
  itemKind: string;
  itemId: string;
  itemTitle: string;
  maskedKey: string;
  buyerUserId: string;
  status: "active" | "revoked";
  revokedReason: string | null;
  maxDownloads: number | null;
  downloadsUsed: number;
  downloadsLeft: number | null;
  reissueCount: number;
  issuedAt: string;
} {
  return {
    id: key.id,
    saleId: key.sale_id,
    itemKind: key.item_kind,
    itemId: key.item_id,
    itemTitle: key.item_title,
    maskedKey: maskLicenseKey(key.key_suffix),
    buyerUserId: key.buyer_user_id,
    status: key.status,
    revokedReason: key.revoked_reason,
    maxDownloads: key.max_downloads,
    downloadsUsed: key.download_count,
    downloadsLeft: key.max_downloads === null ? null : Math.max(0, key.max_downloads - key.download_count),
    reissueCount: key.reissue_count,
    issuedAt: key.created_at,
  };
}
