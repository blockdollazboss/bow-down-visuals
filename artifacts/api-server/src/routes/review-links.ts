import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { z } from "zod";
import { db, reviewLinksTable, reviewCommentsTable, generatedClipsTable } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { randomBytes, createHash, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const router = Router();

/* ── Pricing: FREE ────────────────────────────────────────────────────────────
 * Review links cost nothing to create or use. No comparable sharing/publishing
 * flow is priced in credit-costs.ts (showcase publishing, NFC profiles, press
 * kits are all free); serving a link is a few DB rows with zero provider
 * spend, and every shared link is a branded touchpoint — a growth loop, not
 * a cost center.
 */

/* ── Crypto helpers ─────────────────────────────────────────────────────────── */

const scryptAsync = promisify(scrypt);

/** Express types req.params values as string | string[] — coerce. */
function tokenParam(req: { params: Record<string, string | string[]> }): string {
  const v = req.params["token"];
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

/** Same coercion for the :id param used by manage endpoints. */
function idParam(req: { params: Record<string, string | string[]> }): string {
  const v = req.params["id"];
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}
/** sha256 hex of the public URL token — the raw token is never stored. */
function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const key = (await scryptAsync(password, salt, 32)) as Buffer;
  return `scrypt$${salt}$${key.toString("hex")}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt" || !parts[1] || !parts[2]) return false;
  const key = (await scryptAsync(password, parts[1], 32)) as Buffer;
  const expected = Buffer.from(parts[2], "hex");
  return key.length === expected.length && timingSafeEqual(key, expected);
}

function ipHash(req: { ip?: string; headers: Record<string, unknown> }): string {
  const ip = req.ip ?? "unknown";
  const ua = String(req.headers["user-agent"] ?? "");
  return createHash("sha256").update(`${ip}|${ua}`).digest("hex").slice(0, 32);
}

/* ── Rate limiters ──────────────────────────────────────────────────────────── */

/** Link creation: 30/hour per user — cheap DB write, but not a spam cannon. */
const reviewCreateLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => (req as { userId?: string }).userId || req.ip || "unknown",
  message: { error: "Too many review links. Please try again later." },
});

/** Password attempts: 10/min per IP per token — brute-force guard. */
const reviewUnlockLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => `${req.ip ?? "unknown"}|${tokenParam(req as { params: Record<string, string | string[]> })}`,
  message: { error: "Too many attempts. Please try again in a minute." },
});

/* ── Validation ─────────────────────────────────────────────────────────────── */

const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

const CreateLinkSchema = z.object({
  videoUrl: z.string().trim().min(1).max(2000).refine(
    (u) => { try { const p = new URL(u); return p.protocol === "http:" || p.protocol === "https:"; } catch { return false; } },
    "videoUrl must be a valid http(s) URL",
  ),
  title: z.string().trim().min(1).max(120),
  sourceType: z.enum(["clip", "project_export", "other"]).default("other"),
  sourceId: z.string().trim().max(80).optional().nullable(),
  expiresInDays: z.number().int().min(1).max(365).nullable().default(14),
  password: z.string().min(4).max(64).optional().nullable(),
});

const UnlockSchema = z.object({
  password: z.string().min(1).max(64),
});

const CommentSchema = z.object({
  name: z.string().trim().min(1).max(80),
  timestampSec: z.number().finite().min(0).max(86400),
  text: z.string().trim().min(1).max(1000),
});

const ManageActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("set_status"), status: z.enum(["open", "changes_requested", "approved", "closed"]) }),
  z.object({ action: z.literal("hide_comment"), commentId: z.string().uuid(), hidden: z.boolean() }),
  z.object({ action: z.literal("delete_comment"), commentId: z.string().uuid() }),
  z.object({ action: z.literal("mark_seen") }),
  z.object({ action: z.literal("extend"), expiresInDays: z.number().int().min(1).max(365).nullable() }),
  /* Mint a fresh token (invalidates the old URL). Used by "notify reviewer":
     the creator copies the fresh link after re-exporting an updated cut. */
  z.object({ action: z.literal("regenerate") }),
]);

/* ── Internal helpers ───────────────────────────────────────────────────────── */

type ReviewLink = typeof reviewLinksTable.$inferSelect;

async function findLinkByToken(token: string): Promise<ReviewLink | null> {
  if (!TOKEN_RE.test(token)) return null;
  const rows = await db
    .select()
    .from(reviewLinksTable)
    .where(eq(reviewLinksTable.token_hash, hashToken(token)))
    .limit(1);
  return rows[0] ?? null;
}

/** Returns an error payload when the link can't be viewed, else null. */
function linkBlock(link: ReviewLink): { status: number; error: string } | null {
  if (link.expires_at && new Date(link.expires_at).getTime() < Date.now()) {
    return { status: 410, error: "This review link has expired." };
  }
  if (link.status === "closed") {
    return { status: 410, error: "This review link has been closed by the creator." };
  }
  return null;
}

/**
 * Resolve the freshest playable video URL. Clip storage URLs rotate, so for
 * clip-sourced links we re-read the current URL from generated_clips and fall
 * back to the snapshot stored at creation.
 */
async function resolveVideoUrl(link: ReviewLink): Promise<string> {
  if (link.source_type === "clip" && link.source_id) {
    try {
      const rows = await db
        .select({ video_url: generatedClipsTable.video_url })
        .from(generatedClipsTable)
        .where(eq(generatedClipsTable.id, link.source_id))
        .limit(1);
      const fresh = rows[0]?.video_url;
      if (fresh) return fresh;
    } catch { /* fall through to stored snapshot */ }
  }
  return link.video_url;
}

function publicCommentShape(c: typeof reviewCommentsTable.$inferSelect) {
  return {
    id: c.id,
    name: c.name,
    timestampSec: c.timestamp_sec,
    text: c.text,
    createdAt: c.created_at ? new Date(c.created_at).toISOString() : null,
  };
}

/**
 * Virality: the creator's referral code for the public review page, so every
 * client view can become a referred signup (25% revenue share for the
 * creator). Never auto-creates — a public GET must not have side effects;
 * null when the creator hasn't generated a code yet.
 */
async function getReferralCode(userId: string): Promise<string | null> {
  try {
    const rows = await db.execute(
      sql`SELECT code FROM referral_codes WHERE user_id = ${userId} LIMIT 1`,
    );
    const code = (rows as unknown as { code?: string }[])[0]?.code;
    return typeof code === "string" && code.length > 0 ? code : null;
  } catch {
    return null;
  }
}

async function publicLinkPayload(link: ReviewLink) {
  const comments = await db
    .select()
    .from(reviewCommentsTable)
    .where(and(eq(reviewCommentsTable.link_id, link.id), eq(reviewCommentsTable.hidden, false)))
    .orderBy(reviewCommentsTable.created_at);
  return {
    locked: false,
    title: link.title,
    videoUrl: await resolveVideoUrl(link),
    status: link.status,
    expiresAt: link.expires_at ? new Date(link.expires_at).toISOString() : null,
    comments: comments.map(publicCommentShape),
    referralCode: await getReferralCode(link.user_id),
  };
}

/* ── POST /api/review-links — create a shareable review link (auth, FREE) ──── */

router.post("/review-links", requireAuth, reviewCreateLimiter, async (req, res) => {
  const parsed = CreateLinkSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid review link data" });
    return;
  }
  const d = parsed.data;
  const token = randomBytes(24).toString("base64url"); // 32 chars, unguessable
  const expiresAt = d.expiresInDays ? new Date(Date.now() + d.expiresInDays * 86_400_000) : null;

  try {
    const [row] = await db
      .insert(reviewLinksTable)
      .values({
        user_id: req.userId!,
        token_hash: hashToken(token),
        title: d.title,
        video_url: d.videoUrl,
        source_type: d.sourceType,
        source_id: d.sourceId ?? null,
        password_hash: d.password ? await hashPassword(d.password) : null,
        status: "open",
        expires_at: expiresAt,
      })
      .returning({ id: reviewLinksTable.id });

    res.status(201).json({
      id: row!.id,
      token,
      url: `/review/${token}`,
      hasPassword: !!d.password,
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
    });
  } catch (err) {
    // Extremely unlikely token_hash collision — retry once with a fresh token
    const token2 = randomBytes(24).toString("base64url");
    try {
      const [row] = await db
        .insert(reviewLinksTable)
        .values({
          user_id: req.userId!,
          token_hash: hashToken(token2),
          title: d.title,
          video_url: d.videoUrl,
          source_type: d.sourceType,
          source_id: d.sourceId ?? null,
          password_hash: d.password ? await hashPassword(d.password) : null,
          status: "open",
          expires_at: expiresAt,
        })
        .returning({ id: reviewLinksTable.id });
      res.status(201).json({
        id: row!.id,
        token: token2,
        url: `/review/${token2}`,
        hasPassword: !!d.password,
        expiresAt: expiresAt ? expiresAt.toISOString() : null,
      });
    } catch {
      res.status(500).json({ error: "Could not create review link" });
    }
  }
});

/* ── GET /api/review-links/mine — creator's links + feedback (auth) ────────── */
/* NOTE: registered before /:token so "mine" is never treated as a token. */

router.get("/review-links/mine", requireAuth, async (req, res) => {
  const videoUrl = typeof req.query.videoUrl === "string" && req.query.videoUrl.length > 0
    ? req.query.videoUrl.slice(0, 2000)
    : null;
  /* sourceType/sourceId matching is rotation-proof: clip storage URLs rotate,
     so matching on the immutable source pair keeps the feedback badge alive. */
  const sourceType = typeof req.query.sourceType === "string" && ["clip", "project_export", "other"].includes(req.query.sourceType)
    ? req.query.sourceType
    : null;
  const sourceId = typeof req.query.sourceId === "string" && req.query.sourceId.length > 0
    ? req.query.sourceId.slice(0, 80)
    : null;
  const where = sourceType && sourceId
    ? and(
        eq(reviewLinksTable.user_id, req.userId!),
        eq(reviewLinksTable.source_type, sourceType),
        eq(reviewLinksTable.source_id, sourceId),
      )
    : videoUrl
      ? and(eq(reviewLinksTable.user_id, req.userId!), eq(reviewLinksTable.video_url, videoUrl))
      : eq(reviewLinksTable.user_id, req.userId!);
  try {
    const links = await db
      .select()
      .from(reviewLinksTable)
      .where(where)
      .orderBy(desc(reviewLinksTable.created_at))
      .limit(100);

    const out = await Promise.all(
      links.map(async (link) => {
        const comments = await db
          .select()
          .from(reviewCommentsTable)
          .where(eq(reviewCommentsTable.link_id, link.id))
          .orderBy(desc(reviewCommentsTable.created_at))
          .limit(50);
        const seenAt = link.feedback_seen_at ? new Date(link.feedback_seen_at).getTime() : 0;
        const newCount = comments.filter(
          (c) => c.created_at && new Date(c.created_at).getTime() > seenAt,
        ).length;
        return {
          id: link.id,
          title: link.title,
          token: null as string | null, // token is only ever returned at creation
          url: null as string | null,
          status: link.status,
          hasPassword: !!link.password_hash,
          expiresAt: link.expires_at ? new Date(link.expires_at).toISOString() : null,
          createdAt: link.created_at ? new Date(link.created_at).toISOString() : null,
          commentCount: comments.length,
          newCommentCount: newCount,
          sourceType: link.source_type,
          sourceId: link.source_id,
          latestComments: comments.slice(0, 10).map(publicCommentShape),
        };
      }),
    );
    res.json({ links: out });
  } catch {
    res.status(500).json({ error: "Could not load review links" });
  }
});

/* ── GET /api/review-links/:token — public review payload (rate-limited) ────── */

router.get("/review-links/:token", publicApiLimiter, async (req, res) => {
  const link = await findLinkByToken(tokenParam(req));
  if (!link) {
    res.status(404).json({ error: "Review link not found." });
    return;
  }
  const blocked = linkBlock(link);
  if (blocked) {
    res.status(blocked.status).json({ error: blocked.error });
    return;
  }
  if (link.password_hash) {
    // Title stays hidden until the password is verified — no info leak.
    res.json({ locked: true, hasPassword: true });
    return;
  }
  res.json(await publicLinkPayload(link));
});

/* ── POST /api/review-links/:token/unlock — verify password (rate-limited) ──── */

router.post("/review-links/:token/unlock", reviewUnlockLimiter, async (req, res) => {
  const link = await findLinkByToken(tokenParam(req));
  if (!link) {
    res.status(404).json({ error: "Review link not found." });
    return;
  }
  const blocked = linkBlock(link);
  if (blocked) {
    res.status(blocked.status).json({ error: blocked.error });
    return;
  }
  const parsed = UnlockSchema.safeParse(req.body);
  if (!parsed.success || !link.password_hash) {
    res.status(400).json({ error: "Invalid request." });
    return;
  }
  const ok = await verifyPassword(parsed.data.password, link.password_hash);
  if (!ok) {
    res.status(403).json({ error: "Wrong password." });
    return;
  }
  res.json(await publicLinkPayload(link));
});

/* ── POST /api/review-links/:token/comments — public timestamped comment ───── */

router.post("/review-links/:token/comments", publicApiLimiter, async (req, res) => {
  const link = await findLinkByToken(tokenParam(req));
  if (!link) {
    res.status(404).json({ error: "Review link not found." });
    return;
  }
  const blocked = linkBlock(link);
  if (blocked) {
    res.status(blocked.status).json({ error: blocked.error });
    return;
  }
  if (link.password_hash) {
    // Password-protected links require the unlock step first (v1: enforced by
    // the client flow; the password itself is never re-sent here).
    res.status(403).json({ error: "This review link is password protected." });
    return;
  }
  const parsed = CommentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid comment. Add your name, a timestamp and your note." });
    return;
  }
  const d = parsed.data;
  try {
    const [comment] = await db
      .insert(reviewCommentsTable)
      .values({
        link_id: link.id,
        name: d.name,
        timestamp_sec: Math.round(d.timestampSec * 10) / 10,
        text: d.text,
        hidden: false,
        ip_hash: ipHash(req),
      })
      .returning();
    res.status(201).json({ comment: publicCommentShape(comment!) });
  } catch {
    res.status(500).json({ error: "Could not save your comment." });
  }
});

/* ── GET /api/review-links/:token/manage — owner check (auth) ──────────────── */

router.get("/review-links/:token/manage", requireAuth, async (req, res) => {
  const link = await findLinkByToken(tokenParam(req));
  if (!link) {
    res.status(404).json({ error: "Review link not found." });
    return;
  }
  if (link.user_id !== req.userId) {
    res.status(403).json({ error: "Not your review link." });
    return;
  }
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(reviewCommentsTable)
    .where(eq(reviewCommentsTable.link_id, link.id));
  res.json({
    isOwner: true,
    id: link.id,
    title: link.title,
    status: link.status,
    hasPassword: !!link.password_hash,
    expiresAt: link.expires_at ? new Date(link.expires_at).toISOString() : null,
    commentCount: count ?? 0,
    sourceType: link.source_type,
    sourceId: link.source_id,
  });
});

/* ── PATCH /api/review-links/:id — creator actions (auth + ownership) ─────── */

router.patch("/review-links/:id", requireAuth, async (req, res) => {
  const parsed = ManageActionSchema.safeParse(req.body);
  if (!parsed.success || !z.string().uuid().safeParse(req.params.id).success) {
    res.status(400).json({ error: "Invalid request." });
    return;
  }
  const linkId = idParam(req);
  const owns = await db
    .select({ id: reviewLinksTable.id })
    .from(reviewLinksTable)
    .where(and(eq(reviewLinksTable.id, linkId), eq(reviewLinksTable.user_id, req.userId!)))
    .limit(1);
  if (!owns[0]) {
    res.status(404).json({ error: "Review link not found." });
    return;
  }

  const a = parsed.data;
  try {
    if (a.action === "set_status") {
      await db.update(reviewLinksTable)
        .set({ status: a.status, updated_at: new Date() })
        .where(eq(reviewLinksTable.id, linkId));
    } else if (a.action === "hide_comment") {
      await db.update(reviewCommentsTable)
        .set({ hidden: a.hidden })
        .where(and(eq(reviewCommentsTable.id, a.commentId), eq(reviewCommentsTable.link_id, linkId)));
    } else if (a.action === "delete_comment") {
      await db.delete(reviewCommentsTable)
        .where(and(eq(reviewCommentsTable.id, a.commentId), eq(reviewCommentsTable.link_id, linkId)));
    } else if (a.action === "mark_seen") {
      await db.update(reviewLinksTable)
        .set({ feedback_seen_at: new Date(), updated_at: new Date() })
        .where(eq(reviewLinksTable.id, linkId));
    } else if (a.action === "extend") {
      await db.update(reviewLinksTable)
        .set({
          expires_at: a.expiresInDays ? new Date(Date.now() + a.expiresInDays * 86_400_000) : null,
          updated_at: new Date(),
        })
        .where(eq(reviewLinksTable.id, linkId));
      res.json({ ok: true });
      return;
    } else if (a.action === "regenerate") {
      const newToken = randomBytes(24).toString("base64url");
      await db.update(reviewLinksTable)
        .set({ token_hash: hashToken(newToken), updated_at: new Date() })
        .where(eq(reviewLinksTable.id, linkId));
      res.json({ ok: true, token: newToken, url: `/review/${newToken}` });
      return;
    }
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Could not update review link." });
  }
});

/* ── DELETE /api/review-links/:id — delete link + comments (auth + owner) ─── */

router.delete("/review-links/:id", requireAuth, async (req, res) => {
  if (!z.string().uuid().safeParse(req.params.id).success) {
    res.status(400).json({ error: "Invalid request." });
    return;
  }
  const linkId = idParam(req);
  try {
    const deleted = await db.delete(reviewLinksTable)
      .where(and(eq(reviewLinksTable.id, linkId), eq(reviewLinksTable.user_id, req.userId!)))
      .returning({ id: reviewLinksTable.id });
    if (!deleted[0]) {
      res.status(404).json({ error: "Review link not found." });
      return;
    }
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Could not delete review link." });
  }
});

export default router;
