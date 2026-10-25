/**
 * shopify-bridge.ts — Shopify CSV bridge for the Sell Everything storefront.
 *
 * Competitor-study finding (pro-creative-software.md §5.4/§10): creators who
 * graduate to Shopify — or arrive from it — had NO door at all: no import,
 * no export, every product re-typed by hand. This is the CSV v1 of that
 * door. API sync is a later partner build; files are the honest v1.
 *
 * IMPORT (Shopify products CSV → store_products on the caller's profile):
 *   POST /storefront/shopify-import/preview  { csv } → per-row plan, no writes
 *   POST /storefront/shopify-import/commit   { csv } → same plan, applied
 * Every CSV data row appears in the report — as a create, an update, an
 * image row, or a reject WITH its reason. Nothing is silently dropped.
 * Rows are grouped by Handle; each variant row becomes its own Bow Down
 * listing (title + variant name) because storefront listings are
 * single-price — the preview says exactly that before anything is saved.
 * Prices are parsed as strings into integer cents (never floats), so a
 * price lands byte-exact as the CSV states it. Re-import is idempotent:
 * a listing whose exact title already exists on the caller's profile is
 * UPDATED, never duplicated (Shopify's own importer keys on handle the
 * same way — Bow Down listings carry no handle column, so the listing
 * title is the key, and the preview shows which rows will update).
 *
 * EXPORT (caller's store → Shopify-format CSV files):
 *   GET /storefront/shopify-export/products   products in Shopify CSV shape
 *   GET /storefront/shopify-export/orders     store_orders, Shopify order shape
 *   GET /storefront/shopify-export/customers  email-list fans, Shopify customer shape
 * Exports are born scoped to the caller's profile/lists — a seller can
 * only ever export their own store. Buyer emails are NOT stored on
 * store_orders (buyer is a user id / guest), so the orders Email column
 * is honestly blank rather than invented.
 *
 * "Shopify" appears in copy ONLY as a factual format label (the file
 * format's name) — no partnership, sync, or endorsement is implied.
 *
 * Queries use raw SQL via db.execute(sql``) — the storefront convention
 * (pg-mem cannot run the drizzle builder's rowMode:'array').
 */
import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { mirrorExternalMediaUrl } from "../lib/mirrorMedia";
import { detectWishlistPriceDrop } from "../lib/wishlists";

const router = Router();

const MAX_CSV_CHARS = 8_000_000;
const MAX_DATA_ROWS = 5000;
const MAX_LISTINGS = 2000;
const MAX_IMAGES_PER_PRODUCT = 20; // storefront schema cap (mediaUrls max 20)
const MAX_PRICE_CENTS = 10_000_00 * 100; // storefront create-schema cap ($1,000,000)
const EXPORT_ROW_CAP = 5000;
const CUSTOMER_ROW_CAP = 10000;

/* ── Caller's creator profile (same helper shape as storefront.ts) ────── */
async function callerProfile(userId: string): Promise<{ id: string; slug: string } | null> {
  const r = await db.execute(sql`
    SELECT id, slug FROM creator_profiles WHERE user_id = ${userId} LIMIT 1
  `);
  const row = r.rows[0] as Record<string, unknown> | undefined;
  return row ? { id: String(row["id"]), slug: String(row["slug"]) } : null;
}

/* ═══════════════════════ CSV: parse + write ═══════════════════════════
   RFC 4180: quoted fields may carry commas, quotes ("" escapes) and
   newlines; files may be CRLF or LF and may start with a BOM (Shopify
   exports from Excel often do). */

export interface CsvTable {
  headers: string[];
  records: { rowNumber: number; values: Record<string, string> }[];
}

export function parseCsv(text: string): CsvTable {
  const src = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else cell += c;
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      row.push(cell); cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length > 0) { row.push(cell); rows.push(row); }
  const nonEmpty = rows.filter((r) => !(r.length === 1 && r[0] === ""));
  if (nonEmpty.length === 0) return { headers: [], records: [] };
  const headers = nonEmpty[0]!.map((h) => h.trim());
  const records = nonEmpty.slice(1).map((cells, idx) => {
    const values: Record<string, string> = {};
    headers.forEach((h, j) => { values[h] = cells[j] ?? ""; });
    return { rowNumber: idx + 2, values }; // 1-based, header is row 1
  });
  return { headers, records };
}

export function csvCell(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))];
  return lines.join("\r\n") + "\r\n";
}

