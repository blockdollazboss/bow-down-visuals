import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { requireAuth } from "../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError, LedgerWriteError } from "../lib/credits";
import { getSupabaseAdmin } from "../lib/supabase-admin";
import { db, bioPagesTable, bioLinkClicksTable, BIO_THEME_KEYS, BIO_LINK_ICON_KEYS } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";

const router = Router();

/* ─── Link-in-Bio pages ─────────────────────────────────────────────────
   Creators build a public link-in-bio page served at /bio/:slug (no login
   required). Drafting is free; publishing costs 100 Visual Bucs (402
   pre-check via chargeCredits, auto-refund on publish failure — the same
   money-integrity path as album publish). Click analytics feed the
   builder's counts dashboard. */

/* 100 Visual Bucs to publish a bio page. Drafting is free. */
const PUBLISH_COST = 100;

function param(req: Request, name: string): string {
  const v = req.params[name];
  return Array.isArray(v) ? v[0] : v;
}

/** Exported for unit tests. */
export function isAllowedUrl(v: string): boolean {
  if (/^\/(?!\/)/.test(v)) return true; // site-relative
  return /^(https?:\/\/|mailto:|tel:)/i.test(v);
}

const linkRowSchema = z.object({
  title: z.string().min(1).max(60),
  url: z.string().max(800).refine(isAllowedUrl, { message: "URL must be http(s), mailto:, tel:, or site-relative" }),
  icon: z.string().max(30).optional().default("link"),
});

const socialsSchema = z.object({
  instagram: z.string().max(800).optional().default(""),
  tiktok: z.string().max(800).optional().default(""),
  youtube: z.string().max(800).optional().default(""),
  x: z.string().max(800).optional().default(""),
  spotify: z.string().max(800).optional().default(""),
  discord: z.string().max(800).optional().default(""),
}).partial().default({});

const featuredSchema = z.object({
  label: z.string().min(1).max(80),
  url: z.string().max(800).refine(isAllowedUrl, { message: "URL must be http(s), mailto:, tel:, or site-relative" }),
  kind: z.string().max(30).optional().default("other"),
});

const bioSaveSchema = z.object({
  displayName: z.string().min(1).max(80),
  headline: z.string().max(120).optional().default(""),
  bio: z.string().max(600).optional().default(""),
  avatarUrl: z.string().url().max(800).optional().nullable(),
  links: z.array(linkRowSchema).max(25).optional().default([]),
  socials: socialsSchema,
  theme: z.string().min(1).max(40).optional().default("gold-royal"),
  featured: z.array(featuredSchema).max(12).optional().default([]),
  tipJarUrl: z.string().max(800).refine((v) => !v || isAllowedUrl(v), {
    message: "Tip jar URL must be http(s), mailto:, tel:, or site-relative",
  }).optional().nullable(),
  slug: z.string().min(3).max(40).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase letters, numbers, and hyphens").optional(),
});

/* Social URL allow-list, shared by create + update (stored values become hrefs). */
function validateSocialUrls(socials: Record<string, string | undefined> | undefined): string | null {
  for (const v of Object.values(socials ?? {})) {
    if (v && !isAllowedUrl(v)) return "Social URLs must be http(s) or site-relative";
  }
  return null;
}

/** Exported for unit tests. */
export function slugify(name: string): string {
  const s = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return s || "bio";
}

async function uniqueSlug(base: string, excludeId?: string): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const slug = i === 0 ? base : `${base}-${randomBytes(2).toString("hex")}`;
    const rows = await db.select({ id: bioPagesTable.id }).from(bioPagesTable).where(eq(bioPagesTable.slug, slug)).limit(1);
    const taken = rows.some((r) => r.id !== excludeId);
    if (!taken) return slug;
  }
  return `${base}-${Date.now().toString(36)}`;
}

function publicUrl(slug: string): string {
  return `https://bowdownvisuals.com/bio/${slug}`;
}

function toPublicPage(row: Record<string, unknown>) {
  return {
    slug: row.slug,
    displayName: row.displayName,
    headline: row.headline,
    bio: row.bio,
    avatarUrl: row.avatarUrl,
    links: row.links,
    socials: row.socials,
    theme: row.theme,
    featured: row.featured,
    tipJarUrl: row.tipJarUrl,
    viewCount: row.viewCount,
    url: publicUrl(String(row.slug)),
  };
}

