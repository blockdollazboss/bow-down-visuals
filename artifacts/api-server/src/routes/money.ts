import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/require-auth";
import { db, moneyEntriesTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";

const router = Router();

/* ─── Creator Money Tracker ──────────────────────────────────────────────
   Per-user income/expense ledger. Pure UI + DB — FREE (no credit charges,
   no external API calls). Powers the "Money Tracker" tab on /coach.

   GET    /api/money        — list this user's entries, newest first
   POST   /api/money        — create an entry
   DELETE /api/money/:id    — delete one of the user's entries */

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
