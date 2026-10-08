import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/require-auth";
import { db, moneyEntriesTable } from "@workspace/db";
import { eq, desc, and, sql } from "drizzle-orm";

const router = Router();

/* ─── Creator Money Tracker ──────────────────────────────────────────────
   Per-user income/expense ledger. Pure UI + DB — FREE (no credit charges,
   no external API calls). Powers the "Money Tracker" tab on /coach.

   GET    /api/money        — list this user's entries, newest first
   POST   /api/money        — create an entry
   DELETE /api/money/:id    — delete one of the user's entries */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CreateEntrySchema = z.object({
  type: z.enum(["income", "expense"]),
  category: z.string().trim().min(1).max(60),
  amountCents: z.number().int().min(1).max(100_000_000_00),
  note: z.string().trim().max(280).optional().default(""),
  source: z.string().trim().max(120).optional().nullable(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD")
    .optional(),
  /* Optional distribution release link — income tied to a release can have
     its royalty splits applied in the Splits view. */
  releaseId: z
    .string()
    .refine((s) => s === "" || UUID_RE.test(s), "releaseId must be a UUID")
    .optional()
    .nullable(),
});

function todayYmd(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/* GET /api/money — list entries, newest first (cap 500) */
router.get("/money", requireAuth, async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(moneyEntriesTable)
      .where(eq(moneyEntriesTable.user_id, req.userId!))
      .orderBy(desc(moneyEntriesTable.entry_date), desc(moneyEntriesTable.created_at))
      .limit(500);
    res.json({ entries: rows });
  } catch (err) {
    req.log.error({ err }, "[money] list failed");
    res.status(500).json({ error: "Could not load your money entries." });
  }
});

/* POST /api/money — create an entry */
router.post("/money", requireAuth, async (req, res) => {
  const parsed = CreateEntrySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid money entry", details: parsed.error.issues });
    return;
  }
  const d = parsed.data;
  try {
    /* If a release link was given, verify the release belongs to this user. */
    let releaseId: string | null = d.releaseId?.trim() || null;
    if (releaseId) {
      const own = await db.execute(sql`
        SELECT id FROM distribution_releases
        WHERE id = ${releaseId} AND user_id = ${req.userId!}
        LIMIT 1
      `);
      if (own.rows.length === 0) releaseId = null;
    }
    const [entry] = await db
      .insert(moneyEntriesTable)
      .values({
        user_id: req.userId!,
        entry_type: d.type,
        category: d.category,
        amount_cents: d.amountCents,
        note: d.note ?? "",
        source: d.source ?? null,
        entry_date: d.date ?? todayYmd(),
        releaseId: releaseId,
      })
      .returning();
    res.status(201).json({ entry });
  } catch (err) {
    req.log.error({ err }, "[money] create failed");
    res.status(500).json({ error: "Could not save the entry." });
  }
});

/* DELETE /api/money/:id — delete one of the user's own entries */
router.delete("/money/:id", requireAuth, async (req, res) => {
  const id = req.params.id as string;
  if (!id) {
    res.status(400).json({ error: "Entry id is required." });
    return;
  }
  try {
    const deleted = await db
      .delete(moneyEntriesTable)
      .where(and(eq(moneyEntriesTable.id, id), eq(moneyEntriesTable.user_id, req.userId!)))
      .returning({ id: moneyEntriesTable.id });
    if (deleted.length === 0) {
      res.status(404).json({ error: "Entry not found." });
      return;
    }
    res.json({ deleted: true });
  } catch (err) {
    req.log.error({ err }, "[money] delete failed");
    res.status(500).json({ error: "Could not delete the entry." });
  }
});

export default router;

/* PATCH /api/money/:id — link (or unlink) an entry to a distribution
   release. { releaseId: "<uuid>" | null }. Release must belong to the user. */