/* GET /api/bio-pages/me — the signed-in creator's pages. */
router.get("/bio-pages/me", requireAuth, async (req: Request, res: Response) => {
  try {
    const rows = await db
      .select()
      .from(bioPagesTable)
      .where(eq(bioPagesTable.userId, req.userId!))
      .orderBy(desc(bioPagesTable.updatedAt));
    res.json({
      ok: true,
      pages: rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        displayName: r.displayName,
        headline: r.headline,
        bio: r.bio,
        avatarUrl: r.avatarUrl,
        links: r.links,
        socials: r.socials,
        theme: r.theme,
        featured: r.featured,
        tipJarUrl: r.tipJarUrl,
        isPublished: r.isPublished,
        viewCount: r.viewCount,
        url: publicUrl(r.slug),
        updatedAt: r.updatedAt,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "[bio-pages] list failed");
    res.status(500).json({ ok: false, error: "Failed to load bio pages" });
  }
});

/* POST /api/bio-pages — create a draft (free). */
router.post("/bio-pages", requireAuth, async (req: Request, res: Response) => {
  const parsed = bioSaveSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: "Invalid bio page data", details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  if (!(BIO_THEME_KEYS as Set<string>).has(d.theme)) {
    res.status(400).json({ ok: false, error: "Unknown theme" });
    return;
  }
  for (const l of d.links) {
    if (l.icon && !BIO_LINK_ICON_KEYS.has(l.icon)) {
      res.status(400).json({ ok: false, error: `Unknown link icon: ${l.icon}` });
      return;
    }
  }
  const socialErr = validateSocialUrls(d.socials);
  if (socialErr) {
    res.status(400).json({ ok: false, error: socialErr });
    return;
  }
  try {
    const slug = await uniqueSlug(d.slug ?? slugify(d.displayName));
    const [row] = await db
      .insert(bioPagesTable)
      .values({
        userId: req.userId!,
        slug,
        displayName: d.displayName,
        headline: d.headline ?? "",
        bio: d.bio ?? "",
        avatarUrl: d.avatarUrl ?? null,
        links: d.links.map((l) => ({ title: l.title, url: l.url, icon: l.icon ?? "link" })),
        socials: d.socials ?? {},
        theme: d.theme,
        featured: d.featured.map((f) => ({ label: f.label, url: f.url, kind: f.kind ?? "other" })),
        tipJarUrl: d.tipJarUrl ?? null,
        isPublished: false,
      })
      .returning();
    res.json({ ok: true, page: { ...toPublicPage(row as unknown as Record<string, unknown>), id: row.id, isPublished: false, url: publicUrl(slug) } });
  } catch (err) {
    req.log.error({ err }, "[bio-pages] create failed");
    res.status(500).json({ ok: false, error: "Failed to create bio page" });
  }
});

/* PUT /api/bio-pages/:id — update a draft (free). */
router.put("/bio-pages/:id", requireAuth, async (req: Request, res: Response) => {
  const id = param(req, "id");
  const parsed = bioSaveSchema.partial().safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: "Invalid bio page data", details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  if (d.theme && !(BIO_THEME_KEYS as Set<string>).has(d.theme)) {
    res.status(400).json({ ok: false, error: "Unknown theme" });
    return;
  }
  for (const l of d.links ?? []) {
    if (l.icon && !BIO_LINK_ICON_KEYS.has(l.icon)) {
      res.status(400).json({ ok: false, error: `Unknown link icon: ${l.icon}` });
      return;
    }
  }
  const socialErr = validateSocialUrls(d.socials as Record<string, string | undefined> | undefined);
  if (socialErr) {
    res.status(400).json({ ok: false, error: socialErr });
    return;
  }
  try {
    const [existing] = await db.select().from(bioPagesTable).where(eq(bioPagesTable.id, id)).limit(1);
    if (!existing || existing.userId !== req.userId) {
      res.status(404).json({ ok: false, error: "Bio page not found" });
      return;
    }
    let slug = existing.slug;
    if (d.slug && d.slug !== existing.slug) {
      slug = await uniqueSlug(d.slug, existing.id);
    }
    const [row] = await db
      .update(bioPagesTable)
      .set({
        ...(d.displayName !== undefined ? { displayName: d.displayName } : {}),
        ...(d.headline !== undefined ? { headline: d.headline } : {}),
        ...(d.bio !== undefined ? { bio: d.bio } : {}),
        ...(d.avatarUrl !== undefined ? { avatarUrl: d.avatarUrl } : {}),
        ...(d.links !== undefined ? { links: d.links.map((l) => ({ title: l.title, url: l.url, icon: l.icon ?? "link" })) } : {}),
        ...(d.socials !== undefined ? { socials: d.socials } : {}),
        ...(d.theme !== undefined ? { theme: d.theme } : {}),
        ...(d.featured !== undefined ? { featured: d.featured.map((f) => ({ label: f.label, url: f.url, kind: f.kind ?? "other" })) } : {}),
        ...(d.tipJarUrl !== undefined ? { tipJarUrl: d.tipJarUrl } : {}),
        slug,
        updatedAt: new Date(),
      })
      .where(eq(bioPagesTable.id, id))
      .returning();
    res.json({ ok: true, page: { ...toPublicPage(row as unknown as Record<string, unknown>), id: row.id, isPublished: row.isPublished, url: publicUrl(row.slug) } });
  } catch (err) {
    req.log.error({ err }, "[bio-pages] update failed");
    res.status(500).json({ ok: false, error: "Failed to save bio page" });
  }
});

/* DELETE /api/bio-pages/:id — delete a draft. */
router.delete("/bio-pages/:id", requireAuth, async (req: Request, res: Response) => {
  const id = param(req, "id");
  try {
    const [existing] = await db.select({ id: bioPagesTable.id, userId: bioPagesTable.userId }).from(bioPagesTable).where(eq(bioPagesTable.id, id)).limit(1);
    if (!existing || existing.userId !== req.userId) {
      res.status(404).json({ ok: false, error: "Bio page not found" });
      return;
    }
    await db.delete(bioPagesTable).where(eq(bioPagesTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "[bio-pages] delete failed");
    res.status(500).json({ ok: false, error: "Failed to delete bio page" });
  }
});

/* ── POST /api/bio-publish/:id — publish (100 Visual Bucs) ─────────────
   Route shape mirrors /api/album-publish/:id so the credit registry's
   prefix matching ("/api/bio-publish" + "/") finds the 100 VB cost.
   1. Validate + ownership. 2. Charge 100 VB (402 when broke).
   3. Flip is_published. 4. On ANY failure after the charge → auto-refund.
   Publishing an already-published page is a 409, never a re-charge. */
router.post("/bio-publish/:id", requireAuth, async (req: Request, res: Response) => {
  const id = param(req, "id");
  try {
    const [page] = await db.select().from(bioPagesTable).where(eq(bioPagesTable.id, id)).limit(1);
    if (!page || page.userId !== req.userId) {
      res.status(404).json({ ok: false, error: "Bio page not found" });
      return;
    }
    if (page.isPublished) {
      res.status(409).json({ ok: false, error: "This page is already published.", url: publicUrl(page.slug) });
      return;
    }
    if (!page.displayName.trim()) {
      res.status(400).json({ ok: false, error: "Add a display name before publishing." });
      return;
    }
    const links = (page.links ?? []) as Array<{ title: string; url: string }>;
    if (links.length === 0) {
      res.status(400).json({ ok: false, error: "Add at least one link before publishing." });
      return;
    }

    let creditsRemaining: number;
    try {
      creditsRemaining = await chargeCredits(req.userId!, PUBLISH_COST, {
        action: "Link-in-Bio Publish",
        projectId: id,
      });
    } catch (chargeErr) {
      if (chargeErr instanceof OutOfCreditsError) {
        res.status(402).json({
          ok: false,
          error: "out_of_credits",
          message: `Publishing a link-in-bio page costs ${PUBLISH_COST} Visual Bucs — top up to publish.`,
        });
        return;
      }
      if (chargeErr instanceof LedgerWriteError) {
        res.status(500).json({ ok: false, error: "Credit ledger write failed — no Visual Bucs were taken." });
        return;
      }
      throw chargeErr;
    }

    try {
      const [row] = await db
        .update(bioPagesTable)
        .set({ isPublished: true, updatedAt: new Date() })
        .where(eq(bioPagesTable.id, id))
        .returning();
      res.json({
        ok: true,
        url: publicUrl(row.slug),
        slug: row.slug,
        creditsRemaining,
      });
    } catch (publishErr) {
      // Publish failed after the charge — refund so the creator never pays for nothing.
      try {
        await refundCredits(req.userId!, PUBLISH_COST, {
          action: "Link-in-Bio Publish — refund (publish failed)",
          projectId: id,
        });
      } catch (refundErr) {
        req.log.error({ refundErr }, "[bio-pages] publish failed AND refund failed — needs manual reconciliation");
      }
      req.log.error({ err: publishErr }, "[bio-pages] publish failed after charge — refunded");
      res.status(500).json({ ok: false, error: "Could not publish the page. Your Visual Bucs were refunded." });
    }
  } catch (err) {
    req.log.error({ err }, "[bio-pages] publish failed");
    res.status(500).json({ ok: false, error: "Could not publish the page." });
  }
});

/* POST /api/bio-pages/:id/unpublish — take the page offline (free). */
router.post("/bio-pages/:id/unpublish", requireAuth, async (req: Request, res: Response) => {
  const id = param(req, "id");
  try {
    const [existing] = await db.select({ id: bioPagesTable.id, userId: bioPagesTable.userId }).from(bioPagesTable).where(eq(bioPagesTable.id, id)).limit(1);
    if (!existing || existing.userId !== req.userId) {
      res.status(404).json({ ok: false, error: "Bio page not found" });
      return;
    }
    await db.update(bioPagesTable).set({ isPublished: false, updatedAt: new Date() }).where(eq(bioPagesTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "[bio-pages] unpublish failed");
    res.status(500).json({ ok: false, error: "Failed to unpublish" });
  }
});

/* GET /api/bio-pages/public/:slug — the public page (no login). */
router.get("/bio-pages/public/:slug", async (req: Request, res: Response) => {
  const slug = param(req, "slug");
  try {
    const [page] = await db.select().from(bioPagesTable).where(eq(bioPagesTable.slug, slug)).limit(1);
    if (!page || !page.isPublished) {
      res.status(404).json({ ok: false, error: "Page not found" });
      return;
    }
    // Best-effort view count (analytics only — not money).
    db.update(bioPagesTable)
      .set({ viewCount: sql`${bioPagesTable.viewCount} + 1` })
      .where(eq(bioPagesTable.id, page.id))
      .then(() => undefined, () => undefined);
    // Owner's referral code so shared URLs carry ?ref=CODE (viral earning loop).
    let referralCode: string | null = null;
    try {
      const { data } = await getSupabaseAdmin()
        .from("referral_codes")
        .select("code")
        .eq("user_id", page.userId)
        .maybeSingle();
      referralCode = (data as { code?: string } | null)?.code ?? null;
    } catch { /* non-fatal */ }
    res.json({ ok: true, page: { ...toPublicPage(page as unknown as Record<string, unknown>), referralCode } });
  } catch (err) {
    req.log.error({ err }, "[bio-pages] public fetch failed");
    res.status(500).json({ ok: false, error: "Failed to load page" });
  }
});

const clickSchema = z.object({
  linkIndex: z.number().int().min(-1).max(500).optional().default(-1),
  linkTitle: z.string().max(80).optional().default(""),
  kind: z.enum(["link", "social", "featured", "tip"]).optional().default("link"),
});

/* POST /api/bio-pages/public/:slug/click — record a link click (no login). */
router.post("/bio-pages/public/:slug/click", async (req: Request, res: Response) => {
  const slug = param(req, "slug");
  const parsed = clickSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: "Invalid click data" });
    return;
  }
  try {
    const [page] = await db
      .select({ id: bioPagesTable.id, isPublished: bioPagesTable.isPublished })
      .from(bioPagesTable)
      .where(eq(bioPagesTable.slug, slug))
      .limit(1);
    if (!page || !page.isPublished) {
      res.status(404).json({ ok: false, error: "Page not found" });
      return;
    }
    const ref = req.get("referer") ?? req.get("referrer") ?? null;
    await db.insert(bioLinkClicksTable).values({
      bioPageId: page.id,
      linkIndex: parsed.data.linkIndex,
      linkTitle: parsed.data.kind === "link" ? parsed.data.linkTitle : `${parsed.data.kind}: ${parsed.data.linkTitle}`,
      referrer: ref,
    });
    res.json({ ok: true });
  } catch (err) {
    // Analytics must never break the fan's tap — always succeed loudly enough.
    req.log.error({ err }, "[bio-pages] click track failed");
    res.json({ ok: true });
  }
});

