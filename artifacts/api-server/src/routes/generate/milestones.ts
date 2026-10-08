import { Router } from "express";
import { z } from "zod";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";
import { recordCreditUsage } from "../../lib/payment-record";
import { db, milestonesTable, catalogVaultsTable } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";

const router = Router();

/* ─── Milestone Tracker + Catalog Vault ────────────────────────────────────
   DistroKid RIAA-monitoring / Leave-a-Legacy parity.

   Milestones: creators log the stream/download counts they see in Spotify
   for Artists (or import them via CSV) per track and platform. HONESTY:
   there is no live Spotify stream sync — that needs a real distribution
   partner — so every row carries a source ('manual' | 'csv') and the client
   labels it: "Log your stream counts from Spotify for Artists — live sync
   needs a distribution partner." Logging is FREE.

   Catalog Vault: per-release one-time purchase (200 Visual Bucs) that keeps
   the release's presave page, showcase entry and assets live permanently on
   Bow Down Visuals. Our own hosting — a guarantee we CAN make.
   Pricing: 200 VB one-time (402 → charge → auto-refund; registry entry). */

export const CATALOG_VAULT_CREDIT_COST = Number(process.env["CATALOG_VAULT_CREDITS"]) || 200;

/* Award ladder for logged stream counts. */
export const AWARD_STEPS = [
  { tier: "bronze", at: 1_000, label: "Bronze — 1K streams" },
  { tier: "silver", at: 10_000, label: "Silver — 10K streams" },
  { tier: "gold", at: 100_000, label: "Gold — 100K streams" },
  { tier: "platinum", at: 1_000_000, label: "Platinum — 1M streams" },
  { tier: "diamond", at: 10_000_000, label: "Diamond — 10M streams" },
] as const;

export function awardFor(streams: number): (typeof AWARD_STEPS)[number]["tier"] | "none" {
  let tier: (typeof AWARD_STEPS)[number]["tier"] | "none" = "none";
  for (const step of AWARD_STEPS) {
    if (streams >= step.at) tier = step.tier;
  }
  return tier;
}

export function nextStepAfter(streams: number): (typeof AWARD_STEPS)[number] | null {
  for (const step of AWARD_STEPS) {
    if (streams < step.at) return step;
  }
  return null;
}

const logMilestoneSchema = z.object({
  trackTitle: z.string().trim().min(1, "Track title is required.").max(200),
  artistName: z.string().trim().max(200).optional().default(""),
  platform: z.string().trim().min(1).max(40).default("spotify"),
  streamCount: z.number().int().min(0, "Stream count can't be negative.").max(10_000_000_000),
  note: z.string().trim().max(500).optional().default(""),
});

const csvImportSchema = z.object({
  csv: z
    .string()
    .min(1, "CSV text is required.")
    .max(500_000, "CSV is too large — keep it under 500KB."),
});

/* Parse a simple CSV: header row then data. Accepts headers
   track_title|track|title, platform, streams|stream_count (case-insensitive). */
export function parseMilestoneCsv(csv: string): { rows: Array<{ trackTitle: string; platform: string; streamCount: number }>; skipped: number } {
  const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const rows: Array<{ trackTitle: string; platform: string; streamCount: number }> = [];
  let skipped = 0;
  if (lines.length < 2) return { rows, skipped: lines.length === 0 ? 0 : 1 };
  const header = splitCsvLine(lines[0]!).map((h) => h.toLowerCase().trim());
  const titleIdx = header.findIndex((h) => ["track_title", "track", "title", "song"].includes(h));
  const platformIdx = header.findIndex((h) => ["platform", "service", "store"].includes(h));
  const streamsIdx = header.findIndex((h) => ["streams", "stream_count", "streamcount", "plays", "downloads"].includes(h));
  if (titleIdx < 0 || streamsIdx < 0) return { rows, skipped: lines.length - 1 };
  for (const line of lines.slice(1, 501)) {
    const cols = splitCsvLine(line);
    const trackTitle = (cols[titleIdx] ?? "").trim().slice(0, 200);
    const platform = ((cols[platformIdx] ?? "spotify") || "spotify").trim().slice(0, 40);
    const streamCount = Math.floor(Number((cols[streamsIdx] ?? "").replace(/[, ]/g, "")));
    if (!trackTitle || !Number.isFinite(streamCount) || streamCount < 0 || streamCount > 10_000_000_000) {
      skipped++;
      continue;
    }
    rows.push({ trackTitle, platform, streamCount });
  }
  return { rows, skipped };
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function sanitizeMilestone(m: typeof milestonesTable.$inferSelect) {
  return {
    id: m.id,
    trackTitle: m.trackTitle,
    artistName: m.artistName,
    platform: m.platform,
    streamCount: m.streamCount,
    awardTier: m.awardTier,
    source: m.source,
    note: m.note,
    createdAt: m.createdAt,
  };
}

function escXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}K`;
  return String(n);
}

/* Gold/black shareable milestone card (SVG, 1200×630) with attribution —
   the virality surface: "My song hit 100K streams". */
function milestoneCardSvg(opts: {
  trackTitle: string;
  artistName: string | null;
  platform: string;
  streamCount: number;
  awardTier: string;
}): string {
  const award = AWARD_STEPS.find((s) => s.tier === opts.awardTier);
  const headline = `${formatCount(opts.streamCount)} STREAMS`;
  const awardLabel = award ? award.label.split(" — ")[0]!.toUpperCase() + " AWARD" : "MILESTONE";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#141414"/><stop offset="1" stop-color="#000000"/>
    </linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f6d47c"/><stop offset="0.5" stop-color="#d4af37"/><stop offset="1" stop-color="#9c7c1e"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect x="24" y="24" width="1152" height="582" rx="28" fill="none" stroke="url(#gold)" stroke-width="3" opacity="0.85"/>
  <text x="600" y="120" text-anchor="middle" font-family="Georgia, serif" font-size="34" letter-spacing="10" fill="#d4af37">${escXml(awardLabel)}</text>
  <text x="600" y="290" text-anchor="middle" font-family="Georgia, serif" font-weight="bold" font-size="120" fill="url(#gold)">${escXml(headline)}</text>
  <text x="600" y="380" text-anchor="middle" font-family="Arial, sans-serif" font-size="52" fill="#ffffff">${escXml(opts.trackTitle)}</text>
  ${opts.artistName ? `<text x="600" y="432" text-anchor="middle" font-family="Arial, sans-serif" font-size="34" fill="#cccccc">${escXml(opts.artistName)} · ${escXml(opts.platform)}</text>` : `<text x="600" y="432" text-anchor="middle" font-family="Arial, sans-serif" font-size="34" fill="#cccccc">${escXml(opts.platform)}</text>`}
  <text x="600" y="560" text-anchor="middle" font-family="Arial, sans-serif" font-size="24" letter-spacing="4" fill="#d4af37">MADE WITH BOW DOWN VISUALS · bowdownvisuals.com</text>
</svg>`;
}