/* ═══════════════════ Money: string-exact, never floats ════════════════ */

/** Parse a Shopify money string ("29.99", "29.9", "$1,299.00") into integer
 *  cents by string math only — the cents that land in the DB are exactly
 *  the digits the file stated. Returns null + reason on anything else. */
export function parseMoneyToCents(raw: string): { cents: number } | { error: string } {
  const s = raw.trim().replace(/^\$/, "").replace(/,/g, "");
  if (s === "") return { error: "no price" };
  if (!/^\d+(\.\d+)?$/.test(s)) return { error: `price "${raw.trim()}" is not a plain number` };
  const [dollars, frac = ""] = s.split(".");
  if (frac.length > 2) return { error: `price "${raw.trim()}" has more than two decimal places` };
  const cents = Number(dollars) * 100 + Number((frac + "00").slice(0, 2));
  if (!Number.isSafeInteger(cents)) return { error: `price "${raw.trim()}" is too large` };
  if (cents <= 0) return { error: "Bow Down store prices must be above $0.00" };
  if (cents > MAX_PRICE_CENTS) return { error: "price is above the store maximum of $1,000,000.00" };
  return { cents };
}

/** Integer cents → "29.99" by string math (export side of the same rule). */
export function formatMoneyFromCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(cents));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Shopify Body is HTML; Bow Down descriptions are plain text (max 5000). */
export function stripHtmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function slugifyTitle(title: string): string {
  const s = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80).replace(/-+$/g, "");
  return s || "product";
}

/* ═══════════════════ Import planning (pure, shared) ═══════════════════
   planShopifyImport is pure: records + the caller's existing listing
   titles in, a per-row plan out. Preview returns the plan; commit runs
   the same plan and applies it — so what the preview promised is what
   the commit does. */

export interface PlannedListing {
  kind: "merch" | "digital";
  title: string;
  description: string;
  priceCents: number;
  compareAtCents: number | null;
  inventory: number;
  mediaUrls: string[];
  isActive: boolean;
}

export interface ImportRowReport {
  row: number;
  handle: string;
  sku: string | null;
  title: string | null;
  action: "create" | "update" | "image" | "reject";
  reason?: string;
  warnings: string[];
  productId?: string;
  listing?: PlannedListing;
}

interface ProductGroup {
  handle: string;
  rows: { rowNumber: number; values: Record<string, string> }[];
}

const REQUIRED_HEADERS = ["Handle", "Title", "Variant Price"];

