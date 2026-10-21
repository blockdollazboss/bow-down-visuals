import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/require-auth";
import {
  db,
  contentIdOptinsTable,
  contentIdDetectionsTable,
  insertContentIdOptinSchema,
  insertContentIdDetectionSchema,
  CONTENT_ID_OPTIN_STATUSES,
  CONTENT_ID_DETECTION_STATUSES,
} from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";

const router = Router();

/* ─── Content ID Monitor ──────────────────────────────────────────────────
   YouTube Content ID parity (DistroKid): opt tracks IN/OUT of Content ID
   monitoring, log manually-detected uses, track claim status.

   HONESTY: real YouTube Content ID claiming requires a distribution/CMS
   partnership this site does not have. Opt-ins are stored with status
   'pending_partner'; POST /claim/:id always fails with 409 naming the
   missing partnership — a claim is NEVER faked.

   FREE — no credits, no external API calls.

   GET    /api/content-id/optins        — list this user's opt-ins
   POST   /api/content-id/optins        — opt a track in
   PATCH  /api/content-id/optins/:id    — toggle opt-in / update status
   DELETE /api/content-id/optins/:id    — remove an opt-in
   POST   /api/content-id/claim/:id     — ALWAYS fails (409): no CMS partner
   GET    /api/content-id/detections    — list this user's detected uses
   POST   /api/content-id/detections    — log a detected use (manual)
   PATCH  /api/content-id/detections/:id — update status/notes
   DELETE /api/content-id/detections/:id — delete a detection */

const PARTNER_MISSING_MESSAGE =
  "Content ID claims can't be filed yet: Bow Down Visuals has no YouTube CMS / distribution partnership. " +
  "Your opt-in is saved and the monitoring setup is ready — actual Content ID claims activate automatically " +
  "when our distribution partner integration goes live. Nothing was submitted to YouTube.";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

/* ── opt-ins ───────────────────────────────────────────────────────────── */

router.get("/content-id/optins", requireAuth, async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(contentIdOptinsTable)
      .where(eq(contentIdOptinsTable.user_id, req.userId!))
      .orderBy(desc(contentIdOptinsTable.created_at))
      .limit(500);
    res.json({ optins: rows });
  } catch (err) {
    req.log.error({ err }, "[content-id] list optins failed");
    res.status(500).json({ error: "Could not load your Content ID opt-ins." });
  }
});

router.post("/content-id/optins", requireAuth, async (req, res) => {
  const parsed = insertContentIdOptinSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid opt-in", details: parsed.error.issues });
    return;
  }
  const d = parsed.data;
  try {
    // One opt-in per user per release; standalone tracks keyed by title.
    if (d.release_id) {
      const existing = await db
        .select({ id: contentIdOptinsTable.id })
        .from(contentIdOptinsTable)
        .where(
          and(
            eq(contentIdOptinsTable.user_id, req.userId!),
            eq(contentIdOptinsTable.release_id, d.release_id),
          ),
        )
        .limit(1);
      if (existing.length > 0) {
        res.status(409).json({
          error: "This release is already in your Content ID monitor.",
          optinId: existing[0].id,
        });
        return;
      }
    }
    const [optin] = await db
      .insert(contentIdOptinsTable)
      .values({
        user_id: req.userId!,
        release_id: d.release_id ?? null,
        track_title: d.track_title,
        artist_name: d.artist_name ?? null,
        opted_in: true,
        status: "pending_partner",
      })
      .returning();
    res.status(201).json({ optin });
  } catch (err) {
    req.log.error({ err }, "[content-id] create optin failed");
    res.status(500).json({ error: "Could not save the Content ID opt-in." });
  }
});

const UpdateOptinSchema = z.object({
  opted_in: z.boolean().optional(),
  status: z.enum(CONTENT_ID_OPTIN_STATUSES).optional(),
});

router.patch("/content-id/optins/:id", requireAuth, async (req, res) => {
  const id = req.params.id as string;
  if (!isUuid(id)) {
    res.status(400).json({ error: "Invalid opt-in id." });
    return;
  }
  const parsed = UpdateOptinSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid opt-in update", details: parsed.error.issues });
    return;
  }
  if (parsed.data.status === "active") {
    // 'active' would imply real claims are flowing — refuse until the partner exists.
    res.status(409).json({ error: PARTNER_MISSING_MESSAGE });
    return;
  }
  try {
    const patch: Record<string, unknown> = { updated_at: new Date() };
    if (typeof parsed.data.opted_in === "boolean") {
      patch.opted_in = parsed.data.opted_in;
      patch.status = parsed.data.opted_in ? "pending_partner" : "opted_out";
    }
    if (parsed.data.status && typeof parsed.data.opted_in !== "boolean") {
      patch.status = parsed.data.status;
    }
    const [row] = await db
      .update(contentIdOptinsTable)
      .set(patch)
      .where(and(eq(contentIdOptinsTable.id, id), eq(contentIdOptinsTable.user_id, req.userId!)))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Opt-in not found." });
      return;
    }
    res.json({ optin: row });
  } catch (err) {
    req.log.error({ err }, "[content-id] update optin failed");
    res.status(500).json({ error: "Could not update the opt-in." });
  }
});