router.patch("/money/:id", requireAuth, async (req, res) => {
  const id = req.params.id as string;
  const parsed = z
    .object({
      releaseId: z
        .string()
        .refine((s) => UUID_RE.test(s), "releaseId must be a UUID")
        .nullable()
        .optional(),
    })
    .safeParse(req.body ?? {});
  if (!id || !parsed.success) {
    res.status(400).json({ error: "Valid entry id and releaseId (or null) are required." });
    return;
  }
  try {
    const releaseId = parsed.data.releaseId ?? null;
    if (releaseId) {
      const own = await db.execute(sql`
        SELECT id FROM distribution_releases
        WHERE id = ${releaseId} AND user_id = ${req.userId!}
        LIMIT 1
      `);
      if (own.rows.length === 0) {
        res.status(404).json({ error: "That release isn't yours." });
        return;
      }
    }
    const updated = await db
      .update(moneyEntriesTable)
      .set({ releaseId: releaseId, updated_at: new Date() })
      .where(and(eq(moneyEntriesTable.id, id), eq(moneyEntriesTable.user_id, req.userId!)))
      .returning();
    if (updated.length === 0) {
      res.status(404).json({ error: "Entry not found." });
      return;
    }
    res.json({ entry: updated[0] });
  } catch (err) {
    req.log.error({ err }, "[money] link release failed");
    res.status(500).json({ error: "Could not link the release." });
  }
});

/* ─── Splits overview (free) ─────────────────────────────────────────────
   GET /api/splits/overview — apply each release's agreed royalty splits to
   the income entries linked to that release. Each entry uses the agreement
   version that was effective on the entry's date (edits apply to future
   earnings only). Income with no release link is reported as unlinked so
   the UI can prompt the creator to link it.
   HONESTY: this is split ACCOUNTING on logged income — automatic store
   payouts require a distribution partnership we don't have. */

interface SplitVersionRow {
  release_id: string;
  payee_name: string;
  role: string | null;
  share_pct: string;
  agreement_version: number;
  effective_from: string | null;
  superseded_at: string | null;
}

interface LinkedIncomeRow {
  id: string;
  release_id: string;
  entry_date: string;
  note: string;
  amount_cents: number;
}