export function planShopifyImport(
  table: CsvTable,
  existing: { id: string; title: string }[],
): { rows: ImportRowReport[]; listings: number } {
  const reports: ImportRowReport[] = [];
  const titleToId = new Map<string, string>();
  const titleCounts = new Map<string, number>();
  for (const p of existing) {
    titleCounts.set(p.title, (titleCounts.get(p.title) ?? 0) + 1);
    if (!titleToId.has(p.title)) titleToId.set(p.title, p.id);
  }
  const plannedTitles = new Set<string>(); // titles this file will have created/updated
  let listings = 0;

  /* Group by Handle, first-seen order. Rows with no Handle can't group. */
  const groups: ProductGroup[] = [];
  const byHandle = new Map<string, ProductGroup>();
  for (const rec of table.records) {
    const handle = (rec.values["Handle"] ?? "").trim();
    if (!handle) {
      reports.push({ row: rec.rowNumber, handle: "", sku: null, title: null, action: "reject", reason: "Missing Handle — Shopify groups a product's rows by Handle, and this row has none.", warnings: [] });
      continue;
    }
    let g = byHandle.get(handle);
    if (!g) { g = { handle, rows: [] }; byHandle.set(handle, g); groups.push(g); }
    g.rows.push(rec);
  }

  for (const group of groups) {
    const productRow = group.rows.find((r) => (r.values["Title"] ?? "").trim() !== "") ?? group.rows[0]!;
    const rawTitle = (productRow.values["Title"] ?? "").trim();

    /* Images for the whole product: every row's Image Src, Position order,
       plus variant images. Capped at the schema's 20 with a warning. */
    const imageRows = group.rows
      .filter((r) => (r.values["Image Src"] ?? "").trim() !== "")
      .sort((a, b) => (Number(a.values["Image Position"]) || 999) - (Number(b.values["Image Position"]) || 999));
    const imageUrls: string[] = [];
    for (const r of imageRows) {
      const u = (r.values["Image Src"] ?? "").trim();
      if (u && !imageUrls.includes(u)) imageUrls.push(u);
    }
    for (const r of group.rows) {
      const vu = (r.values["Variant Image"] ?? "").trim();
      if (vu && !imageUrls.includes(vu)) imageUrls.push(vu);
    }
    const productWarnings: string[] = [];
    if (imageUrls.length > MAX_IMAGES_PER_PRODUCT) {
      productWarnings.push(`Only the first ${MAX_IMAGES_PER_PRODUCT} images were kept — the file lists ${imageUrls.length}.`);
    }
    const mediaUrls = imageUrls.slice(0, MAX_IMAGES_PER_PRODUCT);
    const imageRowNumbers = new Set(imageRows.map((r) => r.rowNumber));

    const rejectGroup = (reason: string) => {
      for (const r of group.rows) {
        reports.push({
          row: r.rowNumber, handle: group.handle,
          sku: (r.values["Variant SKU"] ?? "").trim() || null,
          title: rawTitle || null, action: "reject", reason, warnings: [],
        });
      }
    };

    if (!rawTitle) { rejectGroup("No product Title — the product's first row must carry its Title."); continue; }
    if ((productRow.values["Gift Card"] ?? "").trim().toLowerCase() === "true") {
      /* Gift cards ARE a store kind now (Stack-100 #3 #26), but a CSV
         row can't carry the seller-set denominations a Bow Down gift
         card is sold from — creating one here would invent amounts.
         Honest rejection, with the real door named. */
      rejectGroup("Gift cards can't be imported from a CSV — create the gift card in your store dashboard instead, where you set the amounts fans can pick.");
      continue;
    }

    /* Product-level fields come from the titled row. */
    let description = stripHtmlToText(productRow.values["Body (HTML)"] ?? productRow.values["Description"] ?? "");
    if (description.length > 5000) {
      description = description.slice(0, 5000);
      productWarnings.push("Description was longer than the store's 5,000-character limit and was trimmed.");
    }
    const statusRaw = (productRow.values["Status"] ?? "").trim().toLowerCase();
    const publishedRaw = (productRow.values["Published"] ?? "").trim().toLowerCase();
    const isActive = statusRaw ? statusRaw === "active" : publishedRaw !== "false";

    /* A row is a VARIANT row when it carries variant data; a row with only
       an image is a continuation row of the product's gallery. */
    const isVariantRow = (v: Record<string, string>) =>
      (v["Variant Price"] ?? "").trim() !== "" ||
      (v["Variant SKU"] ?? "").trim() !== "" ||
      (v["Option1 Value"] ?? "").trim() !== "";

    for (const rec of group.rows) {
      const v = rec.values;
      const sku = (v["Variant SKU"] ?? "").trim() || null;
      if (!isVariantRow(v)) {
        if (imageRowNumbers.has(rec.rowNumber)) {
          reports.push({ row: rec.rowNumber, handle: group.handle, sku, title: rawTitle, action: "image", warnings: [], });
        } else {
          reports.push({ row: rec.rowNumber, handle: group.handle, sku, title: rawTitle, action: "reject", reason: "Row carries no variant (no price, SKU, or option value) and no image — nothing to import.", warnings: [] });
        }
        continue;
      }

      const rowWarnings = [...productWarnings];
      const optionValues = [v["Option1 Value"], v["Option2 Value"], v["Option3 Value"]]
        .map((s) => (s ?? "").trim())
        .filter((s) => s !== "" && s.toLowerCase() !== "default title");
      let listingTitle = optionValues.length > 0 ? `${rawTitle} — ${optionValues.join(" / ")}` : rawTitle;

      const fail = (reason: string) => {
        reports.push({ row: rec.rowNumber, handle: group.handle, sku, title: listingTitle, action: "reject", reason, warnings: rowWarnings });
      };

      if (listingTitle.length > 160) { fail(`Listing title is ${listingTitle.length} characters — the store caps titles at 160.`); continue; }

      const price = parseMoneyToCents(v["Variant Price"] ?? "");
      if ("error" in price) { fail(`Price can't be imported: ${price.error}.`); continue; }

      let compareAtCents: number | null = null;
      const compareRaw = (v["Variant Compare At Price"] ?? "").trim();
      if (compareRaw !== "") {
        const c = parseMoneyToCents(compareRaw);
        if ("error" in c) rowWarnings.push(`Compare-at price "${compareRaw}" couldn't be read and was left off.`);
        else compareAtCents = c.cents;
      }

      let inventory = -1; // -1 = untracked / unlimited, the storefront semantic
      const qtyRaw = (v["Variant Inventory Qty"] ?? "").trim();
      if (qtyRaw !== "") {
        const q = Number(qtyRaw);
        if (Number.isInteger(q)) {
          if (q < 0) { inventory = 0; rowWarnings.push("Stock was negative in the file (oversold) — listed as sold out (0)."); }
          else inventory = q;
        } else {
          rowWarnings.push(`Stock count "${qtyRaw}" couldn't be read — listed as untracked.`);
        }
      }

      const kind: "merch" | "digital" =
        (v["Variant Requires Shipping"] ?? "").trim().toLowerCase() === "false" ? "digital" : "merch";

      /* Same listing title twice in one file (two handles, one name): the
         second gets its handle appended so both survive — said out loud. */
      if (plannedTitles.has(listingTitle) || (titleCounts.get(listingTitle) ?? 0) > 1) {
        const disambiguated = `${listingTitle} (${group.handle})`;
        if (disambiguated.length <= 160 && !plannedTitles.has(disambiguated)) {
          rowWarnings.push(`Another listing already uses the title "${listingTitle}" — this one was named "${disambiguated}" so both survive.`);
          listingTitle = disambiguated;
        }
      }

      if (listings >= MAX_LISTINGS) { fail(`Import limit of ${MAX_LISTINGS} listings per file reached.`); continue; }
      listings++;

      const existingId = titleToId.get(listingTitle);
      /* Already in the store, or already created earlier in this same
         file → update. Otherwise → create. */
      const action: "create" | "update" = existingId || plannedTitles.has(listingTitle) ? "update" : "create";
      plannedTitles.add(listingTitle);

      reports.push({
        row: rec.rowNumber, handle: group.handle, sku, title: listingTitle,
        action, warnings: rowWarnings,
        productId: existingId,
        listing: { kind, title: listingTitle, description, priceCents: price.cents, compareAtCents, inventory, mediaUrls, isActive },
      });
    }
  }

  reports.sort((a, b) => a.row - b.row);
  return { rows: reports, listings };
}

