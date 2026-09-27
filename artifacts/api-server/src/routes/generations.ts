import { Router } from "express";
import { requireAuth } from "../middlewares/require-auth";
import { db, generationsTable } from "@workspace/db";
import { eq, and, desc, isNull } from "drizzle-orm";

const router = Router();

/* List the user's generations (newest first). Soft-deleted are hidden. */
router.get("/generations", requireAuth, async (req, res) => {
  const generations = await db
    .select()
    .from(generationsTable)
    .where(
      and(
        eq(generationsTable.user_id, req.userId!),
        isNull(generationsTable.deleted_at),
      ),
    )
    .orderBy(desc(generationsTable.created_at))
    .limit(100);

  res.json({ generations });
});

/* Soft-delete a generation (hide it, but preserve the data). */
router.delete("/generations/:id", requireAuth, async (req, res) => {
  const id = String(req.params["id"]);

  await db
    .update(generationsTable)
    .set({ deleted_at: new Date() })
    .where(
      and(
        eq(generationsTable.id, id),
        eq(generationsTable.user_id, req.userId!),
        isNull(generationsTable.deleted_at),
      ),
    );

  res.json({ success: true });
});

export default router;