/* GET /api/bio-pages/:id/analytics — owner's click dashboard. */
router.get("/bio-pages/:id/analytics", requireAuth, async (req: Request, res: Response) => {
  const id = param(req, "id");
  try {
    const [page] = await db
      .select({ id: bioPagesTable.id, userId: bioPagesTable.userId, viewCount: bioPagesTable.viewCount })
      .from(bioPagesTable)
      .where(eq(bioPagesTable.id, id))
      .limit(1);
    if (!page || page.userId !== req.userId) {
      res.status(404).json({ ok: false, error: "Bio page not found" });
      return;
    }
    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(bioLinkClicksTable)
      .where(eq(bioLinkClicksTable.bioPageId, id));
    const perLink = await db
      .select({
        linkTitle: bioLinkClicksTable.linkTitle,
        clicks: sql<number>`count(*)::int`,
      })
      .from(bioLinkClicksTable)
      .where(eq(bioLinkClicksTable.bioPageId, id))
      .groupBy(bioLinkClicksTable.linkTitle)
      .orderBy(sql`count(*) DESC`);
    const [{ recent }] = await db
      .select({ recent: sql<number>`count(*)::int` })
      .from(bioLinkClicksTable)
      .where(and(eq(bioLinkClicksTable.bioPageId, id), sql`${bioLinkClicksTable.createdAt} > NOW() - INTERVAL '7 days'`));
    res.json({ ok: true, views: page.viewCount, totalClicks: total, clicksLast7d: recent, perLink });
  } catch (err) {
    req.log.error({ err }, "[bio-pages] analytics failed");
    res.status(500).json({ ok: false, error: "Failed to load analytics" });
  }
});

export default router;