function summarize(rows: ImportRowReport[]) {
  return {
    products: new Set(rows.map((r) => r.handle).filter(Boolean)).size,
    listings: rows.filter((r) => r.action === "create" || r.action === "update").length,
    creates: rows.filter((r) => r.action === "create").length,
    updates: rows.filter((r) => r.action === "update").length,
    images: rows.filter((r) => r.action === "image").length,
    rejected: rows.filter((r) => r.action === "reject").length,
  };
}

/* ═══════════════════════ Import endpoints ═════════════════════════════ */

const importBodySchema = z.object({ csv: z.string().min(1).max(MAX_CSV_CHARS) });

function parseImportBody(reqBody: unknown): { csv: string } | { error: string } {
  const parsed = importBodySchema.safeParse(reqBody ?? {});
  if (!parsed.success) return { error: "Send the CSV file's text as { csv } (max ~8 MB)." };
  return { csv: parsed.data.csv };
}

function loadImportPlan(csvText: string, existing: { id: string; title: string }[]) {
  const table = parseCsv(csvText);
  if (table.headers.length === 0) return { error: "That file is empty — no header row, no products." } as const;
  const missing = REQUIRED_HEADERS.filter((h) => !table.headers.includes(h));
  if (missing.length > 0) {
    return { error: `This doesn't look like a Shopify products CSV — missing column(s): ${missing.join(", ")}. Export your products from Shopify and use that file.` } as const;
  }
  if (table.records.length === 0) return { error: "That file has a header but no product rows." } as const;
  if (table.records.length > MAX_DATA_ROWS) {
    return { error: `That file has ${table.records.length} rows — the import limit is ${MAX_DATA_ROWS} rows per file.` } as const;
  }
  return { plan: planShopifyImport(table, existing) } as const;
}

async function existingListings(profileId: string): Promise<{ id: string; title: string }[]> {
  const r = await db.execute(sql`SELECT id, title FROM store_products WHERE profile_id = ${profileId}`);
  return (r.rows as Record<string, unknown>[]).map((row) => ({ id: String(row["id"]), title: String(row["title"]) }));
}

