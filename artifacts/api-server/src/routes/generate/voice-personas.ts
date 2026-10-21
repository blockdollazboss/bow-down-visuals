import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middlewares/require-auth";
import { db } from "@workspace/db";
import { voicePersonasTable } from "../../../../../lib/db/src/schema/voice-personas";
import { eq, and, or } from "drizzle-orm";

const router = Router();

/* ─── Voice personas (Suno parity) ───
   Saveable vocal identities that can be reused across song generations. */

const personaSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional().default(""),
  gender: z.enum(["male", "female", "neutral"]).optional().default("neutral"),
  settings: z.record(z.string(), z.unknown()).optional().default({}),
  isPublic: z.boolean().optional().default(false),
});

// List user's personas + public templates
router.get("/personas", requireAuth, async (req, res) => {
  try {
    const personas = await db
      .select()
      .from(voicePersonasTable)
      .where(
        or(
          eq(voicePersonasTable.userId, req.userId!),
          eq(voicePersonasTable.isPublic, true)
        )
      )
      .orderBy(voicePersonasTable.createdAt);
    res.json({ personas });
  } catch (err) {
    res.status(500).json({ error: "Could not load personas." });
  }
});

// Create a persona
router.post("/personas", requireAuth, async (req, res) => {
  const parsed = personaSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  try {
    const [persona] = await db
      .insert(voicePersonasTable)
      .values({
        userId: req.userId!,
        name: parsed.data.name,
        description: parsed.data.description,
        gender: parsed.data.gender,
        settings: parsed.data.settings,
        isPublic: parsed.data.isPublic,
      })
      .returning();
    res.json({ persona });
  } catch (err) {
    res.status(500).json({ error: "Could not create persona." });
  }
});

// Update a persona (owner only)
router.patch("/personas/:id", requireAuth, async (req, res) => {
  const parsed = personaSchema.partial().safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request." });
    return;
  }

  try {
    const [persona] = await db
      .update(voicePersonasTable)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(
        and(
          eq(voicePersonasTable.id, req.params.id as string),
          eq(voicePersonasTable.userId, req.userId!)
        )
      )
      .returning();
    if (!persona) {
      res.status(404).json({ error: "Persona not found." });
      return;
    }
    res.json({ persona });
  } catch (err) {
    res.status(500).json({ error: "Could not update persona." });
  }
});

// Delete a persona (owner only)
router.delete("/personas/:id", requireAuth, async (req, res) => {
  try {
    const [deleted] = await db
      .delete(voicePersonasTable)
      .where(
        and(
          eq(voicePersonasTable.id, req.params.id as string),
          eq(voicePersonasTable.userId, req.userId!)
        )
      )
      .returning();
    if (!deleted) {
      res.status(404).json({ error: "Persona not found." });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Could not delete persona." });
  }
});

export default router;