/* ── Milestones ─────────────────────────────────────────────────────────── */

/* POST /api/milestones/log — log a stream count you read in Spotify for
   Artists (free). Award tier is computed server-side. */
router.post("/milestones/log", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = logMilestoneSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid milestone.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const d = parsed.data;
  const tier = awardFor(d.streamCount);
  try {
    const rows = await db
      .insert(milestonesTable)
      .values({
        userId: req.userId!,
        trackTitle: d.trackTitle,
        artistName: d.artistName || null,
        platform: d.platform.toLowerCase(),
        streamCount: d.streamCount,
        awardTier: tier,
        source: "manual",
        note: d.note || null,
      })
      .returning();
    res.json({ milestone: sanitizeMilestone(rows[0]!), awardTier: tier, nextStep: nextStepAfter(d.streamCount) });
  } catch (err) {
    logger.error({ err }, "milestones/log: insert failed");
    res.status(502).json({ error: "save_failed", message: "Couldn't save the milestone — try again." });
  }
});

/* POST /api/milestones/import-csv — bulk import counts from a CSV export
   (e.g. your own spreadsheet of Spotify for Artists numbers). Free. */
router.post("/milestones/import-csv", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = csvImportSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid CSV.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const { rows, skipped } = parseMilestoneCsv(parsed.data.csv);
  if (rows.length === 0) {
    res.status(400).json({
      error: "no_valid_rows",
      message: "No valid rows found. The CSV needs headers like: track_title, platform, streams",
    });
    return;
  }
  try {
    await db.insert(milestonesTable).values(
      rows.map((r) => ({
        userId: req.userId!,
        trackTitle: r.trackTitle,
        platform: r.platform.toLowerCase(),
        streamCount: r.streamCount,
        awardTier: awardFor(r.streamCount),
        source: "csv",
      }))
    );
    res.json({ imported: rows.length, skipped });
  } catch (err) {
    logger.error({ err }, "milestones/import-csv: insert failed");
    res.status(502).json({ error: "import_failed", message: "Couldn't import the CSV — try again." });
  }
});

/* GET /api/milestones — the creator's logged milestones (free) plus
   per-track progress toward the next award. */
router.get("/milestones", publicApiLimiter, requireAuth, async (req, res) => {
  const rows = await db
    .select()
    .from(milestonesTable)
    .where(eq(milestonesTable.userId, req.userId!))
    .orderBy(desc(milestonesTable.createdAt))
    .limit(500);

  /* Per-track progress: best logged count per track title. */
  const byTrack = new Map<string, { trackTitle: string; artistName: string | null; platform: string; streams: number }>();
  for (const m of rows) {
    const key = `${m.trackTitle.toLowerCase()}|${m.platform.toLowerCase()}`;
    const cur = byTrack.get(key);
    if (!cur || m.streamCount > cur.streams) {
      byTrack.set(key, {
        trackTitle: m.trackTitle,
        artistName: m.artistName,
        platform: m.platform,
        streams: m.streamCount,
      });
    }
  }
  const tracks = [...byTrack.values()].map((t) => {
    const next = nextStepAfter(t.streams);
    const prevAt = [...AWARD_STEPS].reverse().find((s) => t.streams >= s.at)?.at ?? 0;
    const range = (next ? next.at : prevAt * 10 || 1) - prevAt;
    const progressPct = next ? Math.min(100, Math.max(0, ((t.streams - prevAt) / range) * 100)) : 100;
    return {
      ...t,
      awardTier: awardFor(t.streams),
      nextAt: next?.at ?? null,
      nextLabel: next?.label ?? null,
      progressPct: Math.round(progressPct * 10) / 10,
    };
  });

  res.json({ milestones: rows.map(sanitizeMilestone), tracks });
});