router.post("/storefront/shopify-import/preview", requireAuth, publicApiLimiter, async (req, res) => {
  const body = parseImportBody(req.body);
  if ("error" in body) { res.status(400).json({ error: body.error }); return; }
  try {
    const profile = await callerProfile(req.userId!);
    if (!profile) { res.status(404).json({ error: "NO_PROFILE", message: "You need a creator profile before you can sell." }); return; }
    const loaded = loadImportPlan(body.csv, await existingListings(profile.id));
    if ("error" in loaded) { res.status(400).json({ error: loaded.error }); return; }
    const { rows } = loaded.plan;
    res.json({ summary: summarize(rows), rows: rows.map(({ listing: _listing, ...rest }) => rest) });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[shopify-bridge] import preview failed");
    res.status(500).json({ error: "Could not read that file." });
  }
});

router.post("/storefront/shopify-import/commit", requireAuth, publicApiLimiter, async (req, res) => {
  const body = parseImportBody(req.body);
  if ("error" in body) { res.status(400).json({ error: body.error }); return; }
  try {
    const profile = await callerProfile(req.userId!);
    if (!profile) { res.status(404).json({ error: "NO_PROFILE", message: "You need a creator profile before you can sell." }); return; }
    const existing = await existingListings(profile.id);
    const loaded = loadImportPlan(body.csv, existing);
    if ("error" in loaded) { res.status(400).json({ error: loaded.error }); return; }
    const rows = loaded.plan.rows;

    /* Mirror image URLs once per unique URL for the whole run (mirror-on-
       save law: imported media is re-hosted, never left on a dying link).
       Best-effort inside the helper: a dead URL keeps its original value. */
    const mirrorCache = new Map<string, string>();
    const mirrorAll = async (urls: string[]): Promise<string[]> => {
      const out: string[] = [];
      for (const u of urls) {
        if (!mirrorCache.has(u)) {
          mirrorCache.set(u, (await mirrorExternalMediaUrl(u, { kind: "image", ownerKey: req.userId! })) ?? u);
        }
        out.push(mirrorCache.get(u)!);
      }
      return out;
    };

    const titleToId = new Map<string, string>();
    for (const p of existing) if (!titleToId.has(p.title)) titleToId.set(p.title, p.id);

    for (const row of rows) {
      if ((row.action !== "create" && row.action !== "update") || !row.listing) continue;
      const l = row.listing;
      const media = await mirrorAll(l.mediaUrls);
      const knownId = titleToId.get(l.title);
      if (knownId) {
        await db.execute(sql`
          UPDATE store_products
          SET kind = ${l.kind}, title = ${l.title}, description = ${l.description},
              price_cents = ${l.priceCents}, compare_at_cents = ${l.compareAtCents},
              inventory = ${l.inventory}, media_urls = ${JSON.stringify(media)}::jsonb,
              is_active = ${l.isActive}, updated_at = now()
          WHERE id = ${knownId} AND profile_id = ${profile.id}
        `);
        /* Wave 4 #38: a re-import that overwrites a listing's price is
           a price edit — a drop alerts fans who wishlisted it, once
           per drop (lib/wishlists owns the law and never throws). */
        await detectWishlistPriceDrop({
          itemKind: "store_product",
          itemId: knownId,
          newPriceCents: l.priceCents,
          title: l.title,
          link: `/storefront/product/${knownId}`,
        });
        row.action = "update";
        row.productId = knownId;
      } else {
        const r = await db.execute(sql`
          INSERT INTO store_products
            (profile_id, kind, title, description, price_cents, compare_at_cents,
             inventory, media_urls, service_details, event_id, related_links, is_active)
          VALUES (${profile.id}, ${l.kind}, ${l.title}, ${l.description}, ${l.priceCents},
                  ${l.compareAtCents}, ${l.inventory}, ${JSON.stringify(media)}::jsonb,
                  NULL, NULL, '[]'::jsonb, ${l.isActive})
          RETURNING id
        `);
        const id = String((r.rows[0] as Record<string, unknown>)["id"]);
        titleToId.set(l.title, id);
        row.action = "create";
        row.productId = id;
      }
    }

    logger.info({ userId: req.userId, summary: summarize(rows) }, "[shopify-bridge] import committed");
    res.json({ summary: summarize(rows), rows: rows.map(({ listing: _listing, ...rest }) => rest) });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[shopify-bridge] import commit failed");
    res.status(500).json({ error: "Could not import that file." });
  }
});

