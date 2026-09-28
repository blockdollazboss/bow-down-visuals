import { Router, json } from "express";
import { requireAuth } from "../middlewares/require-auth";
import { db, hubProjectsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod";

const router = Router();

/* The hub project is metadata + URLs only — but a script asset carries its
   text as a data: URL, so allow a roomy (but bounded) body on this router. */
router.use(json({ limit: "5mb" }));

const HubAssetSchema = z.object({
  id: z.string().max(80),
  kind: z.enum(["beat", "stems", "song", "video", "image", "thumbnail", "clip", "script", "sfx", "other"]),
  url: z.string().max(1_000_000),
  label: z.string().max(200),
  detail: z.string().max(300).optional(),
  meta: z.record(z.string(), z.string()).optional(),
  createdAt: z.number(),
});

const SaveHubProjectSchema = z.object({
  name: z.string().min(1).max(80),
  type: z.enum(["song", "video", "visual", "movie", "game", "series", "podcast", "release", "grow", "monetize", "learn", "business"]),
  assets: z.array(HubAssetSchema).max(200),
  updatedAt: z.number(),
});

/* Get the user's synced hub project (null when never saved). */
router.get("/hub/project", requireAuth, async (req, res) => {
  const rows = await db
    .select()
    .from(hubProjectsTable)
    .where(eq(hubProjectsTable.user_id, req.userId!))
    .limit(1);

  const row = rows[0];
  if (!row) {
    res.json({ project: null });
    return;
  }
  res.json({
    project: {
      name: row.name,
      type: row.type,
      assets: Array.isArray(row.assets) ? row.assets : [],
      updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : 0,
    },
  });
});

/* Save (upsert) the user's hub project. Last write wins — the client only
   pushes its own freshest state. */
router.put("/hub/project", requireAuth, async (req, res) => {
  const parsed = SaveHubProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid project data" });
    return;
  }
  const d = parsed.data;

  await db
    .insert(hubProjectsTable)
    .values({
      user_id: req.userId!,
      name: d.name,
      type: d.type,
      assets: d.assets,
      updated_at: new Date(d.updatedAt),
    })
    .onConflictDoUpdate({
      target: hubProjectsTable.user_id,
      set: {
        name: d.name,
        type: d.type,
        assets: d.assets,
        updated_at: new Date(d.updatedAt),
      },
    });

  res.json({ success: true });
});

/* Clear the synced project (local cache is cleared client-side). */
router.delete("/hub/project", requireAuth, async (req, res) => {
  await db.delete(hubProjectsTable).where(eq(hubProjectsTable.user_id, req.userId!));
  res.json({ success: true });
});

export default router;