router.get("/splits/overview", requireAuth, async (req, res) => {
  try {
    const releasesResult = await db.execute(sql`
      SELECT id, title, artist_name
      FROM distribution_releases
      WHERE user_id = ${req.userId!}
      ORDER BY created_at DESC
      LIMIT 200
    `);
    const releases = releasesResult.rows as Array<{
      id: string; title: string; artist_name: string;
    }>;
    if (releases.length === 0) {
      res.json({
        releases: [],
        collaboratorTotals: [],
        unlinkedIncomeCents: 0,
        unlinkedIncomeCount: 0,
        disclaimer:
          "Split accounting for your logged income — automatic store payouts need a distribution partner.",
      });
      return;
    }
    const releaseIds = releases.map((r) => r.id);

    const splitsResult = await db.execute(sql`
      SELECT release_id, payee_name, role, share_pct, agreement_version,
             effective_from, superseded_at
      FROM distribution_royalty_splits
      WHERE user_id = ${req.userId!}
      ORDER BY release_id, agreement_version, share_pct DESC
    `);
    const splitRows = (splitsResult.rows as unknown as SplitVersionRow[]).filter((s) =>
      releaseIds.includes(s.release_id),
    );
    const splitsByRelease = new Map<string, SplitVersionRow[]>();
    for (const s of splitRows) {
      const arr = splitsByRelease.get(s.release_id) ?? [];
      arr.push(s);
      splitsByRelease.set(s.release_id, arr);
    }

    const incomeResult = await db.execute(sql`
      SELECT id, release_id, entry_date, note, amount_cents
      FROM money_entries
      WHERE user_id = ${req.userId!}
        AND entry_type = 'income'
        AND release_id IS NOT NULL
      ORDER BY entry_date DESC
    `);
    const incomeRows = (incomeResult.rows as unknown as LinkedIncomeRow[]).filter((e) =>
      releaseIds.includes(e.release_id),
    );

    const unlinkedResult = await db.execute(sql`
      SELECT COALESCE(SUM(amount_cents), 0) AS total, COUNT(*) AS n
      FROM money_entries
      WHERE user_id = ${req.userId!}
        AND entry_type = 'income'
        AND release_id IS NULL
    `);
    const unlinked = unlinkedResult.rows[0] as { total: string; n: string };

    const entryDay = (d: string) => d.slice(0, 10);

    interface EntryShare {
      name: string; role: string | null; sharePct: number; amountCents: number;
    }
    interface OverviewEntry {
      id: string; entryDate: string; note: string; amountCents: number;
      agreementVersion: number; shares: EntryShare[];
    }
    interface OverviewRelease {
      id: string; title: string; artistName: string;
      totalIncomeCents: number;
      collaboratorTotals: Array<{ name: string; role: string | null; sharePct: number; totalCents: number }>;
      entries: OverviewEntry[];
      activeSplits: Array<{ name: string; role: string | null; sharePct: number; agreementVersion: number }>;
    }

    const out: OverviewRelease[] = [];
    const globalTotals = new Map<string, { name: string; role: string | null; totalCents: number }>();

    for (const release of releases) {
      const versions = splitsByRelease.get(release.id) ?? [];
      if (versions.length === 0) continue;
      const releaseIncome = incomeRows.filter((e) => e.release_id === release.id);
      const entries: OverviewEntry[] = [];
      const collabTotals = new Map<string, { name: string; role: string | null; sharePct: number; totalCents: number }>();

      for (const income of releaseIncome) {
        const day = entryDay(income.entry_date);
        /* Version effective on the entry's date: newest version whose
           effective_from is on/before the entry, and which wasn't
           superseded before the entry. */
        const applicable = versions
          .filter(
            (v) =>
              v.effective_from && v.effective_from.slice(0, 10) <= day &&
              (!v.superseded_at || v.superseded_at.slice(0, 10) > day),
          )
          .sort((a, b) => b.agreement_version - a.agreement_version);
        if (applicable.length === 0) continue;
        const versionNo = applicable[0]!.agreement_version;
        const versionSplits = applicable.filter((v) => v.agreement_version === versionNo);
        const shares: EntryShare[] = versionSplits.map((v) => {
          const pct = Number(v.share_pct);
          const amountCents = Math.round((income.amount_cents * pct) / 100);
          return { name: v.payee_name, role: v.role, sharePct: pct, amountCents };
        });
        entries.push({
          id: income.id, entryDate: income.entry_date.slice(0, 10), note: income.note,
          amountCents: income.amount_cents, agreementVersion: versionNo, shares,
        });
        for (const s of shares) {
          const key = s.name.toLowerCase();
          const existing = collabTotals.get(key) ?? { name: s.name, role: s.role, sharePct: s.sharePct, totalCents: 0 };
          existing.totalCents += s.amountCents;
          collabTotals.set(key, existing);
          const g = globalTotals.get(key) ?? { name: s.name, role: s.role, totalCents: 0 };
          g.totalCents += s.amountCents;
          globalTotals.set(key, g);
        }
      }

      const activeVersion = Math.max(...versions.map((v) => v.agreement_version));
      out.push({
        id: release.id,
        title: release.title,
        artistName: release.artist_name,
        totalIncomeCents: entries.reduce((sum, e) => sum + e.amountCents, 0),
        collaboratorTotals: [...collabTotals.values()],
        entries,
        activeSplits: versions
          .filter((v) => v.agreement_version === activeVersion)
          .map((v) => ({
            name: v.payee_name, role: v.role, sharePct: Number(v.share_pct),
            agreementVersion: v.agreement_version,
          })),
      });
    }

    res.json({
      releases: out,
      collaboratorTotals: [...globalTotals.values()].sort((a, b) => b.totalCents - a.totalCents),
      unlinkedIncomeCents: Number(unlinked.total),
      unlinkedIncomeCount: Number(unlinked.n),
      disclaimer:
        "Split accounting for your logged income — automatic store payouts need a distribution partner.",
    });
  } catch (err) {
    req.log.error({ err }, "[money] splits overview failed");
    res.status(500).json({ error: "Could not load the splits overview." });
  }
});