router.delete("/content-id/optins/:id", requireAuth, async (req, res) => {
  const id = req.params.id as string;
  if (!isUuid(id)) {
    res.status(400).json({ error: "Invalid opt-in id." });
    return;
  }
  try {
    const deleted = await db
      .delete(contentIdOptinsTable)
      .where(and(eq(contentIdOptinsTable.id, id), eq(contentIdOptinsTable.user_id, req.userId!)))
      .returning({ id: contentIdOptinsTable.id });
    if (deleted.length === 0) {
      res.status(404).json({ error: "Opt-in not found." });
      return;
    }
    res.json({ deleted: true });
  } catch (err) {
    req.log.error({ err }, "[content-id] delete optin failed");
    res.status(500).json({ error: "Could not delete the opt-in." });
  }
});

/* ── claim: ALWAYS fails until the CMS partnership exists ─────────────── */

router.post("/content-id/claim/:id", requireAuth, async (req, res) => {
  const id = req.params.id as string;
  if (!isUuid(id)) {
    res.status(400).json({ error: "Invalid opt-in id." });
    return;
  }
  // Verify the opt-in exists and belongs to the caller, so the 404/409
  // distinction is honest even though the answer is always "not yet".
  try {
    const rows = await db
      .select({ id: contentIdOptinsTable.id })
      .from(contentIdOptinsTable)
      .where(and(eq(contentIdOptinsTable.id, id), eq(contentIdOptinsTable.user_id, req.userId!)))
      .limit(1);
    if (rows.length === 0) {
      res.status(404).json({ error: "Opt-in not found." });
      return;
    }
  } catch (err) {
    req.log.error({ err }, "[content-id] claim lookup failed");
    res.status(500).json({ error: "Could not check the opt-in." });
    return;
  }
  res.status(409).json({ error: PARTNER_MISSING_MESSAGE, partnershipRequired: true });
});

/* ── detections (manual log) ───────────────────────────────────────────── */

router.get("/content-id/detections", requireAuth, async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(contentIdDetectionsTable)
      .where(eq(contentIdDetectionsTable.user_id, req.userId!))
      .orderBy(desc(contentIdDetectionsTable.created_at))
      .limit(500);
    res.json({ detections: rows });
  } catch (err) {
    req.log.error({ err }, "[content-id] list detections failed");
    res.status(500).json({ error: "Could not load your detected uses." });
  }
});

router.post("/content-id/detections", requireAuth, async (req, res) => {
  const parsed = insertContentIdDetectionSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid detection", details: parsed.error.issues });
    return;
  }
  const d = parsed.data;
  try {
    if (d.optin_id) {
      const owner = await db
        .select({ id: contentIdOptinsTable.id })
        .from(contentIdOptinsTable)
        .where(and(eq(contentIdOptinsTable.id, d.optin_id), eq(contentIdOptinsTable.user_id, req.userId!)))
        .limit(1);
      if (owner.length === 0) {
        res.status(400).json({ error: "That opt-in does not belong to you." });
        return;
      }
    }
    const [detection] = await db
      .insert(contentIdDetectionsTable)
      .values({
        user_id: req.userId!,
        optin_id: d.optin_id ?? null,
        video_url: d.video_url ?? "",
        channel_name: d.channel_name,
        status: "detected",
        notes: d.notes ?? "",
        detected_at: d.detected_at ?? null,
      })
      .returning();
    res.status(201).json({ detection });
  } catch (err) {
    req.log.error({ err }, "[content-id] create detection failed");
    res.status(500).json({ error: "Could not save the detected use." });
  }
});

const UpdateDetectionSchema = z.object({
  status: z.enum(CONTENT_ID_DETECTION_STATUSES).optional(),
  notes: z.string().trim().max(1000).optional(),
  channel_name: z.string().trim().min(1).max(200).optional(),
  video_url: z.string().trim().max(500).optional(),
});

router.patch("/content-id/detections/:id", requireAuth, async (req, res) => {
  const id = req.params.id as string;
  if (!isUuid(id)) {
    res.status(400).json({ error: "Invalid detection id." });
    return;
  }
  const parsed = UpdateDetectionSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid detection update", details: parsed.error.issues });
    return;
  }
  try {
    const patch: Record<string, unknown> = { updated_at: new Date() };
    for (const k of ["status", "notes", "channel_name", "video_url"] as const) {
      const v = parsed.data[k];
      if (v !== undefined) patch[k] = v;
    }
    const [row] = await db
      .update(contentIdDetectionsTable)
      .set(patch)
      .where(and(eq(contentIdDetectionsTable.id, id), eq(contentIdDetectionsTable.user_id, req.userId!)))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Detection not found." });
      return;
    }
    res.json({ detection: row });
  } catch (err) {
    req.log.error({ err }, "[content-id] update detection failed");
    res.status(500).json({ error: "Could not update the detection." });
  }
});

router.delete("/content-id/detections/:id", requireAuth, async (req, res) => {
  const id = req.params.id as string;
  if (!isUuid(id)) {
    res.status(400).json({ error: "Invalid detection id." });
    return;
  }
  try {
    const deleted = await db
      .delete(contentIdDetectionsTable)
      .where(and(eq(contentIdDetectionsTable.id, id), eq(contentIdDetectionsTable.user_id, req.userId!)))
      .returning({ id: contentIdDetectionsTable.id });
    if (deleted.length === 0) {
      res.status(404).json({ error: "Detection not found." });
      return;
    }
    res.json({ deleted: true });
  } catch (err) {
    req.log.error({ err }, "[content-id] delete detection failed");
    res.status(500).json({ error: "Could not delete the detection." });
  }
});

export default router;