/* ═══════════════════════ Export builders ══════════════════════════════ */

export const SHOPIFY_PRODUCT_HEADERS = [
  "Handle", "Title", "Body (HTML)", "Vendor", "Type", "Tags", "Published",
  "Option1 Name", "Option1 Value", "Variant SKU", "Variant Inventory Tracker",
  "Variant Inventory Qty", "Variant Inventory Policy", "Variant Fulfillment Service",
  "Variant Price", "Variant Compare At Price", "Variant Requires Shipping",
  "Variant Taxable", "Image Src", "Image Position", "Status",
];

export interface ExportProduct {
  id: string; kind: string; title: string; description: string;
  priceCents: number; compareAtCents: number | null; inventory: number;
  mediaUrls: string[]; isActive: boolean;
}

export function buildShopifyProductsCsv(products: ExportProduct[]): string {
  const rows: unknown[][] = [];
  for (const p of products) {
    const handle = `${slugifyTitle(p.title)}-${p.id.replace(/-/g, "").slice(0, 8)}`;
    const requiresShipping = p.kind === "merch" ? "true" : "false";
    const base: unknown[] = [
      handle, p.title, p.description, "", "", "", p.isActive ? "TRUE" : "FALSE",
      "Title", "Default Title", "",
      p.inventory === -1 ? "" : "shopify",
      p.inventory === -1 ? "" : p.inventory,
      "deny", "manual",
      formatMoneyFromCents(p.priceCents),
      p.compareAtCents == null ? "" : formatMoneyFromCents(p.compareAtCents),
      requiresShipping, "true",
      p.mediaUrls[0] ?? "", p.mediaUrls.length > 0 ? 1 : "",
      p.isActive ? "active" : "draft",
    ];
    rows.push(base);
    p.mediaUrls.slice(1).forEach((u, i) => {
      const extra = new Array(SHOPIFY_PRODUCT_HEADERS.length).fill("");
      extra[0] = handle;
      extra[18] = u;          // Image Src
      extra[19] = i + 2;      // Image Position
      rows.push(extra);
    });
  }
  return toCsv(SHOPIFY_PRODUCT_HEADERS, rows);
}

export const SHOPIFY_ORDER_HEADERS = [
  "Name", "Email", "Financial Status", "Paid at", "Fulfillment Status",
  "Accepts Marketing", "Currency", "Subtotal", "Shipping", "Taxes", "Total",
  "Discount Code", "Discount Amount", "Created at",
  "Lineitem quantity", "Lineitem name", "Lineitem price", "Lineitem sku",
  "Lineitem requires shipping", "Lineitem taxable", "Lineitem fulfillment status",
  "Payment Method",
];

export interface ExportOrder {
  id: string; productTitle: string; productKind: string; quantity: number;
  amountCents: number; discountCode: string | null; status: string; createdAt: string;
}

export function buildShopifyOrdersCsv(orders: ExportOrder[]): string {
  const financial = (s: string) =>
    s === "completed" ? "paid" : s === "refunded" ? "refunded" : s === "pending" ? "pending" : s;
  const rows = orders.map((o) => {
    const qty = Math.max(1, o.quantity || 1);
    const unit = Math.round(o.amountCents / qty);
    return [
      o.id, "", financial(o.status),
      o.status === "completed" ? o.createdAt : "",
      "", "", "USD",
      formatMoneyFromCents(o.amountCents), "0.00", "0.00", formatMoneyFromCents(o.amountCents),
      o.discountCode ?? "", "", o.createdAt,
      qty, o.productTitle, formatMoneyFromCents(unit), "",
      o.productKind === "merch" ? "true" : "false", "true", "",
      o.status === "completed" ? "Stripe" : "",
    ];
  });
  return toCsv(SHOPIFY_ORDER_HEADERS, rows);
}

export const SHOPIFY_CUSTOMER_HEADERS = [
  "First Name", "Last Name", "Email", "Accepts Email Marketing", "Company",
  "Address1", "Address2", "City", "Province", "Province Code", "Country",
  "Country Code", "Zip", "Phone", "Total Spent", "Total Orders", "Tags", "Note",
];

export interface ExportCustomer { email: string; name: string | null; source: string }