/* GET /api/milestones/:id/card — the shareable gold/black milestone card
   (SVG) with "Made with Bow Down Visuals" attribution. Free. */
router.get("/milestones/:id/card", publicApiLimiter, requireAuth, async (req, res) => {
  const id = req.params["id"] as string;
  const rows = await db
    .select()
    .from(milestonesTable)
    .where(and(eq(milestonesTable.id, id), eq(milestonesTable.userId, req.userId!)))
    .limit(1);
  const m = rows[0];
  if (!m) {
    res.status(404).json({ error: "not_found", message: "Milestone not found." });
    return;
  }
  res.setHeader("Content-Type", "image/svg+xml");
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.send(
    milestoneCardSvg({
      trackTitle: m.trackTitle,
      artistName: m.artistName,
      platform: m.platform,
      streamCount: m.streamCount,
      awardTier: m.awardTier,
    })
  );
});

/* ── Catalog Vault ──────────────────────────────────────────────────────── */

async function getOwnedReleaseId(releaseId: string, userId: string): Promise<{ id: string; title: string } | null> {
  const result = await db.execute<{ id: string; title: string }>(
    sql`SELECT id::text AS id, title FROM distribution_releases WHERE id::text = ${releaseId} AND user_id::text = ${userId} LIMIT 1`
  );
  return result.rows[0] ?? null;
}

/* POST /api/catalog-vault/vault — one-time vault purchase for a release
   (200 Visual Bucs). The release's presave page, showcase entry and assets
   stay live on Bow Down Visuals permanently. */
router.post("/catalog-vault/vault", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = z.object({ releaseId: z.string().uuid("releaseId must be a release UUID.") }).safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request.", details: parsed.error.issues });
    return;
  }
  const { releaseId } = parsed.data;

  const release = await getOwnedReleaseId(releaseId, req.userId!);
  if (!release) {
    res.status(404).json({ error: "not_found", message: "Release not found." });
    return;
  }

  const existing = await db
    .select()
    .from(catalogVaultsTable)
    .where(and(eq(catalogVaultsTable.userId, req.userId!), eq(catalogVaultsTable.releaseId, releaseId)))
    .limit(1);
  if (existing[0]) {
    res.json({ alreadyVaulted: true, releaseId, vaultedAt: existing[0].vaultedAt });
    return;
  }

  const balance = req.userCredits ?? 0;
  if (balance < CATALOG_VAULT_CREDIT_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of Visual Bucs — top up to vault this release.",
    });
    return;
  }
  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, CATALOG_VAULT_CREDIT_COST, {
      action: "Catalog Vault — permanent release hosting",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of Visual Bucs — top up to vault this release.",
      });
      return;
    }
    throw err;
  }

  try {
    const rows = await db
      .insert(catalogVaultsTable)
      .values({
        userId: req.userId!,
        releaseId,
        creditsCharged: CATALOG_VAULT_CREDIT_COST,
        status: "vaulted",
      })
      .returning();
    await recordCreditUsage({
      userId: req.userId!,
      action: "Catalog Vault — permanent release hosting",
      creditsUsed: CATALOG_VAULT_CREDIT_COST,
    });
    res.json({
      vaulted: true,
      releaseId,
      releaseTitle: release.title,
      vaultedAt: rows[0]!.vaultedAt,
      creditsUsed: CATALOG_VAULT_CREDIT_COST,
      creditsRemaining,
    });
  } catch (err) {
    try {
      await refundCredits(req.userId!, CATALOG_VAULT_CREDIT_COST, {
        action: "Catalog Vault — Refund (vault failed)",
      });
    } catch (refundErr) {
      void refundErr;
    }
    logger.error({ err }, "catalog-vault/vault: failed, Visual Bucs refunded");
    res.status(502).json({
      error: "vault_failed",
      message: "Something went wrong vaulting your release — your Visual Bucs were refunded.",
    });
  }
});

/* GET /api/catalog-vault/status — which releases are vaulted (free). */
router.get("/catalog-vault/status", publicApiLimiter, requireAuth, async (req, res) => {
  const rows = await db
    .select()
    .from(catalogVaultsTable)
    .where(eq(catalogVaultsTable.userId, req.userId!))
    .orderBy(desc(catalogVaultsTable.vaultedAt));
  res.json({
    vaults: rows.map((v) => ({
      releaseId: v.releaseId,
      status: v.status,
      vaultedAt: v.vaultedAt,
    })),
  });
});

export default router;
