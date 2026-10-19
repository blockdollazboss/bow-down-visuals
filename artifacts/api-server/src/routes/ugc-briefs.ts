import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { db, ugcBriefsTable, ugcAdsTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { normalizeToStorageRef, refreshSupabaseStorageUrl } from "../lib/objectStorage";
import { mirrorExternalMediaUrl } from "../lib/mirrorMedia";
import { UGC_STYLES } from "./ugc-ads";

const router = Router();

/* ─── UGC Briefs Board (owner order Oct 19, 2026 — the business side) ──
   The other half of UGC Product Ads, in the same Promote surface: a
   brand posts a brief (product, what they want, style, deadline), a
   creator claims it and makes the ad with the same UGC tool (the
   brief pre-fills the ad's product/style), delivers it back through
   the board, and the brand approves it. Lifecycle:
     open → claimed → delivered → approved
     open|claimed → closed (brand) · claimed → open (claimer releases)
   Every other transition is refused (409) — no skipping states, no
   delivering an ad you don't own, no approving your own delivery.

   NO PAYMENT RAIL — by standing law the site pays nobody real money,
   so v1 briefs carry no price, fee, escrow, or Visual Bucs. The
   PAYMENT_NOTE below rides every brief DTO and the board UI states it
   plainly: payment is arranged between the brand and the creator
   directly.

   Visibility: open briefs are the board — any member can read them.
   A non-open brief reads only for its brand and its claimer; everyone
   else gets a 404, so a claimed brief's existence never leaks. */

export const UGC_BRIEF_PAYMENT_NOTE =
  "Bow Down Visuals doesn't hold or move money for briefs — payment is arranged between the brand and the creator directly.";

const BRIEF_STATUSES = ["open", "claimed", "delivered", "approved", "closed"] as const;

function iso(v: unknown): string {
  return v instanceof Date ? v.toISOString() : String(v ?? "");
}

async function toDTO(row: typeof ugcBriefsTable.$inferSelect) {
  return {
    id: row.id,
    brandUserId: row.brandUserId,
    productName: row.productName,
    productImageUrl: row.productImageRef
      ? await refreshSupabaseStorageUrl(row.productImageRef)
      : null,
    productUrl: row.productUrl ?? null,
    details: row.details,
    style: row.style,
    deadline: row.deadline ? iso(row.deadline) : null,
    status: row.status,
    claimedByUserId: row.claimedByUserId ?? null,
    deliveredAdId: row.deliveredAdId ?? null,
    paymentNote: UGC_BRIEF_PAYMENT_NOTE,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

type BriefDTO = Awaited<ReturnType<typeof toDTO>>;

/** A brief the caller may see: open (the board), theirs as brand, or
    theirs as claimer. Anything else is indistinguishable from missing. */
function canSee(row: typeof ugcBriefsTable.$inferSelect, userId: string): boolean {
  return (
    row.status === "open" ||
    row.brandUserId === userId ||
    row.claimedByUserId === userId
  );
}

async function loadBrief(id: string) {
  const [row] = await db
    .select()
    .from(ugcBriefsTable)
    .where(eq(ugcBriefsTable.id, id))
    .limit(1);
  return row ?? null;
}

async function saveBrief(
  id: string,
  patch: Partial<typeof ugcBriefsTable.$inferInsert>,
) {
  const [row] = await db
    .update(ugcBriefsTable)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(ugcBriefsTable.id, id))
    .returning();
  return row ?? null;
}

/* ── POST /api/ugc-briefs — a brand posts a brief ──────────────────── */
const createBriefSchema = z.object({
  productName: z.string().trim().min(1).max(120),
  productImageUrl: z
    .string()
    .trim()
    .max(2048)
    .regex(/^https?:\/\//, "must be an http(s) URL")
    .optional(),
  productUrl: z
    .string()
    .trim()
    .max(2048)
    .regex(/^https?:\/\//, "must be an http(s) URL")
    .optional(),
  details: z.string().trim().min(10, "Say what you want in the ad.").max(2000),
  style: z.enum(UGC_STYLES),
  deadline: z.string().trim().max(40).optional(),
});

router.post("/ugc-briefs", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = createBriefSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid brief.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const d = parsed.data;
  let deadline: Date | null = null;
  if (d.deadline) {
    const when = new Date(d.deadline);
    if (Number.isNaN(when.getTime())) {
      res.status(400).json({ error: "That deadline isn't a real date." });
      return;
    }
    deadline = when;
  }
  try {
    /* Product photo rides mirror-on-save, same as the ad side. */
    let productImageRef: string | null = null;
    if (d.productImageUrl) {
      const normalized = normalizeToStorageRef(d.productImageUrl) ?? d.productImageUrl;
      productImageRef = /^https?:\/\//i.test(normalized)
        ? ((await mirrorExternalMediaUrl(normalized, { kind: "image", ownerKey: req.userId! })) ?? normalized)
        : normalized;
    }
    const [row] = await db
      .insert(ugcBriefsTable)
      .values({
        brandUserId: req.userId!,
        productName: d.productName,
        productImageRef,
        productUrl: d.productUrl ?? null,
        details: d.details,
        style: d.style,
        deadline,
        status: "open",
      })
      .returning();
    res.status(201).json({ brief: await toDTO(row!) });
  } catch (err) {
    logger.error({ err }, "[ugc-briefs] create failed");
    res.status(500).json({ error: "Could not post that brief — try again." });
  }
});

/* ── GET /api/ugc-briefs?scope=open|posted|claimed ─────────────────── */
router.get("/ugc-briefs", requireAuth, async (req, res) => {
  const scope = typeof req.query["scope"] === "string" ? req.query["scope"] : "open";
  if (scope !== "open" && scope !== "posted" && scope !== "claimed") {
    res.status(400).json({ error: "scope must be open, posted, or claimed." });
    return;
  }
  const rawLimit = Number(req.query["limit"]);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(100, Math.floor(rawLimit)) : 50;
  try {
    const where =
      scope === "open"
        ? eq(ugcBriefsTable.status, "open")
        : scope === "posted"
          ? eq(ugcBriefsTable.brandUserId, req.userId!)
          : eq(ugcBriefsTable.claimedByUserId, req.userId!);
    const rows = await db
      .select()
      .from(ugcBriefsTable)
      .where(where)
      .orderBy(desc(ugcBriefsTable.createdAt))
      .limit(limit + 1);
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const briefs: BriefDTO[] = await Promise.all(page.map(toDTO));
    res.json({ briefs, limit, hasMore });
  } catch (err) {
    logger.error({ err }, "[ugc-briefs] list failed");
    res.status(500).json({ error: "Could not load the briefs board — try again." });
  }
});

/* ── GET /api/ugc-briefs/:id ───────────────────────────────────────── */
router.get("/ugc-briefs/:id", requireAuth, async (req, res) => {
  const { id } = req.params as { id: string };
  try {
    const row = await loadBrief(id);
    if (!row || !canSee(row, req.userId!)) {
      res.status(404).json({ error: "Brief not found" });
      return;
    }
    res.json({ brief: await toDTO(row) });
  } catch (err) {
    logger.error({ err }, "[ugc-briefs] get failed");
    res.status(500).json({ error: "Could not load that brief — try again." });
  }
});

/* ── POST /api/ugc-briefs/:id/claim — a creator takes the brief ────── */
router.post("/ugc-briefs/:id/claim", publicApiLimiter, requireAuth, async (req, res) => {
  const { id } = req.params as { id: string };
  try {
    const row = await loadBrief(id);
    if (!row || !canSee(row, req.userId!)) {
      res.status(404).json({ error: "Brief not found" });
      return;
    }
    if (row.brandUserId === req.userId) {
      res.status(400).json({ error: "This is your own brief — a creator has to claim it." });
      return;
    }
    if (row.status !== "open") {
      res.status(409).json({ error: `This brief is ${row.status} — only an open brief can be claimed.` });
      return;
    }
    const saved = await saveBrief(id, { status: "claimed", claimedByUserId: req.userId! });
    res.json({ brief: await toDTO(saved!) });
  } catch (err) {
    logger.error({ err }, "[ugc-briefs] claim failed");
    res.status(500).json({ error: "Could not claim that brief — try again." });
  }
});

/* ── POST /api/ugc-briefs/:id/release — the claimer hands it back ──── */
router.post("/ugc-briefs/:id/release", publicApiLimiter, requireAuth, async (req, res) => {
  const { id } = req.params as { id: string };
  try {
    const row = await loadBrief(id);
    if (!row || !canSee(row, req.userId!)) {
      res.status(404).json({ error: "Brief not found" });
      return;
    }
    if (row.claimedByUserId !== req.userId) {
      res.status(403).json({ error: "Only the creator who claimed this brief can release it." });
      return;
    }
    if (row.status !== "claimed") {
      res.status(409).json({ error: `This brief is ${row.status} — only a claimed brief can be released.` });
      return;
    }
    const saved = await saveBrief(id, { status: "open", claimedByUserId: null });
    res.json({ brief: await toDTO(saved!) });
  } catch (err) {
    logger.error({ err }, "[ugc-briefs] release failed");
    res.status(500).json({ error: "Could not release that brief — try again." });
  }
});

/* ── POST /api/ugc-briefs/:id/deliver — the claimer delivers the ad ── */
const deliverSchema = z.object({
  adId: z.string().uuid(),
});

router.post("/ugc-briefs/:id/deliver", publicApiLimiter, requireAuth, async (req, res) => {
  const { id } = req.params as { id: string };
  const parsed = deliverSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid delivery.", details: parsed.error.issues });
    return;
  }
  try {
    const row = await loadBrief(id);
    if (!row || !canSee(row, req.userId!)) {
      res.status(404).json({ error: "Brief not found" });
      return;
    }
    if (row.claimedByUserId !== req.userId) {
      res.status(403).json({ error: "Only the creator who claimed this brief can deliver on it." });
      return;
    }
    if (row.status !== "claimed") {
      res.status(409).json({ error: `This brief is ${row.status} — only a claimed brief can be delivered.` });
      return;
    }
    /* The delivered ad must be the claimer's own finished ad. Another
       member's ad, an unfinished ad, and a missing ad all read the
       same way: not deliverable. */
    const [ad] = await db
      .select()
      .from(ugcAdsTable)
      .where(and(eq(ugcAdsTable.id, parsed.data.adId), eq(ugcAdsTable.userId, req.userId!)))
      .limit(1);
    if (!ad || ad.status !== "ready") {
      res.status(400).json({ error: "That ad isn't one of your finished ads — generate it first, then deliver." });
      return;
    }
    if (ad.briefId && ad.briefId !== id) {
      res.status(400).json({ error: "That ad was made for a different brief." });
      return;
    }
    if (!ad.briefId) {
      await db
        .update(ugcAdsTable)
        .set({ briefId: id, updatedAt: new Date() })
        .where(eq(ugcAdsTable.id, ad.id));
    }
    const saved = await saveBrief(id, { status: "delivered", deliveredAdId: ad.id });
    res.json({ brief: await toDTO(saved!) });
  } catch (err) {
    logger.error({ err }, "[ugc-briefs] deliver failed");
    res.status(500).json({ error: "Could not deliver that ad — try again." });
  }
});

/* ── POST /api/ugc-briefs/:id/approve — the brand accepts delivery ─── */
router.post("/ugc-briefs/:id/approve", publicApiLimiter, requireAuth, async (req, res) => {
  const { id } = req.params as { id: string };
  try {
    const row = await loadBrief(id);
    if (!row || !canSee(row, req.userId!)) {
      res.status(404).json({ error: "Brief not found" });
      return;
    }
    if (row.brandUserId !== req.userId) {
      res.status(403).json({ error: "Only the brand that posted this brief can approve a delivery." });
      return;
    }
    if (row.status !== "delivered") {
      res.status(409).json({ error: `This brief is ${row.status} — only a delivered brief can be approved.` });
      return;
    }
    const saved = await saveBrief(id, { status: "approved" });
    res.json({ brief: await toDTO(saved!) });
  } catch (err) {
    logger.error({ err }, "[ugc-briefs] approve failed");
    res.status(500).json({ error: "Could not approve that delivery — try again." });
  }
});

/* ── POST /api/ugc-briefs/:id/close — the brand closes the brief ──── */
router.post("/ugc-briefs/:id/close", publicApiLimiter, requireAuth, async (req, res) => {
  const { id } = req.params as { id: string };
  try {
    const row = await loadBrief(id);
    if (!row || !canSee(row, req.userId!)) {
      res.status(404).json({ error: "Brief not found" });
      return;
    }
    if (row.brandUserId !== req.userId) {
      res.status(403).json({ error: "Only the brand that posted this brief can close it." });
      return;
    }
    if (row.status !== "open" && row.status !== "claimed") {
      res.status(409).json({
        error: `This brief is ${row.status} — only an open or claimed brief can be closed.`,
      });
      return;
    }
    const saved = await saveBrief(id, { status: "closed" });
    res.json({ brief: await toDTO(saved!) });
  } catch (err) {
    logger.error({ err }, "[ugc-briefs] close failed");
    res.status(500).json({ error: "Could not close that brief — try again." });
  }
});

export { BRIEF_STATUSES };
export default router;