export function buildShopifyCustomersCsv(customers: ExportCustomer[]): string {
  const rows = customers.map((c) => {
    const parts = (c.name ?? "").trim().split(/\s+/).filter(Boolean);
    const first = parts[0] ?? "";
    const last = parts.slice(1).join(" ");
    return [first, last, c.email, "yes", "", "", "", "", "", "", "", "", "", "", "", "", c.source, ""];
  });
  return toCsv(SHOPIFY_CUSTOMER_HEADERS, rows);
}

/* ═══════════════════════ Export endpoints ═════════════════════════════ */

function sendCsv(res: import("express").Response, filename: string, body: string) {
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(body);
}

router.get("/storefront/shopify-export/products", requireAuth, publicApiLimiter, async (req, res) => {
  try {
    const profile = await callerProfile(req.userId!);
    if (!profile) { res.status(404).json({ error: "NO_PROFILE", message: "You need a creator profile before you can sell." }); return; }
    const r = await db.execute(sql`
      SELECT id, kind, title, description, price_cents, compare_at_cents, inventory, media_urls, is_active
      FROM store_products WHERE profile_id = ${profile.id}
      ORDER BY created_at ASC LIMIT ${EXPORT_ROW_CAP}
    `);
    const products: ExportProduct[] = (r.rows as Record<string, unknown>[]).map((row) => ({
      id: String(row["id"]), kind: String(row["kind"]), title: String(row["title"]),
      description: String(row["description"] ?? ""), priceCents: Number(row["price_cents"]),
      compareAtCents: row["compare_at_cents"] == null ? null : Number(row["compare_at_cents"]),
      inventory: Number(row["inventory"]),
      mediaUrls: Array.isArray(row["media_urls"])
        ? (row["media_urls"] as string[])
        : typeof row["media_urls"] === "string"
          ? (JSON.parse(row["media_urls"]) as string[])
          : [],
      isActive: Boolean(row["is_active"]),
    }));
    sendCsv(res, "shopify-products.csv", buildShopifyProductsCsv(products));
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[shopify-bridge] products export failed");
    res.status(500).json({ error: "Could not export your products." });
  }
});

router.get("/storefront/shopify-export/orders", requireAuth, publicApiLimiter, async (req, res) => {
  try {
    const profile = await callerProfile(req.userId!);
    if (!profile) { res.status(404).json({ error: "NO_PROFILE", message: "You need a creator profile before you can sell." }); return; }
    const r = await db.execute(sql`
      SELECT id, product_title, product_kind, quantity, amount_cents, discount_code, status, created_at
      FROM store_orders WHERE profile_id = ${profile.id}
      ORDER BY created_at ASC LIMIT ${EXPORT_ROW_CAP}
    `);
    const orders: ExportOrder[] = (r.rows as Record<string, unknown>[]).map((row) => ({
      id: String(row["id"]), productTitle: String(row["product_title"] ?? ""),
      productKind: String(row["product_kind"] ?? "digital"), quantity: Number(row["quantity"] ?? 1),
      amountCents: Number(row["amount_cents"]), discountCode: (row["discount_code"] as string | null) ?? null,
      status: String(row["status"] ?? "completed"),
      createdAt: row["created_at"] instanceof Date ? (row["created_at"] as Date).toISOString() : String(row["created_at"]),
    }));
    sendCsv(res, "shopify-orders.csv", buildShopifyOrdersCsv(orders));
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[shopify-bridge] orders export failed");
    res.status(500).json({ error: "Could not export your orders." });
  }
});

router.get("/storefront/shopify-export/customers", requireAuth, publicApiLimiter, async (req, res) => {
  try {
    /* The fan list: subscribers on the caller's own email lists who have
       not unsubscribed — the same audience rule as the catalog manifest. */
    const r = await db.execute(sql`
      SELECT s.email AS email, s.name AS name, s.source AS source
      FROM email_subscribers s JOIN email_lists l ON l.id = s.list_id
      WHERE l.user_id = ${req.userId!} AND s.unsubscribed_at IS NULL
      ORDER BY s.subscribed_at ASC LIMIT ${CUSTOMER_ROW_CAP}
    `);
    const customers: ExportCustomer[] = (r.rows as Record<string, unknown>[]).map((row) => ({
      email: String(row["email"]), name: (row["name"] as string | null) ?? null, source: String(row["source"] ?? ""),
    }));
    sendCsv(res, "shopify-customers.csv", buildShopifyCustomersCsv(customers));
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[shopify-bridge] customers export failed");
    res.status(500).json({ error: "Could not export your fan list." });
  }
});

export default router;
